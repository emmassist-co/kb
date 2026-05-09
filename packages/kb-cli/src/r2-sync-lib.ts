import path from 'node:path';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export interface TenantKbMirrorRootInput {
  cwd: string;
  tenantId: string;
  rootDir?: string;
}

export interface TenantKbSyncManifestFileRecord {
  key: string;
  size?: number;
  remoteHash?: string;
  localHash?: string;
  lastSyncedAt?: string;
}

export interface TenantKbSyncManifest {
  tenantId: string;
  bucketName: string;
  prefix: string;
  pulledAt: string | null;
  pushedAt: string | null;
  files: Record<string, TenantKbSyncManifestFileRecord>;
}

export interface TenantKbRemoteObject {
  key: string;
  size?: number;
  hash?: string;
}

export interface TenantKbLocalFile {
  path: string;
  size: number;
  hash: string;
}

export interface TenantKbTextMergeResult {
  ok: boolean;
  content: string;
}

export type TenantKbSyncFileState =
  | 'unchanged'
  | 'modified-local'
  | 'modified-remote'
  | 'added-local'
  | 'added-remote'
  | 'deleted-local'
  | 'deleted-remote'
  | 'conflict';

export interface TenantKbStatusEntry {
  path: string;
  state: TenantKbSyncFileState;
}

export interface TenantKbPullPlan {
  downloads: TenantKbRemoteObject[];
  staleLocalFiles: string[];
  conflicts: string[];
  nextManifest: TenantKbSyncManifest;
}

export interface TenantKbStatusPlan {
  entries: TenantKbStatusEntry[];
}

export interface TenantKbPushUpload {
  path: string;
  size: number;
  hash: string;
}

export interface TenantKbPushPlan {
  uploads: TenantKbPushUpload[];
  deletions: string[];
  skippedDeletions: string[];
  conflicts: string[];
  nextManifest: TenantKbSyncManifest;
}

export function buildTenantKbPrefix(rootDir: string, tenantId: string): string {
  return `${trimSlashes(rootDir)}/${tenantId}/`;
}

export function buildTenantKbObjectKey(prefix: string, relativePath: string): string {
  return `${prefix}${relativePath}`;
}

export function stripTenantKbPrefix(prefix: string, objectKey: string): string {
  return objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : objectKey;
}

export function resolveTenantKbMirrorRoot(input: TenantKbMirrorRootInput): string {
  const baseRoot = input.rootDir ?? path.join(input.cwd, '.tmp', 'kb-sync');
  return path.join(baseRoot, input.tenantId);
}

export function resolveTenantKbManifestPath(mirrorRoot: string): string {
  return path.join(mirrorRoot, '.kb-sync-manifest.json');
}

export function resolveTenantKbBaseRoot(mirrorRoot: string): string {
  return path.join(mirrorRoot, '.kb-sync-base');
}

export function resolveTenantKbConflictRoot(mirrorRoot: string, timestamp: string): string {
  return path.join(mirrorRoot, '.kb-sync-conflicts', timestamp.replace(/[:.]/g, '-'));
}

export async function readTenantKbSyncManifest(manifestPath: string): Promise<TenantKbSyncManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as TenantKbSyncManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeTenantKbSyncManifest(manifestPath: string, manifest: TenantKbSyncManifest): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function createTenantKbSyncManifest(input: { tenantId: string; bucketName: string; prefix: string }): TenantKbSyncManifest {
  return {
    tenantId: input.tenantId,
    bucketName: input.bucketName,
    prefix: input.prefix,
    pulledAt: null,
    pushedAt: null,
    files: {}
  };
}

export async function collectLocalMirrorFiles(mirrorRoot: string): Promise<TenantKbLocalFile[]> {
  const results: TenantKbLocalFile[] = [];
  await walkMirror(mirrorRoot, mirrorRoot, results);
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readLocalMirrorFile(mirrorRoot: string, relativePath: string): Promise<Buffer> {
  return readFile(path.join(mirrorRoot, relativePath));
}

export async function writeLocalMirrorFile(mirrorRoot: string, relativePath: string, content: Uint8Array): Promise<void> {
  const targetPath = path.join(mirrorRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
}

export async function readTenantKbBaseFile(mirrorRoot: string, relativePath: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(resolveTenantKbBaseRoot(mirrorRoot), relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeTenantKbBaseFile(mirrorRoot: string, relativePath: string, content: Uint8Array): Promise<void> {
  const targetPath = path.join(resolveTenantKbBaseRoot(mirrorRoot), relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
}

export async function writeTenantKbConflictFile(
  mirrorRoot: string,
  timestamp: string,
  relativePath: string,
  suffix: string,
  content: Uint8Array | string
): Promise<string> {
  const targetPath = path.join(resolveTenantKbConflictRoot(mirrorRoot, timestamp), `${relativePath}.${suffix}`);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return targetPath;
}

export async function deleteLocalMirrorFiles(mirrorRoot: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    await rm(path.join(mirrorRoot, relativePath), { force: true });
  }
}

export function planTenantKbPull(input: {
  remoteObjects: TenantKbRemoteObject[];
  localFiles: TenantKbLocalFile[];
  manifest: TenantKbSyncManifest;
  deleteExtraLocal: boolean;
}): TenantKbPullPlan {
  const normalizedRemote = sortRemoteObjects(input.remoteObjects);
  const localByPath = new Map(input.localFiles.map((entry) => [entry.path, entry] as const));
  const manifestByPath = input.manifest.files;
  const remotePaths = new Set(normalizedRemote.map((entry) => entry.key));
  const downloads: TenantKbRemoteObject[] = [];
  const conflicts: string[] = [];
  const staleLocalFiles = input.deleteExtraLocal
    ? input.localFiles.map((entry) => entry.path).filter((entry) => !remotePaths.has(entry))
    : [];

  for (const remote of normalizedRemote) {
    const manifest = manifestByPath[remote.key];
    const local = localByPath.get(remote.key);
    const remoteChanged = remote.hash !== manifest?.remoteHash;
    const localChanged = local && local.hash !== manifest?.localHash;
    if (!manifest || !local || (remoteChanged && !localChanged)) {
      downloads.push(remote);
      continue;
    }
    if (remoteChanged && localChanged) {
      conflicts.push(remote.key);
    }
  }

  return {
    downloads,
    staleLocalFiles,
    conflicts,
    nextManifest: {
      ...input.manifest,
      files: Object.fromEntries(
        normalizedRemote.map((entry) => {
          const local = localByPath.get(entry.key);
          const shouldDownload = downloads.some((download) => download.key === entry.key);
          const previous = manifestByPath[entry.key];
          return [
            entry.key,
            {
              key: entry.key,
              size: entry.size,
              remoteHash: shouldDownload ? entry.hash : previous?.remoteHash,
              localHash: shouldDownload ? entry.hash : local?.hash ?? previous?.localHash
            } satisfies TenantKbSyncManifestFileRecord
          ];
        })
      )
    }
  };
}

export function planTenantKbStatus(input: {
  manifest: TenantKbSyncManifest;
  remoteObjects: TenantKbRemoteObject[];
  localFiles: TenantKbLocalFile[];
}): TenantKbStatusPlan {
  const remoteByPath = new Map(input.remoteObjects.map((entry) => [entry.key, entry] as const));
  const localByPath = new Map(input.localFiles.map((entry) => [entry.path, entry] as const));
  const manifestByPath = input.manifest.files;
  const allPaths = new Set<string>([
    ...Object.keys(manifestByPath),
    ...remoteByPath.keys(),
    ...localByPath.keys()
  ]);

  const entries = [...allPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((entryPath) => ({
      path: entryPath,
      state: classifyPath({
        manifest: manifestByPath[entryPath],
        remote: remoteByPath.get(entryPath),
        local: localByPath.get(entryPath)
      })
    }))
    .filter((entry) => entry.state !== 'deleted-remote');

  return { entries };
}

export function planTenantKbPush(input: {
  manifest: TenantKbSyncManifest;
  remoteObjects: TenantKbRemoteObject[];
  localFiles: TenantKbLocalFile[];
  deleteRemoteMissing: boolean;
  pushedAt: string;
}): TenantKbPushPlan {
  const remoteByPath = new Map(input.remoteObjects.map((entry) => [entry.key, entry] as const));
  const localByPath = new Map(input.localFiles.map((entry) => [entry.path, entry] as const));
  const manifestByPath = input.manifest.files;
  const allPaths = new Set<string>([
    ...Object.keys(manifestByPath),
    ...remoteByPath.keys(),
    ...localByPath.keys()
  ]);

  const uploads: TenantKbPushUpload[] = [];
  const deletions: string[] = [];
  const skippedDeletions: string[] = [];
  const conflicts: string[] = [];
  const nextFiles = { ...input.manifest.files };

  for (const entryPath of [...allPaths].sort((left, right) => left.localeCompare(right))) {
    const manifest = manifestByPath[entryPath];
    const remote = remoteByPath.get(entryPath);
    const local = localByPath.get(entryPath);
    const state = classifyPath({ manifest, remote, local });

    if (state === 'unchanged' || state === 'added-remote' || state === 'modified-remote') {
      if (remote) {
        nextFiles[entryPath] = {
          key: entryPath,
          size: remote.size,
          remoteHash: remote.hash,
          localHash: local?.hash ?? manifest?.localHash,
          lastSyncedAt: input.pushedAt
        };
      }
      continue;
    }

    if (state === 'modified-local' || state === 'added-local') {
      if (!local) continue;
      uploads.push({ path: entryPath, size: local.size, hash: local.hash });
      nextFiles[entryPath] = {
        key: entryPath,
        size: local.size,
        remoteHash: local.hash,
        localHash: local.hash,
        lastSyncedAt: input.pushedAt
      };
      continue;
    }

    if (state === 'deleted-local') {
      if (input.deleteRemoteMissing) {
        deletions.push(entryPath);
        delete nextFiles[entryPath];
      } else {
        skippedDeletions.push(entryPath);
      }
      continue;
    }

    if (state === 'conflict') {
      conflicts.push(entryPath);
    }
  }

  return {
    uploads,
    deletions,
    skippedDeletions,
    conflicts,
    nextManifest: {
      ...input.manifest,
      pushedAt: input.pushedAt,
      files: nextFiles
    }
  };
}

export function mergeTenantKbText(input: { base: string; local: string; remote: string }): TenantKbTextMergeResult {
  if (input.local === input.remote) return { ok: true, content: input.local };
  if (input.local === input.base) return { ok: true, content: input.remote };
  if (input.remote === input.base) return { ok: true, content: input.local };
  if (input.local.startsWith(input.base) && input.remote.startsWith(input.base)) {
    const localTail = input.local.slice(input.base.length);
    const remoteTail = input.remote.slice(input.base.length);
    return { ok: true, content: `${input.base}${localTail}${remoteTail === localTail ? '' : remoteTail}` };
  }
  if (input.local.endsWith(input.base) && input.remote.endsWith(input.base)) {
    const localHead = input.local.slice(0, -input.base.length);
    const remoteHead = input.remote.slice(0, -input.base.length);
    return { ok: true, content: `${localHead}${remoteHead === localHead ? '' : remoteHead}${input.base}` };
  }
  return {
    ok: false,
    content: ['<<<<<<< LOCAL', input.local.replace(/\n$/, ''), '=======', input.remote.replace(/\n$/, ''), '>>>>>>> REMOTE', ''].join('\n')
  };
}

export function refreshManifestLocalState(
  manifest: TenantKbSyncManifest,
  localFiles: TenantKbLocalFile[],
  timestamps: { pulledAt?: string | null; pushedAt?: string | null } = {}
): TenantKbSyncManifest {
  const localByPath = new Map(localFiles.map((entry) => [entry.path, entry] as const));
  const nextFiles: Record<string, TenantKbSyncManifestFileRecord> = {};
  for (const [entryPath, file] of [...localByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const previous = manifest.files[entryPath];
    nextFiles[entryPath] = {
      key: entryPath,
      size: file.size,
      remoteHash: previous?.remoteHash,
      localHash: file.hash,
      lastSyncedAt: previous?.lastSyncedAt ?? timestamps.pulledAt ?? timestamps.pushedAt ?? undefined
    };
  }
  return {
    ...manifest,
    pulledAt: timestamps.pulledAt ?? manifest.pulledAt,
    pushedAt: timestamps.pushedAt ?? manifest.pushedAt,
    files: nextFiles
  };
}

async function walkMirror(rootDir: string, currentDir: string, results: TenantKbLocalFile[]): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(currentDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort()) {
    if (entry === '.kb-sync-manifest.json' || entry === '.kb-sync-base' || entry === '.kb-sync-conflicts') continue;
    const fullPath = path.join(currentDir, entry);
    const fileStat = await stat(fullPath);
    if (fileStat.isDirectory()) {
      await walkMirror(rootDir, fullPath, results);
      continue;
    }
    const content = await readFile(fullPath);
    results.push({
      path: path.relative(rootDir, fullPath).replaceAll(path.sep, '/'),
      size: fileStat.size,
      hash: createContentHash(content)
    });
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '') || '.kb';
}

function sortRemoteObjects(entries: TenantKbRemoteObject[]): TenantKbRemoteObject[] {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

function createContentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function classifyPath(input: {
  manifest?: TenantKbSyncManifestFileRecord;
  remote?: TenantKbRemoteObject;
  local?: TenantKbLocalFile;
}): TenantKbSyncFileState {
  if (input.manifest && input.remote && input.local) {
    const remoteMatches = input.remote.hash === input.manifest.remoteHash;
    const localMatches = input.local.hash === input.manifest.localHash;
    if (remoteMatches && localMatches) return 'unchanged';
    if (remoteMatches && !localMatches) return 'modified-local';
    if (!remoteMatches && localMatches) return 'modified-remote';
    return 'conflict';
  }
  if (input.manifest && !input.remote && input.local) return 'deleted-remote';
  if (input.manifest && input.remote && !input.local) return 'deleted-local';
  if (input.manifest && !input.remote && !input.local) return 'deleted-local';
  if (!input.manifest && input.remote && input.local) return input.remote.hash === input.local.hash ? 'added-remote' : 'conflict';
  if (!input.manifest && input.remote) return 'added-remote';
  if (!input.manifest && input.local) return 'added-local';
  return 'unchanged';
}
