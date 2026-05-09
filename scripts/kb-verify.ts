import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runKnowledgeBaseCli } from '../packages/kb-cli/src/index.js';
import { startKnowledgeBaseCliDaemon } from '../packages/kb-cli/src/daemon.js';

export interface ParsedArgs {
  mode: 'all' | 'local' | 'daemon';
  tenantId?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    mode: 'all'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--mode') {
      const next = argv[index + 1];
      if (next !== 'all' && next !== 'local' && next !== 'daemon') {
        throw new Error(`Invalid mode: ${next ?? '(missing)'}`);
      }
      parsed.mode = next;
      index += 1;
      continue;
    }
    if (arg === '--tenant-id') {
      parsed.tenantId = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function buildKbVerifyFixture(tenantId: string) {
  return {
    tenantId,
    record: {
      entity: {
        id: 'vendor-stripe',
        kind: 'vendor' as const,
        title: 'Stripe',
        currentTruth: 'Stripe handles invoice payments.'
      }
    },
    search: {
      query: 'invoice payments',
      limit: 5
    },
    expectedId: 'vendor-stripe'
  };
}

interface KbHttpClient {
  capabilities(): Promise<unknown>;
  record(input: Record<string, unknown>): Promise<unknown>;
  search(input: Record<string, unknown>): Promise<{ results?: Array<{ id?: string }> }>;
}

export function createKnowledgeBaseHttpClient(
  baseUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
  } = {}
): KbHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const root = baseUrl.replace(/\/$/, '');

  async function request(pathname: string, init?: { method?: string; body?: unknown }) {
    const response = await fetchImpl(`${root}${pathname}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {})
      },
      body: init?.body ? JSON.stringify(init.body) : undefined
    });
    const payload = await response.json() as { ok?: boolean; data?: unknown; error?: { message?: string } };
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
    }
    return payload.data ?? payload;
  }

  return {
    capabilities: () => request('/v1/capabilities'),
    record: (input) => request('/v1/record', { method: 'POST', body: input }),
    search: (input) => request('/v1/search', { method: 'POST', body: input }) as Promise<{ results?: Array<{ id?: string }> }>
  };
}

async function runSmokeAgainstHttpClient(client: KbHttpClient, fixture = buildKbVerifyFixture('kb-smoke')) {
  await client.capabilities();
  await client.record(fixture.record);
  const search = await client.search(fixture.search);
  if (search.results?.[0]?.id !== fixture.expectedId) {
    throw new Error(`KB smoke failed. Expected top result ${fixture.expectedId}, got ${search.results?.[0]?.id ?? 'none'}.`);
  }
}

export async function runLocalKbSmoke(tenantId: string): Promise<void> {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-verify-local-'));
  const fixture = buildKbVerifyFixture(tenantId);
  try {
    const record = await runKnowledgeBaseCli(
      ['record', '--json', JSON.stringify(fixture.record)],
      {
        transport: {
          mode: 'local',
          tenantId,
          rootDir
        }
      }
    );
    if (record.exitCode !== 0) throw new Error(record.stderr.trim() || 'Local KB record failed');
    const search = await runKnowledgeBaseCli(
      ['search', '--json', JSON.stringify(fixture.search)],
      {
        transport: {
          mode: 'local',
          tenantId,
          rootDir
        }
      }
    );
    if (search.exitCode !== 0) throw new Error(search.stderr.trim() || 'Local KB search failed');
    const payload = JSON.parse(search.stdout) as { results?: Array<{ id?: string }> };
    if (payload.results?.[0]?.id !== fixture.expectedId) {
      throw new Error(`Local KB smoke failed. Expected ${fixture.expectedId}, got ${payload.results?.[0]?.id ?? 'none'}.`);
    }
    console.log('kb local smoke ok');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

export async function runDaemonKbSmoke(tenantId: string): Promise<void> {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-verify-daemon-'));
  const daemon = await startKnowledgeBaseCliDaemon({ tenantId, rootDir });
  try {
    await runSmokeAgainstHttpClient(createKnowledgeBaseHttpClient(daemon.url), buildKbVerifyFixture(tenantId));
    console.log('kb daemon smoke ok');
  } finally {
    await daemon.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const tenantId = parsed.tenantId ?? `${process.env.WORKSPACE_TENANT_ID ?? 'workspace-template'}-kb-smoke`;

  if (parsed.mode === 'all' || parsed.mode === 'local') {
    await runLocalKbSmoke(tenantId);
  }
  if (parsed.mode === 'all' || parsed.mode === 'daemon') {
    await runDaemonKbSmoke(tenantId);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
