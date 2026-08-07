import type { InMemoryFs } from 'just-bash';

export interface FlueKbService {
  list(...args: any[]): Promise<any>;
  get(...args: any[]): Promise<any>;
  captureSource(...args: any[]): Promise<any>;
  listEvents(...args: any[]): Promise<any>;
  getEvent(...args: any[]): Promise<any>;
  deleteEvent(...args: any[]): Promise<any>;
  listDrafts(...args: any[]): Promise<any>;
  getDraft(...args: any[]): Promise<any>;
  updateEntityDraft(...args: any[]): Promise<any>;
  deleteDraft(...args: any[]): Promise<any>;
  listRelations(...args: any[]): Promise<any>;
  replaceRelations(...args: any[]): Promise<any>;
  clearRelations(...args: any[]): Promise<any>;
  search(...args: any[]): Promise<any>;
  queryRelations(...args: any[]): Promise<any>;
  remember(...args: any[]): Promise<any>;
  record(...args: any[]): Promise<any>;
  relate(...args: any[]): Promise<any>;
  annotate(...args: any[]): Promise<any>;
  related(...args: any[]): Promise<any>;
  links(...args: any[]): Promise<any>;
  traverse(...args: any[]): Promise<any>;
  doctor(...args: any[]): Promise<any>;
  export(...args: any[]): Promise<any>;
  deleteRecord(...args: any[]): Promise<any>;
  readMemory(...args: any[]): Promise<any>;
  writeMemory(...args: any[]): Promise<any>;
  store?: unknown;
  invalidateLexicalCaches?: () => void;
}

export interface FlueKbKnowledgeBaseConfig {
  enabled?: boolean;
  mode?: string;
  writePolicy?: unknown;
  ingest?: unknown;
  persistence?: {
    backend?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FlueKbProductConfig {
  tenant: {
    id: string;
  };
  knowledgeBase: FlueKbKnowledgeBaseConfig;
}

export interface FlueKbRuntime {
  getService(): Promise<FlueKbService>;
  rebuild(): Promise<unknown>;
  restoreCanonical?(): Promise<unknown>;
}

export interface FlueKbHostAdapter {
  resolveProductConfig(fs: InMemoryFs, env: Record<string, unknown>): Promise<FlueKbProductConfig>;
  createRuntime(
    env: Record<string, unknown>,
    tenantId: string,
    config: FlueKbKnowledgeBaseConfig
  ): FlueKbRuntime;
  createService(
    env: Record<string, unknown>,
    tenantId: string,
    config: FlueKbKnowledgeBaseConfig
  ): FlueKbService;
}
