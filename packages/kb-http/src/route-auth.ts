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

  if (
    request.pathname === '/v1/export' ||
    request.pathname === '/v1/rebuild'
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
