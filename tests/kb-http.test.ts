import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeBaseCloudflareFetch } from '../packages/kb-http/src/cloudflare-worker.js';
import { startKnowledgeBaseNodeServer } from '../packages/kb-http/src/node-server.js';
import { handleKnowledgeBaseHttpRequest } from '../packages/kb-http/src/server.js';

test('kb http exposes capabilities envelope', async () => {
  const response = await handleKnowledgeBaseHttpRequest(
    {
      service: {} as never,
      capabilities: { backend: 'file', mode: 'local' }
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
    capabilities: { backend: 'file', mode: 'local' }
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
