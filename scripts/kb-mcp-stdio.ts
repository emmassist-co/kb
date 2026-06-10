import process from 'node:process';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeBaseService, type KnowledgeBaseConfig } from '../packages/kb-core/src/index.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/index.js';
import { createKnowledgeBaseMcpServer } from '../packages/kb-mcp/src/mcp-server.js';
import type { KnowledgeBaseAccessScope } from '../packages/kb-http/src/types.js';

interface ParsedArgs {
  tenantId: string;
  rootDir: string;
  scopes: KnowledgeBaseAccessScope[];
  cwd: string;
}

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  enabled: true,
  mode: 'basic',
  writePolicy: 'mixed',
  persistence: {
    backend: 'file',
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

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const service = new KnowledgeBaseService(
    parsed.tenantId,
    DEFAULT_CONFIG,
    new FileKnowledgeStore(parsed.rootDir, DEFAULT_CONFIG.mode)
  );
  const server = createKnowledgeBaseMcpServer({
    service,
    capabilities: {
      tenantId: parsed.tenantId,
      backend: 'file',
      transport: 'local',
      mode: DEFAULT_CONFIG.mode,
      canonical: false,
      workspaceRole: 'local-development',
      rootDir: parsed.rootDir
    },
    scopes: parsed.scopes,
    rebuild: async () => {
      const exported = await service.export();
      return {
        ok: true,
        rebuiltAt: new Date().toISOString(),
        counts: {
          entities: exported.entities.length,
          sources: exported.sources.length,
          events: exported.events.length,
          links: exported.links.length,
          drafts: exported.drafts.length
        }
      };
    },
    serverInfo: {
      name: 'kb-local-mcp',
      version: '0.1.0'
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`kb-local-mcp ready tenant=${parsed.tenantId} rootDir=${parsed.rootDir} scopes=${parsed.scopes.join(',')}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  let tenantId = 'default';
  let cwd = process.cwd();
  let scopes: KnowledgeBaseAccessScope[] = ['kb.read', 'kb.write', 'kb.operator'];
  let rootDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--tenant-id') {
      tenantId = requireValue(argv[++index], '--tenant-id');
      continue;
    }
    if (value === '--root-dir') {
      rootDir = requireValue(argv[++index], '--root-dir');
      continue;
    }
    if (value === '--cwd') {
      cwd = requireValue(argv[++index], '--cwd');
      continue;
    }
    if (value === '--scopes') {
      scopes = parseScopes(requireValue(argv[++index], '--scopes'));
      continue;
    }
    if (value === '--help') {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown flag: ${value}`);
  }

  return {
    tenantId,
    cwd,
    rootDir: rootDir ?? path.resolve(cwd, '.kb', tenantId),
    scopes
  };
}

function parseScopes(raw: string): KnowledgeBaseAccessScope[] {
  const values = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error('Expected at least one scope in --scopes.');
  }
  for (const value of values) {
    if (value !== 'kb.read' && value !== 'kb.write' && value !== 'kb.operator') {
      throw new Error(`Unknown KB scope: ${value}`);
    }
  }
  return values as KnowledgeBaseAccessScope[];
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelpAndExit(code: number): never {
  const text = [
    'kb-mcp-stdio',
    '',
    'Start the local KB MCP surface over stdio for tools like Codex.',
    '',
    'Flags:',
    '  --tenant-id TENANT_ID',
    '  --root-dir PATH',
    '  --cwd PATH',
    '  --scopes kb.read,kb.write,kb.operator'
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
