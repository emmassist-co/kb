import type {
  KnowledgeBaseService,
  KnowledgeRelationQueryInput,
  KnowledgeSearchInput
} from '@emmassist-co/kb-core';
import type { KnowledgeBaseHttpContext, KnowledgeBaseHttpRequest, KnowledgeBaseHttpResponseShape } from './types.js';

type CaptureSourceInput = Parameters<KnowledgeBaseService['captureSource']>[0];
type AppendEventInput = Parameters<KnowledgeBaseService['appendEvent']>[0];
type RecordInput = Parameters<KnowledgeBaseService['record']>[0];
type RelateInput = Parameters<KnowledgeBaseService['relate']>[0];
type RememberInput = Parameters<KnowledgeBaseService['remember']>[0];
type AnnotateInput = Parameters<KnowledgeBaseService['annotate']>[0];
type TraverseInput = Parameters<KnowledgeBaseService['traverse']>[0];

export async function handleKnowledgeBaseHttpRequest(
  ctx: KnowledgeBaseHttpContext,
  request: KnowledgeBaseHttpRequest
): Promise<KnowledgeBaseHttpResponseShape> {
  const { service } = ctx;

  if (request.method === 'GET' && request.pathname === '/v1/capabilities') {
    return ok({
      ok: true,
      capabilities: ctx.capabilities ?? {}
    });
  }

  if (request.method === 'GET' && request.pathname === '/v1/inspect') {
    return ok({
      ok: true,
      data: await service.list()
    });
  }

  if (request.method === 'GET' && request.pathname === '/v1/export') {
    return ok({
      ok: true,
      data: await service.export()
    });
  }

  if (request.method === 'GET' && request.pathname === '/v1/doctor') {
    return ok({
      ok: true,
      data: await service.doctor()
    });
  }

  if (request.method === 'GET' && request.pathname === '/v1/entities') {
    return ok({
      ok: true,
      data: await service.list()
    });
  }

  if (request.method === 'GET' && request.pathname.startsWith('/v1/entities/')) {
    const suffix = request.pathname.slice('/v1/entities/'.length);
    if (suffix.endsWith('/related')) {
      const entityId = decodeURIComponent(suffix.slice(0, -'/related'.length));
      return ok({
        ok: true,
        data: await service.related(entityId)
      });
    }
    if (suffix.endsWith('/links')) {
      const entityId = decodeURIComponent(suffix.slice(0, -'/links'.length));
      return ok({
        ok: true,
        data: await service.links(entityId)
      });
    }
    const entityId = decodeURIComponent(suffix);
    return ok({
      ok: true,
      data: await service.get(entityId)
    });
  }

  if (request.method === 'DELETE' && request.pathname.startsWith('/v1/entities/')) {
    const entityId = decodeURIComponent(request.pathname.slice('/v1/entities/'.length));
    return ok({
      ok: true,
      data: await service.deleteRecord(entityId)
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/search') {
    return ok({
      ok: true,
      data: await service.search(expectBody<KnowledgeSearchInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/query-relations') {
    return ok({
      ok: true,
      data: await service.queryRelations(expectBody<KnowledgeRelationQueryInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/record') {
    return ok({
      ok: true,
      data: await service.record(expectBody<RecordInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/relate') {
    return ok({
      ok: true,
      data: await service.relate(expectBody<RelateInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/remember') {
    return ok({
      ok: true,
      data: await service.remember(expectBody<RememberInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/annotate') {
    return ok({
      ok: true,
      data: await service.annotate(expectBody<AnnotateInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/capture-source') {
    return ok({
      ok: true,
      data: await service.captureSource(expectBody<CaptureSourceInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/events') {
    return ok({
      ok: true,
      data: await service.appendEvent(expectBody<AppendEventInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/traverse') {
    return ok({
      ok: true,
      data: await service.traverse(expectBody<TraverseInput>(request.body))
    });
  }

  if (request.method === 'POST' && request.pathname === '/v1/rebuild') {
    if (!ctx.rebuild) {
      throw new Error('Rebuild is not supported by this knowledge base host');
    }
    return ok({
      ok: true,
      data: await ctx.rebuild()
    });
  }

  return {
    status: 404,
    body: {
      ok: false,
      error: {
        code: 'not_found',
        message: `Unknown knowledge base route: ${request.method} ${request.pathname}`
      }
    }
  };
}

function ok(body: unknown): KnowledgeBaseHttpResponseShape {
  return {
    status: 200,
    body
  };
}

function expectBody<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object request body');
  }
  return value as T;
}
