import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyEntity, renderEntityDocument } from '../packages/kb-core/src/documents.js';
import { R2CanonicalKbStore } from '../packages/kb-storage-cloudflare/src/r2-store.js';
import { KnowledgeBaseStateMethods } from '../packages/kb-storage-cloudflare/src/state-cloudflare-do.js';

const TEST_CONFIG = {
  enabled: true,
  mode: 'basic' as const,
  writePolicy: 'mixed' as const,
  persistence: {
    backend: 'r2' as const,
    cacheRefreshPolicy: 'per-run' as const,
    rootDir: '.kb'
  },
  ingest: {
    agentTurns: false,
    userCorrections: false,
    workspaceSignals: false,
    externalResearch: false
  }
};

test('r2 canonical store round-trips durable KB state', async () => {
  const bucket = new FakeR2Bucket();
  const store = new R2CanonicalKbStore(bucket, '.kb', 'workspace-template', 'basic');

  await store.save({
    mode: 'basic',
    entities: {
      'vendor-stripe': renderEntityDocument(createEmptyEntity({
        id: 'vendor-stripe',
        tenantId: 'workspace-template',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe handles invoice payments.'
      }))
    },
    registry: {},
    sources: {},
    events: [],
    links: [],
    drafts: {}
  }, 'version-1');

  const loaded = await store.load();
  assert.equal(loaded.version, 'version-1');
  assert.match(loaded.state.entities['vendor-stripe'] ?? '', /Stripe handles invoice payments/);
});

test('kb cloudflare DO core queues canonical sync and reports pending persistence state', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });

  await methods.invoke({
    tenantId: 'workspace-template',
    config: TEST_CONFIG,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });

  const doctor = await methods.invoke({
    tenantId: 'workspace-template',
    config: TEST_CONFIG,
    method: 'doctor',
    args: []
  }) as {
    persistence?: {
      pendingCount?: number;
      lastSyncStatus?: string;
      canonicalSchemaVersion?: string;
    };
  };

  assert.equal(bucket.objects.size, 0);
  assert.equal(doctor.persistence?.pendingCount, 1);
  assert.equal(doctor.persistence?.lastSyncStatus, 'pending');
  assert.equal(doctor.persistence?.canonicalSchemaVersion, 'v2');
  assert.equal(storage.alarmCalls.length, 1);

  await methods.alarm();

  assert.ok([...bucket.objects.keys()].some((key) => key.endsWith('entities/vendor-stripe.md')));
});

test('kb cloudflare DO core rebuilds restores and resets canonical state', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });

  await methods.invoke({
    tenantId: 'workspace-template',
    config: TEST_CONFIG,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });

  const rebuilt = await methods.rebuildSnapshot({
    tenantId: 'workspace-template',
    config: TEST_CONFIG
  });
  assert.equal(rebuilt.counts.entities, 1);
  assert.ok([...bucket.objects.keys()].some((key) => key.endsWith('entities/vendor-stripe.md')));

  const canonical = new R2CanonicalKbStore(bucket, '.kb', 'workspace-template', 'basic');
  await canonical.save({
    mode: 'basic',
    entities: {
      'vendor-stripe': renderEntityDocument(createEmptyEntity({
        id: 'vendor-stripe',
        tenantId: 'workspace-template',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe owns billing approvals.'
      }))
    },
    registry: {},
    sources: {},
    events: [],
    links: [],
    drafts: {}
  }, 'restored-version');

  const restored = await methods.restoreSnapshotFromCanonical({
    tenantId: 'workspace-template',
    config: TEST_CONFIG
  });
  assert.equal(restored.version, 'restored-version');

  const entity = await methods.invoke({
    tenantId: 'workspace-template',
    config: TEST_CONFIG,
    method: 'get',
    args: ['vendor-stripe']
  }) as { markdown: string };
  assert.match(entity.markdown, /owns billing approvals/);

  const reset = await methods.resetSnapshot({
    tenantId: 'workspace-template',
    config: TEST_CONFIG
  });
  assert.equal(reset.counts.entities, 0);

  const exported = await methods.invoke({
    tenantId: 'workspace-template',
    config: TEST_CONFIG,
    method: 'export',
    args: []
  }) as { entities: unknown[] };
  assert.equal(exported.entities.length, 0);
  assert.equal(bucket.objects.size, 0);
});

class FakeR2Bucket {
  readonly objects = new Map<string, string>();

  async get(key: string) {
    const value = this.objects.get(key);
    if (value == null) return null;
    return {
      async text() {
        return value;
      }
    };
  }

  async put(key: string, value: string) {
    this.objects.set(key, value);
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? '';
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
      cursor: undefined
    };
  }
}

class FakeDurableStorage {
  private readonly values = new Map<string, unknown>();
  readonly alarmCalls: Array<number | Date | null> = [];

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
  }

  async setAlarm(scheduledTime: number | Date | null): Promise<void> {
    this.alarmCalls.push(scheduledTime);
  }
}
