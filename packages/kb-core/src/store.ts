import type {
  EntityDraft,
  KnowledgeBaseMode,
  KnowledgeEntityRegistryEntry,
  KnowledgeEvent,
  KnowledgeLink,
  KnowledgeLock,
  KnowledgePromotionProposal,
  KnowledgeReviewItem
} from './types.js';

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
  getPromotionProposal?(proposalId: string): Promise<KnowledgePromotionProposal | null>;
  putPromotionProposal?(proposal: KnowledgePromotionProposal): Promise<void>;
  deletePromotionProposal?(proposalId: string): Promise<void>;
  listPromotionProposals?(): Promise<KnowledgePromotionProposal[]>;
  getReviewItem?(itemId: string): Promise<KnowledgeReviewItem | null>;
  putReviewItem?(item: KnowledgeReviewItem): Promise<void>;
  deleteReviewItem?(itemId: string): Promise<void>;
  listReviewItems?(): Promise<KnowledgeReviewItem[]>;
  listLinks(): Promise<KnowledgeLink[]>;
  replaceLinksForOrigin(origin: KnowledgeLinkOrigin, links: KnowledgeLink[]): Promise<void>;
  acquireEntityLock(entityId: string, ttlMs: number): Promise<KnowledgeLock | null>;
  releaseEntityLock(lock: KnowledgeLock): Promise<void>;
}
