import { KnowledgeBaseService, type KnowledgeBaseConfig } from '@emmassist-co/kb-core';
import {
  SnapshotKnowledgeStore,
  clonePersistedKnowledgeState,
  createEmptyPersistedKnowledgeState,
  type PersistedKnowledgeState
} from '@emmassist-co/kb-core/snapshot-store';
import { R2CanonicalKbStore } from './r2-store.js';

const SNAPSHOT_KEY = 'kb.snapshot';
const SYNC_STATE_KEY = 'kb.sync-state';
const META_KEY = 'kb.meta';
const CANONICAL_SCHEMA_VERSION = 'v2';

export interface KnowledgeBaseDoStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  deleteAll?(): Promise<void>;
  setAlarm?(scheduledTime: number | Date | null): Promise<void> | void;
  getAlarm?(): Promise<number | null>;
}

export interface KnowledgeBaseDoContextLike {
  storage: KnowledgeBaseDoStorageLike;
}

export interface KnowledgeBaseDoEnvLike {
  KB_CANONICAL_R2: ConstructorParameters<typeof R2CanonicalKbStore>[0];
}

interface StoredMeta {
  tenantId: string | null;
  rootDir: string;
  versionCounter: number;
}

interface StoredSyncState {
  pendingCount: number;
  lastSyncStatus: 'idle' | 'pending' | 'error';
  lastSyncError: string | null;
  lastSuccessfulSyncAt: string | null;
  lastExportedVersion: string | null;
  canonicalSchemaVersion: string;
}

export class KnowledgeBaseStateMethods {
  constructor(
    private readonly ctx: KnowledgeBaseDoContextLike,
    private readonly env: KnowledgeBaseDoEnvLike
  ) {}

  async invoke(input: {
    tenantId: string;
    config: KnowledgeBaseConfig;
    method: keyof KnowledgeBaseService & string;
    args: unknown[];
  }): Promise<unknown> {
    const runtime = await this.ensureRuntime(input.tenantId, input.config);
    const store = new SnapshotKnowledgeStore(clonePersistedKnowledgeState(runtime.snapshot));
    const service = new KnowledgeBaseService(input.tenantId, input.config, store);
    let result = await dispatchMethod(service, input.method, input.args);

    if (store.isDirty()) {
      const version = await this.persistSnapshot(input.tenantId, runtime.rootDir, store.snapshot());
      await this.writeSyncState({
        pendingCount: 1,
        lastSyncStatus: 'pending',
        lastSyncError: null,
        lastSuccessfulSyncAt: runtime.syncState.lastSuccessfulSyncAt,
        lastExportedVersion: version,
        canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION
      });
      await this.scheduleBackgroundAlarm();
    }

    if (input.method === 'doctor' && result && typeof result === 'object') {
      result = {
        ...result,
        persistence: {
          authoritativeBackend: 'durable-object-snapshot',
          canonicalSyncMode: 'async-r2',
          ...(await this.readSyncState())
        }
      };
    }

    return result;
  }

  async rebuildSnapshot(input: { tenantId: string; config: KnowledgeBaseConfig }) {
    const runtime = await this.ensureRuntime(input.tenantId, input.config);
    const version = await this.exportCanonical(runtime.snapshot, runtime.rootDir, input.tenantId, input.config.mode, runtime.meta.versionCounter);
    const now = new Date().toISOString();
    await this.writeSyncState({
      pendingCount: 0,
      lastSyncStatus: 'idle',
      lastSyncError: null,
      lastSuccessfulSyncAt: now,
      lastExportedVersion: version,
      canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION
    });
    return {
      ok: true as const,
      version,
      rebuiltAt: now,
      counts: countsFromSnapshot(runtime.snapshot)
    };
  }

  async restoreSnapshotFromCanonical(input: { tenantId: string; config: KnowledgeBaseConfig }) {
    const canonical = new R2CanonicalKbStore(this.env.KB_CANONICAL_R2, this.rootDir(input.config), input.tenantId, input.config.mode);
    const loaded = await canonical.load();
    const snapshot = normalizeMode(loaded.state, input.config.mode);
    const now = new Date().toISOString();
    const meta = await this.readMeta(this.rootDir(input.config));
    await this.ctx.storage.put(SNAPSHOT_KEY, snapshot);
    await this.ctx.storage.put(META_KEY, {
      ...meta,
      tenantId: input.tenantId
    } satisfies StoredMeta);
    await this.writeSyncState({
      pendingCount: 0,
      lastSyncStatus: 'idle',
      lastSyncError: null,
      lastSuccessfulSyncAt: now,
      lastExportedVersion: loaded.version,
      canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION
    });
    return {
      ok: true as const,
      version: loaded.version,
      restoredAt: now,
      counts: countsFromSnapshot(snapshot)
    };
  }

  async resetSnapshot(input: { tenantId: string; config: KnowledgeBaseConfig }) {
    const rootDir = this.rootDir(input.config);
    const canonical = new R2CanonicalKbStore(this.env.KB_CANONICAL_R2, rootDir, input.tenantId, input.config.mode);
    await canonical.reset();
    const empty = createEmptyPersistedKnowledgeState(input.config.mode);
    const meta = await this.readMeta(rootDir);
    await this.ctx.storage.put(SNAPSHOT_KEY, empty);
    await this.ctx.storage.put(META_KEY, {
      ...meta,
      tenantId: input.tenantId
    } satisfies StoredMeta);
    await this.writeSyncState(createEmptySyncState());
    return {
      ok: true as const,
      tenantId: input.tenantId,
      version: null,
      resetAt: new Date().toISOString(),
      counts: countsFromSnapshot(empty)
    };
  }

  async alarm(): Promise<void> {
    const meta = await this.readMeta();
    const syncState = await this.readSyncState();
    if (!meta.tenantId || syncState.pendingCount === 0) {
      await this.clearAlarm();
      return;
    }

    const snapshot = await this.readSnapshot('basic');
    try {
      const version = await this.exportCanonical(snapshot, meta.rootDir, meta.tenantId, snapshot.mode, meta.versionCounter);
      await this.writeSyncState({
        pendingCount: 0,
        lastSyncStatus: 'idle',
        lastSyncError: null,
        lastSuccessfulSyncAt: new Date().toISOString(),
        lastExportedVersion: version,
        canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION
      });
      await this.clearAlarm();
    } catch (error) {
      await this.writeSyncState({
        pendingCount: 1,
        lastSyncStatus: 'error',
        lastSyncError: error instanceof Error ? error.message : String(error),
        lastSuccessfulSyncAt: syncState.lastSuccessfulSyncAt,
        lastExportedVersion: syncState.lastExportedVersion,
        canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION
      });
      await this.scheduleBackgroundAlarm();
      throw error;
    }
  }

  private async ensureRuntime(tenantId: string, config: KnowledgeBaseConfig): Promise<{
    snapshot: PersistedKnowledgeState;
    syncState: StoredSyncState;
    rootDir: string;
    meta: StoredMeta;
  }> {
    const rootDir = this.rootDir(config);
    const snapshot = await this.readSnapshot(config.mode);
    const syncState = await this.readSyncState();
    const meta = await this.readMeta(rootDir);
    if (meta.tenantId !== tenantId || meta.rootDir !== rootDir) {
      const nextMeta = { ...meta, tenantId, rootDir } satisfies StoredMeta;
      await this.ctx.storage.put(META_KEY, nextMeta);
      return { snapshot, syncState, rootDir, meta: nextMeta };
    }
    return { snapshot, syncState, rootDir, meta };
  }

  private async readSnapshot(mode: KnowledgeBaseConfig['mode']): Promise<PersistedKnowledgeState> {
    return normalizeMode(
      (await this.ctx.storage.get<PersistedKnowledgeState>(SNAPSHOT_KEY)) ?? createEmptyPersistedKnowledgeState(mode),
      mode
    );
  }

  private async readMeta(rootDir = '.kb'): Promise<StoredMeta> {
    return (await this.ctx.storage.get<StoredMeta>(META_KEY)) ?? {
      tenantId: null,
      rootDir,
      versionCounter: 0
    };
  }

  private async readSyncState(): Promise<StoredSyncState> {
    return (await this.ctx.storage.get<StoredSyncState>(SYNC_STATE_KEY)) ?? createEmptySyncState();
  }

  private async writeSyncState(state: StoredSyncState): Promise<void> {
    await this.ctx.storage.put(SYNC_STATE_KEY, state);
  }

  private async persistSnapshot(tenantId: string, rootDir: string, snapshot: PersistedKnowledgeState): Promise<string> {
    const meta = await this.readMeta(rootDir);
    const nextMeta = {
      tenantId,
      rootDir,
      versionCounter: meta.versionCounter + 1
    } satisfies StoredMeta;
    await this.ctx.storage.put(SNAPSHOT_KEY, snapshot);
    await this.ctx.storage.put(META_KEY, nextMeta);
    return buildVersion(nextMeta.versionCounter);
  }

  private async exportCanonical(
    snapshot: PersistedKnowledgeState,
    rootDir: string,
    tenantId: string,
    mode: KnowledgeBaseConfig['mode'],
    versionCounter: number
  ): Promise<string> {
    const store = new R2CanonicalKbStore(this.env.KB_CANONICAL_R2, rootDir, tenantId, mode);
    const version = buildVersion(versionCounter);
    await store.save(snapshot, version);
    return version;
  }

  private rootDir(config: KnowledgeBaseConfig): string {
    return config.persistence.rootDir || '.kb';
  }

  private async scheduleBackgroundAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm?.(Date.now() + 1_000);
  }

  private async clearAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm?.(null);
  }
}

function buildVersion(counter: number): string {
  return `do-snapshot-${counter}`;
}

function countsFromSnapshot(snapshot: PersistedKnowledgeState) {
  return {
    entities: Object.keys(snapshot.entities).length,
    sources: Object.keys(snapshot.sources).length,
    events: snapshot.events.length,
    links: snapshot.links.length,
    drafts: Object.keys(snapshot.drafts).length,
    registry: Object.keys(snapshot.registry).length
  };
}

function normalizeMode(snapshot: PersistedKnowledgeState, mode: KnowledgeBaseConfig['mode']): PersistedKnowledgeState {
  if (snapshot.mode === mode) return snapshot;
  return {
    ...snapshot,
    mode
  };
}

function createEmptySyncState(): StoredSyncState {
  return {
    pendingCount: 0,
    lastSyncStatus: 'idle',
    lastSyncError: null,
    lastSuccessfulSyncAt: null,
    lastExportedVersion: null,
    canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION
  };
}

async function dispatchMethod(service: KnowledgeBaseService, method: keyof KnowledgeBaseService & string, args: unknown[]): Promise<unknown> {
  const candidate = (service as unknown as Record<string, unknown>)[method];
  if (typeof candidate !== 'function') {
    throw new Error(`Unknown KB state method: ${method}`);
  }
  return (candidate as (...fnArgs: unknown[]) => Promise<unknown>).apply(service, args);
}
