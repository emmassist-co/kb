import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeBaseService, KnowledgeWorkspaceCapabilities } from '@emmassist-co/kb-core';
import type { KnowledgeBaseAccessScope } from '@emmassist-co/kb-http/types';
import { registerKnowledgeBaseMcpTools } from './tools.js';

export interface KnowledgeBaseMcpServerOptions {
  service: KnowledgeBaseService;
  capabilities?: KnowledgeWorkspaceCapabilities;
  scopes: KnowledgeBaseAccessScope[];
  rebuild?: () => Promise<unknown>;
  serverInfo?: {
    name?: string;
    version?: string;
  };
}

export function createKnowledgeBaseMcpServer(options: KnowledgeBaseMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.serverInfo?.name ?? 'kb-mcp',
    version: options.serverInfo?.version ?? '0.1.0'
  });
  registerKnowledgeBaseMcpTools(server, {
    service: options.service,
    capabilities: options.capabilities,
    scopes: options.scopes,
    rebuild: options.rebuild
  });
  return server;
}
