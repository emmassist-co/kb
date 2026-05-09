import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KnowledgeBaseHttpContext } from './types.js';
import { handleKnowledgeBaseHttpRequest } from './server.js';

export interface KnowledgeBaseNodeServerOptions {
  host?: string;
  port?: number;
}

export interface KnowledgeBaseNodeServerHandle {
  host: string;
  port: number;
  url: string;
  server: HttpServer;
  close(): Promise<void>;
}

export async function startKnowledgeBaseNodeServer(
  ctx: KnowledgeBaseHttpContext,
  options: KnowledgeBaseNodeServerOptions = {}
): Promise<KnowledgeBaseNodeServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer(async (request, response) => {
    await handleNodeRequest(ctx, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Knowledge base HTTP server did not expose a TCP address');
  }
  return {
    host: address.address,
    port: address.port,
    url: `http://${address.address}:${address.port}`,
    server,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    })
  };
}

async function handleNodeRequest(
  ctx: KnowledgeBaseHttpContext,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const result = await handleKnowledgeBaseHttpRequest(ctx, {
      method: request.method ?? 'GET',
      pathname: url.pathname,
      searchParams: url.searchParams,
      body: request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await parseJsonBody(request)
    });
    response.statusCode = result.status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    for (const [key, value] of Object.entries(result.headers ?? {})) {
      response.setHeader(key, value);
    }
    response.end(`${JSON.stringify(result.body)}\n`);
  } catch (error) {
    response.statusCode = 400;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify({
      ok: false,
      error: {
        code: 'bad_request',
        message: error instanceof Error ? error.message : String(error)
      }
    })}\n`);
  }
}

async function parseJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return undefined;
  return JSON.parse(raw);
}
