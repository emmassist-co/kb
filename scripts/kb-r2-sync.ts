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
} from '../src/lib/cloudflare/auth.js';
import { resolveProductConfig } from '../src/lib/product-config.js';
import {
  buildTenantKbObjectKey,
  buildTenantKbPrefix,
  collectLocalMirrorFiles,
  createTenantKbSyncManifest,
  deleteLocalMirrorFiles,
  planTenantKbPull,
  planTenantKbPush,
  planTenantKbStatus,
  mergeTenantKbText,
  readLocalMirrorFile,
  readTenantKbBaseFile,
  readTenantKbSyncManifest,
  refreshManifestLocalState,
  resolveTenantKbMirrorRoot,
  resolveTenantKbManifestPath,
  stripTenantKbPrefix,
  writeLocalMirrorFile,
  writeTenantKbBaseFile,
  writeTenantKbConflictFile,
  writeTenantKbSyncManifest,
  type TenantKbRemoteObject,
  type TenantKbSyncManifest
} from '../src/lib/kb/r2-sync.js';

export type KbR2SyncCommand = 'pull' | 'status' | 'push';

export interface ParsedKbR2SyncArgs {
  command: KbR2SyncCommand;
  tenantId: string;
  mirrorRoot: string;
  deleteEnabled: boolean;
  json: boolean;
  rootDir?: string;
  prefix: string;
  mergeConflicts: boolean;
}

interface KbR2RemoteStore {
  list(prefix: string): Promise<TenantKbRemoteObject[]>;
  get(objectKey: string): Promise<Uint8Array>;
  put(objectKey: string, content: Uint8Array): Promise<{ hash?: string; size: number }>;
  delete(objectKeys: string[]): Promise<void>;
}

export function parseKbR2SyncArgs(
  argv: string[],
  cwd = process.cwd(),
  env: Record<string, unknown> = process.env
): ParsedKbR2SyncArgs {
  const [commandToken, ...rest] = argv;
  if (!commandToken || commandToken === '--help' || commandToken === 'help') {
    throw new Error(renderKbR2SyncHelp());
  }
  if (!isKbR2SyncCommand(commandToken)) {
    throw new Error(renderKbR2SyncHelp());
  }

  const flags = parseFlags(rest);
  const tenantId = readRequiredFlag(flags, 'tenant-id');
  const productConfig = resolveProductConfig({
    ...env,
    WORKSPACE_TENANT_ID: tenantId
  });
  const configuredRoot =
    (productConfig.knowledgeBase as { persistence?: { rootDir?: string } }).persistence?.rootDir || '.kb';
  const rootDir = typeof flags.root === 'string' ? flags.root : undefined;

  return {
    command: commandToken,
    tenantId,
    mirrorRoot: resolveTenantKbMirrorRoot({ cwd, tenantId, rootDir }),
    deleteEnabled: flags.delete === true,
    json: flags.json === true,
    rootDir,
    prefix: buildTenantKbPrefix(configuredRoot, tenantId),
    mergeConflicts: flags['no-merge'] !== true
  };
}

export function renderKbR2SyncHelp(): string {
  return [
    'Usage: kb-r2-sync <pull|status|push> --tenant-id TENANT_ID [flags]',
    '',
    'Commands:',
    '  pull    Download the tenant KB mirror from R2',
    '  status  Compare local files, manifest, and current remote state',
    '  push    Upload changed local files back to R2',
    '',
    'Flags:',
    '  --tenant-id TENANT_ID   Required tenant identifier',
    '  --root PATH             Override local mirror base directory',
    '  --delete                Allow destructive sync behavior for stale files',
    '  --json                  Emit JSON output when supported',
    '  --no-merge              Disable automatic text merge for push conflicts',
    '  --help                  Show this help',
    '',
    'Environment:',
    '  CLOUDFLARE_API_TOKEN or Wrangler cached auth (preferred)',
    '  CLOUDFLARE_API_TOKEN_ID (optional, otherwise derived via token verification)',
    '  R2_ACCESS_KEY_ID / AWS_ACCESS_KEY_ID (optional explicit override)',
    '  R2_SECRET_ACCESS_KEY / AWS_SECRET_ACCESS_KEY (optional explicit override)',
    '  R2_SESSION_TOKEN / AWS_SESSION_TOKEN (optional explicit override)',
    '  CLOUDFLARE_ACCOUNT_ID (optional, falls back to `wrangler whoami --json`)',
    '  KB_CANONICAL_R2_BUCKET (optional, falls back to wrangler.jsonc binding)'
  ].join('\n');
}

export async function executeKbR2SyncCommand(
  args: ParsedKbR2SyncArgs,
  options: {
    cwd?: string;
    env?: Record<string, unknown>;
    remoteStore?: KbR2RemoteStore;
  } = {}
): Promise<Record<string, unknown>> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const remoteStore = options.remoteStore ?? (await createKbR2RemoteStore(cwd, env));
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
    throw new Error(`No sync manifest found at ${manifestPath}. Run pull first.`);
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

async function refreshBaseSnapshots(mirrorRoot: string, localFiles: Awaited<ReturnType<typeof collectLocalMirrorFiles>>): Promise<void> {
  for (const entry of localFiles) {
    await writeTenantKbBaseFile(mirrorRoot, entry.path, await readLocalMirrorFile(mirrorRoot, entry.path));
  }
}

async function listRelativeRemoteObjects(remoteStore: KbR2RemoteStore, prefix: string): Promise<TenantKbRemoteObject[]> {
  const objects = await remoteStore.list(prefix);
  return objects
    .map((entry) => ({
      ...entry,
      key: stripTenantKbPrefix(prefix, entry.key)
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

async function createKbR2RemoteStore(cwd: string, env: Record<string, unknown>): Promise<KbR2RemoteStore> {
  const accessKeyId = readNonEmptyString(env.R2_ACCESS_KEY_ID) ?? readNonEmptyString(env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = readNonEmptyString(env.R2_SECRET_ACCESS_KEY) ?? readNonEmptyString(env.AWS_SECRET_ACCESS_KEY);
  const accountId = resolveCloudflareAccountId(env);
  const bucketName = resolveKbBucketName(cwd, env);
  const sessionToken = readNonEmptyString(env.R2_SESSION_TOKEN) ?? readNonEmptyString(env.AWS_SESSION_TOKEN);
  const credentials = accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey, sessionToken }
    : await mintCloudflareR2TemporaryCredentials(
      {
        accountId,
        bucket: bucketName,
        permission: 'object-read-write'
      },
      env
    );

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials
  });

  return {
    async list(prefix: string) {
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
    async get(objectKey: string) {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: objectKey
        })
      );
      if (!response.Body) {
        throw new Error(`Remote object body missing for ${objectKey}`);
      }
      return response.Body.transformToByteArray();
    },
    async put(objectKey: string, content: Uint8Array) {
      const response = await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: content
        })
      );
      return {
        hash: normalizeRemoteHash(response.ETag),
        size: content.byteLength
      };
    },
    async delete(objectKeys: string[]) {
      if (objectKeys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: objectKeys.map((entry) => ({ Key: entry })),
            Quiet: true
          }
        })
      );
    }
  };
}

function resolveKbBucketName(cwd: string, env: Record<string, unknown>): string {
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

async function main() {
  try {
    const args = parseKbR2SyncArgs(process.argv.slice(2));
    const result = await executeKbR2SyncCommand(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isUsage = message.startsWith('Usage: kb-r2-sync');
    const stream = isUsage ? process.stdout : process.stderr;
    stream.write(`${message}\n`);
    process.exitCode = isUsage ? 0 : 1;
  }
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
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

function readRequiredFlag(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required flag: --${key}`);
  }
  return value.trim();
}

function isKbR2SyncCommand(value: string): value is KbR2SyncCommand {
  return value === 'pull' || value === 'status' || value === 'push';
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  void main();
}
