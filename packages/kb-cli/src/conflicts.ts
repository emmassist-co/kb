import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { KnowledgeBaseCliOptions } from './index.js';
import { resolveMirrorRoot } from './sync.js';
import {
  collectLocalMirrorFiles,
  readTenantKbSyncManifest,
  resolveTenantKbManifestPath,
  writeTenantKbBaseFile,
  writeTenantKbSyncManifest
} from './r2-sync-lib.js';

type ConflictVariant = 'base' | 'local' | 'remote' | 'merged-with-conflicts';

interface ConflictCommandOptions {
  contents?: boolean;
  from?: string;
  file?: string;
  path?: string;
  timestamp?: string;
}

interface ConflictSet {
  timestamp: string;
  path: string;
  variants: ConflictVariant[];
}

export function renderKnowledgeBaseConflictsHelp(): string {
  return 'kb conflicts <list|show|resolve> [--path PATH] [--timestamp ID] [--contents] [--from local|remote|merged|file] [--file PATH]';
}

export async function executeKnowledgeBaseConflictsCommand(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): Promise<Record<string, unknown>> {
  const action = argv[0] ?? 'list';
  const flags = parseFlags(argv.slice(1));
  const env = options.env ?? process.env;
  assertR2MirrorBackend(env);
  const tenantId = env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  const mirrorRoot = resolveMirrorRoot(options.cwd ?? process.cwd(), env, tenantId);
  const conflictRoot = path.join(mirrorRoot, '.kb-sync-conflicts');

  if (action === 'list') {
    const conflicts = filterConflictSets(await listConflictSets(conflictRoot), flags);
    return {
      ok: conflicts.length === 0,
      command: 'conflicts',
      action: 'list',
      state: conflicts.length > 0 ? 'blocked' : 'none',
      tenantId,
      counts: { conflicts: conflicts.length },
      conflicts
    };
  }
  if (action === 'show') {
    const conflicts = filterConflictSets(await listConflictSets(conflictRoot), flags);
    if (conflicts.length !== 1) {
      throw new Error(`Expected exactly one conflict. Narrow with --path and --timestamp. Found ${conflicts.length}.`);
    }
    const conflict = conflicts[0];
    const result: Record<string, unknown> = {
      ok: true,
      command: 'conflicts',
      action: 'show',
      tenantId,
      conflict
    };
    if (flags.contents) {
      result.contents = Object.fromEntries(
        await Promise.all(conflict.variants.map(async (variant) => [
          variant,
          await readFile(resolveConflictVariantPath(conflictRoot, conflict, variant), 'utf8')
        ]))
      );
    }
    return result;
  }
  if (action === 'resolve') {
    const conflicts = filterConflictSets(await listConflictSets(conflictRoot), flags);
    if (conflicts.length !== 1) {
      throw new Error(`Expected exactly one conflict. Narrow with --path and --timestamp. Found ${conflicts.length}.`);
    }
    const conflict = conflicts[0];
    const from = flags.from;
    if (!from) throw new Error('Resolve requires --from local|remote|merged|file.');
    assertCompleteConflictSet(conflict);
    const content = await readResolutionContent(conflictRoot, conflict, from, flags);
    if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
      throw new Error('Resolution content still contains conflict markers.');
    }
    const targetPath = path.join(mirrorRoot, conflict.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf8');
    let manifestUpdated = false;
    if (from === 'remote') {
      await writeTenantKbBaseFile(mirrorRoot, conflict.path, Buffer.from(content, 'utf8'));
      manifestUpdated = await markRemoteResolutionSynced(mirrorRoot, conflict.path, content);
    }
    return {
      ok: true,
      command: 'conflicts',
      action: 'resolve',
      tenantId,
      path: conflict.path,
      resolvedFrom: from,
      manifestUpdated,
      nextActions: ['run_validate_mirror', 'run_sync_status']
    };
  }
  throw new Error(`Usage: ${renderKnowledgeBaseConflictsHelp()}`);
}

async function listConflictSets(conflictRoot: string): Promise<ConflictSet[]> {
  if (!existsSync(conflictRoot)) return [];
  const results = new Map<string, ConflictSet>();
  for (const timestamp of await readdir(conflictRoot)) {
    const timestampRoot = path.join(conflictRoot, timestamp);
    await walkConflictFiles(timestampRoot, async (filePath) => {
      const relative = path.relative(timestampRoot, filePath).replaceAll(path.sep, '/');
      const match = /^(.*)\.(base|local|remote|merged-with-conflicts)$/.exec(relative);
      if (!match) return;
      const [, recordPath, variant] = match;
      const key = `${timestamp}:${recordPath}`;
      const current = results.get(key) ?? { timestamp, path: recordPath, variants: [] };
      current.variants = [...new Set([...current.variants, variant as ConflictVariant])].sort();
      results.set(key, current);
    });
  }
  return [...results.values()].sort((left, right) => `${left.timestamp}:${left.path}`.localeCompare(`${right.timestamp}:${right.path}`));
}

async function walkConflictFiles(currentPath: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(currentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const nextPath = path.join(currentPath, entry);
    const entryStat = await stat(nextPath);
    if (entryStat.isDirectory()) {
      await walkConflictFiles(nextPath, visit);
      continue;
    }
    await visit(nextPath);
  }
}

function filterConflictSets(conflicts: ConflictSet[], flags: ConflictCommandOptions): ConflictSet[] {
  return conflicts.filter((conflict) => {
    if (flags.path && conflict.path !== flags.path) return false;
    if (flags.timestamp && conflict.timestamp !== flags.timestamp) return false;
    return true;
  });
}

async function readResolutionContent(
  conflictRoot: string,
  conflict: ConflictSet,
  from: string,
  flags: ConflictCommandOptions
): Promise<string> {
  if (from === 'file') {
    if (!flags.file) throw new Error('Resolve with --from file requires --file PATH.');
    return readFile(path.resolve(flags.file), 'utf8');
  }
  const variant = from === 'merged' ? 'merged-with-conflicts' : from;
  if (!isConflictVariant(variant)) throw new Error('Resolve requires --from local|remote|merged|file.');
  if (!conflict.variants.includes(variant)) throw new Error(`Conflict variant missing: ${variant}`);
  return readFile(resolveConflictVariantPath(conflictRoot, conflict, variant), 'utf8');
}

function resolveConflictVariantPath(conflictRoot: string, conflict: ConflictSet, variant: ConflictVariant): string {
  return path.join(conflictRoot, conflict.timestamp, `${conflict.path}.${variant}`);
}

function isConflictVariant(value: string): value is ConflictVariant {
  return value === 'base' || value === 'local' || value === 'remote' || value === 'merged-with-conflicts';
}

function assertCompleteConflictSet(conflict: ConflictSet): void {
  const required: ConflictVariant[] = ['base', 'local', 'remote'];
  const missing = required.filter((variant) => !conflict.variants.includes(variant));
  if (missing.length > 0) {
    throw new Error(`Conflict set is incomplete for ${conflict.path}; missing ${missing.join(', ')}.`);
  }
}

async function markRemoteResolutionSynced(mirrorRoot: string, recordPath: string, content: string): Promise<boolean> {
  const manifestPath = resolveTenantKbManifestPath(mirrorRoot);
  const manifest = await readTenantKbSyncManifest(manifestPath);
  if (!manifest) return false;

  const localFile = (await collectLocalMirrorFiles(mirrorRoot)).find((entry) => entry.path === recordPath);
  if (!localFile) return false;
  const hash = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  const syncedAt = new Date().toISOString();

  await writeTenantKbSyncManifest(manifestPath, {
    ...manifest,
    files: {
      ...manifest.files,
      [recordPath]: {
        key: recordPath,
        size: localFile.size,
        remoteHash: hash,
        localHash: hash,
        lastSyncedAt: syncedAt
      }
    }
  });
  return true;
}

function parseFlags(argv: string[]): ConflictCommandOptions {
  const flags: ConflictCommandOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--contents') {
      flags.contents = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Usage: ${renderKnowledgeBaseConflictsHelp()}`);
    const key = token.slice(2) as keyof ConflictCommandOptions;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${token}`);
    flags[key] = next as never;
    index += 1;
  }
  return flags;
}

function assertR2MirrorBackend(env: Record<string, string | undefined>): void {
  if (env.KB_BACKEND?.trim().toLowerCase() !== 'r2-mirror') {
    throw new Error('`kb conflicts` is only supported with KB_BACKEND=r2-mirror.');
  }
}
