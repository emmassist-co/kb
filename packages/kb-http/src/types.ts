import type {
  KnowledgeBaseService,
  KnowledgeLexicalBackend,
  KnowledgeSearchMode
} from '@emmassist-co/kb-core';

export interface KnowledgeBaseHttpContext {
  service: KnowledgeBaseService;
  capabilities?: Record<string, unknown>;
  rebuild?: () => Promise<unknown>;
}

export interface KnowledgeBaseHttpRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body?: unknown;
}

export interface KnowledgeBaseHttpResponseShape {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface KnowledgeBaseHttpSearchRequest {
  query: string;
  limit?: number;
  mode?: KnowledgeSearchMode;
  lexicalBackend?: KnowledgeLexicalBackend;
  kind?: string;
  assistQuery?: boolean;
}
