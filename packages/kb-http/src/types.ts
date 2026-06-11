import type {
  KnowledgeBaseService,
  KnowledgeMutationResult,
  KnowledgeWorkspaceCapabilities,
  KnowledgeLexicalBackend,
  KnowledgeSearchMode
} from '@emmassist-co/kb-core';

export type KnowledgeBaseSourceRecordInput = {
  source: {
    id: string;
    kind: 'note' | 'research' | 'workspace' | 'chat';
    title: string;
    url?: string;
    authors?: string[];
    tags?: string[];
    linkedEntities?: string[];
    createdAt?: string;
    summary?: string;
    content?: string;
    citations?: string[];
    rawSourceRef?: string;
    supersedes?: string[];
    freshnessStatus?: 'fresh' | 'needs_review' | 'stale';
    lastReviewedAt?: string;
  };
};

export interface KnowledgeBaseSemanticWriteService extends KnowledgeBaseService {
  recordSource(input: KnowledgeBaseSourceRecordInput): Promise<KnowledgeMutationResult>;
}

export type KnowledgeBaseAccessScope = 'kb.read' | 'kb.write' | 'kb.operator';

export interface KnowledgeBaseHttpAuthToken {
  token: string;
  scopes: KnowledgeBaseAccessScope[];
  subject?: string;
}

export interface KnowledgeBaseHttpAuthConfig {
  required?: boolean;
  tokens: KnowledgeBaseHttpAuthToken[];
  challengeRealm?: string;
}

export interface KnowledgeBaseHttpHeaders {
  [key: string]: string | undefined;
}

export type KnowledgeBaseHttpAuthResult =
  | {
      ok: true;
      principal: string | null;
      scopes: KnowledgeBaseAccessScope[];
    }
  | {
      ok: false;
      status: 401 | 403;
      headers?: Record<string, string>;
      error: {
        code: 'unauthorized' | 'forbidden';
        message: string;
      };
    };

export interface KnowledgeBaseHttpContext {
  service: KnowledgeBaseSemanticWriteService;
  capabilities?: KnowledgeWorkspaceCapabilities;
  rebuild?: () => Promise<unknown>;
  auth?: KnowledgeBaseHttpAuthConfig;
}

export interface KnowledgeBaseHttpRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body?: unknown;
  headers?: KnowledgeBaseHttpHeaders;
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
