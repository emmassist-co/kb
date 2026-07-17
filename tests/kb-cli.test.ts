import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { startKnowledgeBaseCliDaemon } from '../packages/kb-cli/src/daemon.js';
import {
  executeKnowledgeBaseCloudflareDeployCommand,
  executeKnowledgeBaseCloudflareVerifyCommand
} from '../packages/kb-cli/src/cloudflare-deploy.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/file-store.js';
import { startKnowledgeBaseNodeServer } from '../packages/kb-http/src/node-server.js';
import { buildSubcommandArgv, runKnowledgeBaseCli } from '../packages/kb-cli/src/index.js';
import { summarizeKnowledgeBaseSyncResult } from '../packages/kb-cli/src/sync.js';
import { applyKnowledgeBaseSemanticSyncEdits, summarizeKnowledgeBaseSyncDaemonResult } from '../packages/kb-cli/src/sync-daemon.js';
import { validateKnowledgeBaseMirrorEntries } from '../packages/kb-cli/src/mirror-validation.js';
import { summarizeKnowledgeBaseHealthChecks } from '../packages/kb-cli/src/health.js';
import { isSandboxListenError } from './helpers.js';


test('kb cli exposes static agent-improvement help without workflow commands', async () => {
  const result = await runKnowledgeBaseCli(['help', 'agent-improvement']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /kb agent improvement support/);
  assert.match(result.stdout, /Agents think; KB stores, validates, retrieves, relates, and exposes evidence/);
  assert.match(result.stdout, /kb-agent-improvement/);
  assert.match(result.stdout, /agent-correction-sweep\.md/);
  assert.match(result.stdout, /kb-local validate <remember\|record\|relate\|annotate>/);
  assert.doesNotMatch(result.stdout, /kb-local improve/);
  assert.doesNotMatch(result.stdout, /kb-local ingest-docs/);
  assert.doesNotMatch(result.stdout, /kb-local detect-contradictions/);
});

test('kb cli local mode can record and search in-process', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-local-'));

  try {
    const record = await runKnowledgeBaseCli(
      ['record', '--json', '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe owns billing."}}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(record.exitCode, 0);
    const recordPayload = JSON.parse(record.stdout) as {
      entityIds: string[];
      eventIds: string[];
      hydrated: {
        entities: Array<{ meta: { id: string; title: string } }>;
        sources: unknown[];
        events: unknown[];
        links: unknown[];
      };
    };
    assert.deepEqual(recordPayload.entityIds, ['vendor-stripe']);
    assert.deepEqual(recordPayload.eventIds, []);
    assert.equal(recordPayload.hydrated.entities[0]?.meta.id, 'vendor-stripe');
    assert.equal(recordPayload.hydrated.entities[0]?.meta.title, 'Stripe');
    assert.deepEqual(recordPayload.hydrated.sources, []);
    assert.deepEqual(recordPayload.hydrated.events, []);
    assert.deepEqual(recordPayload.hydrated.links, []);

    const search = await runKnowledgeBaseCli(
      ['search', '--json', '{"query":"billing stripe"}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(search.exitCode, 0);
    const parsed = JSON.parse(search.stdout) as { results: Array<{ id: string; trust?: { currentness: string } }> };
    assert.equal(parsed.results[0]?.id, 'vendor-stripe');
    assert.equal(parsed.results[0]?.trust?.currentness, 'current');

    const evidence = await runKnowledgeBaseCli(
      ['evidence', '--id', 'vendor-stripe'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(evidence.exitCode, 0);
    const evidencePayload = JSON.parse(evidence.stdout) as { id: string; currentTruth: { claims: Array<{ text: string }> } };
    assert.equal(evidencePayload.id, 'vendor-stripe');
    assert.equal(evidencePayload.currentTruth.claims[0]?.text, 'Stripe owns billing.');

    const recall = await runKnowledgeBaseCli(
      ['recall', '--json', '{"query":"billing stripe","purpose":"pre-answer"}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(recall.exitCode, 0);
    const recallPayload = JSON.parse(recall.stdout) as { purpose?: string; claims: Array<{ entityId?: string }> };
    assert.equal(recallPayload.purpose, 'pre-answer');
    assert.equal(recallPayload.claims[0]?.entityId, 'vendor-stripe');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli proposal review flow promotes canonical writes', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-proposal-'));

  try {
    const submit = await runKnowledgeBaseCli(
      [
        'submit-proposal',
        '--json',
        '{"id":"proposal_billing","operation":"record","payload":{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe owns billing."}}}'
      ],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(submit.exitCode, 0);
    assert.equal((JSON.parse(submit.stdout) as { status: string }).status, 'review_pending');

    const review = await runKnowledgeBaseCli(
      ['review-proposal', '--id', 'proposal_billing', '--json', '{"status":"approved","reviewer":"operator"}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(review.exitCode, 0);
    assert.equal((JSON.parse(review.stdout) as { status: string }).status, 'approved');

    const apply = await runKnowledgeBaseCli(
      ['apply-proposal', '--id', 'proposal_billing', '--applied-by', 'operator'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(apply.exitCode, 0);
    const appliedPayload = JSON.parse(apply.stdout) as { proposal: { status: string }; mutation: { entityIds: string[] } };
    assert.equal(appliedPayload.proposal.status, 'applied');
    assert.deepEqual(appliedPayload.mutation.entityIds, ['vendor-stripe']);

    const debt = await runKnowledgeBaseCli(
      ['debt'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(debt.exitCode, 0);
    assert.equal(typeof (JSON.parse(debt.stdout) as { ok: boolean }).ok, 'boolean');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli write responses expose hydrated links and event writeback', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-writeback-'));

  try {
    const setup = await runKnowledgeBaseCli(
      [
        'record-batch',
        '--json',
        '[{"entity":{"id":"person-alex","kind":"person","title":"Alex"}},{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme runs billing."}}]'
      ],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(setup.exitCode, 0);

    const relate = await runKnowledgeBaseCli(
      ['relate', '--json', '{"type":"founder_of","fromId":"person-alex","toId":"company-acme"}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(relate.exitCode, 0);
    const relatePayload = JSON.parse(relate.stdout) as {
      hydrated: {
        entities: Array<{ meta: { id: string } }>;
        links: Array<{ type: string; fromId: string; toId: string }>;
      };
    };
    assert.deepEqual(
      relatePayload.hydrated.entities.map((entity) => entity.meta.id),
      ['company-acme', 'person-alex']
    );
    assert.deepEqual(relatePayload.hydrated.links.map((link) => ({
      type: link.type,
      fromId: link.fromId,
      toId: link.toId
    })), [
      {
        type: 'founder_of',
        fromId: 'person-alex',
        toId: 'company-acme'
      }
    ]);

    const annotate = await runKnowledgeBaseCli(
      [
        'annotate',
        '--json',
        '{"entity_ids":["company-acme"],"summary":"2026-06-08: Confirmed founder edge.","effective_at":"2026-06-08T00:00:00.000Z"}'
      ],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(annotate.exitCode, 0);
    const annotatePayload = JSON.parse(annotate.stdout) as {
      eventIds: string[];
      hydrated: {
        entities: Array<{ timeline: string[] }>;
        events: Array<{ summary: string }>;
      };
    };
    assert.equal(annotatePayload.eventIds.length, 1);
    assert.match(annotatePayload.hydrated.entities[0]?.timeline[0] ?? '', /2026-06-08: Confirmed founder edge\./);
    assert.match(annotatePayload.hydrated.events[0]?.summary ?? '', /2026-06-08: Confirmed founder edge\./);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli daemon helper serves canonical endpoints over localhost', async (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-daemon-'));
  let daemon;

  try {
    daemon = await startKnowledgeBaseCliDaemon({
      tenantId: 'acme',
      rootDir
    });
  } catch (error) {
    rmSync(rootDir, { recursive: true, force: true });
    if (isSandboxListenError(error)) {
      t.skip('sandbox blocks localhost listen');
      return;
    }
    throw error;
  }

  try {
    const response = await fetch(`${daemon.url}/v1/capabilities`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { capabilities: { backend: string; canonical: boolean; workspaceRole: string } };
    assert.equal(payload.capabilities.backend, 'file');
    assert.equal(payload.capabilities.canonical, false);
    assert.equal(payload.capabilities.workspaceRole, 'local-development');
  } finally {
    await daemon.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli http mode can search through the daemon contract', async (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-http-'));
  const service = new KnowledgeBaseService(
    'acme',
    {
      enabled: true,
      mode: 'basic',
      writePolicy: 'mixed',
      persistence: { backend: 'file', cacheRefreshPolicy: 'none', rootDir: '.kb' },
      ingest: {
        agentTurns: false,
        userCorrections: false,
        workspaceSignals: false,
        externalResearch: false
      }
    },
    new FileKnowledgeStore(rootDir, 'basic')
  );
  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe owns billing.'
    }
  });
  let server;

  try {
    server = await startKnowledgeBaseNodeServer({
      service,
      capabilities: {
        backend: 'file',
        canonical: false,
        mode: 'local',
        tenantId: 'acme',
        transport: 'http',
        workspaceRole: 'local-development'
      }
    });
  } catch (error) {
    rmSync(rootDir, { recursive: true, force: true });
    if (isSandboxListenError(error)) {
      t.skip('sandbox blocks localhost listen');
      return;
    }
    throw error;
  }

  try {
    const result = await runKnowledgeBaseCli(
      ['search', '--json', '{"query":"billing stripe"}'],
      {
        transport: {
          mode: 'http',
          baseUrl: server.url
        }
      }
    );
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { results: Array<{ id: string }> };
    assert.equal(parsed.results[0]?.id, 'vendor-stripe');
  } finally {
    await server.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli http mode sends bearer auth to protected remote hosts', async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const result = await runKnowledgeBaseCli(
    ['inspect'],
    {
      transport: {
        mode: 'http',
        baseUrl: 'https://kb.example.com',
        token: 'top-secret',
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          seen.push({
            url: String(input),
            authorization: headers.get('authorization')
          });
          return new Response(JSON.stringify({
            ok: true,
            data: {
              backend: 'cloudflare',
              canonical: true,
              tenantId: 'acme',
              transport: 'worker',
              workspaceRole: 'canonical-production'
            }
          }), {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          });
        }
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, [{
    url: 'https://kb.example.com/v1/inspect',
    authorization: 'Bearer top-secret'
  }]);
});

test('kb cli resolves remote bearer auth from environment', async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push(headers.get('authorization') ?? '');
    return new Response(JSON.stringify({
      ok: true,
      data: { status: 'ok' }
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    });
  }) as typeof fetch;

  try {
    const result = await runKnowledgeBaseCli(
      ['doctor'],
      {
        env: {
          KB_BASE_URL: 'https://kb.example.com',
          KB_API_TOKEN: 'from-env'
        }
      }
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(seen, ['Bearer from-env']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('kb cloudflare deploy generates a secret, installs it, and verifies both surfaces', async () => {
  const writes = new Map<string, string>();
  const commands: Array<{ command: string; args: string[]; stdin?: string }> = [];
  const requests: Array<{ url: string; authorization: string | null; method: string }> = [];

  const result = await executeKnowledgeBaseCloudflareDeployCommand(
    [
      '--workspace', '/tmp/acme-kb',
      '--workspace-id', 'acme',
      '--worker-name', 'acme-kb',
      '--bucket', 'acme-kb-canonical',
      '--host-url', 'https://kb.acme.example'
    ],
    {
      mkdir: async () => undefined,
      writeFile: async (filePath, contents) => {
        writes.set(String(filePath), String(contents));
      },
      randomToken: () => 'generated-secret',
      runCommand: async (command, args, commandOptions) => {
        commands.push({ command, args, stdin: commandOptions?.stdin });
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      },
      fetchImpl: (async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          authorization: headers.get('authorization'),
          method: init?.method ?? 'GET'
        });
        if (String(input).endsWith('/v1/capabilities')) {
          return new Response(JSON.stringify({
            ok: true,
            capabilities: {
              tenantId: 'acme',
              backend: 'cloudflare',
              canonical: true,
              workspaceRole: 'canonical-production'
            }
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'kb-cloudflare-deploy-verify',
          result: { tools: [] }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch
    }
  );

  assert.equal(result.auth.token, 'generated-secret');
  assert.equal(result.auth.generated, true);
  assert.equal(result.hostUrl, 'https://kb.acme.example');
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], {
    command: 'npx',
    args: ['wrangler', 'secret', 'put', 'KB_API_TOKEN', '--name', 'acme-kb', '--config', 'wrangler.jsonc'],
    stdin: 'generated-secret\n'
  });
  assert.deepEqual(commands[1], {
    command: 'npx',
    args: ['wrangler', 'deploy', '--config', 'wrangler.jsonc'],
    stdin: undefined
  });
  assert.deepEqual(requests, [
    {
      url: 'https://kb.acme.example/v1/capabilities',
      authorization: 'Bearer generated-secret',
      method: 'GET'
    },
    {
      url: 'https://kb.acme.example/mcp',
      authorization: 'Bearer generated-secret',
      method: 'POST'
    }
  ]);
  assert.match(writes.get('/tmp/acme-kb/src/kb-worker.ts') ?? '', /createKnowledgeBaseMcpFetch/);
  assert.match(writes.get('/tmp/acme-kb/src/kb-worker.ts') ?? '', /KB_API_TOKEN/);
  assert.doesNotMatch(writes.get('/tmp/acme-kb/src/kb-worker.ts') ?? '', /generated-secret/);
  assert.match(writes.get('/tmp/acme-kb/wrangler.jsonc') ?? '', /acme-kb-canonical/);
  assert.match(writes.get('/tmp/acme-kb/wrangler.jsonc') ?? '', /KB_WORKSPACE_ID/);
});

test('kb cloudflare deploy accepts a provided secret without generating a replacement', async () => {
  const result = await executeKnowledgeBaseCloudflareDeployCommand(
    [
      '--workspace', '/tmp/acme-kb',
      '--tenant-id', 'acme',
      '--secret', 'provided-secret'
    ],
    {
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      randomToken: () => 'should-not-be-used',
      runCommand: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
      fetchImpl: (async (input) => {
        if (String(input).endsWith('/v1/capabilities')) {
          return new Response(JSON.stringify({
            ok: true,
            capabilities: {
              tenantId: 'acme',
              backend: 'cloudflare',
              canonical: true,
              workspaceRole: 'canonical-production'
            }
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch
    }
  );

  assert.equal(result.auth.token, 'provided-secret');
  assert.equal(result.auth.generated, false);
});

test('kb cloudflare verify checks both capabilities and mcp on a protected host', async () => {
  const requests: Array<{ url: string; authorization: string | null; method: string }> = [];

  const result = await executeKnowledgeBaseCloudflareVerifyCommand(
    [
      '--host-url', 'https://kb.acme.example',
      '--workspace-id', 'acme'
    ],
    {
      env: {
        KB_API_TOKEN: 'verify-secret'
      },
      fetchImpl: (async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          authorization: headers.get('authorization'),
          method: init?.method ?? 'GET'
        });
        if (String(input).endsWith('/v1/capabilities')) {
          return new Response(JSON.stringify({
            ok: true,
            capabilities: {
              tenantId: 'acme',
              backend: 'cloudflare',
              canonical: true,
              workspaceRole: 'canonical-production'
            }
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'kb-cloudflare-verify',
          result: {
            tools: [
              { name: 'capabilities' },
              { name: 'search' }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch
    }
  );

  assert.equal(result.hostUrl, 'https://kb.acme.example');
  assert.equal(result.verification.capabilities.tenantId, 'acme');
  assert.deepEqual(result.verification.mcp.toolNames, ['capabilities', 'search']);
  assert.deepEqual(requests, [
    {
      url: 'https://kb.acme.example/v1/capabilities',
      authorization: 'Bearer verify-secret',
      method: 'GET'
    },
    {
      url: 'https://kb.acme.example/mcp',
      authorization: 'Bearer verify-secret',
      method: 'POST'
    }
  ]);
});

test('kb cloudflare verify fails clearly without a configured token', async () => {
  await assert.rejects(
    executeKnowledgeBaseCloudflareVerifyCommand(
      ['--host-url', 'https://kb.acme.example'],
      {
        env: {}
      }
    ),
    /Missing KB_API_TOKEN, KB_BEARER_TOKEN, or --token/
  );
});

test('kb cloudflare verify fails when mcp verification is rejected', async () => {
  await assert.rejects(
    executeKnowledgeBaseCloudflareVerifyCommand(
      ['--host-url', 'https://kb.acme.example'],
      {
        env: {
          KB_API_TOKEN: 'verify-secret'
        },
        fetchImpl: (async (input) => {
          if (String(input).endsWith('/v1/capabilities')) {
            return new Response(JSON.stringify({
              ok: true,
              capabilities: {
                tenantId: 'acme',
                backend: 'cloudflare',
                canonical: true,
                workspaceRole: 'canonical-production'
              }
            }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          return new Response('forbidden', { status: 403 });
        }) as typeof fetch
      }
    ),
    /Cloudflare verification failed for \/mcp with 403/
  );
});

test('kb cli schema documents required fields and valid enums for write commands', async () => {
  const result = await runKnowledgeBaseCli(['schema', 'remember']);

  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout) as {
    command: string;
    required: string[];
    enums: Record<string, string[]>;
    note: string;
  };
  assert.equal(parsed.command, 'remember');
  assert.deepEqual(parsed.required, ['intent', 'summary']);
  assert.deepEqual(parsed.enums.intent, ['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile']);
  assert.match(parsed.note, /Use `record` for structured entities/i);
  assert.match(parsed.note, /`relate` for explicit edges/i);
});

test('kb cli help makes the edge-writing split explicit', async () => {
  const result = await runKnowledgeBaseCli(['help']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Use `kb record` for structured entities/);
  assert.match(result.stdout, /Use `kb relate` for explicit relation edges between existing entities/);
  assert.match(result.stdout, /Do not use `kb annotate` for relation edges/);
  assert.match(result.stdout, /Only use `record\.relations\[\]` when you are already creating or rewriting the entity/);
  assert.match(result.stdout, /workspace namespace, backend, canonicality/);
  assert.match(result.stdout, /kb help operator/);
  assert.doesNotMatch(result.stdout, /kb capture-source --json @payload\.json/);
  assert.doesNotMatch(result.stdout, /kb events/);
  assert.doesNotMatch(result.stdout, /kb drafts/);
  assert.doesNotMatch(result.stdout, /kb relations \[--entity-id/);
  assert.match(result.stdout, /kb sync <pull\|status\|push> \[--verbose] \[--changes] \[--conflicts] \[--stats]/);
  assert.match(result.stdout, /kb daemon <start\|stop\|restart\|status\|logs\|once> \[--verbose] \[--logs] \[--stats]/);
  assert.match(result.stdout, /kb cloudflare deploy --workspace-id WORKSPACE_ID/);
  assert.match(result.stdout, /kb cloudflare verify \[--host-url URL] \[--token VALUE] \[--workspace-id ID]/);
  assert.match(result.stdout, /verify both `\/v1` and `\/mcp`/);
  assert.match(result.stdout, /recheck an existing protected Cloudflare KB host without redeploying it/);
});

test('kb cli runtime help exposes trust-substrate contract for package users', async () => {
  const result = await runKnowledgeBaseCli(['help', 'runtime'], {
    env: {
      KB_BASE_URL: 'https://kb.example.com',
      KB_WORKSPACE_ID: 'acme'
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /KB runtime contract/);
  assert.match(result.stdout, /workspace: acme/);
  assert.match(result.stdout, /backend: http/);
  assert.match(result.stdout, /transport: http/);
  assert.match(result.stdout, /canonical: unknown \(run `kb inspect`\)/);
  assert.match(result.stdout, /workspace role: unknown \(run `kb inspect`\)/);
  assert.match(result.stdout, /trust substrate: 2026-07-16\.trust-substrate/);
  assert.match(result.stdout, /Use `kb evidence --id ENTITY_ID` before asserting/);
  assert.match(result.stdout, /Recall bundles never mutate state/);
});

test('kb cloudflare help exposes both deploy and verify flows', async () => {
  const result = await runKnowledgeBaseCli(['cloudflare', 'help']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /kb cloudflare <deploy\|verify> \[flags]/);
  assert.match(result.stdout, /kb cloudflare deploy --workspace-id WORKSPACE_ID/);
  assert.match(result.stdout, /kb cloudflare verify \[flags]/);
  assert.match(result.stdout, /checks \/mcp through a real MCP tools\/list request/);
});

test('kb cli operator help exposes repair-only commands explicitly', async () => {
  const result = await runKnowledgeBaseCli(['help', 'operator']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /kb capture-source --json @payload\.json/);
  assert.match(result.stdout, /kb events/);
  assert.match(result.stdout, /kb drafts/);
  assert.match(result.stdout, /kb relations \[--entity-id/);
  assert.match(result.stdout, /repair, cleanup, or inspection/i);
  assert.match(result.stdout, /Default agent work should stay on `search`, `query-relations`, `remember`, `record`, `relate`, and `annotate`/);
});

test('kb cli inspect exposes tenant and workspace role for local mode', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-inspect-'));

  try {
    await runKnowledgeBaseCli(
      ['record', '--json', '{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme runs billing."}}'],
      {
        transport: { mode: 'local', tenantId: 'acme', rootDir }
      }
    );
    const result = await runKnowledgeBaseCli(['inspect'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });

    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      tenantId: string;
      backend: string;
      canonical: boolean;
      workspaceRole: string;
      rootDir: string;
      summary: {
        entities: Array<{ id: string }>;
        mode: string;
      };
    };
    assert.equal(parsed.tenantId, 'acme');
    assert.equal(parsed.backend, 'file');
    assert.equal(parsed.canonical, false);
    assert.equal(parsed.workspaceRole, 'local-development');
    assert.equal(parsed.rootDir, rootDir);
    assert.equal(parsed.summary.mode, 'basic');
    assert.deepEqual(parsed.summary.entities.map((entity) => entity.id), ['company-acme']);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli rejects canonical-style backends without an http target', async () => {
  const cloudflare = await runKnowledgeBaseCli(['inspect'], {
    env: {
      KB_BACKEND: 'cloudflare',
      KB_TENANT_ID: 'acme'
    }
  });
  assert.equal(cloudflare.exitCode, 1);
  assert.match(cloudflare.stderr, /KB_BACKEND=cloudflare is not a direct local CLI workspace/i);
  assert.match(cloudflare.stderr, /Use KB_BASE_URL to target the canonical deployed kb-http surface/i);

  const r2 = await runKnowledgeBaseCli(['inspect'], {
    env: {
      KB_BACKEND: 'r2',
      KB_TENANT_ID: 'acme'
    }
  });
  assert.equal(r2.exitCode, 1);
  assert.match(r2.stderr, /KB_BACKEND=r2 is not a direct local CLI workspace/i);
});

test('kb cli sync commands are rejected outside r2-mirror mode', async () => {
  const result = await runKnowledgeBaseCli(['sync', 'status'], {
    env: {
      KB_BACKEND: 'file',
      KB_TENANT_ID: 'acme'
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /only supported with KB_BACKEND=r2-mirror/i);
});

test('kb cli daemon commands are rejected outside r2-mirror mode', async () => {
  const result = await runKnowledgeBaseCli(['daemon', 'status'], {
    env: {
      KB_BACKEND: 'http',
      KB_BASE_URL: 'http://127.0.0.1:3001'
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /only supported with KB_BACKEND=r2-mirror/i);
});

test('kb cli rebuilds subcommand argv with trailing flags intact', () => {
  assert.deepEqual(
    buildSubcommandArgv({
      positionals: ['sync', 'status'],
      flags: { changes: true, verbose: true, lines: '20' }
    }, 1),
    ['status', '--changes', '--verbose', '--lines', '20']
  );
});

test('kb sync status defaults to a compact aggregate-only envelope', () => {
  const summary = summarizeKnowledgeBaseSyncResult({
    ok: true,
    command: 'status',
    tenantId: 'acme',
    mirrorRoot: '/tmp/acme',
    prefix: '.kb/acme/',
    entries: [
      { path: 'entities/vendor-acme.md', state: 'unchanged' },
      { path: 'entities/vendor-globex.md', state: 'modified-local' },
      { path: 'entities/vendor-initech.md', state: 'added-remote' }
    ]
  });

  assert.deepEqual(summary, {
    ok: true,
    command: 'sync',
    action: 'status',
    state: 'drift',
    counts: {
      changed: 2,
      conflicts: 0
    },
    hints: ['has_local_changes', 'needs_pull']
  });
});

test('kb sync status can disclose changed paths on demand', () => {
  const summary = summarizeKnowledgeBaseSyncResult({
    ok: true,
    command: 'status',
    tenantId: 'acme',
    mirrorRoot: '/tmp/acme',
    prefix: '.kb/acme/',
    entries: [
      { path: 'entities/vendor-globex.md', state: 'modified-local' },
      { path: 'entities/vendor-initech.md', state: 'added-remote' }
    ]
  }, { changes: true });

  assert.deepEqual(summary, {
    ok: true,
    command: 'sync',
    action: 'status',
    state: 'drift',
    counts: {
      changed: 2,
      conflicts: 0
    },
    hints: ['has_local_changes', 'needs_pull'],
    changes: {
      modifiedLocal: ['entities/vendor-globex.md'],
      addedRemote: ['entities/vendor-initech.md']
    }
  });
});

test('kb sync status surfaces support-only local edits as rejected semantic drift', () => {
  const summary = summarizeKnowledgeBaseSyncResult({
    ok: true,
    command: 'status',
    tenantId: 'acme',
    mirrorRoot: '/tmp/acme',
    prefix: '.kb/acme/',
    entries: [
      { path: 'events/evt-1.json', state: 'rejected-local' }
    ]
  }, { changes: true });

  assert.deepEqual(summary, {
    ok: true,
    command: 'sync',
    action: 'status',
    state: 'rejected',
    counts: {
      changed: 1,
      conflicts: 0,
      rejected: 1
    },
    hints: ['has_rejected_local_edits'],
    changes: {
      rejectedLocal: ['events/evt-1.json']
    }
  });
});

test('kb daemon status defaults to a compact health envelope', () => {
  const summary = summarizeKnowledgeBaseSyncDaemonResult({
    stdout: 'kb daemon running (pid 123)\n{"state":"idle","action":"pull","detail":"ok","updatedAt":"2026-05-13T10:00:00.000Z"}',
    stderr: '',
    exitCode: 0
  });

  assert.deepEqual(summary, {
    ok: true,
    command: 'daemon',
    action: 'status',
    state: 'idle',
    counts: {},
    hints: ['running']
  });
});

test('kb daemon status does not surface stale running hints when the daemon is down', () => {
  const summary = summarizeKnowledgeBaseSyncDaemonResult({
    stdout: 'kb daemon not running\n{"state":"idle","action":"sleep","detail":"next pull at 1781098216","pid":32278,"updatedAt":"2026-06-10T13:25:01.049Z"}',
    stderr: '',
    exitCode: 1
  }, { stats: true });

  assert.deepEqual(summary, {
    ok: false,
    command: 'daemon',
    action: 'status',
    state: 'stopped',
    counts: {},
    hints: ['not_running'],
    stats: {
      state: 'idle',
      action: 'sleep',
      detail: 'next pull at 1781098216',
      pid: 32278,
      updatedAt: '2026-06-10T13:25:01.049Z'
    }
  });
});

test('kb daemon status surfaces semantic sync blockage when payload reports rejected edits or conflicts', () => {
  const summary = summarizeKnowledgeBaseSyncDaemonResult({
    stdout: 'kb daemon running (pid 123)\n{"state":"idle","action":"push","detail":"ok","semanticSync":{"state":"blocked","rejectedEdits":2,"conflicts":1},"updatedAt":"2026-06-11T10:00:00.000Z"}',
    stderr: '',
    exitCode: 0
  }, { stats: true });

  assert.deepEqual(summary, {
    ok: true,
    command: 'daemon',
    action: 'status',
    state: 'semantic_blocked',
    counts: {
      rejectedEdits: 2,
      semanticConflicts: 1
    },
    hints: ['running', 'semantic_sync_blocked'],
    stats: {
      state: 'idle',
      action: 'push',
      detail: 'ok',
      semanticSync: {
        state: 'blocked',
        rejectedEdits: 2,
        conflicts: 1
      },
      updatedAt: '2026-06-11T10:00:00.000Z'
    }
  });
});

test('kb daemon logs remain opt-in and compact by default', () => {
  const summary = summarizeKnowledgeBaseSyncDaemonResult({
    stdout: '[2026-05-13T10:00:00.000Z] kb sync pull\n[2026-05-13T10:00:05.000Z] {"ok":true}',
    stderr: '',
    exitCode: 0
  }, { action: 'logs' });

  assert.deepEqual(summary, {
    ok: true,
    command: 'daemon',
    action: 'logs',
    state: 'ok',
    counts: {
      lines: 2
    },
    hints: ['use_verbose_for_log_lines']
  });
});

test('kb daemon semantic pass compiles editable entity markdown into canonical mutations', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-daemon-semantic-'));
  const mirrorRoot = path.join(rootDir, 'mirror');
  const storeRoot = path.join(rootDir, 'canonical');

  try {
    const service = new KnowledgeBaseService(
      'acme',
      {
        enabled: true,
        mode: 'basic',
        writePolicy: 'mixed',
        persistence: {
          backend: 'file',
          cacheRefreshPolicy: 'none',
          rootDir: storeRoot
        },
        ingest: {
          agentTurns: false,
          userCorrections: false,
          workspaceSignals: false,
          externalResearch: false
        }
      },
      new FileKnowledgeStore(storeRoot, 'basic')
    );

    await service.record({
      entity: {
        id: 'vendor-acme',
        kind: 'vendor',
        title: 'Acme',
        aliases: ['ACME'],
        owners: ['finance'],
        currentTruth: 'Acme owns billing.',
        timeline: ['2026-06-01: Contract signed.']
      }
    });
    const canonical = await service.get('vendor-acme');
    mkdirSync(path.join(mirrorRoot, 'entities'), { recursive: true });
    mkdirSync(path.join(mirrorRoot, '.kb-sync-base', 'entities'), { recursive: true });
    writeFileSync(path.join(mirrorRoot, 'entities', 'vendor-acme.md'), `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
  - Acme Corp
handles: []
tags: []
status:
owners:
  - finance
  - ops
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing and vendor tooling.

## Open Questions

## Timeline

- 2026-06-01: Contract signed.
- 2026-06-11: Human updated ownership notes.

## Sources
`);
    writeFileSync(path.join(mirrorRoot, '.kb-sync-base', 'entities', 'vendor-acme.md'), canonical.markdown);

    const outcome = await applyKnowledgeBaseSemanticSyncEdits({
      mirrorRoot,
      statusEntries: [{ path: 'entities/vendor-acme.md', state: 'modified-local' }],
      executor: {
        get: service.get.bind(service),
        record: service.record.bind(service),
        recordSource: service.recordSource.bind(service),
        annotate: service.annotate.bind(service)
      }
    });

    assert.deepEqual(outcome, {
      appliedEdits: 1,
      rejectedEdits: 0,
      conflicts: 0,
      touchedPaths: ['entities/vendor-acme.md'],
      issues: []
    });

    const next = await service.get('vendor-acme');
    assert.equal(next.kind, 'entity');
    if (next.kind !== 'entity') return;
    assert.equal(next.parsed.currentTruth, 'Acme owns billing and vendor tooling.');
    assert.deepEqual(next.parsed.meta.aliases, ['ACME', 'Acme Corp']);
    assert.deepEqual(next.parsed.meta.owners, ['finance', 'ops']);
    assert.deepEqual(next.parsed.timeline, [
      '2026-06-01: Contract signed.',
      '2026-06-11: Human updated ownership notes.'
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb daemon semantic pass fails closed on support-only local edits', async () => {
  const outcome = await applyKnowledgeBaseSemanticSyncEdits({
    mirrorRoot: '/tmp/unused',
    statusEntries: [{ path: 'events/evt_1.json', state: 'rejected-local' }],
    executor: {
      get: async () => {
        throw new Error('should not be called');
      },
      record: async () => {
        throw new Error('should not be called');
      },
      recordSource: async () => {
        throw new Error('should not be called');
      },
      annotate: async () => {
        throw new Error('should not be called');
      }
    }
  });

  assert.deepEqual(outcome, {
    appliedEdits: 0,
    rejectedEdits: 1,
    conflicts: 0,
    touchedPaths: [],
    issues: [{
      path: 'events/evt_1.json',
      code: 'rejected_local',
      message: 'Support-only mirror file was edited locally.'
    }]
  });
});

test('kb validate-mirror helper returns structured parse and support-only issues', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-validate-mirror-'));
  const mirrorRoot = path.join(rootDir, 'mirror');

  try {
    mkdirSync(path.join(mirrorRoot, 'entities'), { recursive: true });
    mkdirSync(path.join(mirrorRoot, 'events'), { recursive: true });
    writeFileSync(path.join(mirrorRoot, 'entities', 'vendor-acme.md'), `---
id: [
---
`);
    writeFileSync(path.join(mirrorRoot, 'events', 'evt-1.json'), '{"id":"evt-1"}\n');

    const result = await validateKnowledgeBaseMirrorEntries({
      mirrorRoot,
      entries: [
        { path: 'entities/vendor-acme.md', state: 'added-local' },
        { path: 'events/evt-1.json', state: 'rejected-local' }
      ]
    });

    assert.deepEqual(result.checkedPaths, ['entities/vendor-acme.md', 'events/evt-1.json']);
    assert.deepEqual(result.issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      severity: issue.severity,
      nextAction: issue.nextAction
    })), [
      {
        path: 'entities/vendor-acme.md',
        code: 'parse_error',
        severity: 'error',
        nextAction: 'fix_markdown_and_rerun_validate_mirror'
      },
      {
        path: 'events/evt-1.json',
        code: 'support_only_edit',
        severity: 'error',
        nextAction: 'revert_support_only_edit_or_use_operator_repair'
      }
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb conflicts list show and resolve local conflict artifacts', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-conflicts-'));
  const mirrorRoot = path.join(rootDir, 'tenant-a');
  const conflictRoot = path.join(mirrorRoot, '.kb-sync-conflicts', '2026-06-23T10-00-00-000Z', 'entities');

  try {
    mkdirSync(conflictRoot, { recursive: true });
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.base'), 'base\n');
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.local'), 'local\n');
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.remote'), 'remote\n');
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.merged-with-conflicts'), 'merged\n');

    const env = {
      KB_BACKEND: 'r2-mirror',
      KB_TENANT_ID: 'tenant-a',
      KB_R2_MIRROR_ROOT: rootDir
    };
    const list = await runKnowledgeBaseCli(['conflicts', 'list'], { env });
    assert.equal(list.exitCode, 0);
    const listPayload = JSON.parse(list.stdout) as { state: string; counts: { conflicts: number }; conflicts: Array<{ path: string }> };
    assert.equal(listPayload.state, 'blocked');
    assert.equal(listPayload.counts.conflicts, 1);
    assert.equal(listPayload.conflicts[0].path, 'entities/vendor-acme.md');

    const show = await runKnowledgeBaseCli(['conflicts', 'show', '--path', 'entities/vendor-acme.md', '--contents'], { env });
    assert.equal(show.exitCode, 0);
    const showPayload = JSON.parse(show.stdout) as { contents: { local: string; remote: string } };
    assert.equal(showPayload.contents.local, 'local\n');
    assert.equal(showPayload.contents.remote, 'remote\n');

    const resolve = await runKnowledgeBaseCli(['conflicts', 'resolve', '--path', 'entities/vendor-acme.md', '--from', 'local'], { env });
    assert.equal(resolve.exitCode, 0);
    const resolved = await import('node:fs').then((fs) => fs.readFileSync(path.join(mirrorRoot, 'entities', 'vendor-acme.md'), 'utf8'));
    assert.equal(resolved, 'local\n');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb conflicts resolve from remote updates baseline and manifest hashes', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-conflicts-remote-'));
  const mirrorRoot = path.join(rootDir, 'tenant-a');
  const conflictRoot = path.join(mirrorRoot, '.kb-sync-conflicts', '2026-06-23T10-00-00-000Z', 'entities');
  const manifestPath = path.join(mirrorRoot, '.kb-sync-manifest.json');

  try {
    mkdirSync(conflictRoot, { recursive: true });
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.base'), 'base\n');
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.local'), 'local\n');
    writeFileSync(path.join(conflictRoot, 'vendor-acme.md.remote'), 'remote\n');
    writeFileSync(manifestPath, JSON.stringify({
      tenantId: 'tenant-a',
      bucketName: 'kb',
      prefix: '.kb/tenant-a/',
      pulledAt: null,
      pushedAt: null,
      files: {
        'entities/vendor-acme.md': {
          key: 'entities/vendor-acme.md',
          size: 5,
          remoteHash: 'old-remote',
          localHash: 'old-local'
        }
      }
    }));

    const env = {
      KB_BACKEND: 'r2-mirror',
      KB_TENANT_ID: 'tenant-a',
      KB_R2_MIRROR_ROOT: rootDir
    };
    const resolve = await runKnowledgeBaseCli(['conflicts', 'resolve', '--path', 'entities/vendor-acme.md', '--from', 'remote'], { env });
    assert.equal(resolve.exitCode, 0);
    const payload = JSON.parse(resolve.stdout) as { manifestUpdated: boolean };
    assert.equal(payload.manifestUpdated, true);
    assert.equal(readFileSync(path.join(mirrorRoot, 'entities', 'vendor-acme.md'), 'utf8'), 'remote\n');
    assert.equal(readFileSync(path.join(mirrorRoot, '.kb-sync-base', 'entities', 'vendor-acme.md'), 'utf8'), 'remote\n');

    const expectedHash = createHash('sha256').update('remote\n').digest('hex');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Record<string, { remoteHash?: string; localHash?: string; size?: number; lastSyncedAt?: string }>;
    };
    assert.equal(manifest.files['entities/vendor-acme.md']?.remoteHash, expectedHash);
    assert.equal(manifest.files['entities/vendor-acme.md']?.localHash, expectedHash);
    assert.equal(manifest.files['entities/vendor-acme.md']?.size, 7);
    assert.ok(manifest.files['entities/vendor-acme.md']?.lastSyncedAt);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb doctor preserves string issues and adds structured details', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-doctor-details-'));

  try {
    const service = new KnowledgeBaseService(
      'acme',
      {
        enabled: true,
        mode: 'basic',
        writePolicy: 'mixed',
        persistence: {
          backend: 'file',
          cacheRefreshPolicy: 'none',
          rootDir
        },
        ingest: {
          agentTurns: false,
          userCorrections: false,
          workspaceSignals: false,
          externalResearch: false
        }
      },
      new FileKnowledgeStore(rootDir, 'basic')
    );
    await service.record({
      entity: {
        id: 'vendor-acme',
        kind: 'vendor',
        title: 'Acme',
        currentTruth: 'Acme owns billing.',
        sources: ['src_missing']
      }
    });

    const result = await service.doctor();

    assert.equal(result.ok, false);
    assert.match(result.issues[0], /missing source reference src_missing/);
    assert.deepEqual(result.details[0], {
      code: 'missing_source_reference',
      severity: 'error',
      message: 'vendor-acme: missing source reference src_missing',
      entityId: 'vendor-acme',
      sourceId: 'src_missing',
      path: 'entities/vendor-acme.md',
      nextAction: 'restore_source_or_remove_reference'
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb health summary prioritizes blockers and next actions', () => {
  const summary = summarizeKnowledgeBaseHealthChecks({
    tenantId: 'tenant-a',
    sync: {
      state: 'rejected',
      counts: { changed: 1, conflicts: 0 }
    },
    validation: {
      ok: false,
      counts: { blockers: 1 }
    },
    daemon: {
      ok: false
    },
    conflicts: {
      counts: { conflicts: 0 }
    }
  });

  assert.deepEqual(summary, {
    ok: false,
    command: 'health',
    state: 'blocked',
    tenantId: 'tenant-a',
    workspace: {
      backend: 'r2-mirror',
      canonical: false
    },
    counts: {
      syncChanged: 1,
      syncConflicts: 0,
      validationBlockers: 1,
      conflicts: 0
    },
    blockers: ['rejected_local_edits', 'mirror_validation_failed'],
    warnings: ['daemon_not_running'],
    nextActions: ['run_validate_mirror', 'start_daemon']
  });
});

test('kb cli validate reports all write payload issues before mutation', async () => {
  const remember = await runKnowledgeBaseCli(['validate', 'remember', '--json', '{"intent":"wrong"}']);
  assert.equal(remember.exitCode, 1);
  assert.match(remember.stderr, /summary/);
  assert.match(remember.stderr, /intent/);
  assert.match(remember.stderr, /source_capture/);

  const record = await runKnowledgeBaseCli(['validate', 'record', '--json', '{}']);
  assert.equal(record.exitCode, 1);
  assert.match(record.stderr, /entity/);

  const annotate = await runKnowledgeBaseCli(['validate', 'annotate', '--json', '{"entity_ids":["vendor-stripe"]}']);
  assert.equal(annotate.exitCode, 1);
  assert.match(annotate.stderr, /summary/);

  const nested = await runKnowledgeBaseCli([
    'validate',
    'record',
    '--json',
    '{"entity":{"id":"person-alex","kind":"person","title":"Alex","handles":[{"type":"telegram","value":"@alex"}]}}'
  ]);
  assert.equal(nested.exitCode, 1);
  assert.match(nested.stderr, /entity\.handles/);
});

test('kb cli remember rejects bare json file paths with an @file hint', async () => {
  const result = await runKnowledgeBaseCli(['remember', '--json', '/workspace/kb_payload.json']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /@file\.json/);
  assert.match(result.stderr, /looks like a file path/i);
});

test('kb cli remember rejects structured content objects with a validation error', async () => {
  const result = await runKnowledgeBaseCli([
    'remember',
    '--json',
    '{"intent":"source_capture","summary":"Cloudflare invoice","content":{"type":"expense","vendor":"Cloudflare"}}'
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /content/i);
  assert.match(result.stderr, /string/i);
});

test('kb cli remember rejects field flags without --json payload transport', async () => {
  const result = await runKnowledgeBaseCli([
    'remember',
    '--intent',
    'source_capture',
    '--summary',
    'Cloudflare invoice',
    '--source',
    'gmail'
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /remember accepts payloads only through --json/i);
  assert.match(result.stderr, /--json @payload\.json/);
});

test('kb cli delete removes test entities cleanly', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-delete-'));

  try {
    const record = await runKnowledgeBaseCli(
      ['record', '--json', '{"entity":{"id":"test-mixed-org","kind":"company","title":"Test Mixed Org","currentTruth":"Cleanup me."}}'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(record.exitCode, 0);

    const deleted = await runKnowledgeBaseCli(['delete', '--id', 'test-mixed-org'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    assert.equal(deleted.exitCode, 0);

    const listed = await runKnowledgeBaseCli(['list'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    const parsed = JSON.parse(listed.stdout) as { entities: Array<{ id: string }> };
    assert.deepEqual(parsed.entities, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli batch write commands apply multiple records and annotations', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-batch-'));

  try {
    const recordBatch = await runKnowledgeBaseCli(
      [
        'record-batch',
        '--json',
        '[{"entity":{"id":"person-alex","kind":"person","title":"Alex","currentTruth":"Alex founded Acme."}},{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme builds billing tooling."},"relations":[{"type":"founded","fromId":"person-alex","toId":"company-acme"}]}]'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(recordBatch.exitCode, 0);

    const annotateBatch = await runKnowledgeBaseCli(
      [
        'annotate-batch',
        '--json',
        '[{"entity_ids":["company-acme"],"summary":"2026-05-09: Validated founder edge.","effective_at":"2026-05-09T00:00:00.000Z"},{"entity_ids":["person-alex"],"summary":"2026-05-09: Confirmed canonical spelling."}]'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(annotateBatch.exitCode, 0);

    const company = await runKnowledgeBaseCli(['get', 'company-acme'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    assert.match(company.stdout, /Validated founder edge/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli traverse can filter for explicit structured edges', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-traverse-'));

  try {
    const record = await runKnowledgeBaseCli(
      [
        'record',
        '--json',
        '{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme works with billing systems."},"relatedEntities":[{"id":"person-alex","kind":"person","title":"Alex"}],"relations":[{"type":"founder_of","fromId":"person-alex","toId":"company-acme"}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(record.exitCode, 0);

    const traversed = await runKnowledgeBaseCli(
      ['traverse', '--id', 'company-acme', '--type', 'founder_of', '--explicit-only'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(traversed.exitCode, 0);
    const parsed = JSON.parse(traversed.stdout) as { edges: Array<{ type: string; explicitReference?: boolean }> };
    assert.equal(parsed.edges.length, 1);
    assert.equal(parsed.edges[0]?.type, 'founder_of');
    assert.equal(parsed.edges[0]?.explicitReference, true);

    const mention = await runKnowledgeBaseCli(
      [
        'replace-relations',
        '--json',
        '{"origin":{"kind":"seed","id":"legacy-mentioned-in"},"links":[{"type":"mentioned_in","fromId":"person-alex","toId":"company-acme"}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(mention.exitCode, 0);

    const defaultTraversal = await runKnowledgeBaseCli(
      ['traverse', '--id', 'person-alex', '--type', 'mentioned_in'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(defaultTraversal.exitCode, 0);
    assert.equal((JSON.parse(defaultTraversal.stdout) as { edges: unknown[] }).edges.length, 0);

    const includeMentionsTraversal = await runKnowledgeBaseCli(
      ['traverse', '--id', 'person-alex', '--type', 'mentioned_in', '--include-mentions'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(includeMentionsTraversal.exitCode, 0);
    assert.equal((JSON.parse(includeMentionsTraversal.stdout) as { edges: unknown[] }).edges.length, 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli relate adds an explicit edge between existing entities', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-relate-'));

  try {
    const record = await runKnowledgeBaseCli(
      [
        'record-batch',
        '--json',
        '[{"entity":{"id":"person-alex","kind":"person","title":"Alex"}},{"entity":{"id":"company-ki-group","kind":"company","title":"KI Group"}}]'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(record.exitCode, 0);

    const relate = await runKnowledgeBaseCli(
      [
        'relate',
        '--json',
        '{"type":"colleague_at","fromId":"person-alex","toId":"company-ki-group","confidence":0.9}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(relate.exitCode, 0);

    const traversed = await runKnowledgeBaseCli(
      ['traverse', '--id', 'person-alex', '--type', 'colleague_at', '--explicit-only'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(traversed.exitCode, 0);
    const parsed = JSON.parse(traversed.stdout) as { edges: Array<{ type: string }> };
    assert.equal(parsed.edges[0]?.type, 'colleague_at');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli exposes direct event, draft, relation, and source-capture surfaces', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-secondary-state-'));

  try {
    const captured = await runKnowledgeBaseCli(
      [
        'capture-source',
        '--json',
        '{"id":"src_note","title":"Operator note","content":"Stripe billing owner is Alex.","linkedEntities":["vendor-stripe"],"extractEntities":false}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(captured.exitCode, 0);

    const draft = await runKnowledgeBaseCli(
      [
        'put-draft',
        '--json',
        '{"entityId":"vendor-stripe","title":"Stripe","summary":"Needs cleanup","openQuestions":["Who owns support?"],"sourceIds":["src_note"]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(draft.exitCode, 0);

    const event = await runKnowledgeBaseCli(
      [
        'record',
        '--json',
        '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe handles billing."},"events":[{"summary":"2026-06-07: Billing owner captured.","sourceIds":["src_note"]}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(event.exitCode, 0);

    const relations = await runKnowledgeBaseCli(
      [
        'replace-relations',
        '--json',
        '{"origin":{"kind":"seed","id":"seed:test"},"links":[{"type":"vendor_for","fromId":"vendor-stripe","toId":"vendor-stripe"}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(relations.exitCode, 0);

    const listedEvents = await runKnowledgeBaseCli(['events'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    const listedDrafts = await runKnowledgeBaseCli(['drafts'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    const listedRelations = await runKnowledgeBaseCli(['relations', '--origin-kind', 'seed', '--origin-id', 'seed:test'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });

    assert.equal(listedEvents.exitCode, 0);
    assert.equal(listedDrafts.exitCode, 0);
    assert.equal(listedRelations.exitCode, 0);
    assert.match(listedEvents.stdout, /Billing owner captured/);
    assert.match(listedDrafts.stdout, /Needs cleanup/);
    assert.match(listedRelations.stdout, /vendor_for/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli daemon can serve browser dashboard UI and api routes', async (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-dashboard-root-'));
  const assetsDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-dashboard-assets-'));
  writeFileSync(path.join(assetsDir, 'index.html'), '<main>kb dashboard</main>', 'utf8');
  let daemon;

  try {
    daemon = await startKnowledgeBaseCliDaemon({
      tenantId: 'acme',
      rootDir,
      dashboard: {
        enabled: true,
        assetsDir
      }
    });
  } catch (error) {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(assetsDir, { recursive: true, force: true });
    if (isSandboxListenError(error)) {
      t.skip('sandbox blocks localhost listen');
      return;
    }
    throw error;
  }

  try {
    assert.match(daemon.dashboardUrl ?? '', /\/dashboard\/$/);
    const dashboard = await fetch(daemon.dashboardUrl ?? '');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /kb dashboard/);
    const capabilities = await fetch(`${daemon.url}/v1/capabilities`);
    assert.equal(capabilities.status, 200);
  } finally {
    await daemon.close();
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(assetsDir, { recursive: true, force: true });
  }
});

test('kb cli dashboard refuses non-loopback host', async () => {
  const result = await runKnowledgeBaseCli(
    ['dashboard', '--host', '0.0.0.0'],
    {
      transport: {
        mode: 'local',
        tenantId: 'acme',
        rootDir: mkdtempSync(path.join(tmpdir(), 'kb-cli-dashboard-host-'))
      }
    }
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Refusing to start dashboard on a non-loopback host/);
});
