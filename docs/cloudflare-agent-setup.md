# Cloudflare KB Setup For Agents

This guide is for operators who want the canonical KB surface on Cloudflare and then want one or more agents or MCP clients to use that deployed KB over HTTP.

The target shape is:

- one tenant-scoped Worker deployment
- one Durable Object namespace for write-authoritative snapshot state
- one canonical R2 bucket for exported tenant state
- one `kb-http` surface that reports `canonical-production`
- one adjacent `/mcp` surface over the same Worker runtime
- one or more agents configured with `KB_BASE_URL` and `KB_API_TOKEN`

## What You Need

- Node `22+`
- a Cloudflare account
- `npx wrangler login` completed, or `CLOUDFLARE_API_TOKEN` configured
- a deploy workspace for the Worker

## Decide These Values First

Choose these before setup:

- `worker name`
  Example: `acme-kb`
- `tenant id`
  Stable KB namespace for the deployment
  Example: `acme`
- `root dir`
  Canonical root prefix inside the KB store
  Example: `.kb`
- `R2 bucket name`
  Example: `acme-kb-canonical`
- `route or custom domain`
  Example: `https://kb.acme.example`

Recommended defaults:

- `tenant id`: customer, workspace, or agent boundary
- `root dir`: `.kb`
- one Worker deployment per tenant boundary

## 1. Create A Worker Workspace

In a fresh folder:

```bash
npm init -y
npm install @emmassist-co/kb-core @emmassist-co/kb-http @emmassist-co/kb-mcp @emmassist-co/kb-storage-cloudflare @emmassist-co/kb-cli
npm install -D typescript wrangler
```

## 2. Preferred Bootstrap Command

The fastest supported path is the CLI bootstrap:

```bash
npx kb-local cloudflare deploy \
  --workspace . \
  --tenant-id acme \
  --worker-name acme-kb \
  --bucket acme-kb-canonical \
  --host-url https://acme-kb.workers.dev
```

This command:

- writes an MCP-capable Worker wrapper to `src/kb-worker.ts`
- writes `wrangler.jsonc`
- generates a bearer token locally unless you pass `--secret`
- installs the token with `wrangler secret put KB_API_TOKEN`
- deploys the Worker
- verifies both `/v1/capabilities` and `/mcp` with the same bearer token

The command prints the bearer token once in its JSON output when it generates the secret. The Worker source never stores that token.

To recheck the host later without redeploying:

```bash
KB_BASE_URL=https://acme-kb.workers.dev \
KB_API_TOKEN=replace-me-with-a-secret \
npx kb-local cloudflare verify --tenant-id acme
```

## 3. Add The Worker Code Manually

Create `src/kb-worker.ts` in your deploy workspace with a thin KB-specific wrapper around the published packages:

```ts
import type { KnowledgeBaseConfig, KnowledgeBaseService } from '@emmassist-co/kb-core';
import { createKnowledgeBaseCloudflareFetch } from '@emmassist-co/kb-http/cloudflare-worker';
import type { KnowledgeBaseHttpAuthConfig } from '@emmassist-co/kb-http';
import { KnowledgeBaseStateMethods } from '@emmassist-co/kb-storage-cloudflare/state-cloudflare-do';
import { createKnowledgeBaseMcpFetch } from '@emmassist-co/kb-mcp/cloudflare-worker';

type Env = {
  KB_STATE: DurableObjectNamespace<KnowledgeBaseStateObject>;
  KB_CANONICAL_R2: R2Bucket;
  KB_API_TOKEN?: string;
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
    rootDir: '.kb'
  },
  ingest: {
    agentTurns: false,
    userCorrections: false,
    workspaceSignals: false,
    externalResearch: false
  }
};

function resolveTenantId(env: Env): string {
  const tenantId = env.KB_TENANT_ID?.trim();
  if (!tenantId) throw new Error('Missing KB_TENANT_ID.');
  return tenantId;
}

function resolveConfig(env: Env): KnowledgeBaseConfig {
  const rootDir = env.KB_ROOT_DIR?.trim() || '.kb';
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
    const tenantId = resolveTenantId(env);
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
      rootDir: config.persistence.rootDir
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
```

This wrapper follows the same contract the repo tests and docs already describe:

- `kb-http` owns the `/v1/...` contract
- `kb-mcp` is the adjacent MCP surface on the same Worker
- Durable Object state is the write authority
- R2 is the canonical exported state
- `GET /v1/capabilities` must advertise `canonical-production`
- shared-secret bearer auth protects both `/v1` and `/mcp` in v1

## 4. Add Wrangler Config

Create `wrangler.jsonc`:

```jsonc
{
  "name": "acme-kb",
  "main": "src/kb-worker.ts",
  "compatibility_date": "2026-06-10",
  "vars": {
    "KB_TENANT_ID": "acme",
    "KB_ROOT_DIR": ".kb"
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
      "bucket_name": "acme-kb-canonical"
    }
  ]
}
```

Adjust the values for your tenant and bucket.

## 5. Install The Shared Secret, Create The R2 Bucket, And Deploy

Generate a secret locally or provide one yourself, then install it:

```bash
printf '%s' 'replace-me-with-a-secret' | npx wrangler secret put KB_API_TOKEN
```

Then deploy:

```bash
npx wrangler r2 bucket create acme-kb-canonical
npx wrangler deploy
```

If you want a custom domain or route, add that in your Worker config and redeploy.

## 6. Verify The Protected KB Surface

First confirm the Worker is the canonical KB surface:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret

curl -s -H "Authorization: Bearer $KB_API_TOKEN" "$KB_BASE_URL/v1/capabilities" | jq
curl -s -H "Authorization: Bearer $KB_API_TOKEN" "$KB_BASE_URL/v1/inspect" | jq
curl -s -H "Authorization: Bearer $KB_API_TOKEN" "$KB_BASE_URL/v1/doctor" | jq
```

What you want to see:

- `backend: "cloudflare"`
- `transport: "worker"`
- `canonical: true`
- `workspaceRole: "canonical-production"`
- the expected `tenantId`

The key contract line is `workspaceRole: canonical-production`. If that is not true, do not treat the Worker as the production KB surface yet.

The MCP endpoint should also be reachable with the same token at `POST /mcp`.

The supported CLI recheck path is:

```bash
KB_BASE_URL=https://YOUR-KB-HOST \
KB_API_TOKEN=replace-me-with-a-secret \
npx kb-local cloudflare verify --tenant-id acme
```

That command validates the same protected host across:

- `GET /v1/capabilities`
- `POST /mcp` via MCP `tools/list`

## 7. Connect An External MCP Client

For any MCP client that supports Streamable HTTP and static headers, configure the deployed Worker directly:

```json
{
  "mcpServers": {
    "acme-kb": {
      "transport": {
        "type": "streamable-http",
        "url": "https://YOUR-KB-HOST/mcp",
        "headers": {
          "Authorization": "Bearer replace-me-with-a-secret"
        }
      }
    }
  }
}
```

Use the same API key you use for `kb-local` remote HTTP mode. In v1, `/v1` and `/mcp` share the same bearer token.

If you are working inside the `kb` repo, you can also run:

```bash
npm run verify:deployment -- --kb-http-smoke --base-url https://YOUR-KB-HOST
```

## 8. Connect An Agent

Once the Worker is live, the simplest agent connection path is the remote HTTP mode already supported by `kb-local`:

```bash
npm install @emmassist-co/kb-cli

export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret
npx kb-local inspect
npx kb-local search --json '{"query":"billing"}'
```

For agents that should write into the KB:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-cloudflare-setup
```

Use `kb-write` for normal write operations and `kb-cloudflare-setup` when the agent needs to help an operator stand up or reconnect the canonical Cloudflare KB surface, including shared-secret auth and MCP verification.

## 9. Optional Local Mirror Support

If an operator needs a support workspace that mirrors canonical R2 state locally:

```bash
export KB_BACKEND=r2-mirror
export KB_TENANT_ID=acme
export KB_R2_MIRROR_ROOT="$PWD/.kb-sync"

npx kb-local sync pull
npx kb-local sync status
```

This is a support path, not a second production architecture.
