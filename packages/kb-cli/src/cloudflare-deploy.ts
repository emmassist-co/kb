import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export interface KnowledgeBaseCloudflareDeployResult {
  ok: true;
  workspacePath: string;
  workerName: string;
  tenantId: string;
  bucketName: string;
  hostUrl: string;
  auth: {
    token: string;
    generated: boolean;
  };
  files: {
    worker: string;
    wrangler: string;
  };
  verification: {
    capabilities: KnowledgeBaseCloudflareCapabilities;
    mcp: KnowledgeBaseCloudflareMcpVerification;
  };
}

export interface KnowledgeBaseCloudflareCapabilities {
  tenantId?: string;
  backend?: string;
  canonical?: boolean;
  workspaceRole?: string;
  trustSubstrate?: {
    version?: string;
    trustAwareRetrieval?: boolean;
    evidenceViews?: boolean;
    promotionReview?: boolean;
    memoryDebt?: boolean;
    decisionViews?: boolean;
    recallBundles?: boolean;
    recallMutatesState?: boolean;
  };
}

export interface KnowledgeBaseCloudflareMcpVerification {
  ok: boolean;
  status: number;
  toolNames?: string[];
}

export interface KnowledgeBaseCloudflareVerifyResult {
  ok: true;
  hostUrl: string;
  auth: {
    tokenConfigured: true;
  };
  verification: {
    capabilities: KnowledgeBaseCloudflareCapabilities;
    mcp: KnowledgeBaseCloudflareMcpVerification;
  };
}

export interface KnowledgeBaseCloudflareDeployOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  writeFile?: typeof writeFile;
  mkdir?: typeof mkdir;
  fetchImpl?: typeof fetch;
  runCommand?: (
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: string;
    }
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  randomToken?: () => string;
}

export interface KnowledgeBaseCloudflareVerifyOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export async function executeKnowledgeBaseCloudflareDeployCommand(
  argv: string[],
  options: KnowledgeBaseCloudflareDeployOptions = {}
): Promise<KnowledgeBaseCloudflareDeployResult> {
  const parsed = parseFlags(argv);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const workspacePath = path.resolve(cwd, readStringFlag(parsed, 'workspace') ?? '.');
  const tenantId = requireWorkspaceIdFlag(parsed);
  const workerName = readStringFlag(parsed, 'worker-name') ?? `${tenantId}-kb`;
  const bucketName = readStringFlag(parsed, 'bucket') ?? `${workerName}-canonical`;
  const rootDir = readStringFlag(parsed, 'root-dir') ?? '.kb';
  const hostUrl = normalizeHostUrl(readStringFlag(parsed, 'host-url') ?? `https://${workerName}.workers.dev`);
  const providedSecret = readStringFlag(parsed, 'secret') ?? readNonEmptyString(env.KB_API_TOKEN);
  const token = providedSecret ?? (options.randomToken ?? defaultRandomToken)();
  const generated = !providedSecret;
  const workerRelativePath = 'src/kb-worker.ts';
  const wranglerRelativePath = 'wrangler.jsonc';
  const workerPath = path.join(workspacePath, workerRelativePath);
  const wranglerPath = path.join(workspacePath, wranglerRelativePath);
  const writeFileImpl = options.writeFile ?? writeFile;
  const mkdirImpl = options.mkdir ?? mkdir;
  const runCommand = options.runCommand ?? runCommandWithSpawn;
  const fetchImpl = options.fetchImpl ?? fetch;

  await mkdirImpl(path.dirname(workerPath), { recursive: true });
  await writeFileImpl(
    workerPath,
    renderCloudflareWorkerTemplate({ tenantId, rootDir }),
    'utf8'
  );
  await writeFileImpl(
    wranglerPath,
    renderWranglerConfigTemplate({ workerName, tenantId, rootDir, bucketName }),
    'utf8'
  );

  await requireSuccess(
    runCommand('npx', [
      'wrangler',
      'secret',
      'put',
      'KB_API_TOKEN',
      '--name',
      workerName,
      '--config',
      wranglerRelativePath
    ], {
      cwd: workspacePath,
      env,
      stdin: `${token}\n`
    }),
    'wrangler secret put'
  );

  await requireSuccess(
    runCommand('npx', [
      'wrangler',
      'deploy',
      '--config',
      wranglerRelativePath
    ], {
      cwd: workspacePath,
      env
    }),
    'wrangler deploy'
  );

  const verification = await verifyKnowledgeBaseCloudflareHost({
    hostUrl,
    token,
    expectedTenantId: tenantId,
    fetchImpl,
    errorPrefix: 'Deployment verification'
  });

  return {
    ok: true,
    workspacePath,
    workerName,
    tenantId,
    bucketName,
    hostUrl,
    auth: {
      token,
      generated
    },
    files: {
      worker: workerPath,
      wrangler: wranglerPath
    },
    verification: verification.verification
  };
}

export async function executeKnowledgeBaseCloudflareVerifyCommand(
  argv: string[],
  options: KnowledgeBaseCloudflareVerifyOptions = {}
): Promise<KnowledgeBaseCloudflareVerifyResult> {
  const parsed = parseFlags(argv);
  const env = options.env ?? process.env;
  const hostUrl = normalizeHostUrl(readStringFlag(parsed, 'host-url') ?? readNonEmptyString(env.KB_BASE_URL) ?? '');
  if (!hostUrl) {
    throw new Error('Missing KB_BASE_URL or --host-url for kb cloudflare verify.');
  }
  const token = readStringFlag(parsed, 'token')
    ?? readNonEmptyString(env.KB_API_TOKEN)
    ?? readNonEmptyString(env.KB_BEARER_TOKEN);
  if (!token) {
    throw new Error('Missing KB_API_TOKEN, KB_BEARER_TOKEN, or --token for kb cloudflare verify.');
  }
  return verifyKnowledgeBaseCloudflareHost({
    hostUrl,
    token,
    expectedTenantId: readWorkspaceIdFlag(parsed),
    fetchImpl: options.fetchImpl ?? fetch,
    errorPrefix: 'Cloudflare verification'
  });
}

export function renderKnowledgeBaseCloudflareHelp(): string {
  return [
    'kb cloudflare <deploy|verify> [flags]',
    '',
    'Cloudflare-hosted canonical KB setup and verification commands.',
    '',
    renderKnowledgeBaseCloudflareDeployHelp(),
    '',
    renderKnowledgeBaseCloudflareVerifyHelp()
  ].join('\n');
}

export function renderKnowledgeBaseCloudflareDeployHelp(): string {
  return [
    'kb cloudflare deploy --workspace-id WORKSPACE_ID [flags]',
    '',
    'Deploy or refresh a Cloudflare-hosted canonical KB surface with shared-secret auth and MCP enabled.',
    '',
    'Flags:',
    '  --workspace PATH      Deploy workspace to scaffold or refresh. Defaults to the current directory.',
    '  --worker-name NAME    Worker name. Defaults to <workspace-id>-kb.',
    '  --bucket NAME         Canonical R2 bucket binding. Defaults to <worker-name>-canonical.',
    '  --root-dir PATH       KB root dir inside the canonical store. Defaults to .kb.',
    '  --host-url URL        Deployed hostname to verify after deploy. Defaults to https://<worker-name>.workers.dev.',
    '  --secret VALUE        Install this bearer token instead of generating one locally.',
    '',
    'Auth behavior:',
    '  - If --secret is omitted, the command generates a bearer token locally, installs it with Wrangler, and prints it once in the JSON result.',
    '  - The generated Worker wrapper never persists the bearer token in source files.',
    '  - Verification checks both /v1/capabilities and /mcp with the same bearer token.'
  ].join('\n');
}

export function renderKnowledgeBaseCloudflareVerifyHelp(): string {
  return [
    'kb cloudflare verify [flags]',
    '',
    'Verify an existing protected Cloudflare KB host without redeploying it.',
    '',
    'Flags:',
    '  --host-url URL        Cloudflare KB host URL. Defaults to KB_BASE_URL.',
    '  --token VALUE         Bearer token. Defaults to KB_API_TOKEN or KB_BEARER_TOKEN.',
    '  --workspace-id ID     Optional workspace assertion. Verification fails if the host reports a different workspace namespace.',
    '',
    'Verification behavior:',
    '  - checks /v1/capabilities and validates backend, canonical, and workspace role',
    '  - checks /mcp through a real MCP tools/list request using the same bearer token',
    '  - reports capability metadata plus the advertised MCP tool names'
  ].join('\n');
}

function renderCloudflareWorkerTemplate(input: {
  tenantId: string;
  rootDir: string;
}): string {
  return `import type { KnowledgeBaseConfig, KnowledgeBaseService } from '@emmassist-co/kb-core';
import { createKnowledgeBaseCloudflareFetch } from '@emmassist-co/kb-http/cloudflare-worker';
import type { KnowledgeBaseHttpAuthConfig } from '@emmassist-co/kb-http';
import { KnowledgeBaseStateMethods } from '@emmassist-co/kb-storage-cloudflare/state-cloudflare-do';
import { createKnowledgeBaseMcpFetch } from '@emmassist-co/kb-mcp/cloudflare-worker';

type Env = {
  KB_STATE: DurableObjectNamespace<KnowledgeBaseStateObject>;
  KB_CANONICAL_R2: R2Bucket;
  KB_API_TOKEN?: string;
  KB_WORKSPACE_ID?: string;
  KB_TENANT_ID?: string;
  KB_ROOT_DIR?: string;
};

const KB_CONFIG: KnowledgeBaseConfig = {
  enabled: true,
  mode: 'basic',
  writePolicy: 'mixed',
  persistence: {
    backend: 'cloudflare',
    cacheRefreshPolicy: 'none',
    rootDir: '${escapeTemplateLiteral(input.rootDir)}'
  },
  ingest: {
    agentTurns: false,
    userCorrections: false,
    workspaceSignals: false,
    externalResearch: false
  }
};

function resolveWorkspaceId(env: Env): string {
  const workspaceId = env.KB_WORKSPACE_ID?.trim() || env.KB_TENANT_ID?.trim() || '${escapeTemplateLiteral(input.tenantId)}';
  if (!workspaceId) throw new Error('Missing KB_WORKSPACE_ID.');
  return workspaceId;
}

function resolveConfig(env: Env): KnowledgeBaseConfig {
  const rootDir = env.KB_ROOT_DIR?.trim() || '${escapeTemplateLiteral(input.rootDir)}';
  return {
    ...KB_CONFIG,
    persistence: {
      ...KB_CONFIG.persistence,
      rootDir
    }
  };
}

function createDoService(env: Env, tenantId: string, config: KnowledgeBaseConfig): KnowledgeBaseService {
  const stub = env.KB_STATE.get(env.KB_STATE.idFromName(tenantId));
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return (...args: unknown[]) => stub.invoke({ tenantId, config, method: prop, args });
    }
  }) as KnowledgeBaseService;
}

function resolveAuth(env: Env): KnowledgeBaseHttpAuthConfig {
  const token = env.KB_API_TOKEN?.trim();
  if (!token) throw new Error('Missing KB_API_TOKEN.');
  return {
    required: true,
    challengeRealm: 'kb',
    tokens: [
      {
        token,
        scopes: ['kb.read', 'kb.write', 'kb.operator'],
        subject: 'kb-cloudflare-operator'
      }
    ]
  };
}

export class KnowledgeBaseStateObject extends DurableObject {
  private readonly methods: KnowledgeBaseStateMethods;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.methods = new KnowledgeBaseStateMethods(ctx, env);
  }

  invoke(payload: { tenantId: string; config: KnowledgeBaseConfig; method: keyof KnowledgeBaseService & string; args: unknown[] }) {
    return this.methods.invoke(payload);
  }

  rebuildSnapshot(payload: { tenantId: string; config: KnowledgeBaseConfig }) {
    return this.methods.rebuildSnapshot(payload);
  }

  restoreSnapshotFromCanonical(payload: { tenantId: string; config: KnowledgeBaseConfig }) {
    return this.methods.restoreSnapshotFromCanonical(payload);
  }

  resetSnapshot(payload: { tenantId: string; config: KnowledgeBaseConfig }) {
    return this.methods.resetSnapshot(payload);
  }

  alarm() {
    return this.methods.alarm();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const tenantId = resolveWorkspaceId(env);
    const config = resolveConfig(env);
    const auth = resolveAuth(env);
    const stub = env.KB_STATE.get(env.KB_STATE.idFromName(tenantId));
    const service = createDoService(env, tenantId, config);
    const capabilities = {
      tenantId,
      backend: 'cloudflare' as const,
      transport: 'worker' as const,
      mode: config.mode,
      canonical: true,
      workspaceRole: 'canonical-production' as const,
      rootDir: config.persistence.rootDir,
      trustSubstrate: {
        version: '2026-07-16.trust-substrate' as const,
        trustAwareRetrieval: true as const,
        evidenceViews: true as const,
        promotionReview: true as const,
        memoryDebt: true as const,
        decisionViews: true as const,
        recallBundles: true as const,
        recallMutatesState: false as const
      }
    };
    const rebuild = () => stub.rebuildSnapshot({ tenantId, config });
    const url = new URL(request.url);

    if (url.pathname.startsWith('/mcp')) {
      return createKnowledgeBaseMcpFetch({
        service,
        capabilities,
        auth,
        rebuild,
        serverInfo: {
          name: 'kb-mcp',
          version: '0.1.0'
        }
      })(request);
    }

    return createKnowledgeBaseCloudflareFetch({
      service,
      capabilities,
      auth,
      rebuild
    })(request);
  }
};
`;
}

function renderWranglerConfigTemplate(input: {
  workerName: string;
  tenantId: string;
  rootDir: string;
  bucketName: string;
}): string {
  return `{
  "name": "${escapeJsonString(input.workerName)}",
  "main": "src/kb-worker.ts",
  "compatibility_date": "2026-06-10",
  "vars": {
    "KB_WORKSPACE_ID": "${escapeJsonString(input.tenantId)}",
    "KB_ROOT_DIR": "${escapeJsonString(input.rootDir)}"
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "KB_STATE",
        "class_name": "KnowledgeBaseStateObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["KnowledgeBaseStateObject"]
    }
  ],
  "r2_buckets": [
    {
      "binding": "KB_CANONICAL_R2",
      "bucket_name": "${escapeJsonString(input.bucketName)}"
    }
  ]
}
`;
}

async function requireSuccess(
  promise: Promise<{ stdout: string; stderr: string; exitCode: number }>,
  label: string
): Promise<void> {
  const result = await promise;
  if (result.exitCode === 0) return;
  const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
  throw new Error(`${label} failed.${detail ? `\n${detail}` : ''}`);
}

async function verifyKnowledgeBaseCloudflareHost(input: {
  hostUrl: string;
  token: string;
  expectedTenantId?: string;
  fetchImpl: typeof fetch;
  errorPrefix: string;
}): Promise<KnowledgeBaseCloudflareVerifyResult> {
  const capabilitiesResponse = await input.fetchImpl(`${input.hostUrl}/v1/capabilities`, {
    headers: {
      authorization: `Bearer ${input.token}`
    }
  });
  if (!capabilitiesResponse.ok) {
    throw new Error(`${input.errorPrefix} failed for /v1/capabilities with ${capabilitiesResponse.status}.`);
  }
  const capabilitiesPayload = await capabilitiesResponse.json() as {
    ok?: boolean;
    capabilities?: KnowledgeBaseCloudflareCapabilities;
  };
  const capabilities = capabilitiesPayload.capabilities ?? {};
  if (capabilities.backend !== 'cloudflare') {
    throw new Error(`${input.errorPrefix} expected backend=cloudflare, received ${String(capabilities.backend)}.`);
  }
  if (capabilities.canonical !== true) {
    throw new Error(`${input.errorPrefix} expected canonical=true.`);
  }
  if (capabilities.workspaceRole !== 'canonical-production') {
    throw new Error(`${input.errorPrefix} expected workspaceRole=canonical-production, received ${String(capabilities.workspaceRole)}.`);
  }
  if (input.expectedTenantId && capabilities.tenantId !== input.expectedTenantId) {
    throw new Error(`${input.errorPrefix} expected tenantId=${input.expectedTenantId}, received ${String(capabilities.tenantId)}.`);
  }

  const mcpResponse = await input.fetchImpl(`${input.hostUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'kb-cloudflare-verify',
      method: 'tools/list',
      params: {}
    })
  });
  if (!mcpResponse.ok) {
    throw new Error(`${input.errorPrefix} failed for /mcp with ${mcpResponse.status}.`);
  }
  const mcpPayload = await mcpResponse.json() as {
    result?: {
      tools?: Array<{ name?: string }>;
    };
  };

  return {
    ok: true,
    hostUrl: input.hostUrl,
    auth: {
      tokenConfigured: true
    },
    verification: {
      capabilities,
      mcp: {
        ok: true,
        status: mcpResponse.status,
        toolNames: (mcpPayload.result?.tools ?? [])
          .map((tool) => tool.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      }
    }
  };
}

async function runCommandWithSpawn(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: string;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: 'pipe'
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1
      });
    });
    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const trimmed = value.slice(2);
    const separator = trimmed.indexOf('=');
    if (separator >= 0) {
      flags[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[trimmed] = next;
      index += 1;
      continue;
    }
    flags[trimmed] = true;
  }
  return flags;
}

function readStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readWorkspaceIdFlag(flags: Record<string, string | boolean>): string | undefined {
  return readStringFlag(flags, 'workspace-id') ?? readStringFlag(flags, 'tenant-id');
}

function requireWorkspaceIdFlag(flags: Record<string, string | boolean>): string {
  const value = readWorkspaceIdFlag(flags);
  if (!value) throw new Error('Missing required flag: --workspace-id');
  return value;
}

function normalizeHostUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function defaultRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function escapeTemplateLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

function escapeJsonString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
