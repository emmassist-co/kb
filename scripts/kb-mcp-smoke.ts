import path from 'node:path';
import process from 'node:process';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/file-store.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createKnowledgeBaseMcpFetch } from '../packages/kb-mcp/src/cloudflare-worker.js';

interface ParsedArgs {
  tenantId: string;
  rootDir: string;
  keepRoot: boolean;
  scopes: string;
  transport: 'http' | 'stdio';
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  await ensureLocalNodeModules(repoRoot);
  await mkdir(parsed.rootDir, { recursive: true });

  const transport = parsed.transport === 'http'
    ? createHttpTransport(parsed)
    : createStdioTransport(parsed, repoRoot);
  const stderrLines: string[] = [];
  if ('stderr' in transport && transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      stderrLines.push(String(chunk));
    });
  }

  const client = new Client({
    name: 'kb-mcp-smoke',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    const capabilities = await client.callTool({
      name: 'capabilities',
      arguments: {}
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

    const search = await client.callTool({
      name: 'search',
      arguments: {
        query: 'billing acme'
      }
    });

    const inspect = await client.callTool({
      name: 'inspect',
      arguments: {}
    });

    const result = {
      ok: true,
      tenantId: parsed.tenantId,
      rootDir: parsed.rootDir,
      transport: parsed.transport,
      toolNames,
      capabilities: capabilities.structuredContent,
      record: record.structuredContent,
      search: search.structuredContent,
      inspect: inspect.structuredContent,
      stderr: stderrLines.join('')
    };

    assertSmokeResult(result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await transport.close();
    if (!parsed.keepRoot) {
      await rm(parsed.rootDir, { recursive: true, force: true });
    }
  }
}

function assertSmokeResult(result: {
  capabilities: unknown;
  search: unknown;
  toolNames: string[];
  inspect: unknown;
  transport?: unknown;
}): void {
  if (!result.toolNames.includes('capabilities')) {
    throw new Error('MCP smoke failed: capabilities tool was not advertised.');
  }
  if (!result.toolNames.includes('record')) {
    throw new Error('MCP smoke failed: record tool was not advertised.');
  }
  if (!result.toolNames.includes('search')) {
    throw new Error('MCP smoke failed: search tool was not advertised.');
  }

  const capabilities = result.capabilities as Record<string, unknown> | null;
  const expectedBackend = result.transport === 'http' ? 'cloudflare' : 'file';
  const expectedWorkspaceRole = result.transport === 'http' ? 'canonical-production' : 'local-development';
  if (!capabilities || capabilities.backend !== expectedBackend || capabilities.workspaceRole !== expectedWorkspaceRole) {
    throw new Error(`MCP smoke failed: unexpected capabilities payload ${JSON.stringify(result.capabilities)}.`);
  }

  const search = result.search as { results?: Array<{ id?: string }> } | null;
  if (!search?.results?.some((entry) => entry.id === 'company-acme')) {
    throw new Error(`MCP smoke failed: search did not return company-acme. Payload: ${JSON.stringify(result.search)}`);
  }

  const inspect = result.inspect as { summary?: { entities?: Array<{ id?: string }> } } | null;
  if (!inspect?.summary?.entities?.some((entry) => entry.id === 'company-acme')) {
    throw new Error(`MCP smoke failed: inspect summary did not include company-acme. Payload: ${JSON.stringify(result.inspect)}`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let tenantId = 'kb-mcp-smoke';
  let rootDir: string | undefined;
  let keepRoot = false;
  let scopes = 'kb.read,kb.write,kb.operator';
  let transport: 'http' | 'stdio' = 'http';

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--tenant-id') {
      tenantId = requireValue(argv[++index], '--tenant-id');
      continue;
    }
    if (value === '--root-dir') {
      rootDir = path.resolve(requireValue(argv[++index], '--root-dir'));
      continue;
    }
    if (value === '--keep-root') {
      keepRoot = true;
      continue;
    }
    if (value === '--scopes') {
      scopes = requireValue(argv[++index], '--scopes');
      continue;
    }
    if (value === '--transport') {
      const transportValue = requireValue(argv[++index], '--transport');
      if (transportValue !== 'http' && transportValue !== 'stdio') {
        throw new Error(`Unsupported --transport value: ${transportValue}`);
      }
      transport = transportValue;
      continue;
    }
    if (value === '--help') {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown flag: ${value}`);
  }

  return {
    tenantId,
    rootDir: rootDir ?? mkdtempSync(path.join(tmpdir(), `${tenantId}-`)),
    keepRoot,
    scopes,
    transport
  };
}

function createStdioTransport(parsed: ParsedArgs, repoRoot: string): StdioClientTransport {
  return new StdioClientTransport({
    command: 'node',
    args: [
      '--import',
      'tsx/esm',
      path.resolve(repoRoot, 'scripts/kb-mcp-stdio.ts'),
      '--tenant-id',
      parsed.tenantId,
      '--root-dir',
      parsed.rootDir,
      '--cwd',
      repoRoot,
      '--scopes',
      parsed.scopes
    ],
    cwd: repoRoot,
    stderr: 'pipe'
  });
}

function createHttpTransport(parsed: ParsedArgs): StreamableHTTPClientTransport {
  const service = new KnowledgeBaseService(
    parsed.tenantId,
    {
      enabled: true,
      mode: 'basic',
      writePolicy: 'mixed',
      persistence: {
        backend: 'file',
        cacheRefreshPolicy: 'none',
        rootDir: parsed.rootDir
      },
      ingest: {
        agentTurns: false,
        userCorrections: false,
        workspaceSignals: false,
        externalResearch: false
      }
    },
    new FileKnowledgeStore(parsed.rootDir, 'basic')
  );
  const handler = createKnowledgeBaseMcpFetch({
    service,
    capabilities: {
      tenantId: parsed.tenantId,
      backend: 'cloudflare',
      transport: 'worker',
      mode: 'basic',
      canonical: true,
      workspaceRole: 'canonical-production',
      rootDir: parsed.rootDir
    },
    auth: {
      required: true,
      tokens: [
        {
          token: 'top-secret',
          scopes: parsed.scopes.split(',').map((value) => value.trim()).filter(Boolean)
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
    fetch: async (input, init) => {
      const request = new Request(String(input), init);
      return handler(request);
    }
  });
}

async function ensureLocalNodeModules(repoRoot: string): Promise<void> {
  const target = path.join(repoRoot, 'node_modules');
  if (!existsSync(target)) {
    throw new Error(`Missing ${target}. Restore the local node_modules symlink or install dependencies first.`);
  }
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelpAndExit(code: number): never {
  const text = [
    'kb-mcp-smoke',
    '',
    'Run a real MCP client smoke test against the local KB MCP stdio server.',
    '',
    'Flags:',
    '  --tenant-id TENANT_ID',
    '  --root-dir PATH',
    '  --transport http|stdio',
    '  --scopes kb.read,kb.write,kb.operator',
    '  --keep-root'
  ].join('\n');
  if (code === 0) {
    console.log(text);
  } else {
    console.error(text);
  }
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
