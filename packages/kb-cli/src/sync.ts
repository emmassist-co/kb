import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import {
  mintCloudflareR2TemporaryCredentials,
  resolveCloudflareAccountId
} from './cloudflare-auth.js';
import {
  buildTenantKbObjectKey,
  buildTenantKbPrefix,
  collectLocalMirrorFiles,
  createTenantKbSyncManifest,
  deleteLocalMirrorFiles,
  mergeTenantKbText,
  planTenantKbPull,
  planTenantKbPush,
  planTenantKbStatus,
  readLocalMirrorFile,
  readTenantKbBaseFile,
  readTenantKbSyncManifest,
  refreshManifestLocalState,
  resolveTenantKbManifestPath,
  stripTenantKbPrefix,
  writeLocalMirrorFile,
  writeTenantKbBaseFile,
  writeTenantKbConflictFile,
  writeTenantKbSyncManifest,
  type TenantKbRemoteObject,
  type TenantKbSyncManifest
} from './r2-sync-lib.js';
import type { KnowledgeBaseCliOptions } from './index.js';

export type KnowledgeBaseSyncCommand = 'pull' | 'status' | 'push';

interface ParsedKnowledgeBaseSyncArgs {
  command: KnowledgeBaseSyncCommand;
  tenantId: string;
  mirrorRoot: string;
  deleteEnabled: boolean;
  prefix: string;
  mergeConflicts: boolean;
}

interface KnowledgeBaseRemoteStore {
  list(prefix: string): Promise<TenantKbRemoteObject[]>;
  get(objectKey: string): Promise<Uint8Array>;
  put(objectKey: string, content: Uint8Array): Promise<{ hash?: string; size: number }>;
  delete(objectKeys: string[]): Promise<void>;
}

export function renderKnowledgeBaseSyncHelp(): string {
  return 'kb sync <pull|status|push>';
}

export async function executeKnowledgeBaseSyncCommand(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): Promise<Record<string, unknown>> {
  const env = options.env ?? process.env;
  assertR2MirrorBackend(env);
  const args = parseKnowledgeBaseSyncArgs(argv, options);
  return executeParsedKnowledgeBaseSyncCommand(args, options);
}

export function resolveMirrorRoot(cwd: string, env: Record<string, string | undefined>, tenantId: string): string {
  const baseRoot = env.KB_R2_MIRROR_ROOT?.trim() || path.resolve(cwd, '.kb-r2');
  return env.KB_ROOT_DIR?.trim() || path.join(baseRoot, tenantId);
}

export function parseKnowledgeBaseSyncArgs(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): ParsedKnowledgeBaseSyncArgs {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const [commandToken, ...rest] = argv;
  if (!isKnowledgeBaseSyncCommand(commandToken)) {
    throw new Error(`Usage: ${renderKnowledgeBaseSyncHelp()}`);
  }
  const flags = parseFlags(rest);
  const tenantId = env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  const configuredRoot = readNonEmptyString(env.KB_CANONICAL_ROOT_DIR) ?? '.kb';
  return {
    command: commandToken,
    tenantId,
    mirrorRoot: resolveMirrorRoot(cwd, env, tenantId),
    deleteEnabled: flags.delete === true,
    prefix: buildTenantKbPrefix(configuredRoot, tenantId),
    mergeConflicts: flags['no-merge'] !== true
  };
}

async function executeParsedKnowledgeBaseSyncCommand(
  args: ParsedKnowledgeBaseSyncArgs,
  options: KnowledgeBaseCliOptions
): Promise<Record<string, unknown>> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const remoteStore = await createKnowledgeBaseRemoteStore(cwd, env);
  const manifestPath = resolveTenantKbManifestPath(args.mirrorRoot);
  const existingManifest =
    (await readTenantKbSyncManifest(manifestPath)) ??
    createTenantKbSyncManifest({
      tenantId: args.tenantId,
      bucketName: resolveKbBucketName(cwd, env),
      prefix: args.prefix
    });
  const remoteObjects = await listRelativeRemoteObjects(remoteStore, args.prefix);
  const localFiles = await collectLocalMirrorFiles(args.mirrorRoot);

  if (args.command === 'status') {
    const status = planTenantKbStatus({
      manifest: existingManifest,
      remoteObjects,
      localFiles
    });
    return {
      ok: true,
      command: 'status',
      tenantId: args.tenantId,
      mirrorRoot: args.mirrorRoot,
      prefix: args.prefix,
      entries: status.entries
    };
  }

  if (args.command === 'pull') {
    const pulledAt = new Date().toISOString();
    const plan = planTenantKbPull({
      remoteObjects,
      localFiles,
      manifest: existingManifest,
      deleteExtraLocal: args.deleteEnabled
    });

    for (const entry of plan.downloads) {
      const content = await remoteStore.get(buildTenantKbObjectKey(args.prefix, entry.key));
      await writeLocalMirrorFile(args.mirrorRoot, entry.key, content);
    }
    if (plan.staleLocalFiles.length > 0) {
      await deleteLocalMirrorFiles(args.mirrorRoot, plan.staleLocalFiles);
    }

    const nextLocalFiles = await collectLocalMirrorFiles(args.mirrorRoot);
    await refreshBaseSnapshots(args.mirrorRoot, nextLocalFiles);
    const nextManifest = refreshManifestLocalState(
      {
        ...plan.nextManifest,
        pulledAt,
        files: plan.nextManifest.files
      },
      nextLocalFiles,
      { pulledAt }
    );
    await writeTenantKbSyncManifest(manifestPath, nextManifest);

    return {
      ok: true,
      command: 'pull',
      tenantId: args.tenantId,
      downloaded: plan.downloads.length,
      deletedLocal: plan.staleLocalFiles.length,
      conflicts: plan.conflicts,
      mirrorRoot: args.mirrorRoot,
      manifestPath
    };
  }

  const manifest = await readTenantKbSyncManifest(manifestPath);
  if (!manifest) {
    throw new Error(`No sync manifest found at ${manifestPath}. Run \`kb sync pull\` first.`);
  }

  const pushedAt = new Date().toISOString();
  const plan = planTenantKbPush({
    manifest,
    remoteObjects,
    localFiles,
    deleteRemoteMissing: args.deleteEnabled,
    pushedAt
  });
  const uploadedHashes = new Map<string, { hash?: string; size: number }>();
  const unresolvedConflicts: string[] = [];

  if (plan.conflicts.length > 0) {
    if (!args.mergeConflicts) {
      throw new Error(`Push aborted due to remote conflicts:\n${plan.conflicts.map((entry) => `- ${entry}`).join('\n')}`);
    }
    for (const entryPath of plan.conflicts) {
      const base = await readTenantKbBaseFile(args.mirrorRoot, entryPath);
      const local = await readLocalMirrorFile(args.mirrorRoot, entryPath);
      const remote = await remoteStore.get(buildTenantKbObjectKey(args.prefix, entryPath));
      const merge = base
        ? mergeTenantKbText({ base: base.toString('utf8'), local: local.toString('utf8'), remote: Buffer.from(remote).toString('utf8') })
        : { ok: false, content: mergeTenantKbText({ base: '', local: local.toString('utf8'), remote: Buffer.from(remote).toString('utf8') }).content };
      if (!merge.ok) {
        const conflictAt = pushedAt;
        await writeTenantKbConflictFile(args.mirrorRoot, conflictAt, entryPath, 'base', base ?? '');
        await writeTenantKbConflictFile(args.mirrorRoot, conflictAt, entryPath, 'local', local);
        await writeTenantKbConflictFile(args.mirrorRoot, conflictAt, entryPath, 'remote', remote);
        await writeTenantKbConflictFile(args.mirrorRoot, conflictAt, entryPath, 'merged-with-conflicts', merge.content);
        unresolvedConflicts.push(entryPath);
        continue;
      }
      const content = Buffer.from(merge.content, 'utf8');
      await writeLocalMirrorFile(args.mirrorRoot, entryPath, content);
      uploadedHashes.set(
        entryPath,
        await remoteStore.put(buildTenantKbObjectKey(args.prefix, entryPath), content)
      );
    }
    if (unresolvedConflicts.length > 0) {
      throw new Error(`Push aborted due to unresolved remote conflicts. Conflict copies were written under .kb-sync-conflicts:\n${unresolvedConflicts.map((entry) => `- ${entry}`).join('\n')}`);
    }
  }

  for (const entry of plan.uploads) {
    const content = await readLocalMirrorFile(args.mirrorRoot, entry.path);
    uploadedHashes.set(
      entry.path,
      await remoteStore.put(buildTenantKbObjectKey(args.prefix, entry.path), content)
    );
  }
  if (plan.deletions.length > 0) {
    await remoteStore.delete(plan.deletions.map((entry) => buildTenantKbObjectKey(args.prefix, entry)));
  }

  let nextManifest: TenantKbSyncManifest = refreshManifestLocalState(plan.nextManifest, await collectLocalMirrorFiles(args.mirrorRoot), {
    pushedAt
  });
  for (const [entryPath, uploaded] of uploadedHashes.entries()) {
    nextManifest.files[entryPath] = {
      ...nextManifest.files[entryPath],
      key: entryPath,
      size: uploaded.size,
      remoteHash: uploaded.hash ?? nextManifest.files[entryPath]?.remoteHash,
      localHash: nextManifest.files[entryPath]?.localHash,
      lastSyncedAt: pushedAt
    };
  }
  await refreshBaseSnapshots(args.mirrorRoot, await collectLocalMirrorFiles(args.mirrorRoot));
  await writeTenantKbSyncManifest(manifestPath, nextManifest);

  return {
    ok: true,
    command: 'push',
    tenantId: args.tenantId,
    uploaded: plan.uploads.length,
    deletedRemote: plan.deletions.length,
    skippedDeletions: plan.skippedDeletions,
    mirrorRoot: args.mirrorRoot,
    manifestPath
  };
}

async function refreshBaseSnapshots(
  mirrorRoot: string,
  localFiles: Awaited<ReturnType<typeof collectLocalMirrorFiles>>
): Promise<void> {
  for (const entry of localFiles) {
    await writeTenantKbBaseFile(mirrorRoot, entry.path, await readLocalMirrorFile(mirrorRoot, entry.path));
  }
}

async function listRelativeRemoteObjects(remoteStore: KnowledgeBaseRemoteStore, prefix: string): Promise<TenantKbRemoteObject[]> {
  const objects = await remoteStore.list(prefix);
  return objects.map((entry) => ({
    ...entry,
    key: stripTenantKbPrefix(prefix, entry.key)
  })).sort((left, right) => left.key.localeCompare(right.key));
}

async function createKnowledgeBaseRemoteStore(
  cwd: string,
  env: Record<string, string | undefined>
): Promise<KnowledgeBaseRemoteStore> {
  const accessKeyId = readNonEmptyString(env.R2_ACCESS_KEY_ID) ?? readNonEmptyString(env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = readNonEmptyString(env.R2_SECRET_ACCESS_KEY) ?? readNonEmptyString(env.AWS_SECRET_ACCESS_KEY);
  const accountId = resolveCloudflareAccountId(env);
  const bucketName = resolveKbBucketName(cwd, env);
  const sessionToken = readNonEmptyString(env.R2_SESSION_TOKEN) ?? readNonEmptyString(env.AWS_SESSION_TOKEN);
  const credentials = accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey, sessionToken }
    : await mintCloudflareR2TemporaryCredentials({ accountId, bucket: bucketName, permission: 'object-read-write' }, env);

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials
  });

  return {
    async list(prefix) {
      const results: TenantKbRemoteObject[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken
          })
        );
        for (const entry of response.Contents ?? []) {
          if (!entry.Key) continue;
          results.push({
            key: entry.Key,
            size: entry.Size,
            hash: normalizeRemoteHash(entry.ETag)
          });
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return results;
    },
    async get(objectKey) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: objectKey }));
      if (!response.Body) throw new Error(`Remote object body missing for ${objectKey}`);
      return response.Body.transformToByteArray();
    },
    async put(objectKey, content) {
      const response = await client.send(new PutObjectCommand({ Bucket: bucketName, Key: objectKey, Body: content }));
      return {
        hash: normalizeRemoteHash(response.ETag),
        size: content.byteLength
      };
    },
    async delete(objectKeys) {
      if (objectKeys.length === 0) return;
      await client.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objectKeys.map((entry) => ({ Key: entry })), Quiet: true }
      }));
    }
  };
}

function resolveKbBucketName(cwd: string, env: Record<string, string | undefined>): string {
  const explicit = readNonEmptyString(env.KB_CANONICAL_R2_BUCKET);
  if (explicit) return explicit;
  const wranglerPath = path.join(cwd, 'wrangler.jsonc');
  const config = JSON.parse(readFileSync(wranglerPath, 'utf8')) as {
    r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
  };
  const bucket = config.r2_buckets?.find((entry) => entry.binding === 'KB_CANONICAL_R2')?.bucket_name;
  if (!bucket) {
    throw new Error(`Could not resolve KB_CANONICAL_R2 bucket name from ${wranglerPath}.`);
  }
  return bucket;
}

function normalizeRemoteHash(value: string | undefined): string | undefined {
  return value?.replace(/^"+|"+$/g, '') || undefined;
}

function isKnowledgeBaseSyncCommand(value: string | undefined): value is KnowledgeBaseSyncCommand {
  return value === 'pull' || value === 'status' || value === 'push';
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function readNonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertR2MirrorBackend(env: Record<string, string | undefined>): void {
  if (env.KB_BACKEND?.trim().toLowerCase() !== 'r2-mirror') {
    throw new Error('`kb sync` is only supported with KB_BACKEND=r2-mirror.');
  }
}
