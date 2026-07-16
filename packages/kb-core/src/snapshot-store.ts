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
import type { KnowledgeLinkOrigin, KnowledgeStore } from './store.js';

export interface PersistedKnowledgeState {
  mode: KnowledgeBaseMode;
  entities: Record<string, string>;
  registry: Record<string, KnowledgeEntityRegistryEntry>;
  sources: Record<string, string>;
  events: KnowledgeEvent[];
  links: KnowledgeLink[];
  drafts: Record<string, EntityDraft>;
  proposals?: Record<string, KnowledgePromotionProposal>;
  reviewItems?: Record<string, KnowledgeReviewItem>;
}

export interface PersistedKnowledgeStateDelta {
  upsertedEntityIds: string[];
  upsertedSourceIds: string[];
  upsertedRegistryIds: string[];
  appendedEventIds: string[];
  upsertedDraftIds: string[];
  deletedDraftIds: string[];
  upsertedProposalIds: string[];
  deletedProposalIds: string[];
  upsertedReviewItemIds: string[];
  deletedReviewItemIds: string[];
  replacedLinkOrigins: KnowledgeLinkOrigin[];
  requiresFullRebuild: boolean;
  requiresFullReset: boolean;
}

export class SnapshotKnowledgeStore implements KnowledgeStore {
  private readonly locks = new Map<string, KnowledgeLock>();
  private dirty = false;
  private readonly delta = createEmptyPersistedKnowledgeStateDelta();
  private readonly state: PersistedKnowledgeState & {
    proposals: Record<string, KnowledgePromotionProposal>;
    reviewItems: Record<string, KnowledgeReviewItem>;
  };

  constructor(state: PersistedKnowledgeState) {
    state.proposals ??= {};
    state.reviewItems ??= {};
    this.state = state as PersistedKnowledgeState & {
      proposals: Record<string, KnowledgePromotionProposal>;
      reviewItems: Record<string, KnowledgeReviewItem>;
    };
  }

  async mode(): Promise<KnowledgeBaseMode> {
    return this.state.mode;
  }

  async getEntityMarkdown(id: string): Promise<string | null> {
    return this.state.entities[id] ?? null;
  }

  async listEntityMarkdown(): Promise<Array<{ id: string; markdown: string }>> {
    return Object.entries(this.state.entities)
      .map(([id, markdown]) => ({ id, markdown }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async putEntityMarkdown(id: string, markdown: string): Promise<void> {
    if (this.state.entities[id] === markdown) return;
    this.state.entities[id] = markdown;
    this.markDirty();
    this.delta.upsertedEntityIds = pushUniqueString(this.delta.upsertedEntityIds, id);
  }

  async deleteEntityMarkdown(id: string): Promise<void> {
    if (!(id in this.state.entities)) return;
    delete this.state.entities[id];
    this.markDirty();
    this.delta.upsertedEntityIds = pushUniqueString(this.delta.upsertedEntityIds, id);
  }

  async getSourceMarkdown(id: string): Promise<string | null> {
    return this.state.sources[id] ?? null;
  }

  async listSourceMarkdown(): Promise<Array<{ id: string; markdown: string }>> {
    return Object.entries(this.state.sources)
      .map(([id, markdown]) => ({ id, markdown }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async putSourceMarkdown(id: string, markdown: string): Promise<void> {
    if (this.state.sources[id] === markdown) return;
    this.state.sources[id] = markdown;
    this.markDirty();
    this.delta.upsertedSourceIds = pushUniqueString(this.delta.upsertedSourceIds, id);
  }

  async deleteSourceMarkdown(id: string): Promise<void> {
    if (!(id in this.state.sources)) return;
    delete this.state.sources[id];
    this.markDirty();
    this.delta.upsertedSourceIds = pushUniqueString(this.delta.upsertedSourceIds, id);
  }

  async listEntityRegistry(): Promise<KnowledgeEntityRegistryEntry[]> {
    return Object.values(this.state.registry).sort((left, right) => left.entityId.localeCompare(right.entityId));
  }

  async putEntityRegistryEntry(entry: KnowledgeEntityRegistryEntry): Promise<void> {
    const next = cloneRegistryEntry(entry);
    if (equalRegistryEntry(this.state.registry[entry.entityId], next)) return;
    this.state.registry[entry.entityId] = next;
    this.markDirty();
    this.delta.upsertedRegistryIds = pushUniqueString(this.delta.upsertedRegistryIds, entry.entityId);
  }

  async deleteEntityRegistryEntry(entityId: string): Promise<void> {
    if (!(entityId in this.state.registry)) return;
    delete this.state.registry[entityId];
    this.markDirty();
    this.delta.upsertedRegistryIds = pushUniqueString(this.delta.upsertedRegistryIds, entityId);
  }

  async appendEvent(event: KnowledgeEvent): Promise<void> {
    const next = cloneEvent(event);
    this.state.events.push(next);
    this.markDirty();
    this.delta.appendedEventIds = pushUniqueString(this.delta.appendedEventIds, next.id);
  }

  async listEvents(): Promise<KnowledgeEvent[]> {
    return this.state.events.map(cloneEvent);
  }

  async replaceEvents(events: KnowledgeEvent[]): Promise<void> {
    const next = events.map(cloneEvent);
    if (JSON.stringify(this.state.events) === JSON.stringify(next)) return;
    this.state.events = next;
    this.markDirty();
    this.delta.requiresFullRebuild = true;
  }

  async getDraft(entityId: string): Promise<EntityDraft | null> {
    return this.state.drafts[entityId] ? cloneDraft(this.state.drafts[entityId]) : null;
  }

  async putDraft(draft: EntityDraft): Promise<void> {
    const next = cloneDraft(draft);
    if (equalDraft(this.state.drafts[draft.entityId], next)) return;
    this.state.drafts[draft.entityId] = next;
    this.markDirty();
    this.delta.upsertedDraftIds = pushUniqueString(this.delta.upsertedDraftIds, draft.entityId);
    this.delta.deletedDraftIds = this.delta.deletedDraftIds.filter((entry) => entry !== draft.entityId);
  }

  async deleteDraft(entityId: string): Promise<void> {
    if (!(entityId in this.state.drafts)) return;
    delete this.state.drafts[entityId];
    this.markDirty();
    this.delta.deletedDraftIds = pushUniqueString(this.delta.deletedDraftIds, entityId);
    this.delta.upsertedDraftIds = this.delta.upsertedDraftIds.filter((entry) => entry !== entityId);
  }

  async listDrafts(): Promise<EntityDraft[]> {
    return Object.values(this.state.drafts).map(cloneDraft);
  }

  async getPromotionProposal(proposalId: string): Promise<KnowledgePromotionProposal | null> {
    return this.state.proposals[proposalId] ? clonePromotionProposal(this.state.proposals[proposalId]) : null;
  }

  async putPromotionProposal(proposal: KnowledgePromotionProposal): Promise<void> {
    const next = clonePromotionProposal(proposal);
    if (JSON.stringify(this.state.proposals[proposal.id]) === JSON.stringify(next)) return;
    this.state.proposals[proposal.id] = next;
    this.markDirty();
    this.delta.upsertedProposalIds = pushUniqueString(this.delta.upsertedProposalIds, proposal.id);
    this.delta.deletedProposalIds = this.delta.deletedProposalIds.filter((entry) => entry !== proposal.id);
  }

  async deletePromotionProposal(proposalId: string): Promise<void> {
    if (!(proposalId in this.state.proposals)) return;
    delete this.state.proposals[proposalId];
    this.markDirty();
    this.delta.deletedProposalIds = pushUniqueString(this.delta.deletedProposalIds, proposalId);
    this.delta.upsertedProposalIds = this.delta.upsertedProposalIds.filter((entry) => entry !== proposalId);
  }

  async listPromotionProposals(): Promise<KnowledgePromotionProposal[]> {
    return Object.values(this.state.proposals).map(clonePromotionProposal).sort((left, right) => left.id.localeCompare(right.id));
  }

  async getReviewItem(itemId: string): Promise<KnowledgeReviewItem | null> {
    return this.state.reviewItems[itemId] ? cloneReviewItem(this.state.reviewItems[itemId]) : null;
  }

  async putReviewItem(item: KnowledgeReviewItem): Promise<void> {
    const next = cloneReviewItem(item);
    if (JSON.stringify(this.state.reviewItems[item.id]) === JSON.stringify(next)) return;
    this.state.reviewItems[item.id] = next;
    this.markDirty();
    this.delta.upsertedReviewItemIds = pushUniqueString(this.delta.upsertedReviewItemIds, item.id);
    this.delta.deletedReviewItemIds = this.delta.deletedReviewItemIds.filter((entry) => entry !== item.id);
  }

  async deleteReviewItem(itemId: string): Promise<void> {
    if (!(itemId in this.state.reviewItems)) return;
    delete this.state.reviewItems[itemId];
    this.markDirty();
    this.delta.deletedReviewItemIds = pushUniqueString(this.delta.deletedReviewItemIds, itemId);
    this.delta.upsertedReviewItemIds = this.delta.upsertedReviewItemIds.filter((entry) => entry !== itemId);
  }

  async listReviewItems(): Promise<KnowledgeReviewItem[]> {
    return Object.values(this.state.reviewItems).map(cloneReviewItem).sort((left, right) => left.id.localeCompare(right.id));
  }

  async listLinks(): Promise<KnowledgeLink[]> {
    return this.state.links.map(cloneLink);
  }

  async replaceLinksForOrigin(origin: KnowledgeLinkOrigin, links: KnowledgeLink[]): Promise<void> {
    const nextLinks = this.state.links
      .filter((link) => !(link.originKind === origin.kind && link.originId === origin.id))
      .concat(links.map(cloneLink));
    if (equalLinks(this.state.links, nextLinks)) return;
    this.state.links = nextLinks;
    this.markDirty();
    this.delta.replacedLinkOrigins = pushUniqueOrigin(this.delta.replacedLinkOrigins, origin);
  }

  async acquireEntityLock(entityId: string, ttlMs: number): Promise<KnowledgeLock | null> {
    const now = Date.now();
    const current = this.locks.get(entityId);
    if (current && current.expiresAt > now) return null;
    const next = {
      key: entityId,
      token: crypto.randomUUID(),
      expiresAt: now + ttlMs
    };
    this.locks.set(entityId, next);
    return next;
  }

  async releaseEntityLock(lock: KnowledgeLock): Promise<void> {
    const current = this.locks.get(lock.key);
    if (current?.token === lock.token) {
      this.locks.delete(lock.key);
    }
  }

  snapshot(): PersistedKnowledgeState {
    return clonePersistedKnowledgeState(this.state);
  }

  isDirty(): boolean {
    return this.dirty;
  }

  changes(): PersistedKnowledgeStateDelta {
    return clonePersistedKnowledgeStateDelta(this.delta);
  }

  markFullRebuild(): void {
    this.markDirty();
    this.delta.requiresFullRebuild = true;
  }

  markFullReset(): void {
    this.markDirty();
    this.delta.requiresFullReset = true;
  }

  private markDirty(): void {
    this.dirty = true;
  }
}

export function createEmptyPersistedKnowledgeState(mode: KnowledgeBaseMode): PersistedKnowledgeState {
  return {
    mode,
    entities: {},
    registry: {},
    sources: {},
    events: [],
    links: [],
    drafts: {},
    proposals: {},
    reviewItems: {}
  };
}

export function clonePersistedKnowledgeState(state: PersistedKnowledgeState): PersistedKnowledgeState {
  return {
    mode: state.mode,
    entities: { ...state.entities },
    registry: Object.fromEntries(Object.entries(state.registry).map(([id, entry]) => [id, cloneRegistryEntry(entry)])),
    sources: { ...state.sources },
    events: state.events.map(cloneEvent),
    links: state.links.map(cloneLink),
    drafts: Object.fromEntries(Object.entries(state.drafts ?? {}).map(([id, draft]) => [id, cloneDraft(draft)])),
    proposals: Object.fromEntries(Object.entries(state.proposals ?? {}).map(([id, proposal]) => [id, clonePromotionProposal(proposal)])),
    reviewItems: Object.fromEntries(Object.entries(state.reviewItems ?? {}).map(([id, item]) => [id, cloneReviewItem(item)]))
  };
}

export function createEmptyPersistedKnowledgeStateDelta(): PersistedKnowledgeStateDelta {
  return {
    upsertedEntityIds: [],
    upsertedSourceIds: [],
    upsertedRegistryIds: [],
    appendedEventIds: [],
    upsertedDraftIds: [],
    deletedDraftIds: [],
    upsertedProposalIds: [],
    deletedProposalIds: [],
    upsertedReviewItemIds: [],
    deletedReviewItemIds: [],
    replacedLinkOrigins: [],
    requiresFullRebuild: false,
    requiresFullReset: false
  };
}

export function clonePersistedKnowledgeStateDelta(delta: PersistedKnowledgeStateDelta): PersistedKnowledgeStateDelta {
  return {
    upsertedEntityIds: [...delta.upsertedEntityIds],
    upsertedSourceIds: [...delta.upsertedSourceIds],
    upsertedRegistryIds: [...delta.upsertedRegistryIds],
    appendedEventIds: [...delta.appendedEventIds],
    upsertedDraftIds: [...delta.upsertedDraftIds],
    deletedDraftIds: [...delta.deletedDraftIds],
    upsertedProposalIds: [...delta.upsertedProposalIds],
    deletedProposalIds: [...delta.deletedProposalIds],
    upsertedReviewItemIds: [...delta.upsertedReviewItemIds],
    deletedReviewItemIds: [...delta.deletedReviewItemIds],
    replacedLinkOrigins: delta.replacedLinkOrigins.map((origin) => ({ ...origin })),
    requiresFullRebuild: delta.requiresFullRebuild,
    requiresFullReset: delta.requiresFullReset
  };
}

export function cloneRegistryEntry(entry: KnowledgeEntityRegistryEntry): KnowledgeEntityRegistryEntry {
  return {
    ...entry,
    aliases: [...entry.aliases],
    handles: [...entry.handles],
    externalIds: [...entry.externalIds],
    canonicalTokens: [...entry.canonicalTokens]
  };
}

export function cloneEvent(event: KnowledgeEvent): KnowledgeEvent {
  return {
    ...event,
    entityIds: [...event.entityIds],
    sourceIds: [...event.sourceIds]
  };
}

export function cloneDraft(draft: EntityDraft): EntityDraft {
  return {
    ...draft,
    openQuestions: [...draft.openQuestions],
    sourceIds: [...draft.sourceIds],
    timelineNotes: [...draft.timelineNotes]
  };
}

export function clonePromotionProposal(proposal: KnowledgePromotionProposal): KnowledgePromotionProposal {
  return {
    ...proposal,
    payload: cloneJsonObject(proposal.payload),
    targetEntityIds: [...proposal.targetEntityIds],
    sourceIds: [...proposal.sourceIds],
    warnings: [...proposal.warnings],
    appliedMutation: proposal.appliedMutation
      ? {
          ...proposal.appliedMutation,
          entityIds: [...proposal.appliedMutation.entityIds],
          sourceIds: [...proposal.appliedMutation.sourceIds],
          eventIds: [...proposal.appliedMutation.eventIds],
          warnings: [...proposal.appliedMutation.warnings],
          hydrated: {
            entities: proposal.appliedMutation.hydrated.entities.map((entity) => ({ ...entity, meta: { ...entity.meta } })),
            sources: proposal.appliedMutation.hydrated.sources.map((source) => ({ ...source, meta: { ...source.meta } })),
            events: proposal.appliedMutation.hydrated.events.map(cloneEvent),
            links: proposal.appliedMutation.hydrated.links.map(cloneLink)
          }
        }
      : undefined
  };
}

export function cloneReviewItem(item: KnowledgeReviewItem): KnowledgeReviewItem {
  return {
    ...item,
    targetIds: [...item.targetIds],
    sourceIds: [...item.sourceIds],
    relatedIds: [...item.relatedIds]
  };
}

export function cloneLink(link: KnowledgeLink): KnowledgeLink {
  return {
    ...link,
    sourceIds: [...link.sourceIds]
  };
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function equalRegistryEntry(
  left: KnowledgeEntityRegistryEntry | undefined,
  right: KnowledgeEntityRegistryEntry
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function equalDraft(
  left: EntityDraft | undefined,
  right: EntityDraft
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function equalLinks(left: KnowledgeLink[], right: KnowledgeLink[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushUniqueString(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function pushUniqueOrigin(values: KnowledgeLinkOrigin[], value: KnowledgeLinkOrigin): KnowledgeLinkOrigin[] {
  return values.some((entry) => entry.kind === value.kind && entry.id === value.id)
    ? values
    : [...values, { ...value }];
}
