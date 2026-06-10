import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { KnowledgeBaseHttpContext } from '@emmassist-co/kb-http/types';
import { authorizeKnowledgeBaseRequest } from '@emmassist-co/kb-http/auth';
import { createKnowledgeBaseMcpServer } from './mcp-server.js';

export interface KnowledgeBaseMcpContext extends KnowledgeBaseHttpContext {
  serverInfo?: {
    name?: string;
    version?: string;
  };
}

export function createKnowledgeBaseMcpFetch(
  ctx: KnowledgeBaseMcpContext
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const auth = authorizeKnowledgeBaseRequest({
      auth: ctx.auth,
      headers: Object.fromEntries(request.headers.entries()),
      requiredScopes: ['kb.read']
    });
    if (!auth.ok) {
      return Response.json({
        ok: false,
        error: auth.error
      }, {
        status: auth.status,
        headers: auth.headers
      });
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createKnowledgeBaseMcpServer({
      service: ctx.service,
      capabilities: ctx.capabilities,
      scopes: auth.scopes,
      rebuild: ctx.rebuild,
      serverInfo: ctx.serverInfo
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
