import type { KnowledgeBaseHttpContext } from './types.js';
import { handleKnowledgeBaseHttpRequest } from './server.js';

export async function handleKnowledgeBaseHttpFetch(
  ctx: KnowledgeBaseHttpContext,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await parseJsonBody(request);
    const response = await handleKnowledgeBaseHttpRequest(ctx, {
      method: request.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      body
    });
    return Response.json(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          code: 'bad_request',
          message: error instanceof Error ? error.message : String(error)
        }
      },
      { status: 400 }
    );
  }
}

async function parseJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw.trim()) return undefined;
  return JSON.parse(raw);
}
