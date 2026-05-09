import type { KnowledgeBaseHttpContext } from './types.js';
import { handleKnowledgeBaseHttpFetch } from './fetch-handler.js';

export function createKnowledgeBaseCloudflareFetch(
  ctx: KnowledgeBaseHttpContext
): (request: Request) => Promise<Response> {
  return async (request: Request) => handleKnowledgeBaseHttpFetch(ctx, request);
}
