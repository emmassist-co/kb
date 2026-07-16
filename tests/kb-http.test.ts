import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/file-store.js';
import { buildTrustSubstrateCapabilities } from '../packages/kb-core/src/service-helpers.js';
import { createKnowledgeBaseCloudflareFetch } from '../packages/kb-http/src/cloudflare-worker.js';
import { startKnowledgeBaseNodeServer } from '../packages/kb-http/src/node-server.js';
import { handleKnowledgeBaseHttpRequest } from '../packages/kb-http/src/server.js';
import { isSandboxListenError } from './helpers.js';

test('kb http exposes capabilities envelope', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {} as never,
      capabilities: {
        backend: 'file',
        canonical: false,
        mode: 'local',
        tenantId: 'acme',
        transport: 'http',
        workspaceRole: 'local-development'
      }
    },
    {
      method: 'GET',
      pathname: '/v1/capabilities',
      searchParams: new URLSearchParams()
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    capabilities: {
      backend: 'file',
      canonical: false,
      mode: 'local',
      tenantId: 'acme',
      transport: 'http',
      workspaceRole: 'local-development',
      trustSubstrate: buildTrustSubstrateCapabilities()
    }
  });
});

test('kb http inspect exposes capabilities plus compact workspace summary', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async list() {
          return {
            mode: 'basic',
            entities: [{ id: 'company-acme', title: 'Acme', kind: 'company' }],
            sources: [{ id: 'src_1', title: 'Handbook', kind: 'research' }],
            links: [{ type: 'founder_of', count: 1 }]
          };
        }
      } as never,
      capabilities: {
        backend: 'cloudflare',
        canonical: true,
        mode: 'local',
        tenantId: 'acme',
        transport: 'http',
        workspaceRole: 'canonical-production'
      }
    },
    {
      method: 'GET',
      pathname: '/v1/inspect',
      searchParams: new URLSearchParams()
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    data: {
      backend: 'cloudflare',
      canonical: true,
      mode: 'local',
      tenantId: 'acme',
      transport: 'http',
      workspaceRole: 'canonical-production',
      trustSubstrate: buildTrustSubstrateCapabilities(),
      summary: {
        mode: 'basic',
        entities: [{ id: 'company-acme', title: 'Acme', kind: 'company' }],
        sources: [{ id: 'src_1', title: 'Handbook', kind: 'research' }],
        links: [{ type: 'founder_of', count: 1 }]
      }
    }
  });
});

test('kb http exposes event, draft, relation, and evidence routes', async () => {
  const calls: string[] = [];
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async listEvents() {
          calls.push('listEvents');
          return [{ id: 'evt_1' }];
        },
        async getDraft(entityId: string) {
          calls.push(`getDraft:${entityId}`);
          return { entityId };
        },
        async listRelations(input: Record<string, unknown>) {
          calls.push(`listRelations:${JSON.stringify(input)}`);
          return [{ id: 'rel_1' }];
        }
      } as never
    },
    {
      method: 'GET',
      pathname: '/v1/events',
      searchParams: new URLSearchParams()
    }
  );

  const draftResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async getDraft(entityId: string) {
          calls.push(`getDraft:${entityId}`);
          return { entityId };
        }
      } as never
    },
    {
      method: 'GET',
      pathname: '/v1/drafts/vendor-stripe',
      searchParams: new URLSearchParams()
    }
  );

  const relationResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async listRelations(input: Record<string, unknown>) {
          calls.push(`listRelations:${JSON.stringify(input)}`);
          return [{ id: 'rel_1' }];
        }
      } as never
    },
    {
      method: 'GET',
      pathname: '/v1/relations',
      searchParams: new URLSearchParams('entityId=vendor-stripe&type=vendor_for')
    }
  );

  const evidenceResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async evidence(entityId: string) {
          calls.push(`evidence:${entityId}`);
          return { id: entityId, currentTruth: { claims: [] } };
        }
      } as never
    },
    {
      method: 'GET',
      pathname: '/v1/entities/vendor-stripe/evidence',
      searchParams: new URLSearchParams()
    }
  );

  assert.equal(response.status, 200);
  assert.equal(draftResponse.status, 200);
  assert.equal(relationResponse.status, 200);
  assert.equal(evidenceResponse.status, 200);
  assert.deepEqual(calls, [
    'listEvents',
    'getDraft:vendor-stripe',
    'listRelations:{"entityId":"vendor-stripe","type":"vendor_for"}',
    'evidence:vendor-stripe'
  ]);
});

test('kb http exposes proposal, review, and debt routes', async () => {
  const calls: string[] = [];
  const submitResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async submitPromotionProposal(input: Record<string, unknown>) {
          calls.push(`submit:${input.operation}`);
          return { id: 'proposal_1', ...input };
        }
      } as never
    },
    {
      method: 'POST',
      pathname: '/v1/proposals',
      searchParams: new URLSearchParams(),
      body: {
        operation: 'record',
        payload: { entity: { id: 'vendor-stripe' } }
      }
    }
  );
  const reviewResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async reviewPromotionProposal(input: Record<string, unknown>) {
          calls.push(`review:${input.proposalId}:${input.status}`);
          return input;
        }
      } as never
    },
    {
      method: 'PUT',
      pathname: '/v1/proposals/proposal_1/review',
      searchParams: new URLSearchParams(),
      body: { status: 'approved' }
    }
  );
  const applyResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async applyPromotionProposal(input: Record<string, unknown>) {
          calls.push(`apply:${input.proposalId}`);
          return { proposal: input, mutation: { entityIds: [] } };
        }
      } as never
    },
    {
      method: 'POST',
      pathname: '/v1/proposals/proposal_1/apply',
      searchParams: new URLSearchParams(),
      body: {}
    }
  );
  const debtResponse = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async memoryDebt() {
          calls.push('debt');
          return { ok: false, items: [] };
        }
      } as never
    },
    {
      method: 'GET',
      pathname: '/v1/debt',
      searchParams: new URLSearchParams()
    }
  );

  assert.equal(submitResponse.status, 200);
  assert.equal(reviewResponse.status, 200);
  assert.equal(applyResponse.status, 200);
  assert.equal(debtResponse.status, 200);
  assert.deepEqual(calls, ['submit:record', 'review:proposal_1:approved', 'apply:proposal_1', 'debt']);
});

test('kb http requires operator scope for proposal approval', async () => {
  let called = false;
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async reviewPromotionProposal() {
          called = true;
          return {};
        }
      } as never,
      auth: {
        required: true,
        tokens: [{ token: 'writer', scopes: ['kb.read', 'kb.write'] }]
      }
    },
    {
      method: 'PUT',
      pathname: '/v1/proposals/proposal_1/review',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: 'Bearer writer'
      },
      body: { status: 'approved' }
    }
  );

  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: 'forbidden',
      message: 'Missing required scopes: kb.operator'
    }
  });
});

test('kb http delegates recall requests to the service as read-only route', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async recall(input: Record<string, unknown>) {
          calls.push(input);
          return { query: input.query, claims: [] };
        }
      } as never,
      auth: {
        required: true,
        tokens: [{ token: 'reader', scopes: ['kb.read'] }]
      }
    },
    {
      method: 'POST',
      pathname: '/v1/recall',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: 'Bearer reader'
      },
      body: { query: 'billing', purpose: 'pre-answer' }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ query: 'billing', purpose: 'pre-answer' }]);
  assert.deepEqual(response.body, {
    ok: true,
    data: { query: 'billing', claims: [] }
  });
});

test('kb http delegates search requests to the service', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async search(input: Record<string, unknown>) {
          calls.push(input);
          return {
            query: String(input.query),
            mode: 'search-only',
            results: []
          };
        }
      } as never
    },
    {
      method: 'POST',
      pathname: '/v1/search',
      searchParams: new URLSearchParams(),
      body: { query: 'who owns billing', limit: 5 }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ query: 'who owns billing', limit: 5 }]);
  assert.deepEqual(response.body, {
    ok: true,
    data: {
      query: 'who owns billing',
      mode: 'search-only',
      results: []
    }
  });
});

test('kb http write routes return enriched mutation envelopes', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async annotate(input: Record<string, unknown>) {
          assert.deepEqual(input, {
            entityIds: ['company-acme'],
            summary: 'Confirmed founder edge.',
            effectiveAt: '2026-06-08T00:00:00.000Z'
          });
          return {
            mutated: true,
            entityIds: ['company-acme'],
            sourceIds: [],
            eventIds: ['evt_1'],
            warnings: [],
            hydrated: {
              entities: [{ meta: { id: 'company-acme', title: 'Acme' }, timeline: ['2026-06-08: Confirmed founder edge.'] }],
              sources: [],
              events: [{ id: 'evt_1', summary: '2026-06-08: Confirmed founder edge.' }],
              links: []
            }
          };
        }
      } as never
    },
    {
      method: 'POST',
      pathname: '/v1/annotate',
      searchParams: new URLSearchParams(),
      body: {
        entityIds: ['company-acme'],
        summary: 'Confirmed founder edge.',
        effectiveAt: '2026-06-08T00:00:00.000Z'
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    data: {
      mutated: true,
      entityIds: ['company-acme'],
      sourceIds: [],
      eventIds: ['evt_1'],
      warnings: [],
      hydrated: {
        entities: [{ meta: { id: 'company-acme', title: 'Acme' }, timeline: ['2026-06-08: Confirmed founder edge.'] }],
        sources: [],
        events: [{ id: 'evt_1', summary: '2026-06-08: Confirmed founder edge.' }],
        links: []
      }
    }
  });
});

test('kb http exposes exact source-record write route for semantic sync', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async recordSource(input: Record<string, unknown>) {
          assert.deepEqual(input, {
            source: {
              id: 'src_vendor_note',
              kind: 'note',
              title: 'Vendor note',
              linkedEntities: ['vendor-acme'],
              summary: 'Updated summary.',
              content: 'Updated content.'
            }
          });
          return {
            mutated: true,
            entityIds: [],
            sourceIds: ['src_vendor_note'],
            eventIds: [],
            warnings: [],
            hydrated: {
              entities: [],
              sources: [{ meta: { id: 'src_vendor_note', title: 'Vendor note' }, summary: 'Updated summary.' }],
              events: [],
              links: []
            }
          };
        }
      } as never
    },
    {
      method: 'POST',
      pathname: '/v1/record-source',
      searchParams: new URLSearchParams(),
      body: {
        source: {
          id: 'src_vendor_note',
          kind: 'note',
          title: 'Vendor note',
          linkedEntities: ['vendor-acme'],
          summary: 'Updated summary.',
          content: 'Updated content.'
        }
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    data: {
      mutated: true,
      entityIds: [],
      sourceIds: ['src_vendor_note'],
      eventIds: [],
      warnings: [],
      hydrated: {
        entities: [],
        sources: [{ meta: { id: 'src_vendor_note', title: 'Vendor note' }, summary: 'Updated summary.' }],
        events: [],
        links: []
      }
    }
  });
});

test('kb http node server serves the same contract over localhost', async (t) => {
  let server;

  try {
    server = await startKnowledgeBaseNodeServer({
      service: {
        async doctor() {
          return { status: 'ok' };
        }
      } as never
    });
  } catch (error) {
    if (isSandboxListenError(error)) {
      t.skip('sandbox blocks localhost listen');
      return;
    }
    throw error;
  }

  try {
    const response = await fetch(`${server.url}/v1/doctor`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      data: { status: 'ok' }
    });
  } finally {
    await server.close();
  }
});

test('kb http cloudflare adapter serves the same fetch contract', async () => {
  const fetchHandler = createKnowledgeBaseCloudflareFetch({
    service: {
      async doctor() {
        return { status: 'ok' };
      }
    } as never
  });

  const response = await fetchHandler(new Request('https://example.com/v1/doctor'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { status: 'ok' }
  });
});

test('kb http rejects protected routes without a bearer token', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async list() {
          throw new Error('should not be called');
        }
      } as never,
      auth: {
        required: true,
        tokens: [{ token: 'top-secret', scopes: ['kb.read'] }]
      }
    },
    {
      method: 'GET',
      pathname: '/v1/inspect',
      searchParams: new URLSearchParams()
    }
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers?.['WWW-Authenticate'], 'Bearer realm="kb"');
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: 'unauthorized',
      message: 'Missing or invalid bearer token.'
    }
  });
});

test('kb http rejects write routes when the token lacks write scope', async () => {
  let called = false;
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async record() {
          called = true;
          return {};
        }
      } as never,
      auth: {
        required: true,
        tokens: [{ token: 'read-only', scopes: ['kb.read'] }]
      }
    },
    {
      method: 'POST',
      pathname: '/v1/record',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: 'Bearer read-only'
      },
      body: {
        entity: {
          id: 'company-acme',
          kind: 'company',
          title: 'Acme'
        }
      }
    }
  );

  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: 'forbidden',
      message: 'Missing required scopes: kb.write'
    }
  });
});

test('kb http accepts protected read routes with a valid bearer token', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {
        async doctor() {
          return { status: 'ok' };
        }
      } as never,
      auth: {
        required: true,
        tokens: [{ token: 'reader', scopes: ['kb.read'] }]
      }
    },
    {
      method: 'GET',
      pathname: '/v1/doctor',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: 'Bearer reader'
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    data: { status: 'ok' }
  });
});

test('kb http exposes safe document read and stale-write save routes', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-http-documents-'));
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

  try {
    await service.record({
      entity: {
        id: 'company-acme',
        kind: 'company',
        title: 'Acme',
        currentTruth: 'Acme runs billing.'
      }
    });

    const getResponse = await handleKnowledgeBaseHttpRequest(
      { service: service as never },
      {
        method: 'GET',
        pathname: '/v1/documents/entity/company-acme',
        searchParams: new URLSearchParams()
      }
    );
    assert.equal(getResponse.status, 200);
    const getBody = getResponse.body as { data: { markdown: string; revision: string; parsed: { meta: { id: string; tenantId: string } } } };
    assert.equal(getBody.data.parsed.meta.id, 'company-acme');
    assert.equal(getBody.data.parsed.meta.tenantId, 'acme');

    const savedMarkdown = getBody.data.markdown.replace('Acme runs billing.', 'Acme owns billing and invoices.');
    const saveResponse = await handleKnowledgeBaseHttpRequest(
      { service: service as never },
      {
        method: 'PUT',
        pathname: '/v1/documents/entity/company-acme',
        searchParams: new URLSearchParams(),
        body: { markdown: savedMarkdown, revision: getBody.data.revision }
      }
    );
    assert.equal(saveResponse.status, 200);
    const saved = saveResponse.body as { data: { markdown: string; revision: string } };
    assert.match(saved.data.markdown, /owns billing/);
    assert.notEqual(saved.data.revision, getBody.data.revision);

    await assert.rejects(
      () => handleKnowledgeBaseHttpRequest(
        { service: service as never },
        {
          method: 'PUT',
          pathname: '/v1/documents/entity/company-acme',
          searchParams: new URLSearchParams(),
          body: { markdown: savedMarkdown, revision: getBody.data.revision }
        }
      ),
      /Stale entity document revision/
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb http document save rejects identity changes', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-http-doc-identity-'));
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

  try {
    await service.record({ entity: { id: 'company-acme', kind: 'company', title: 'Acme' } });
    const getResponse = await handleKnowledgeBaseHttpRequest(
      { service: service as never },
      { method: 'GET', pathname: '/v1/documents/entity/company-acme', searchParams: new URLSearchParams() }
    );
    const getBody = getResponse.body as { data: { markdown: string; revision: string } };
    const changedId = getBody.data.markdown.replace('id: company-acme', 'id: company-other');
    await assert.rejects(
      () => handleKnowledgeBaseHttpRequest(
        { service: service as never },
        {
          method: 'PUT',
          pathname: '/v1/documents/entity/company-acme',
          searchParams: new URLSearchParams(),
          body: { markdown: changedId, revision: getBody.data.revision }
        }
      ),
      /document id cannot change/
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb node server serves dashboard assets without shadowing api routes', async (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-http-dashboard-root-'));
  const assetsDir = mkdtempSync(path.join(tmpdir(), 'kb-http-dashboard-assets-'));
  writeFileSync(path.join(assetsDir, 'index.html'), '<main id="app">dashboard</main>', 'utf8');
  writeFileSync(path.join(assetsDir, 'app.js'), 'console.log("dashboard")', 'utf8');
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
  let server;
  try {
    server = await startKnowledgeBaseNodeServer(
      {
        service,
        capabilities: {
          backend: 'file',
          canonical: false,
          mode: 'local',
          tenantId: 'acme',
          transport: 'http',
          workspaceRole: 'local-development'
        }
      },
      { dashboard: { assetsDir, token: 'secret-token' } }
    );
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
    const dashboard = await fetch(`${server.url}/dashboard/records/company-acme`);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /dashboard/);

    const config = await fetch(`${server.url}/dashboard/config.json`);
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {
      apiBase: '/v1',
      basePath: '/dashboard',
      readOnly: false,
      token: 'secret-token'
    });

    const api = await fetch(`${server.url}/v1/capabilities`);
    assert.equal(api.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(api.status, 200);
  } finally {
    await server.close();
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(assetsDir, { recursive: true, force: true });
  }
});
