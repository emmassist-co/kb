import type {
  KnowledgeBaseAccessScope,
  KnowledgeBaseHttpRequest
} from './types.js';

export function requiredScopesForKnowledgeBaseRoute(
  request: KnowledgeBaseHttpRequest
): KnowledgeBaseAccessScope[] {
  if (request.method === 'GET' && (request.pathname === '/v1/capabilities' || request.pathname === '/v1/inspect')) {
    return ['kb.read'];
  }

  if (request.method === 'POST' && request.pathname === '/v1/recall') {
    return ['kb.read'];
  }

  if (
    request.pathname === '/v1/export' ||
    request.pathname === '/v1/rebuild' ||
    (request.pathname.startsWith('/v1/proposals/') && (request.pathname.endsWith('/review') || request.pathname.endsWith('/apply'))) ||
    (request.pathname.startsWith('/v1/reviews') && request.method !== 'GET')
  ) {
    return ['kb.operator'];
  }

  if (
    request.method === 'POST' ||
    request.method === 'PUT' ||
    request.method === 'DELETE'
  ) {
    return ['kb.write'];
  }

  return ['kb.read'];
}
