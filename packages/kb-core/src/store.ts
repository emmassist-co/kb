import type { EntityDraft, KnowledgeBaseMode, KnowledgeEntityRegistryEntry, KnowledgeEvent, KnowledgeLink, KnowledgeLock } from './types.js';

export interface KnowledgeLinkOrigin {
  kind: 'entity' | 'source' | 'event' | 'seed';
  id: string;
}

export interface KnowledgeStore {
  mode(): Promise<KnowledgeBaseMode>;
  getEntityMarkdown(id: string): Promise<string | null>;
  listEntityMarkdown(): Promise<Array<{ id: string; markdown: string }>>;
  putEntityMarkdown(id: string, markdown: string): Promise<void>;
  deleteEntityMarkdown(id: string): Promise<void>;
  getSourceMarkdown(id: string): Promise<string | null>;
  listSourceMarkdown(): Promise<Array<{ id: string; markdown: string }>>;
  putSourceMarkdown(id: string, markdown: string): Promise<void>;
  deleteSourceMarkdown(id: string): Promise<void>;
  listEntityRegistry(): Promise<KnowledgeEntityRegistryEntry[]>;
  putEntityRegistryEntry(entry: KnowledgeEntityRegistryEntry): Promise<void>;
  deleteEntityRegistryEntry(entityId: string): Promise<void>;
  appendEvent(event: KnowledgeEvent): Promise<void>;
  listEvents(): Promise<KnowledgeEvent[]>;
  replaceEvents(events: KnowledgeEvent[]): Promise<void>;
  getDraft(entityId: string): Promise<EntityDraft | null>;
  putDraft(draft: EntityDraft): Promise<void>;
  deleteDraft(entityId: string): Promise<void>;
  listDrafts(): Promise<EntityDraft[]>;
  listLinks(): Promise<KnowledgeLink[]>;
  replaceLinksForOrigin(origin: KnowledgeLinkOrigin, links: KnowledgeLink[]): Promise<void>;
  acquireEntityLock(entityId: string, ttlMs: number): Promise<KnowledgeLock | null>;
  releaseEntityLock(lock: KnowledgeLock): Promise<void>;
}
