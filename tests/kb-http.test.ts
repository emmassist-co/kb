import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeBaseCloudflareFetch } from '../packages/kb-http/src/cloudflare-worker.js';
import { startKnowledgeBaseNodeServer } from '../packages/kb-http/src/node-server.js';
import { handleKnowledgeBaseHttpRequest } from '../packages/kb-http/src/server.js';

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
      workspaceRole: 'local-development'
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
      summary: {
        mode: 'basic',
        entities: [{ id: 'company-acme', title: 'Acme', kind: 'company' }],
        sources: [{ id: 'src_1', title: 'Handbook', kind: 'research' }],
        links: [{ type: 'founder_of', count: 1 }]
      }
    }
  });
});

test('kb http exposes event, draft, and relation routes', async () => {
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

  assert.equal(response.status, 200);
  assert.equal(draftResponse.status, 200);
  assert.equal(relationResponse.status, 200);
  assert.deepEqual(calls, [
    'listEvents',
    'getDraft:vendor-stripe',
    'listRelations:{"entityId":"vendor-stripe","type":"vendor_for"}'
  ]);
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

test('kb http node server serves the same contract over localhost', async () => {
  const server = await startKnowledgeBaseNodeServer({
    service: {
      async doctor() {
        return { status: 'ok' };
      }
    } as never
  });

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
