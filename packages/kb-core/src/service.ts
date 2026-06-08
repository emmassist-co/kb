import { buildBm25Index, scoreBm25Index } from './bm25.js';
import {
  createEmptyEntity,
  createSourceDocument,
  parseEntityDocument,
  parseSourceDocument,
  renderEntityDocument,
  renderSourceDocument,
  validateEntityDocument,
  validateSourceDocument
} from './documents.js';
import {
  DEFAULT_LEXICAL_BACKEND,
  annotateLinkTemporalState,
  applyAmbiguityCalibration,
  assistQuery,
  bm25RelationPenalty,
  buildConsolidatedEntity,
  buildId,
  buildSearchGraphBoostResults,
  compactExcerpt,
  computeIdentityQueryBias,
  dedupeLinks,
  defaultLexicalBackend,
  defaultSearchMode,
  isLinkVisibleAt,
  mergeExploratoryGraphResults,
  normalizeResolverText,
  rankGraphResults,
  registryEntryFromEntity,
  relationClassificationOrNull,
  resolveAnchorEntity,
  resolveRememberSourceContent,
  scoreMatch,
  scoreToConfidence,
  slugifyEntityTitle,
  suggestEntityIds,
  summarizeLinks,
  titleFromId,
  tokenizeSearch,
  uniqueStrings
} from './service-helpers.js';
import { classifyRelationQuery, defaultRelationRules, extractLinksFromText, relationResultMode } from './relations.js';
import type { KnowledgeLinkOrigin, KnowledgeStore } from './store.js';
import type {
  EntityDocument,
  EntityDraft,
  KnowledgeBaseConfig,
  KnowledgeEntityKind,
  KnowledgeEntityRegistryEntry,
  KnowledgeEvent,
  KnowledgeExportSnapshot,
  KnowledgeLexicalBackend,
  KnowledgeLink,
  KnowledgeLinkRule,
  KnowledgeRelationQueryInput,
  KnowledgeRelationQueryResult,
  KnowledgeMutationResult,
  KnowledgeReplayRecord,
  KnowledgeReplaySummary,
  KnowledgeSearchExplanation,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  SourceDocument
} from './types.js';

const ENTITY_LOCK_TTL_MS = 15_000;

export interface KnowledgeBaseReplayAdapter {
  appendRecord(rootDir: string, record: KnowledgeReplayRecord): Promise<void>;
  loadRecords(rootDir: string | undefined, tenantId: string, recordsPath?: string): Promise<KnowledgeReplayRecord[]>;
}

const noopReplayAdapter: KnowledgeBaseReplayAdapter = {
  async appendRecord() {},
  async loadRecords() {
    return [];
  }
};

export class KnowledgeBaseService {
  private bm25Cache:
    | {
        version: string;
        index: ReturnType<typeof buildBm25Index>;
      }
    | null = null;

  constructor(
    private readonly tenantId: string,
    private readonly config: KnowledgeBaseConfig,
    private readonly store: KnowledgeStore,
    private readonly relationRules: KnowledgeLinkRule[] = defaultRelationRules(),
    private readonly rootDir?: string,
    private readonly replayCaptureEnabled = false,
    private readonly replayAdapter: KnowledgeBaseReplayAdapter = noopReplayAdapter
  ) {}

  async list(): Promise<{ mode: string; entities: Array<{ id: string; title: string; kind: string }>; sources: Array<{ id: string; title: string; kind: string }>; links: Array<{ type: string; count: number }> }> {
    const entities = await this.loadEntities();
    const sources = await this.loadSources();
    const links = await this.store.listLinks();
    return {
      mode: await this.store.mode(),
      entities: entities.map((entity) => ({ id: entity.meta.id, title: entity.meta.title, kind: entity.meta.kind })),
      sources: sources.map((source) => ({ id: source.meta.id, title: source.meta.title, kind: source.meta.kind })),
      links: summarizeLinks(links)
    };
  }

  async get(id: string): Promise<{ kind: 'entity' | 'source'; markdown: string; parsed: EntityDocument | SourceDocument }> {
    const entityMarkdown = await this.store.getEntityMarkdown(id);
    if (entityMarkdown) {
      return { kind: 'entity', markdown: entityMarkdown, parsed: parseEntityDocument(entityMarkdown) };
    }
    const sourceMarkdown = await this.store.getSourceMarkdown(id);
    if (sourceMarkdown) {
      return { kind: 'source', markdown: sourceMarkdown, parsed: parseSourceDocument(sourceMarkdown) };
    }
    throw new Error(`Knowledge record not found: ${id}`);
  }

  async createEntity(input: {
    id: string;
    kind: KnowledgeEntityKind;
    title: string;
    aliases?: string[];
    handles?: string[];
    tags?: string[];
    status?: string;
    owners?: string[];
    sources?: string[];
    confidence?: 'low' | 'medium' | 'high';
    currentTruth?: string;
    openQuestions?: string[];
    timeline?: string[];
  }): Promise<EntityDocument> {
    const entity = createEmptyEntity({
      ...input,
      tenantId: this.tenantId
    });
    await this.store.putEntityMarkdown(entity.meta.id, renderEntityDocument(entity));
    await this.upsertRegistryEntry(entity);
    this.invalidateLexicalCaches();
    await this.reindexEntity(entity.meta.id);
    return entity;
  }

  async captureSource(input: {
    id?: string;
    kind?: 'note' | 'research' | 'workspace' | 'chat';
    title: string;
    url?: string;
    authors?: string[];
    tags?: string[];
    linkedEntities?: string[];
    summary?: string;
    content: string;
    citations?: string[];
    extractEntities?: boolean;
    createdAt?: string;
  }): Promise<{ source: SourceDocument; suggestedEntities: string[]; extractedLinks: number }> {
    const id = input.id ?? buildId('src');
    const suggestedEntities = input.extractEntities ? suggestEntityIds([input.title, input.summary ?? '', input.content].join('\n')) : [];
    const linkedEntities = [...new Set([...(input.linkedEntities ?? []), ...suggestedEntities])];
    const source = createSourceDocument({
      id,
      tenantId: this.tenantId,
      kind: input.kind ?? 'note',
      title: input.title,
      url: input.url,
      authors: input.authors,
      tags: input.tags,
      linkedEntities,
      summary: input.summary,
      content: input.content,
      citations: input.citations,
      createdAt: input.createdAt
    });
    await this.store.putSourceMarkdown(id, renderSourceDocument(source));
    this.invalidateLexicalCaches();

    for (const entityId of suggestedEntities) {
      const existingDraft = await this.store.getDraft(entityId);
      await this.store.putDraft({
        entityId,
        tenantId: this.tenantId,
        title: titleFromId(entityId),
        openQuestions: existingDraft?.openQuestions ?? [],
        sourceIds: uniqueStrings([...(existingDraft?.sourceIds ?? []), id]),
        timelineNotes: uniqueStrings([...(existingDraft?.timelineNotes ?? []), `Captured from source ${id}.`]),
        updatedAt: new Date().toISOString()
      });
    }

    const extractedLinks = await this.reindexSource(id);
    return { source, suggestedEntities, extractedLinks };
  }

  async appendEvent(input: {
    id?: string;
    entityId?: string;
    entityIds?: string[];
    summary: string;
    sourceIds?: string[];
    provenance?: string;
    createdAt?: string;
  }): Promise<KnowledgeEvent> {
    const event: KnowledgeEvent = {
      id: input.id ?? buildId('evt'),
      tenantId: this.tenantId,
      entityIds: uniqueStrings([...(input.entityIds ?? []), ...(input.entityId ? [input.entityId] : [])]),
      summary: input.summary.trim(),
      sourceIds: uniqueStrings(input.sourceIds ?? []),
      provenance: input.provenance?.trim() || undefined,
      createdAt: input.createdAt ?? new Date().toISOString()
    };
    await this.store.appendEvent(event);
    this.invalidateLexicalCaches();
    await this.reindexEvent(event);
    return event;
  }

  async listEvents(): Promise<KnowledgeEvent[]> {
    return this.loadEvents();
  }

  async getEvent(id: string): Promise<KnowledgeEvent> {
    const event = (await this.loadEvents()).find((entry) => entry.id === id) ?? null;
    if (!event) throw new Error(`Knowledge event not found: ${id}`);
    return event;
  }

  async deleteEvent(id: string): Promise<{ id: string; deleted: true; removedLinks: number }> {
    const events = await this.loadEvents();
    const remainingEvents = events.filter((event) => event.id !== id);
    if (remainingEvents.length === events.length) {
      throw new Error(`Knowledge event not found: ${id}`);
    }
    await this.store.replaceEvents(remainingEvents);
    const removedLinks = (await this.store.listLinks()).filter((link) => link.originKind === 'event' && link.originId === id).length;
    await this.store.replaceLinksForOrigin({ kind: 'event', id }, []);
    this.invalidateLexicalCaches();
    return { id, deleted: true, removedLinks };
  }

  async importStructuredLinks(input: {
    origin: KnowledgeLinkOrigin;
    links: Array<{
      type: string;
      fromId: string;
      toId: string;
      sourceIds?: string[];
      confidence?: number;
      evidenceKind?: KnowledgeLink['evidenceKind'];
      createdAt?: string;
    }>;
  }): Promise<number> {
    const entities = await this.loadEntities();
    const entityMap = new Map(entities.map((entity) => [entity.meta.id, entity]));
    const originEntity = input.origin.kind === 'seed' || input.origin.kind === 'entity'
      ? entityMap.get(input.origin.id) ?? null
      : null;
    const links = input.links.map((link) => ({
      id: `${link.type}:${link.fromId}:${link.toId}:${[...(link.sourceIds ?? [])].sort().join(',') || `${input.origin.kind}:${input.origin.id}`}`,
      tenantId: this.tenantId,
      type: link.type,
      fromId: link.fromId,
      toId: link.toId,
      sourceIds: uniqueStrings(link.sourceIds ?? []),
      confidence: link.confidence ?? 0.95,
      evidenceKind: link.evidenceKind ?? 'structured',
      evidenceStrength: 'explicit-ref' as const,
      sourceSurface: 'structured' as const,
      explicitReference: true,
      createdAt: link.createdAt ?? new Date().toISOString(),
      originKind: input.origin.kind,
      originId: input.origin.id,
      ruleId: 'structured'
    })).map((link) => annotateLinkTemporalState(link, originEntity, entityMap.get(link.toId) ?? entityMap.get(link.fromId) ?? null));
    await this.store.replaceLinksForOrigin(input.origin, links);
    return links.length;
  }

  async updateEntityDraft(input: {
    entityId: string;
    title?: string;
    kind?: KnowledgeEntityKind;
    summary?: string;
    openQuestions?: string[];
    sourceIds?: string[];
    timelineNotes?: string[];
  }): Promise<EntityDraft> {
    const current = await this.store.getDraft(input.entityId);
    const draft: EntityDraft = {
      entityId: input.entityId,
      tenantId: this.tenantId,
      title: input.title ?? current?.title,
      kind: input.kind ?? current?.kind,
      summary: input.summary ?? current?.summary,
      openQuestions: uniqueStrings([...(current?.openQuestions ?? []), ...(input.openQuestions ?? [])]),
      sourceIds: uniqueStrings([...(current?.sourceIds ?? []), ...(input.sourceIds ?? [])]),
      timelineNotes: uniqueStrings([...(current?.timelineNotes ?? []), ...(input.timelineNotes ?? [])]),
      updatedAt: new Date().toISOString()
    };
    await this.store.putDraft(draft);
    return draft;
  }

  async listDrafts(): Promise<EntityDraft[]> {
    return (await this.store.listDrafts()).sort((left, right) => {
      const updated = right.updatedAt.localeCompare(left.updatedAt);
      return updated !== 0 ? updated : left.entityId.localeCompare(right.entityId);
    });
  }

  async getDraft(entityId: string): Promise<EntityDraft> {
    const draft = await this.store.getDraft(entityId);
    if (!draft) throw new Error(`Knowledge draft not found: ${entityId}`);
    return draft;
  }

  async deleteDraft(entityId: string): Promise<{ entityId: string; deleted: true }> {
    const draft = await this.store.getDraft(entityId);
    if (!draft) throw new Error(`Knowledge draft not found: ${entityId}`);
    await this.store.deleteDraft(entityId);
    return { entityId, deleted: true };
  }

  async listRelations(input: {
    entityId?: string;
    originKind?: KnowledgeLinkOrigin['kind'];
    originId?: string;
    type?: string;
  } = {}): Promise<KnowledgeLink[]> {
    return this.filterRelations(input);
  }

  async replaceRelations(input: {
    origin: KnowledgeLinkOrigin;
    links: Array<{
      type: string;
      fromId: string;
      toId: string;
      sourceIds?: string[];
      confidence?: number;
      evidenceKind?: KnowledgeLink['evidenceKind'];
      createdAt?: string;
    }>;
  }): Promise<{ origin: KnowledgeLinkOrigin; count: number; links: KnowledgeLink[] }> {
    await this.ensureRelationTargets(
      input.links.map((link) => ({ fromId: link.fromId, toId: link.toId })),
      [],
      uniqueStrings(input.links.flatMap((link) => link.sourceIds ?? []))
    );
    await this.importStructuredLinks(input);
    const links = await this.filterRelations({
      originKind: input.origin.kind,
      originId: input.origin.id
    });
    return {
      origin: input.origin,
      count: links.length,
      links
    };
  }

  async clearRelations(origin: KnowledgeLinkOrigin): Promise<{ origin: KnowledgeLinkOrigin; deleted: true; removed: number }> {
    const existing = await this.filterRelations({
      originKind: origin.kind,
      originId: origin.id
    });
    await this.store.replaceLinksForOrigin(origin, []);
    this.invalidateLexicalCaches();
    return {
      origin,
      deleted: true,
      removed: existing.length
    };
  }

  async remember(input: {
    intent: 'source_capture' | 'fact_update' | 'correction' | 'company_profile' | 'person_profile';
    summary: string;
    content?: string;
    entities?: Array<{
      id?: string;
      kind: KnowledgeEntityKind;
      title: string;
      aliases?: string[];
      facts?: string[];
    }>;
    relations?: Array<{
      type: string;
      fromId: string;
      toId: string;
      sourceIds?: string[];
      confidence?: number;
    }>;
    source?: {
      id?: string;
      title?: string;
      url?: string;
      kind?: 'note' | 'research' | 'workspace' | 'chat';
      authors?: string[];
      citations?: string[];
      rawSourceRef?: string;
      supersedes?: string[];
      freshnessStatus?: 'fresh' | 'needs_review' | 'stale';
      lastReviewedAt?: string;
    };
    effectiveAt?: string;
    confidence?: 'low' | 'medium' | 'high';
  }): Promise<KnowledgeMutationResult> {
    const warnings: string[] = [];
    const entityInputs = (input.entities ?? []).map((entity) => ({
      ...entity,
      id: entity.id ?? slugifyEntityTitle(entity.kind, entity.title)
    }));
    const entityIds = uniqueStrings(entityInputs.map((entity) => entity.id));
    const factsByEntity = new Map(
      entityInputs.map((entity) => [
        entity.id,
        uniqueStrings(entity.facts ?? [])
      ])
    );

    let sourceId: string | null = null;
    if (input.source || input.content || input.intent === 'source_capture') {
      const linkedEntities = entityIds;
      const source = await this.upsertSourceDocument({
        id: input.source?.id,
        kind: input.source?.kind ?? 'research',
        title: input.source?.title ?? input.summary,
        url: input.source?.url,
        authors: input.source?.authors ?? [],
        citations: input.source?.citations ?? [],
        rawSourceRef: input.source?.rawSourceRef,
        supersedes: input.source?.supersedes,
        freshnessStatus: input.source?.freshnessStatus,
        lastReviewedAt: input.source?.lastReviewedAt,
        linkedEntities,
        summary: input.summary,
        content: resolveRememberSourceContent(input.summary, input.content, input.source?.url)
      });
      sourceId = source.meta.id;
    }

    const mutatedEntityIds: string[] = [];
    for (const entity of entityInputs) {
      const factLines = factsByEntity.get(entity.id) ?? [];
      const currentTruth = uniqueStrings(
        [
          ...(factLines.length ? factLines : []),
          ...(input.intent === 'correction' && factLines.length === 0 ? [input.summary] : [])
        ].filter(Boolean)
      ).join('\n');
      const next = await this.upsertEntityDocument({
        id: entity.id,
        kind: entity.kind,
        title: entity.title,
        aliases: entity.aliases ?? [],
        sources: sourceId ? [sourceId] : [],
        confidence: input.confidence,
        currentTruth
      });
      mutatedEntityIds.push(next.meta.id);
      if (!factLines.length && !next.currentTruth && input.intent !== 'source_capture') {
        warnings.push(`entity ${next.meta.id} was created without currentTruth`);
      }
    }

    let relationLinks: KnowledgeLink[] = [];
    if (input.relations?.length) {
      await this.ensureRelationTargets(input.relations, entityInputs, sourceId ? [sourceId] : []);
      await this.importStructuredLinks({
        origin: sourceId
          ? { kind: 'source', id: sourceId }
          : { kind: 'seed', id: `remember:${Date.now().toString(36)}` },
        links: input.relations.map((relation) => ({
          type: relation.type,
          fromId: relation.fromId,
          toId: relation.toId,
          sourceIds: uniqueStrings([...(relation.sourceIds ?? []), ...(sourceId ? [sourceId] : [])]),
          confidence: relation.confidence
        }))
      });
      relationLinks = await this.loadLinksForEdges(input.relations);
    }

    if (input.effectiveAt && entityIds.length > 0 && input.summary) {
      for (const entityId of entityIds) {
        await this.appendTimelineEntry(entityId, `${input.effectiveAt.slice(0, 10)}: ${input.summary}`, sourceId ? [sourceId] : []);
      }
    }

    return this.buildMutationResult({
      mutated: true,
      entityIds: uniqueStrings(mutatedEntityIds),
      sourceIds: sourceId ? [sourceId] : [],
      eventIds: [],
      warnings,
      links: relationLinks
    });
  }

  async record(input: {
    entity: {
      id: string;
      kind: KnowledgeEntityKind;
      title: string;
      aliases?: string[];
      handles?: string[];
      tags?: string[];
      status?: string;
      owners?: string[];
      sources?: string[];
      confidence?: 'low' | 'medium' | 'high';
      currentTruth?: string;
      openQuestions?: string[];
      timeline?: string[];
      supersedes?: string[];
      freshnessStatus?: 'fresh' | 'needs_review' | 'stale';
      lastReviewedAt?: string;
    };
    relatedEntities?: Array<{
      id: string;
      kind: KnowledgeEntityKind;
      title: string;
      aliases?: string[];
      currentTruth?: string;
    }>;
    relations?: Array<{
      type: string;
      fromId: string;
      toId: string;
      sourceIds?: string[];
      confidence?: number;
    }>;
    sources?: Array<{
      id?: string;
      kind?: 'note' | 'research' | 'workspace' | 'chat';
      title: string;
      url?: string;
      authors?: string[];
      citations?: string[];
      summary?: string;
      content?: string;
      rawSourceRef?: string;
      supersedes?: string[];
      freshnessStatus?: 'fresh' | 'needs_review' | 'stale';
      lastReviewedAt?: string;
    }>;
    events?: Array<{
      summary: string;
      entityIds?: string[];
      sourceIds?: string[];
      provenance?: string;
      createdAt?: string;
    }>;
  }): Promise<KnowledgeMutationResult> {
    const warnings: string[] = [];
    const primary = await this.upsertEntityDocument(input.entity);
    const relatedIds: string[] = [];
    for (const entity of input.relatedEntities ?? []) {
      const next = await this.upsertEntityDocument({
        id: entity.id,
        kind: entity.kind,
        title: entity.title,
        aliases: entity.aliases,
        currentTruth: entity.currentTruth
      });
      relatedIds.push(next.meta.id);
    }

    const sourceIds: string[] = [];
    for (const source of input.sources ?? []) {
      const next = await this.upsertSourceDocument({
        id: source.id,
        kind: source.kind ?? 'note',
        title: source.title,
        url: source.url,
        authors: source.authors ?? [],
        citations: source.citations ?? [],
        rawSourceRef: source.rawSourceRef,
        supersedes: source.supersedes,
        freshnessStatus: source.freshnessStatus,
        lastReviewedAt: source.lastReviewedAt,
        linkedEntities: uniqueStrings([primary.meta.id, ...relatedIds]),
        summary: source.summary ?? source.title,
        content: source.content ?? source.summary ?? source.title
      });
      sourceIds.push(next.meta.id);
    }

    let relationLinks: KnowledgeLink[] = [];
    if (input.relations?.length) {
      await this.importStructuredLinks({
        origin: { kind: 'seed', id: `record:${primary.meta.id}` },
        links: input.relations.map((relation) => ({
          type: relation.type,
          fromId: relation.fromId,
          toId: relation.toId,
          sourceIds: uniqueStrings([...(relation.sourceIds ?? []), ...sourceIds]),
          confidence: relation.confidence
        }))
      });
      relationLinks = await this.loadLinksForEdges(input.relations);
    }

    const eventIds: string[] = [];
    for (const event of input.events ?? []) {
      const appended = await this.appendEvent({
        entityIds: event.entityIds ?? [primary.meta.id],
        summary: event.summary,
        sourceIds: uniqueStrings([...(event.sourceIds ?? []), ...sourceIds]),
        provenance: event.provenance,
        createdAt: event.createdAt
      });
      eventIds.push(appended.id);
    }

    if (!primary.currentTruth) warnings.push(`entity ${primary.meta.id} was recorded without currentTruth`);
    return this.buildMutationResult({
      mutated: true,
      entityIds: uniqueStrings([primary.meta.id, ...relatedIds]),
      sourceIds: uniqueStrings(sourceIds),
      eventIds: uniqueStrings(eventIds),
      warnings,
      links: relationLinks
    });
  }

  async annotate(input: {
    entityIds: string[];
    summary: string;
    effectiveAt?: string;
    sourceIds?: string[];
    provenance?: string;
  }): Promise<KnowledgeMutationResult> {
    const entityIds = uniqueStrings(input.entityIds);
    const line = input.effectiveAt ? `${input.effectiveAt.slice(0, 10)}: ${input.summary}` : input.summary;
    for (const entityId of entityIds) {
      await this.appendTimelineEntry(entityId, line, input.sourceIds ?? []);
    }
    const event = await this.appendEvent({
      entityIds,
      summary: line,
      sourceIds: input.sourceIds ?? [],
      provenance: input.provenance,
      createdAt: input.effectiveAt
    });
    return this.buildMutationResult({
      mutated: true,
      entityIds,
      sourceIds: uniqueStrings(input.sourceIds ?? []),
      eventIds: [event.id],
      warnings: [],
      links: []
    });
  }

  async relate(input: {
    type: string;
    fromId: string;
    toId: string;
    sourceIds?: string[];
    confidence?: number;
  }): Promise<KnowledgeMutationResult> {
    await this.ensureRelationTargets(
      [{ fromId: input.fromId, toId: input.toId }],
      [],
      uniqueStrings(input.sourceIds ?? [])
    );
    await this.importStructuredLinks({
      origin: { kind: 'seed', id: `relate:${input.type}:${input.fromId}:${input.toId}` },
      links: [{
        type: input.type,
        fromId: input.fromId,
        toId: input.toId,
        sourceIds: uniqueStrings(input.sourceIds ?? []),
        confidence: input.confidence
      }]
    });
    const links = await this.loadLinksForEdges([input]);
    return this.buildMutationResult({
      mutated: true,
      entityIds: uniqueStrings([input.fromId, input.toId]),
      sourceIds: uniqueStrings(input.sourceIds ?? []),
      eventIds: [],
      warnings: [],
      links
    });
  }

  async search(input: KnowledgeSearchInput): Promise<{ query: string; assistedQuery?: string; mode: string; results: KnowledgeSearchResult[] }> {
    const startedAt = Date.now();
    const effectiveQuery = input.query.trim();
    const mode = input.mode ?? defaultSearchMode(this.config.mode);
    const lexicalBackend = input.lexicalBackend ?? defaultLexicalBackend(this.config.mode);
    if (mode === 'graph-only' || mode === 'graph-first-hybrid') {
      const relation = await this.queryRelations({
        query: effectiveQuery,
        limit: input.limit,
        mode: relationResultMode(mode),
        lexicalBackend,
        captureReplay: false
      });
      const response = {
        query: effectiveQuery,
        assistedQuery: undefined,
        mode,
        results: relation.results
      };
      if (input.captureReplay !== false) {
        await this.captureReplay({
          query: effectiveQuery,
          mode,
          lexicalBackend,
          limit: input.limit ?? 10,
          durationMs: Date.now() - startedAt,
          resultIds: relation.results.map((result) => result.id),
          relationType: relation.classification.relationType,
          anchorId: relation.classification.anchorId
        });
      }
      return response;
    }

    const lexical = await this.lexicalSearch({
      ...input,
      query: effectiveQuery,
      lexicalBackend
    });
    const response = {
      query: effectiveQuery,
      assistedQuery: lexical.assistedQuery,
      mode,
      results: lexical.results
    };
    if (input.captureReplay !== false) {
      await this.captureReplay({
        query: effectiveQuery,
        mode,
        lexicalBackend,
        limit: input.limit ?? 10,
        durationMs: Date.now() - startedAt,
        resultIds: lexical.results.map((result) => result.id),
        relationType: relationClassificationOrNull(effectiveQuery),
        anchorId: null
      });
    }
    return response;
  }

  async queryRelations(input: KnowledgeRelationQueryInput & { captureReplay?: boolean }): Promise<KnowledgeRelationQueryResult> {
    const startedAt = Date.now();
    const entities = await this.loadEntities();
    const registry = await this.loadRegistry(entities);
    const links = await this.store.listLinks();
    const classification = classifyRelationQuery(input.query);
    const anchor = classification.anchorQuery
      ? resolveAnchorEntity(classification.anchorQuery, classification.relationType, input.query, registry, entities, links)
      : null;
    const relationType = classification.relationType;
    const currentOnly = input.currentOnly ?? !input.asOf;
    const traversedLinks = anchor && relationType
      ? links.filter((link) =>
          link.type === relationType &&
          (link.fromId === anchor.meta.id || link.toId === anchor.meta.id) &&
          isLinkVisibleAt(link, input.asOf, currentOnly)
        )
      : [];

    const graphResults = rankGraphResults({
      relationType,
      anchorId: anchor?.meta.id ?? null,
      entities,
      links: traversedLinks,
      query: input.query,
      limit: input.limit ?? 10
    });

    const degraded = !(anchor && relationType);

    if (degraded) {
      const lexical = await this.lexicalSearch({
        query: input.query,
        limit: input.limit ?? 10,
        kind: undefined,
        assistQuery: true,
        mode: 'search-only',
        lexicalBackend: input.lexicalBackend ?? defaultLexicalBackend(this.config.mode)
      });
      const degradedResults = lexical.results.map((result) => ({
        ...result,
        retrievalMode: 'search-only' as const
      }));
      const response = {
        query: input.query,
        classification: {
          relationType,
          anchorId: anchor?.meta.id ?? null,
          confidence: 0,
          degraded: true,
          candidateRelationTypes: classification.candidateRelationTypes ?? []
        },
        results: degradedResults,
        traversedLinks: [] as KnowledgeLink[]
      };
      if (input.captureReplay !== false) {
        await this.captureReplay({
          query: input.query,
          mode: 'query-relations',
          lexicalBackend: input.lexicalBackend,
          limit: input.limit ?? 10,
          durationMs: Date.now() - startedAt,
          resultIds: response.results.map((result) => result.id),
          relationType: response.classification.relationType,
          anchorId: response.classification.anchorId
        });
      }
      return response;
    }

    if (input.mode === 'graph-only') {
      const response = {
        query: input.query,
        classification: {
          relationType,
          anchorId: anchor?.meta.id ?? null,
          confidence: classification.confidence,
          degraded: false,
          candidateRelationTypes: classification.candidateRelationTypes ?? []
        },
        results: graphResults.map((result) => ({ ...result, retrievalMode: 'graph-only' as const })),
        traversedLinks
      };
      if (input.captureReplay !== false) {
        await this.captureReplay({
          query: input.query,
          mode: 'query-relations',
          lexicalBackend: input.lexicalBackend,
          limit: input.limit ?? 10,
          durationMs: Date.now() - startedAt,
          resultIds: response.results.map((result) => result.id),
          relationType: response.classification.relationType,
          anchorId: response.classification.anchorId
        });
      }
      return response;
    }

    const response = {
      query: input.query,
      classification: {
        relationType,
        anchorId: anchor?.meta.id ?? null,
        confidence: classification.confidence,
        degraded: false,
        candidateRelationTypes: classification.candidateRelationTypes ?? []
      },
      results: graphResults.map((result) => ({ ...result, retrievalMode: 'graph-first-hybrid' as const })),
      traversedLinks
    };
    if (input.captureReplay !== false) {
      await this.captureReplay({
        query: input.query,
        mode: 'query-relations',
        lexicalBackend: input.lexicalBackend,
        limit: input.limit ?? 10,
        durationMs: Date.now() - startedAt,
        resultIds: response.results.map((result) => result.id),
        relationType: response.classification.relationType,
        anchorId: response.classification.anchorId
      });
    }
    return response;
  }

  async links(id: string): Promise<{ id: string; outgoing: KnowledgeLink[]; incoming: KnowledgeLink[] }> {
    const links = await this.store.listLinks();
    return {
      id,
      outgoing: links.filter((link) => link.fromId === id),
      incoming: links.filter((link) => link.toId === id)
    };
  }

  async traverse(input: {
    id: string;
    type?: string;
    direction?: 'in' | 'out' | 'both';
    depth?: number;
    explicitOnly?: boolean;
    originKind?: 'entity' | 'source' | 'event' | 'seed';
  }): Promise<{ id: string; depth: number; edges: KnowledgeLink[]; entityIds: string[] }> {
    const direction = input.direction ?? 'both';
    const depth = Math.max(1, input.depth ?? 1);
    const allLinks = await this.store.listLinks();
    const seen = new Set<string>([input.id]);
    const edges: KnowledgeLink[] = [];
    let frontier = new Set<string>([input.id]);

    for (let step = 0; step < depth; step += 1) {
      const next = new Set<string>();
      for (const link of allLinks) {
        if (input.type && link.type !== input.type) continue;
        if (input.explicitOnly && !link.explicitReference) continue;
        if (input.originKind && link.originKind !== input.originKind) continue;
        const forward = frontier.has(link.fromId) && (direction === 'out' || direction === 'both');
        const reverse = frontier.has(link.toId) && (direction === 'in' || direction === 'both');
        if (!forward && !reverse) continue;
        edges.push(link);
        const candidateIds = forward ? [link.toId] : reverse ? [link.fromId] : [];
        for (const candidate of candidateIds) {
          if (!seen.has(candidate)) {
            seen.add(candidate);
            next.add(candidate);
          }
        }
      }
      frontier = next;
      if (frontier.size === 0) break;
    }

    return {
      id: input.id,
      depth,
      edges: dedupeLinks(edges),
      entityIds: [...seen].filter((entityId) => entityId !== input.id)
    };
  }

  async explainSearch(query: string, limit = 10, lexicalBackend?: KnowledgeLexicalBackend): Promise<KnowledgeSearchExplanation> {
    const resolvedLexicalBackend = lexicalBackend ?? defaultLexicalBackend(this.config.mode);
    const lexical = await this.lexicalSearch({ query, limit, mode: 'search-only', assistQuery: true, lexicalBackend: resolvedLexicalBackend });
    const graph = await this.queryRelations({ query, limit, mode: 'graph-only', lexicalBackend: resolvedLexicalBackend, captureReplay: false });
    const hybrid = await this.queryRelations({ query, limit, mode: 'graph-first-hybrid', lexicalBackend: resolvedLexicalBackend, captureReplay: false });
    return {
      query,
      lexicalBackend: resolvedLexicalBackend,
      classification: graph.classification,
      lexical: lexical.results,
      graph: graph.results,
      hybrid: hybrid.results
    };
  }

  async consolidate(entityId: string, options: { dryRun?: boolean } = {}): Promise<{ changed: boolean; markdown: string; entity: EntityDocument; clearedDraft: boolean; extractedLinks: number }> {
    const lock = await this.store.acquireEntityLock(entityId, ENTITY_LOCK_TTL_MS);
    if (!lock) {
      throw new Error(`Knowledge entity is already being consolidated: ${entityId}`);
    }

    try {
      const currentMarkdown = await this.store.getEntityMarkdown(entityId);
      const current = currentMarkdown ? parseEntityDocument(currentMarkdown) : null;
      const draft = await this.store.getDraft(entityId);
      const events = (await this.loadEvents()).filter((event) => event.entityIds.includes(entityId));
      if (!current && !draft && events.length === 0) {
        throw new Error(`Nothing to consolidate for entity: ${entityId}`);
      }

      const next = buildConsolidatedEntity(this.tenantId, entityId, current, draft, events);
      const markdown = renderEntityDocument(next);
      const changed = currentMarkdown !== markdown;
      let extractedLinks = 0;

      if (!options.dryRun) {
        await this.store.putEntityMarkdown(entityId, markdown);
        await this.upsertRegistryEntry(next);
        if (draft) await this.store.deleteDraft(entityId);
        this.invalidateLexicalCaches();
        extractedLinks = await this.reindexEntity(entityId);
      }

      return {
        changed,
        markdown,
        entity: next,
        clearedDraft: Boolean(draft) && !options.dryRun,
        extractedLinks
      };
    } finally {
      await this.store.releaseEntityLock(lock);
    }
  }

  async diff(entityId: string): Promise<{ currentMarkdown: string | null; proposedMarkdown: string; changed: boolean }> {
    const currentMarkdown = await this.store.getEntityMarkdown(entityId);
    const proposed = await this.consolidate(entityId, { dryRun: true });
    return {
      currentMarkdown,
      proposedMarkdown: proposed.markdown,
      changed: currentMarkdown !== proposed.markdown
    };
  }

  async doctor(): Promise<{ ok: boolean; issues: string[]; counts: Record<string, number> }> {
    const entities = await this.loadEntities();
    const registry = await this.loadRegistry(entities);
    const sources = await this.loadSources();
    const events = await this.loadEvents();
    const links = await this.store.listLinks();
    const issues: string[] = [];
    const sourceIds = new Set(sources.map((source) => source.meta.id));
    const entityIds = new Set(entities.map((entity) => entity.meta.id));

    for (const entity of entities) {
      for (const issue of validateEntityDocument(entity)) issues.push(`${entity.meta.id}: ${issue}`);
      for (const sourceId of entity.sources) {
        if (!sourceIds.has(sourceId)) issues.push(`${entity.meta.id}: missing source reference ${sourceId}`);
      }
      if (entity.meta.freshnessStatus === 'fresh' && !entity.meta.lastReviewedAt) {
        issues.push(`${entity.meta.id}: freshnessStatus=fresh requires lastReviewedAt`);
      }
      for (const targetId of entity.meta.supersedes ?? []) {
        if (!entityIds.has(targetId)) issues.push(`${entity.meta.id}: missing supersession target ${targetId}`);
      }
    }
    for (const source of sources) {
      for (const issue of validateSourceDocument(source)) issues.push(`${source.meta.id}: ${issue}`);
      if (source.meta.freshnessStatus === 'fresh' && !source.meta.lastReviewedAt) {
        issues.push(`${source.meta.id}: freshnessStatus=fresh requires lastReviewedAt`);
      }
      for (const targetId of source.meta.supersedes ?? []) {
        if (!sourceIds.has(targetId)) issues.push(`${source.meta.id}: missing supersession target ${targetId}`);
      }
    }
    for (const event of events) {
      if (!event.entityIds.length) issues.push(`${event.id}: event has no entityIds`);
    }
    for (const link of links) {
      if (!entityIds.has(link.fromId)) issues.push(`${link.id}: missing from entity ${link.fromId}`);
      if (!entityIds.has(link.toId)) issues.push(`${link.id}: missing to entity ${link.toId}`);
      for (const sourceId of link.sourceIds) {
        if (!sourceIds.has(sourceId)) issues.push(`${link.id}: missing source reference ${sourceId}`);
      }
    }

    const aliasOwners = new Map<string, string[]>();
    for (const entry of registry) {
      for (const alias of uniqueStrings([entry.title, ...entry.aliases, ...entry.handles])) {
        const key = normalizeResolverText(alias);
        if (!key) continue;
        aliasOwners.set(key, [...(aliasOwners.get(key) ?? []), entry.entityId]);
      }
    }
    for (const [alias, ownerIds] of aliasOwners) {
      const uniqueOwners = uniqueStrings(ownerIds);
      if (uniqueOwners.length > 1) {
        issues.push(`duplicate alias "${alias}" across entities: ${uniqueOwners.join(', ')}`);
      }
    }

    const singularRelationTypes = new Set(['approves', 'reviews', 'escalates_to', 'uses_system', 'vendor_for']);
    const activeLinks = links.filter((link) => (link.status ?? 'active') === 'active');
    const contradictions = new Map<string, Set<string>>();
    for (const link of activeLinks) {
      if (!singularRelationTypes.has(link.type)) continue;
      const key = `${link.fromId}:${link.type}`;
      const next = contradictions.get(key) ?? new Set<string>();
      next.add(link.toId);
      contradictions.set(key, next);
    }
    for (const [key, targets] of contradictions) {
      if (targets.size > 1) {
        issues.push(`contradictory active facts for ${key}: ${[...targets].join(', ')}`);
      }
    }

    const supersessionCycles = detectSupersessionCycles([
      ...entities.map((entity) => ({ id: entity.meta.id, supersedes: entity.meta.supersedes ?? [] })),
      ...sources.map((source) => ({ id: source.meta.id, supersedes: source.meta.supersedes ?? [] }))
    ]);
    for (const cycle of supersessionCycles) {
      issues.push(`supersession cycle detected: ${cycle.join(' -> ')}`);
    }

    return {
      ok: issues.length === 0,
      issues,
      counts: {
        entities: entities.length,
        registry: registry.length,
        sources: sources.length,
        events: events.length,
        drafts: (await this.store.listDrafts()).length,
        links: links.length
      }
    };
  }

  async export(): Promise<KnowledgeExportSnapshot> {
    return {
      tenantId: this.tenantId,
      mode: await this.store.mode(),
      entities: await this.loadEntities(),
      sources: await this.loadSources(),
      events: await this.loadEvents(),
      drafts: await this.listDrafts(),
      links: await this.store.listLinks()
    };
  }

  async related(id: string): Promise<{ id: string; relatedEntities: string[]; sourceIds: string[]; linkTypes: string[] }> {
    const entity = await this.store.getEntityMarkdown(id);
    if (!entity) throw new Error(`Entity not found: ${id}`);
    const parsed = parseEntityDocument(entity);
    const sourceIds = uniqueStrings(parsed.sources);
    const sources = await this.loadSources();
    const sourceRelated = sources
      .filter((source) => sourceIds.includes(source.meta.id))
      .flatMap((source) => source.meta.linkedEntities)
      .filter((entityId) => entityId !== id);
    const links = await this.store.listLinks();
    const graphRelated = links
      .filter((link) => link.fromId === id || link.toId === id)
      .flatMap((link) => [link.fromId, link.toId])
      .filter((entityId) => entityId !== id);
    return {
      id,
      relatedEntities: uniqueStrings([...sourceRelated, ...graphRelated]),
      sourceIds,
      linkTypes: uniqueStrings(links.filter((link) => link.fromId === id || link.toId === id).map((link) => link.type))
    };
  }

  async deleteRecord(id: string): Promise<{
    id: string;
    kind: 'entity' | 'source';
    deleted: true;
    removedLinks: number;
    removedEvents: number;
  }> {
    const entityMarkdown = await this.store.getEntityMarkdown(id);
    if (entityMarkdown) {
      const removedLinks = (await this.store.listLinks()).filter((link) => link.fromId === id || link.toId === id).length;
      await this.store.deleteEntityMarkdown(id);
      await this.store.deleteDraft(id);
      await this.store.deleteEntityRegistryEntry(id);
      await this.removeLinksWhere((link) => link.fromId === id || link.toId === id);
      await this.removeEntityReferencesFromSources(id);
      const removedEvents = await this.rewriteEvents((event) => {
        if (!event.entityIds.includes(id)) return event;
        const nextEntityIds = event.entityIds.filter((entityId) => entityId !== id);
        return nextEntityIds.length > 0 ? { ...event, entityIds: nextEntityIds } : null;
      });
      this.invalidateLexicalCaches();
      return { id, kind: 'entity', deleted: true, removedLinks, removedEvents };
    }

    const sourceMarkdown = await this.store.getSourceMarkdown(id);
    if (sourceMarkdown) {
      const removedLinks = (await this.store.listLinks()).filter((link) => link.originKind === 'source' && link.originId === id).length;
      await this.store.deleteSourceMarkdown(id);
      await this.removeSourceReferencesFromEntities(id);
      await this.removeLinksWhere((link) => link.originKind === 'source' && link.originId === id);
      const removedEvents = await this.rewriteEvents((event) => {
        if (!event.sourceIds.includes(id)) return event;
        return { ...event, sourceIds: event.sourceIds.filter((sourceId) => sourceId !== id) };
      });
      this.invalidateLexicalCaches();
      return { id, kind: 'source', deleted: true, removedLinks, removedEvents };
    }

    throw new Error(`Knowledge record not found: ${id}`);
  }

  async exportReplay(): Promise<string> {
    if (!this.rootDir) return '';
    const records = await this.replayAdapter.loadRecords(this.rootDir, this.tenantId);
    return records.map((record) => JSON.stringify(record)).join('\n');
  }

  async replayQueries(recordsPath?: string): Promise<KnowledgeReplaySummary> {
    const records = await this.replayAdapter.loadRecords(this.rootDir, this.tenantId, recordsPath);
    const regressions: KnowledgeReplaySummary['regressions'] = [];
    let jaccardSum = 0;
    let top1Stable = 0;
    let latencyDeltaSum = 0;

    for (const record of records) {
      const startedAt = Date.now();
      const replayed =
        record.mode === 'query-relations'
          ? await this.queryRelations({
              query: record.query,
              limit: record.limit,
              mode: 'graph-first-hybrid',
              lexicalBackend: record.lexicalBackend,
              captureReplay: false
            })
          : await this.search({
              query: record.query,
              limit: record.limit,
              mode: record.mode,
              lexicalBackend: record.lexicalBackend,
              captureReplay: false
            });
      const durationMs = Date.now() - startedAt;
      const currentIds = replayed.results.map((result) => result.id);
      const jaccardAtK = replayJaccard(record.resultIds, currentIds, record.limit);
      const previousTop1 = record.resultIds[0] ?? null;
      const currentTop1 = currentIds[0] ?? null;
      jaccardSum += jaccardAtK;
      if (previousTop1 === currentTop1) top1Stable += 1;
      latencyDeltaSum += durationMs - record.durationMs;
      if (jaccardAtK < 0.5 || previousTop1 !== currentTop1) {
        regressions.push({
          query: record.query,
          previousTop1,
          currentTop1,
          jaccardAtK,
          latencyDeltaMs: durationMs - record.durationMs
        });
      }
    }

    regressions.sort((left, right) => left.jaccardAtK - right.jaccardAtK || right.latencyDeltaMs - left.latencyDeltaMs);
    return {
      recordCount: records.length,
      meanJaccardAtK: records.length ? jaccardSum / records.length : 1,
      top1Stability: records.length ? top1Stable / records.length : 1,
      meanLatencyDeltaMs: records.length ? latencyDeltaSum / records.length : 0,
      regressions: regressions.slice(0, 20)
    };
  }

  private async loadEntities(): Promise<EntityDocument[]> {
    const docs = await this.store.listEntityMarkdown();
    return docs.map((entry) => parseEntityDocument(entry.markdown));
  }

  private async loadRegistry(entities?: EntityDocument[]): Promise<KnowledgeEntityRegistryEntry[]> {
    const currentEntities = entities ?? await this.loadEntities();
    const persisted = await this.store.listEntityRegistry();
    const persistedMap = new Map(persisted.map((entry) => [entry.entityId, entry]));
    const derived = currentEntities.map((entity) => persistedMap.get(entity.meta.id) ?? registryEntryFromEntity(entity));
    return derived.sort((left, right) => left.entityId.localeCompare(right.entityId));
  }

  private async loadSources(): Promise<SourceDocument[]> {
    const docs = await this.store.listSourceMarkdown();
    return docs.map((entry) => parseSourceDocument(entry.markdown));
  }

  private async loadEvents(): Promise<KnowledgeEvent[]> {
    return (await this.store.listEvents()).sort((left, right) => {
      const created = left.createdAt.localeCompare(right.createdAt);
      return created !== 0 ? created : left.id.localeCompare(right.id);
    });
  }

  private async filterRelations(input: {
    entityId?: string;
    originKind?: KnowledgeLinkOrigin['kind'];
    originId?: string;
    type?: string;
  }): Promise<KnowledgeLink[]> {
    return (await this.store.listLinks())
      .filter((link) => {
        if (input.entityId && link.fromId !== input.entityId && link.toId !== input.entityId) return false;
        if (input.originKind && link.originKind !== input.originKind) return false;
        if (input.originId && link.originId !== input.originId) return false;
        if (input.type && link.type !== input.type) return false;
        return true;
      })
      .sort((left, right) => {
        const created = left.createdAt.localeCompare(right.createdAt);
        return created !== 0 ? created : left.id.localeCompare(right.id);
      });
  }

  private async buildMutationResult(input: {
    mutated: true;
    entityIds: string[];
    sourceIds: string[];
    eventIds: string[];
    warnings: string[];
    links: KnowledgeLink[];
  }): Promise<KnowledgeMutationResult> {
    const [entities, sources, events] = await Promise.all([
      this.loadEntities(),
      this.loadSources(),
      this.loadEvents()
    ]);
    return {
      mutated: true,
      entityIds: uniqueStrings(input.entityIds),
      sourceIds: uniqueStrings(input.sourceIds),
      eventIds: uniqueStrings(input.eventIds),
      warnings: input.warnings,
      hydrated: {
        entities: entities.filter((entity) => input.entityIds.includes(entity.meta.id)),
        sources: sources.filter((source) => input.sourceIds.includes(source.meta.id)),
        events: events.filter((event) => input.eventIds.includes(event.id)),
        links: input.links
      }
    };
  }

  private async loadLinksForEdges(
    edges: Array<{
      type: string;
      fromId: string;
      toId: string;
    }>
  ): Promise<KnowledgeLink[]> {
    const expected = new Set(edges.map((edge) => `${edge.type}:${edge.fromId}:${edge.toId}`));
    return (await this.store.listLinks())
      .filter((link) => expected.has(`${link.type}:${link.fromId}:${link.toId}`))
      .sort((left, right) => {
        const created = left.createdAt.localeCompare(right.createdAt);
        return created !== 0 ? created : left.id.localeCompare(right.id);
      });
  }

  private async lexicalSearch(input: KnowledgeSearchInput): Promise<{ query: string; assistedQuery?: string; results: KnowledgeSearchResult[] }> {
    const entities = await this.loadEntities();
    const registry = await this.loadRegistry(entities);
    const sources = await this.loadSources();
    const links = await this.store.listLinks();
    const effectiveQuery = input.query.trim();
    const assistedQuery = input.assistQuery ? assistQuery(effectiveQuery) : undefined;
    const relationClassification = classifyRelationQuery(effectiveQuery);
    const anchor = relationClassification.anchorQuery
      ? resolveAnchorEntity(relationClassification.anchorQuery, relationClassification.relationType, effectiveQuery, registry, entities, links)
      : null;
    const lexicalBackend = input.lexicalBackend ?? DEFAULT_LEXICAL_BACKEND;
    const sourceEntityContext = new Map(
      entities.map((entity) => [
        entity.meta.id,
        [entity.meta.title, entity.meta.aliases.join(' '), entity.meta.handles.join(' '), entity.meta.tags.join(' ')].join(' ').trim()
      ])
    );

    if (lexicalBackend === 'bm25-lexical') {
      const index = this.getBm25Index(entities, sources);
      const indexedResults = scoreBm25Index({
        index,
        query: [effectiveQuery, assistedQuery].filter(Boolean).join(' '),
        limit: input.limit ?? 10,
        kind: input.kind
      });
      const results = indexedResults.map((entry) => {
        if (entry.kind !== 'entity' || !entry.entityKind) {
          const suppression = bm25RelationPenalty(entry, relationClassification.relationType, anchor?.meta.id ?? null, effectiveQuery);
          const score = Number((entry.score - suppression).toFixed(3));
          return {
            ...entry,
            score,
            confidence: scoreToConfidence(score),
            ambiguous: score < 8
          };
        }
        const suppression = bm25RelationPenalty(entry, relationClassification.relationType, anchor?.meta.id ?? null, effectiveQuery);
        const score = Number((entry.score - suppression).toFixed(3));
        return {
          ...entry,
          score,
          reason: uniqueStrings([
            ...entry.reason,
            ...(suppression > 0 ? [`suppress:${suppression.toFixed(1)}`] : [])
          ]),
          confidence: scoreToConfidence(score),
          ambiguous: score < 8,
          relationTypes: uniqueStrings(
            links.filter((link) => link.fromId === entry.id || link.toId === entry.id).map((link) => link.type)
          )
        };
      });
      return {
        query: effectiveQuery,
        assistedQuery,
        results: applyAmbiguityCalibration(
          mergeExploratoryGraphResults(
            results
              .filter((entry) => entry.score > 0)
              .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
              .slice(0, input.limit ?? 10),
            buildSearchGraphBoostResults(entities, links, relationClassification.relationType, anchor?.meta.id ?? null, effectiveQuery, input.limit ?? 10),
            input.limit ?? 10
          )
        )
      };
    }

    const tokens = tokenizeSearch([effectiveQuery, assistedQuery].filter(Boolean).join(' '));
    const results: KnowledgeSearchResult[] = [];

    for (const entity of entities) {
      if (input.kind && entity.meta.kind !== input.kind) continue;
      const haystacks = [
        { field: 'title', value: entity.meta.title, weight: 3 },
        { field: 'kind', value: entity.meta.kind, weight: 0.5 },
        { field: 'alias', value: entity.meta.aliases.join(' '), weight: 2.75 },
        { field: 'handle', value: entity.meta.handles.join(' '), weight: 3.25 },
        { field: 'tag', value: entity.meta.tags.join(' '), weight: 1.5 },
        { field: 'truth', value: entity.currentTruth, weight: 1.25 },
        { field: 'timeline', value: entity.timeline.join(' '), weight: 0.9 }
      ];
      const match = scoreMatch(tokens, haystacks);
      if (match.score > 0) {
        const identityBias = computeIdentityQueryBias({
          query: effectiveQuery,
          relationType: relationClassification.relationType,
          kind: 'entity',
          entity
        });
        results.push({
          id: entity.meta.id,
          kind: 'entity',
          entityKind: entity.meta.kind,
          title: entity.meta.title,
          score: Number((match.score + identityBias.scoreAdjustment).toFixed(3)),
          reason: uniqueStrings([...match.reason, ...identityBias.reason]),
          matchedFields: uniqueStrings(match.matchedFields),
          sourceIds: uniqueStrings([...entity.sources, ...entity.meta.sources]),
          confidence: scoreToConfidence(match.score + identityBias.scoreAdjustment),
          ambiguous: match.score + identityBias.scoreAdjustment < 8,
          excerpt: compactExcerpt(entity.currentTruth || entity.timeline[0] || entity.meta.title),
          retrievalMode: 'search-only',
          relationTypes: uniqueStrings(
            links.filter((link) => link.fromId === entity.meta.id || link.toId === entity.meta.id).map((link) => link.type)
          )
        });
      }
    }

    for (const source of sources) {
      const linkedEntityContext = source.meta.linkedEntities
        .map((entityId) => sourceEntityContext.get(entityId) ?? entityId)
        .join(' ');
      const haystacks = [
        { field: 'title', value: source.meta.title, weight: 1.25 },
        { field: 'summary', value: source.summary, weight: 1.5 },
        { field: 'content', value: source.content, weight: 1 },
        { field: 'tag', value: source.meta.tags.join(' '), weight: 1.1 },
        { field: 'linked-entity-context', value: linkedEntityContext, weight: 0.85 }
      ];
      const match = scoreMatch(tokens, haystacks);
      if (match.score > 0) {
        const identityBias = computeIdentityQueryBias({
          query: effectiveQuery,
          relationType: relationClassification.relationType,
          kind: 'source'
        });
        results.push({
          id: source.meta.id,
          kind: 'source',
          title: source.meta.title,
          score: Number((match.score + identityBias.scoreAdjustment).toFixed(3)),
          reason: uniqueStrings([...match.reason, ...identityBias.reason]),
          matchedFields: match.matchedFields,
          sourceIds: [source.meta.id],
          confidence: scoreToConfidence(match.score + identityBias.scoreAdjustment),
          ambiguous: match.score + identityBias.scoreAdjustment < 8,
          excerpt: compactExcerpt(source.summary || source.content || source.meta.title),
          retrievalMode: 'search-only'
        });
      }
    }

    results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
    return {
      query: effectiveQuery,
      assistedQuery,
      results: applyAmbiguityCalibration(
        mergeExploratoryGraphResults(
          results.slice(0, input.limit ?? 10),
          buildSearchGraphBoostResults(entities, links, relationClassification.relationType, anchor?.meta.id ?? null, effectiveQuery, input.limit ?? 10),
          input.limit ?? 10
        )
      )
    };
  }

  private getBm25Index(entities: EntityDocument[], sources: SourceDocument[]) {
    const version = [
      entities.length,
      sources.length,
      ...entities.map((entity) => `${entity.meta.id}:${entity.meta.updatedAt}`),
      ...sources.map((source) => `${source.meta.id}:${source.meta.createdAt}`)
    ].join('|');
    if (this.bm25Cache?.version === version) return this.bm25Cache.index;
    const index = buildBm25Index({ entities, sources });
    this.bm25Cache = { version, index };
    return index;
  }

  private invalidateLexicalCaches() {
    this.bm25Cache = null;
  }

  private async upsertEntityDocument(input: {
    id: string;
    kind: KnowledgeEntityKind;
    title: string;
    aliases?: string[];
    handles?: string[];
    tags?: string[];
    status?: string;
    owners?: string[];
    sources?: string[];
    confidence?: 'low' | 'medium' | 'high';
    currentTruth?: string;
    openQuestions?: string[];
    timeline?: string[];
    supersedes?: string[];
    freshnessStatus?: 'fresh' | 'needs_review' | 'stale';
    lastReviewedAt?: string;
  }): Promise<EntityDocument> {
    const currentMarkdown = await this.store.getEntityMarkdown(input.id);
    const current = currentMarkdown ? parseEntityDocument(currentMarkdown) : null;
    const next = createEmptyEntity({
      id: input.id,
      tenantId: this.tenantId,
      kind: input.kind ?? current?.meta.kind,
      title: input.title ?? current?.meta.title ?? titleFromId(input.id),
      aliases: uniqueStrings([...(current?.meta.aliases ?? []), ...(input.aliases ?? [])]),
      handles: uniqueStrings([...(current?.meta.handles ?? []), ...(input.handles ?? [])]),
      tags: uniqueStrings([...(current?.meta.tags ?? []), ...(input.tags ?? [])]),
      status: input.status ?? current?.meta.status,
      owners: uniqueStrings([...(current?.meta.owners ?? []), ...(input.owners ?? [])]),
      sources: uniqueStrings([...(current?.sources ?? []), ...(input.sources ?? [])]),
      confidence: input.confidence ?? current?.meta.confidence,
      supersedes: uniqueStrings([...(current?.meta.supersedes ?? []), ...(input.supersedes ?? [])]),
      freshnessStatus: input.freshnessStatus ?? current?.meta.freshnessStatus,
      lastReviewedAt: input.lastReviewedAt ?? current?.meta.lastReviewedAt,
      currentTruth: input.currentTruth ?? current?.currentTruth,
      openQuestions: uniqueStrings([...(current?.openQuestions ?? []), ...(input.openQuestions ?? [])]),
      timeline: uniqueStrings([...(current?.timeline ?? []), ...(input.timeline ?? [])])
    });
    await this.store.putEntityMarkdown(next.meta.id, renderEntityDocument(next));
    await this.upsertRegistryEntry(next);
    this.invalidateLexicalCaches();
    await this.reindexEntity(next.meta.id);
    return next;
  }

  private async upsertSourceDocument(input: {
    id?: string;
    kind: 'note' | 'research' | 'workspace' | 'chat';
    title: string;
    url?: string;
    authors?: string[];
    citations?: string[];
    linkedEntities?: string[];
    summary?: string;
    content?: string;
    rawSourceRef?: string;
    supersedes?: string[];
    freshnessStatus?: 'fresh' | 'needs_review' | 'stale';
    lastReviewedAt?: string;
  }): Promise<SourceDocument> {
    const id = input.id ?? buildId('src');
    const currentMarkdown = await this.store.getSourceMarkdown(id);
    const current = currentMarkdown ? parseSourceDocument(currentMarkdown) : null;
    const next = createSourceDocument({
      id,
      tenantId: this.tenantId,
      kind: input.kind ?? current?.meta.kind ?? 'note',
      title: input.title ?? current?.meta.title ?? 'Untitled source',
      url: input.url ?? current?.meta.url,
      authors: uniqueStrings([...(current?.meta.authors ?? []), ...(input.authors ?? [])]),
      tags: current?.meta.tags ?? [],
      linkedEntities: uniqueStrings([...(current?.meta.linkedEntities ?? []), ...(input.linkedEntities ?? [])]),
      createdAt: current?.meta.createdAt,
      rawSourceRef: input.rawSourceRef ?? current?.meta.rawSourceRef,
      supersedes: uniqueStrings([...(current?.meta.supersedes ?? []), ...(input.supersedes ?? [])]),
      freshnessStatus: input.freshnessStatus ?? current?.meta.freshnessStatus,
      lastReviewedAt: input.lastReviewedAt ?? current?.meta.lastReviewedAt,
      summary: input.summary ?? current?.summary,
      content: input.content ?? current?.content,
      citations: uniqueStrings([...(current?.citations ?? []), ...(input.citations ?? []), ...(input.url ? [input.url] : [])])
    });
    await this.store.putSourceMarkdown(id, renderSourceDocument(next));
    this.invalidateLexicalCaches();
    await this.reindexSource(id);
    return next;
  }

  private async appendTimelineEntry(entityId: string, line: string, sourceIds: string[]): Promise<EntityDocument> {
    const currentMarkdown = await this.store.getEntityMarkdown(entityId);
    if (!currentMarkdown) throw new Error(`Entity not found: ${entityId}`);
    const current = parseEntityDocument(currentMarkdown);
    const next = createEmptyEntity({
      id: current.meta.id,
      tenantId: current.meta.tenantId,
      kind: current.meta.kind,
      title: current.meta.title,
      aliases: current.meta.aliases,
      handles: current.meta.handles,
      tags: current.meta.tags,
      status: current.meta.status,
      owners: current.meta.owners,
      sources: uniqueStrings([...(current.sources ?? []), ...sourceIds]),
      confidence: current.meta.confidence,
      currentTruth: current.currentTruth,
      openQuestions: current.openQuestions,
      timeline: uniqueStrings([...(current.timeline ?? []), line])
    });
    await this.store.putEntityMarkdown(entityId, renderEntityDocument(next));
    await this.upsertRegistryEntry(next);
    this.invalidateLexicalCaches();
    await this.reindexEntity(entityId);
    return next;
  }

  private async ensureRelationTargets(
    relations: Array<{ fromId: string; toId: string }>,
    entityInputs: Array<{ id: string; kind: KnowledgeEntityKind; title: string; aliases?: string[] }>,
    sourceIds: string[]
  ): Promise<void> {
    const knownIds = new Set(entityInputs.map((entity) => entity.id));
    const allTargets = uniqueStrings(relations.flatMap((relation) => [relation.fromId, relation.toId]));
    for (const targetId of allTargets) {
      if (knownIds.has(targetId)) continue;
      const existing = await this.store.getEntityMarkdown(targetId);
      if (existing) continue;
      await this.upsertEntityDocument({
        id: targetId,
        kind: 'person',
        title: titleFromId(targetId),
        sources: sourceIds
      });
    }
  }

  private async upsertRegistryEntry(entity: EntityDocument): Promise<void> {
    await this.store.putEntityRegistryEntry(registryEntryFromEntity(entity));
  }

  private async captureReplay(input: {
    query: string;
    mode: 'search-only' | 'graph-only' | 'graph-first-hybrid' | 'query-relations';
    lexicalBackend?: KnowledgeLexicalBackend;
    limit: number;
    durationMs: number;
    resultIds: string[];
    relationType?: string | null;
    anchorId?: string | null;
  }): Promise<void> {
    if (!this.rootDir) return;
    if (!this.replayCaptureEnabled) return;
    await this.replayAdapter.appendRecord(this.rootDir, {
      tenantId: this.tenantId,
      capturedAt: new Date().toISOString(),
      query: input.query,
      mode: input.mode,
      lexicalBackend: input.lexicalBackend,
      limit: input.limit,
      durationMs: input.durationMs,
      resultIds: input.resultIds,
      relationType: input.relationType ?? null,
      anchorId: input.anchorId ?? null
    });
  }

  private async reindexEntity(entityId: string): Promise<number> {
    const markdown = await this.store.getEntityMarkdown(entityId);
    if (!markdown) return 0;
    const entity = parseEntityDocument(markdown);
    const entities = await this.loadEntities();
    const links = extractLinksFromText(
      { tenantId: this.tenantId, entities, sources: [] },
      this.relationRules,
      {
        originKind: 'entity',
        originId: entityId,
        text: entity.currentTruth,
        sourceIds: entity.sources,
        evidenceKind: 'direct',
        sourceSurface: 'current-truth',
        createdAt: entity.meta.updatedAt,
        primaryEntityId: entityId
      }
    );
    const timelineLinks = extractLinksFromText(
      { tenantId: this.tenantId, entities, sources: [] },
      this.relationRules,
      {
        originKind: 'entity',
        originId: entityId,
        text: entity.timeline.join('\n'),
        sourceIds: entity.sources,
        evidenceKind: 'timeline',
        sourceSurface: 'timeline',
        createdAt: entity.meta.updatedAt,
        primaryEntityId: entityId
      }
    );
    const entityMap = new Map(entities.map((entry) => [entry.meta.id, entry]));
    const allLinks = dedupeLinks([...links, ...timelineLinks]).map((link) => annotateLinkTemporalState(link, entity, entityMap.get(link.toId) ?? entityMap.get(link.fromId) ?? null));
    await this.store.replaceLinksForOrigin({ kind: 'entity', id: entityId }, allLinks);
    return allLinks.length;
  }

  private async reindexSource(sourceId: string): Promise<number> {
    const markdown = await this.store.getSourceMarkdown(sourceId);
    if (!markdown) return 0;
    const source = parseSourceDocument(markdown);
    const entities = await this.loadEntities();
    const summaryLinks = source.summary
      ? extractLinksFromText(
          { tenantId: this.tenantId, entities, sources: [] },
          this.relationRules,
          {
            originKind: 'source',
            originId: sourceId,
            text: source.summary,
            sourceIds: [source.meta.id],
            evidenceKind: 'summary',
            sourceSurface: 'source-summary',
            createdAt: source.meta.createdAt
          }
        )
      : [];
    const contentLinks = source.content
      ? extractLinksFromText(
          { tenantId: this.tenantId, entities, sources: [] },
          this.relationRules,
          {
            originKind: 'source',
            originId: sourceId,
            text: source.content,
            sourceIds: [source.meta.id],
            evidenceKind: 'direct',
            sourceSurface: 'source-content',
            createdAt: source.meta.createdAt
          }
        )
      : [];
    const entityMap = new Map(entities.map((entry) => [entry.meta.id, entry]));
    const links = dedupeLinks([...summaryLinks, ...contentLinks]).map((link) => annotateLinkTemporalState(link, null, entityMap.get(link.toId) ?? entityMap.get(link.fromId) ?? null));
    await this.store.replaceLinksForOrigin({ kind: 'source', id: sourceId }, links);
    return links.length;
  }

  private async reindexEvent(event: KnowledgeEvent): Promise<number> {
    const entities = await this.loadEntities();
    const links = extractLinksFromText(
      { tenantId: this.tenantId, entities, sources: [] },
      this.relationRules,
      {
        originKind: 'event',
        originId: event.id,
        text: event.summary,
        sourceIds: event.sourceIds,
        evidenceKind: 'timeline',
        sourceSurface: 'event-summary',
        createdAt: event.createdAt,
        primaryEntityId: event.entityIds[0]
      }
    );
    const entityMap = new Map(entities.map((entry) => [entry.meta.id, entry]));
    const annotatedLinks = links.map((link) => annotateLinkTemporalState(link, null, entityMap.get(link.toId) ?? entityMap.get(link.fromId) ?? null));
    await this.store.replaceLinksForOrigin({ kind: 'event', id: event.id }, annotatedLinks);
    return annotatedLinks.length;
  }

  private async removeEntityReferencesFromSources(entityId: string): Promise<void> {
    const sources = await this.loadSources();
    for (const source of sources) {
      if (!source.meta.linkedEntities.includes(entityId)) continue;
      const next = createSourceDocument({
        id: source.meta.id,
        tenantId: source.meta.tenantId,
        kind: source.meta.kind,
        title: source.meta.title,
        url: source.meta.url,
        authors: source.meta.authors,
        tags: source.meta.tags,
        linkedEntities: source.meta.linkedEntities.filter((linkedId) => linkedId !== entityId),
        summary: source.summary,
        content: source.content,
        citations: source.citations,
        createdAt: source.meta.createdAt
      });
      await this.store.putSourceMarkdown(source.meta.id, renderSourceDocument(next));
    }
  }

  private async removeSourceReferencesFromEntities(sourceId: string): Promise<void> {
    const entities = await this.loadEntities();
    for (const entity of entities) {
      const nextSourceIds = uniqueStrings([...entity.sources, ...entity.meta.sources].filter((entry) => entry !== sourceId));
      if (nextSourceIds.length === uniqueStrings([...entity.sources, ...entity.meta.sources]).length) continue;
      const next = createEmptyEntity({
        id: entity.meta.id,
        tenantId: entity.meta.tenantId,
        kind: entity.meta.kind,
        title: entity.meta.title,
        aliases: entity.meta.aliases,
        handles: entity.meta.handles,
        tags: entity.meta.tags,
        status: entity.meta.status,
        owners: entity.meta.owners,
        sources: nextSourceIds,
        confidence: entity.meta.confidence,
        currentTruth: entity.currentTruth,
        openQuestions: entity.openQuestions,
        timeline: entity.timeline
      });
      await this.store.putEntityMarkdown(entity.meta.id, renderEntityDocument(next));
      await this.upsertRegistryEntry(next);
    }
  }

  private async rewriteEvents(transform: (event: KnowledgeEvent) => KnowledgeEvent | null): Promise<number> {
    const current = await this.store.listEvents();
    const next: KnowledgeEvent[] = [];
    let changed = 0;
    for (const event of current) {
      const transformed = transform(event);
      if (!transformed) {
        changed += 1;
        continue;
      }
      next.push(transformed);
      if (JSON.stringify(transformed) !== JSON.stringify(event)) changed += 1;
    }
    if (changed > 0) {
      await this.store.replaceEvents(next);
    }
    return changed;
  }

  private async removeLinksWhere(predicate: (link: KnowledgeLink) => boolean): Promise<number> {
    const allLinks = await this.store.listLinks();
    const removed = allLinks.filter(predicate);
    if (removed.length === 0) return 0;
    const remaining = allLinks.filter((link) => !predicate(link));
    const touchedOrigins = new Map<string, KnowledgeLinkOrigin>();
    for (const link of removed) {
      if (!link.originKind || !link.originId) continue;
      touchedOrigins.set(`${link.originKind}:${link.originId}`, { kind: link.originKind, id: link.originId });
    }
    const remainingByOrigin = new Map<string, KnowledgeLink[]>();
    for (const link of remaining) {
      if (!link.originKind || !link.originId) continue;
      const key = `${link.originKind}:${link.originId}`;
      const bucket = remainingByOrigin.get(key) ?? [];
      bucket.push(link);
      remainingByOrigin.set(key, bucket);
    }
    for (const origin of touchedOrigins.values()) {
      await this.store.replaceLinksForOrigin(origin, remainingByOrigin.get(`${origin.kind}:${origin.id}`) ?? []);
    }
    return removed.length;
  }
}

function replayJaccard(previous: string[], current: string[], limit: number): number {
  const left = new Set(previous.slice(0, limit));
  const right = new Set(current.slice(0, limit));
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : intersection / union;
}

function detectSupersessionCycles(records: Array<{ id: string; supersedes: string[] }>): string[][] {
  const graph = new Map(records.map((record) => [record.id, record.supersedes]));
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();

  for (const record of records) {
    const stack: string[] = [];
    const onStack = new Set<string>();
    walkSupersession(record.id, graph, stack, onStack, cycles, seenKeys);
  }

  return cycles;
}

function walkSupersession(
  currentId: string,
  graph: Map<string, string[]>,
  stack: string[],
  onStack: Set<string>,
  cycles: string[][],
  seenKeys: Set<string>
): void {
  stack.push(currentId);
  onStack.add(currentId);

  for (const nextId of graph.get(currentId) ?? []) {
    if (onStack.has(nextId)) {
      const startIndex = stack.indexOf(nextId);
      const cycle = [...stack.slice(startIndex), nextId];
      const key = cycle.join('->');
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        cycles.push(cycle);
      }
      continue;
    }
    if (!graph.has(nextId)) continue;
    walkSupersession(nextId, graph, stack, onStack, cycles, seenKeys);
  }

  stack.pop();
  onStack.delete(currentId);
}
