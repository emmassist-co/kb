import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { KnowledgeBaseHttpContext } from './types.js';
import { handleKnowledgeBaseHttpRequest } from './server.js';

export interface KnowledgeBaseNodeDashboardOptions {
  assetsDir: string;
  basePath?: string;
  readOnly?: boolean;
  token?: string;
}

export interface KnowledgeBaseNodeServerOptions {
  host?: string;
  port?: number;
  dashboard?: KnowledgeBaseNodeDashboardOptions;
}

export interface KnowledgeBaseNodeServerHandle {
  host: string;
  port: number;
  url: string;
  dashboardUrl?: string;
  server: HttpServer;
  close(): Promise<void>;
}

export async function startKnowledgeBaseNodeServer(
  ctx: KnowledgeBaseHttpContext,
  options: KnowledgeBaseNodeServerOptions = {}
): Promise<KnowledgeBaseNodeServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer(async (request, response) => {
    await handleNodeRequest(ctx, request, response, options.dashboard);
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
  const url = `http://${address.address}:${address.port}`;
  return {
    host: address.address,
    port: address.port,
    url,
    dashboardUrl: options.dashboard ? `${url}${normalizeDashboardBasePath(options.dashboard.basePath)}/` : undefined,
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
  response: ServerResponse,
  dashboard?: KnowledgeBaseNodeDashboardOptions
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  try {
    if (!url.pathname.startsWith('/v1/') && dashboard && await tryServeDashboardAsset(dashboard, url.pathname, response)) {
      return;
    }

    const result = await handleKnowledgeBaseHttpRequest(ctx, {
      method: request.method ?? 'GET',
      pathname: url.pathname,
      searchParams: url.searchParams,
      body: request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await parseJsonBody(request),
      headers: normalizeHeaders(request)
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

async function tryServeDashboardAsset(
  dashboard: KnowledgeBaseNodeDashboardOptions,
  pathname: string,
  response: ServerResponse
): Promise<boolean> {
  const basePath = normalizeDashboardBasePath(dashboard.basePath);
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return false;

  if (pathname === `${basePath}/config.json`) {
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify({
      apiBase: '/v1',
      basePath,
      readOnly: dashboard.readOnly ?? false,
      token: dashboard.token ?? null
    })}\n`);
    return true;
  }

  const relative = pathname === basePath || pathname === `${basePath}/`
    ? 'index.html'
    : pathname.slice(basePath.length + 1);
  const assetPath = safeAssetPath(dashboard.assetsDir, relative);
  const filePath = await fileExists(assetPath) ? assetPath : path.join(dashboard.assetsDir, 'index.html');
  if (!await fileExists(filePath)) {
    throw new Error(`Dashboard assets were not found in ${dashboard.assetsDir}. Run the kb-cli dashboard build before serving.`);
  }

  response.statusCode = 200;
  response.setHeader('content-type', contentType(filePath));
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .once('error', reject)
      .once('end', resolve)
      .pipe(response);
  });
  return true;
}

function safeAssetPath(root: string, relativePath: string): string {
  const decoded = decodeURIComponent(relativePath).replace(/^\/+/, '');
  const resolved = path.resolve(root, decoded);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error('Dashboard asset path escapes the asset directory');
  }
  return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const entry = await stat(filePath);
    return entry.isFile();
  } catch {
    return false;
  }
}

function normalizeDashboardBasePath(basePath = '/dashboard'): string {
  const normalized = `/${basePath.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/dashboard' : normalized;
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function normalizeHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      headers[key] = value.join(', ');
    }
  }
  return headers;
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
