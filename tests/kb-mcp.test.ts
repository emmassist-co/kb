import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildTrustSubstrateCapabilities } from '../packages/kb-core/src/service-helpers.js';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/file-store.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createKnowledgeBaseMcpFetch } from '../packages/kb-mcp/src/cloudflare-worker.js';
import { listKnowledgeBaseMcpToolNames } from '../packages/kb-mcp/src/tools.js';

test('kb mcp tool catalog is filtered by scope', () => {
  assert.deepEqual(listKnowledgeBaseMcpToolNames(['kb.read']), [
    'capabilities',
    'inspect',
    'doctor',
    'search',
    'query_relations',
    'evidence',
    'recall'
  ]);
  assert.deepEqual(listKnowledgeBaseMcpToolNames(['kb.read', 'kb.write']), [
    'capabilities',
    'inspect',
    'doctor',
    'search',
    'query_relations',
    'evidence',
    'recall',
    'remember',
    'record',
    'relate',
    'annotate'
  ]);
  assert.deepEqual(listKnowledgeBaseMcpToolNames(['kb.read', 'kb.write', 'kb.operator']), [
    'capabilities',
    'inspect',
    'doctor',
    'search',
    'query_relations',
    'evidence',
    'recall',
    'remember',
    'record',
    'relate',
    'annotate',
    'export',
    'rebuild'
  ]);
});

test('kb mcp rejects protected requests without a bearer token', async () => {
  const fetchHandler = createKnowledgeBaseMcpFetch({
    service: {} as never,
    auth: {
      required: true,
      tokens: [{ token: 'top-secret', scopes: ['kb.read'] }]
    }
  });

  const response = await fetchHandler(new Request('https://example.com/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    })
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: 'unauthorized',
      message: 'Missing or invalid bearer token.'
    }
  });
});

test('kb mcp stdio smoke can round-trip capabilities, record, and search', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-mcp-stdio-'));
  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      '--import',
      'tsx/esm',
      path.resolve(process.cwd(), 'scripts/kb-mcp-stdio.ts'),
      '--tenant-id',
      'kb-mcp-test',
      '--root-dir',
      rootDir,
      '--cwd',
      process.cwd(),
      '--scopes',
      'kb.read,kb.write,kb.operator'
    ],
    cwd: process.cwd(),
    stderr: 'pipe'
  });
  const client = new Client({
    name: 'kb-mcp-test-client',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'capabilities'));
    assert.ok(tools.tools.some((tool) => tool.name === 'record'));
    assert.ok(tools.tools.some((tool) => tool.name === 'search'));

    const capabilities = await client.callTool({
      name: 'capabilities',
      arguments: {}
    });
    assert.deepEqual(capabilities.structuredContent, {
      tenantId: 'kb-mcp-test',
      backend: 'file',
      transport: 'local',
      mode: 'basic',
      canonical: false,
      workspaceRole: 'local-development',
      rootDir,
      trustSubstrate: buildTrustSubstrateCapabilities()
    });

    const record = await client.callTool({
      name: 'record',
      arguments: {
        payload: {
          entity: {
            id: 'company-acme',
            kind: 'company',
            title: 'Acme',
            currentTruth: 'Acme runs billing.'
          }
        }
      }
    });
    assert.equal(
      (record.structuredContent as { entityIds?: string[] }).entityIds?.[0],
      'company-acme'
    );

    const search = await client.callTool({
      name: 'search',
      arguments: {
        query: 'billing acme'
      }
    });
    assert.equal(
      (search.structuredContent as { results?: Array<{ id?: string }> }).results?.[0]?.id,
      'company-acme'
    );
  } finally {
    await transport.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb mcp http transport can round-trip capabilities, record, and search', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-mcp-http-'));
  const service = createHttpSmokeService(rootDir);
  const client = new Client({
    name: 'kb-mcp-http-test-client',
    version: '1.0.0'
  });
  const transport = createHttpSmokeTransport({
    service,
    rootDir,
    scopes: ['kb.read', 'kb.write', 'kb.operator']
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'capabilities'));
    assert.ok(tools.tools.some((tool) => tool.name === 'record'));

    const capabilities = await client.callTool({
      name: 'capabilities',
      arguments: {}
    });
    assert.deepEqual(capabilities.structuredContent, {
      tenantId: 'kb-mcp-http-test',
      backend: 'cloudflare',
      transport: 'worker',
      mode: 'basic',
      canonical: true,
      workspaceRole: 'canonical-production',
      rootDir,
      trustSubstrate: buildTrustSubstrateCapabilities()
    });

    const record = await client.callTool({
      name: 'record',
      arguments: {
        payload: {
          entity: {
            id: 'company-acme',
            kind: 'company',
            title: 'Acme',
            currentTruth: 'Acme runs billing.'
          }
        }
      }
    });
    assert.equal(
      (record.structuredContent as { entityIds?: string[] }).entityIds?.[0],
      'company-acme'
    );

    const search = await client.callTool({
      name: 'search',
      arguments: {
        query: 'billing acme'
      }
    });
    assert.equal(
      (search.structuredContent as { results?: Array<{ id?: string }> }).results?.[0]?.id,
      'company-acme'
    );
  } finally {
    await transport.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb mcp http transport blocks write tools for read-only tokens', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-mcp-http-readonly-'));
  const service = createHttpSmokeService(rootDir);
  const client = new Client({
    name: 'kb-mcp-http-readonly-client',
    version: '1.0.0'
  });
  const transport = createHttpSmokeTransport({
    service,
    rootDir,
    scopes: ['kb.read']
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(!tools.tools.some((tool) => tool.name === 'record'));
  } finally {
    await transport.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function createHttpSmokeService(rootDir: string): KnowledgeBaseService {
  return new KnowledgeBaseService(
    'kb-mcp-http-test',
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
}

function createHttpSmokeTransport(input: {
  service: KnowledgeBaseService;
  rootDir: string;
  scopes: string[];
}): StreamableHTTPClientTransport {
  const handler = createKnowledgeBaseMcpFetch({
    service: input.service,
    capabilities: {
      tenantId: 'kb-mcp-http-test',
      backend: 'cloudflare',
      transport: 'worker',
      mode: 'basic',
      canonical: true,
      workspaceRole: 'canonical-production',
      rootDir: input.rootDir
    },
    auth: {
      required: true,
      tokens: [
        {
          token: 'top-secret',
          scopes: input.scopes
        }
      ]
    },
    serverInfo: {
      name: 'kb-mcp-http-smoke',
      version: '0.1.0'
    }
  });

  return new StreamableHTTPClientTransport(new URL('https://example.com/mcp'), {
    requestInit: {
      headers: {
        authorization: 'Bearer top-secret'
      }
    },
    fetch: async (inputValue, init) => {
      const request = new Request(String(inputValue), init);
      return handler(request);
    }
  });
}
