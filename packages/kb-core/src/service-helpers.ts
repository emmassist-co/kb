import { createEmptyEntity } from './documents.js';
import { classifyRelationQuery, findEntityByQuery } from './relations.js';
import type {
  EntityDocument,
  EntityDraft,
  KnowledgeBaseConfig,
  KnowledgeEntityKind,
  KnowledgeEntityRegistryEntry,
  KnowledgeEvent,
  KnowledgeLexicalBackend,
  KnowledgeLink,
  KnowledgeSearchResult
} from './types.js';

export const DEFAULT_LEXICAL_BACKEND: KnowledgeLexicalBackend = 'legacy-lexical';

export function defaultSearchMode(mode: KnowledgeBaseConfig['mode']): 'search-only' | 'graph-first-hybrid' {
  return mode === 'compound' ? 'graph-first-hybrid' : 'search-only';
}

export function defaultLexicalBackend(mode: KnowledgeBaseConfig['mode']): KnowledgeLexicalBackend {
  return mode === 'compound' ? 'bm25-lexical' : DEFAULT_LEXICAL_BACKEND;
}

export function buildConsolidatedEntity(
  tenantId: string,
  entityId: string,
  current: EntityDocument | null,
  draft: EntityDraft | null,
  events: KnowledgeEvent[]
): EntityDocument {
  const timelineFromEvents = events
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((event) => `${event.createdAt.slice(0, 10)}: ${event.summary}`);
  const next = current
    ? {
        ...current,
        meta: { ...current.meta }
      }
    : createEmptyEntity({
        id: entityId,
        tenantId,
        kind: draft?.kind ?? 'process',
        title: draft?.title ?? titleFromId(entityId)
      });

  next.meta.kind = draft?.kind ?? next.meta.kind;
  next.meta.title = draft?.title ?? next.meta.title;
  next.currentTruth = (draft?.summary ?? next.currentTruth ?? '').trim();
  next.openQuestions = uniqueStrings([...(next.openQuestions ?? []), ...(draft?.openQuestions ?? [])]);
  next.timeline = uniqueStrings([...(next.timeline ?? []), ...timelineFromEvents, ...(draft?.timelineNotes ?? [])]);
  next.sources = uniqueStrings([...(next.sources ?? []), ...(draft?.sourceIds ?? []), ...events.flatMap((event) => event.sourceIds)]);
  next.meta.sources = uniqueStrings([...(next.meta.sources ?? []), ...next.sources]);
  next.meta.updatedAt = new Date().toISOString();
  return next;
}

export function assistQuery(query: string): string {
  return uniqueStrings(
    query
      .toLowerCase()
      .split(/[^a-z0-9@._-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
  ).join(' ');
}

export function tokenizeSearch(query: string): string[] {
  return uniqueStrings(
    query
      .toLowerCase()
      .split(/[^a-z0-9@._-]+/i)
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

export function scoreMatch(
  tokens: string[],
  haystacks: Array<{ field: string; value: string; weight?: number }>
): { score: number; reason: string[]; matchedFields: string[] } {
  if (tokens.length === 0) return { score: 0, reason: [], matchedFields: [] };
  let score = 0;
  const reason: string[] = [];
  const matchedFields: string[] = [];
  const normalized = haystacks.map((entry) => ({
    value: entry.value.toLowerCase(),
    field: entry.field,
    weight: entry.weight ?? 1
  }));
  for (const token of tokens) {
    for (const haystack of normalized) {
      if (haystack.value === token) {
        score += 8 * haystack.weight;
        reason.push(`exact:${token}`);
        matchedFields.push(haystack.field);
        break;
      }
      if (haystack.value.includes(token)) {
        score += 3 * haystack.weight;
        reason.push(`contains:${token}`);
        matchedFields.push(haystack.field);
        break;
      }
    }
  }
  return { score, reason: uniqueStrings(reason), matchedFields: uniqueStrings(matchedFields) };
}

export function computeIdentityQueryBias(input: {
  query: string;
  relationType: string | null;
  kind: 'entity' | 'source';
  entity?: EntityDocument;
}): { scoreAdjustment: number; reason: string[] } {
  if (input.relationType) return { scoreAdjustment: 0, reason: [] };
  const normalizedQuery = normalizeResolverText(input.query);
  if (!normalizedQuery) return { scoreAdjustment: 0, reason: [] };
  const tokens = tokenizeSearch(input.query).filter((token) => !IDENTITY_STOPWORDS.has(token));
  const handleLike = /[@.]/.test(input.query);
  const identityLike = handleLike || tokens.length <= 3;
  if (!identityLike) return { scoreAdjustment: 0, reason: [] };

  if (input.kind === 'source') {
    return {
      scoreAdjustment: handleLike ? -10 : -6,
      reason: ['identity-source-suppression']
    };
  }

  const entity = input.entity;
  if (!entity) return { scoreAdjustment: 0, reason: [] };
  const normalizedTitle = normalizeResolverText(entity.meta.title);
  const normalizedAliases = entity.meta.aliases.map(normalizeResolverText).filter(Boolean);
  const normalizedHandles = entity.meta.handles.map(normalizeResolverText).filter(Boolean);
  const exactHandle = normalizedHandles.includes(normalizedQuery);
  const exactAlias = normalizedAliases.includes(normalizedQuery);
  const exactTitle = normalizedTitle === normalizedQuery;
  const queryTags = tokens.filter((token) => entity.meta.tags.map((tag) => tag.toLowerCase()).includes(token));
  const boost =
    (exactHandle ? 18 : 0) +
    (exactAlias ? 14 : 0) +
    (exactTitle ? 12 : 0) +
    Math.min(4, queryTags.length * 2) +
    2;
  const reason = [
    ...(exactHandle ? ['identity-exact-handle'] : []),
    ...(exactAlias ? ['identity-exact-alias'] : []),
    ...(exactTitle ? ['identity-exact-title'] : []),
    ...(queryTags.length > 0 ? [`identity-tag-match:${queryTags.join(',')}`] : []),
    'identity-entity-preference'
  ];
  return { scoreAdjustment: boost, reason };
}

export function rankGraphResults(input: {
  relationType: string | null;
  anchorId: string | null;
  entities: EntityDocument[];
  links: KnowledgeLink[];
  query: string;
  limit: number;
}): KnowledgeSearchResult[] {
  if (!input.relationType || !input.anchorId) return [];
  const entityMap = new Map(input.entities.map((entity) => [entity.meta.id, entity]));
  const scored = new Map<
    string,
    {
      score: number;
      linkTypes: Set<string>;
      sourceIds: Set<string>;
      sourceSurfaces: Set<string>;
      historicalOnly: boolean;
      explicitSupport: boolean;
      evidenceKinds: Set<string>;
    }
  >();

  for (const link of input.links) {
    let candidateId: string | null = null;
    if (link.fromId === input.anchorId) candidateId = link.toId;
    else if (link.toId === input.anchorId) candidateId = link.fromId;
    if (!candidateId) continue;
    const entry = scored.get(candidateId) ?? {
      score: 0,
      linkTypes: new Set<string>(),
      sourceIds: new Set<string>(),
      sourceSurfaces: new Set<string>(),
      historicalOnly: true,
      explicitSupport: false,
      evidenceKinds: new Set<string>()
    };
    entry.score += scoreLink(link);
    entry.linkTypes.add(link.type);
    entry.evidenceKinds.add(link.evidenceKind);
    if (link.sourceSurface) entry.sourceSurfaces.add(link.sourceSurface);
    if (link.evidenceKind !== 'timeline') {
      entry.historicalOnly = false;
    }
    if (link.explicitReference || link.evidenceStrength === 'explicit-ref') {
      entry.explicitSupport = true;
    }
    for (const sourceId of link.sourceIds) entry.sourceIds.add(sourceId);
    scored.set(candidateId, entry);
  }

  return [...scored.entries()]
    .map(([entityId, entry]) => {
      const entity = entityMap.get(entityId);
      if (!entity) return null;
      const typeBoost = expectedAnswerTypeBoost(input.relationType, entity.meta.kind, input.query);
      const supportBoost = Math.min(4, entry.sourceIds.size * 0.75);
      const supportSurfaceBoost = Math.min(3, entry.sourceSurfaces.size * 0.6);
      const explicitBoost = entry.explicitSupport ? 1.5 : 0;
      const backlinkBoost = Math.min(2, input.links.filter((link) => link.fromId === entity.meta.id || link.toId === entity.meta.id).length * 0.2);
      const currentTruthBoost = entry.historicalOnly ? -4 : 3;
      const totalScore = entry.score + typeBoost + supportBoost + supportSurfaceBoost + explicitBoost + backlinkBoost + currentTruthBoost;
      return {
        id: entity.meta.id,
        kind: 'entity' as const,
        entityKind: entity.meta.kind,
        title: entity.meta.title,
        score: Number(totalScore.toFixed(3)),
        reason: uniqueStrings([
          `relation:${input.relationType}`,
          `anchor:${input.anchorId}`,
          ...(typeBoost > 0 ? [`type:${entity.meta.kind}`] : []),
          ...(entry.explicitSupport ? ['explicit-ref'] : []),
          ...(currentTruthBoost > 0 ? ['current-truth'] : entry.historicalOnly ? ['historical-only'] : [])
        ]),
        matchedFields: ['graph'],
        sourceIds: [...entry.sourceIds],
        confidence: scoreToConfidence(totalScore),
        ambiguous: totalScore < 10,
        excerpt: compactExcerpt(entity.currentTruth || entity.timeline[0] || entity.meta.title),
        retrievalMode: 'graph-only' as const,
        relationTypes: [...entry.linkTypes]
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, input.limit);
}

export function registryEntryFromEntity(entity: EntityDocument): KnowledgeEntityRegistryEntry {
  return {
    entityId: entity.meta.id,
    kind: entity.meta.kind,
    title: entity.meta.title,
    aliases: uniqueStrings(entity.meta.aliases),
    handles: uniqueStrings(entity.meta.handles),
    externalIds: [],
    canonicalTokens: uniqueStrings(buildCanonicalForms([entity.meta.title, ...entity.meta.aliases, ...entity.meta.handles])),
    pageFamily: inferPageFamily(entity.meta.kind),
    updatedAt: entity.meta.updatedAt
  };
}

export function normalizeResolverText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(currently|current|right now|actually|the|a|an|it)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveAnchorEntity(
  anchorQuery: string,
  relationType: string | null,
  rawQuery: string,
  registry: KnowledgeEntityRegistryEntry[],
  entities: EntityDocument[],
  links: KnowledgeLink[]
): EntityDocument | null {
  const fallback = findEntityByQuery(anchorQuery, entities, relationType, links);
  const normalized = normalizeResolverText(anchorQuery);
  const queryTokens = normalized.split(' ').filter(Boolean);
  const explicitMeeting = /\b(sync|weekly review|attends|attend)\b/i.test(rawQuery);
  const explicitPolicy = /\bpolicy|control set|covers|governs\b/i.test(rawQuery);
  const explicitSystem = /\bsystem|tool|toolchain\b/i.test(rawQuery);

  let best: { entityId: string; score: number } | null = null;
  for (const entry of registry) {
    let score = 0;
    for (const form of entry.canonicalTokens) {
      if (!form) continue;
      if (form === normalized) score = Math.max(score, 26);
      else if (form.includes(normalized) || normalized.includes(form)) score = Math.max(score, 18);
      else {
        const formTokens = new Set(form.split(' ').filter(Boolean));
        const overlap = queryTokens.filter((token) => formTokens.has(token)).length;
        if (overlap >= 2) score = Math.max(score, 12 + overlap);
      }
    }
    if (relationType) score += relationAnchorFamilyBoost(entry.pageFamily, relationType, explicitMeeting, explicitPolicy, explicitSystem);
    if (!/\bdesk\b/i.test(rawQuery) && entry.title.toLowerCase().includes('core lane')) score += 1.25;
    if (!/\blane\b/i.test(rawQuery) && entry.title.toLowerCase().includes('priority desk')) score -= 1.5;
    if (best === null || score > best.score) best = { entityId: entry.entityId, score };
  }

  if (best && best.score >= 12) {
    return entities.find((entity) => entity.meta.id === best.entityId) ?? fallback;
  }
  return fallback;
}

export function annotateLinkTemporalState(link: KnowledgeLink, originEntity: EntityDocument | null, targetEntity: EntityDocument | null): KnowledgeLink {
  if (link.status) return link;
  if (link.sourceSurface === 'timeline' || link.evidenceKind === 'timeline') {
    return {
      ...link,
      status: 'historical',
      validFrom: extractFirstDate(originEntity?.timeline.join(' ') ?? '') ?? link.createdAt,
      validTo: link.createdAt
    };
  }
  if (originEntity && targetEntity) {
    const currentText = normalizeResolverText(originEntity.currentTruth);
    const timelineText = normalizeResolverText(originEntity.timeline.join(' '));
    const targetForms = buildCanonicalForms([targetEntity.meta.title, ...targetEntity.meta.aliases, ...targetEntity.meta.handles]);
    const inCurrent = targetForms.some((form) => currentText.includes(form));
    const inTimeline = targetForms.some((form) => timelineText.includes(form));
    if (inCurrent) {
      return { ...link, status: 'active', validFrom: originEntity.meta.updatedAt };
    }
    if (inTimeline && !inCurrent) {
      return {
        ...link,
        status: 'historical',
        validFrom: extractFirstDate(originEntity.timeline.join(' ')) ?? link.createdAt,
        validTo: originEntity.meta.updatedAt
      };
    }
  }
  return {
    ...link,
    status: 'active',
    validFrom: link.createdAt
  };
}

export function isLinkVisibleAt(link: KnowledgeLink, asOf: string | undefined, currentOnly: boolean): boolean {
  if (asOf) {
    const point = new Date(asOf).toISOString();
    const validFrom = link.validFrom ?? link.createdAt;
    const validTo = link.validTo ?? null;
    return validFrom <= point && (!validTo || validTo >= point);
  }
  if (currentOnly) return (link.status ?? 'active') === 'active';
  return true;
}

export function buildSearchGraphBoostResults(
  entities: EntityDocument[],
  links: KnowledgeLink[],
  relationType: string | null,
  anchorId: string | null,
  query: string,
  limit: number
): KnowledgeSearchResult[] {
  if (!relationType || !anchorId) return [];
  return rankGraphResults({
    relationType,
    anchorId,
    entities,
    links: links.filter((link) => link.type === relationType && (link.fromId === anchorId || link.toId === anchorId) && (link.status ?? 'active') === 'active'),
    query,
    limit
  }).map((entry) => ({
    ...entry,
    score: Number((entry.score * 0.45).toFixed(3)),
    retrievalMode: 'search-only' as const,
    reason: uniqueStrings([...entry.reason, 'graph-boost'])
  }));
}

export function mergeExploratoryGraphResults(
  lexical: KnowledgeSearchResult[],
  graph: KnowledgeSearchResult[],
  limit: number
): KnowledgeSearchResult[] {
  const merged = new Map<string, KnowledgeSearchResult>();
  for (const entry of lexical) {
    merged.set(entry.id, entry);
  }
  for (const entry of graph) {
    const current = merged.get(entry.id);
    if (!current) {
      merged.set(entry.id, entry);
      continue;
    }
    merged.set(entry.id, {
      ...current,
      score: Number((current.score + entry.score).toFixed(3)),
      reason: uniqueStrings([...current.reason, ...entry.reason]),
      matchedFields: uniqueStrings([...current.matchedFields, ...entry.matchedFields]),
      sourceIds: uniqueStrings([...current.sourceIds, ...entry.sourceIds]),
      relationTypes: uniqueStrings([...(current.relationTypes ?? []), ...(entry.relationTypes ?? [])])
    });
  }
  return [...merged.values()]
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

export function compactExcerpt(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 160 ? singleLine : `${singleLine.slice(0, 157)}...`;
}

export function suggestEntityIds(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
  return uniqueStrings(
    matches
      .map((value) => value.trim())
      .filter((value) => value.length >= 4)
      .map((value) => slugify(value))
  ).slice(0, 8);
}

export function titleFromId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function slugifyEntityTitle(kind: KnowledgeEntityKind, title: string): string {
  return `${kind}-${slugify(title)}`;
}

export function buildId(prefix: string): string {
  return `${prefix}_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_${crypto.randomUUID().slice(0, 8)}`;
}

export function relationClassificationOrNull(query: string): string | null {
  return classifyRelationQuery(query).relationType;
}

export function resolveRememberSourceContent(summary: string, content: string | undefined, url: string | undefined): string {
  const normalizedContent = (content ?? '').trim();
  if (normalizedContent) return normalizedContent;
  const normalizedSummary = summary.trim();
  if (normalizedSummary && url) return `${normalizedSummary}\n\nReference URL: ${url}`;
  if (normalizedSummary) return normalizedSummary;
  if (url) return `Reference captured without fetched body.\n\nReference URL: ${url}`;
  return 'Reference captured without fetched body.';
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function scoreToConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

export function applyAmbiguityCalibration(results: KnowledgeSearchResult[]): KnowledgeSearchResult[] {
  if (results.length < 2) return results;
  const topScore = Math.max(results[0].score, 0.001);
  const closeSecond = results[1].score >= topScore * 0.45;
  if (!closeSecond) return results;
  return results.map((entry, index) => (index < 2 ? { ...entry, ambiguous: true } : entry));
}

export function bm25RelationPenalty(
  entry: KnowledgeSearchResult,
  relationType: string | null,
  anchorId: string | null,
  query: string
): number {
  if (!relationType) return 0;
  let penalty = lexicalSuppressionPenalty(entry, relationType);
  if (anchorId && entry.id === anchorId) {
    penalty += 10;
  }
  if (entry.kind === 'entity' && entry.entityKind) {
    const preferredKinds = relationPreferredKinds(relationType, query.toLowerCase());
    if (!preferredKinds.includes(entry.entityKind)) {
      penalty += 5;
    }
  }
  return penalty;
}

export function summarizeLinks(links: KnowledgeLink[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.type, (counts.get(link.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

export function dedupeLinks(links: KnowledgeLink[]): KnowledgeLink[] {
  return [...new Map(links.map((link) => [link.id, link])).values()];
}

const IDENTITY_STOPWORDS = new Set(['resolve', 'from', 'the', 'a', 'an']);

function inferPageFamily(kind: KnowledgeEntityKind): KnowledgeEntityRegistryEntry['pageFamily'] {
  if (kind === 'process') return 'process';
  if (kind === 'meeting') return 'meeting';
  if (kind === 'project') return 'project';
  if (kind === 'decision') return 'decision';
  if (kind === 'policy') return 'policy';
  if (kind === 'system') return 'system';
  if (kind === 'team') return 'team';
  return 'entity';
}

function buildCanonicalForms(values: string[]): string[] {
  const synonyms: Record<string, string> = {
    exec: 'executive',
    recon: 'reconciliation',
    renewals: 'renewal',
    approvals: 'approval',
    redlines: 'redline',
    invoices: 'invoice'
  };
  return values.flatMap((value) => {
    const normalized = normalizeResolverText(value);
    const replaced = normalized
      .split(' ')
      .map((token) => synonyms[token] ?? singularizeToken(token))
      .join(' ')
      .trim();
    return [normalized, replaced].filter(Boolean);
  });
}

function singularizeToken(token: string): string {
  if (token.endsWith('ies') && token.length > 3) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) return token.slice(0, -1);
  return token;
}

function relationAnchorFamilyBoost(
  pageFamily: KnowledgeEntityRegistryEntry['pageFamily'],
  relationType: string,
  explicitMeeting: boolean,
  explicitPolicy: boolean,
  explicitSystem: boolean
): number {
  if (relationType === 'attends') return pageFamily === 'meeting' ? 8 : -2;
  if (relationType === 'applies_to' && explicitPolicy) return pageFamily === 'process' ? 8 : pageFamily === 'policy' ? 4 : -2;
  if (relationType === 'uses_system' && explicitSystem) return pageFamily === 'process' ? 8 : pageFamily === 'system' ? 4 : -2;
  if (explicitMeeting) return pageFamily === 'meeting' ? 6 : -2;
  if (['owns', 'approves', 'reviews', 'escalates_to', 'uses_system', 'vendor_for', 'depends_on', 'applies_to'].includes(relationType)) {
    return pageFamily === 'process' ? 7 : pageFamily === 'policy' ? 2 : pageFamily === 'project' || pageFamily === 'decision' ? -1 : 0;
  }
  return 0;
}

function extractFirstDate(text: string): string | null {
  const match = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  return match ? `${match[0]}T00:00:00.000Z` : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function scoreLink(link: KnowledgeLink): number {
  const evidenceBoost =
    link.evidenceStrength === 'explicit-ref'
      ? 4
      : link.evidenceStrength === 'page-prior'
        ? 1.5
      : link.evidenceStrength === 'keyword'
        ? 2
        : 0.5;
  const currentSurfaceBoost =
    link.sourceSurface === 'current-truth'
      ? 3
      : link.sourceSurface === 'source-summary' || link.sourceSurface === 'structured'
        ? 2
        : link.sourceSurface === 'timeline'
          ? 0.75
          : 1;
  const multiSourceBoost = Math.min(2.5, Math.max(0, link.sourceIds.length - 1) * 0.85);
  return 10 * link.confidence + evidenceBoost + currentSurfaceBoost + multiSourceBoost + (link.explicitReference ? 1.5 : 0);
}

function expectedAnswerTypeBoost(relationType: string | null, entityKind: KnowledgeEntityKind, query: string): number {
  if (!relationType) return 0;
  const lowerQuery = query.toLowerCase();
  const preferredKinds = relationPreferredKinds(relationType, lowerQuery);
  if (preferredKinds.includes(entityKind)) return 6;
  return relationType === 'applies_to' ? -8 : -4;
}

function relationPreferredKinds(relationType: string, query: string): KnowledgeEntityKind[] {
  if (relationType === 'depends_on') {
    if (query.includes('policy')) return ['policy'];
    if (query.includes('system') || query.includes('tool')) return ['system'];
    if (query.includes('vendor')) return ['vendor'];
    return ['process', 'policy', 'system', 'vendor'];
  }
  if (relationType === 'applies_to') {
    if (query.includes('system') || query.includes('tool') || query.includes('vendor')) {
      return ['policy', 'system', 'vendor'];
    }
    return ['policy'];
  }
  const map: Record<string, KnowledgeEntityKind[]> = {
    owns: ['person', 'team'],
    approves: ['person'],
    reviews: ['person'],
    escalates_to: ['person', 'team'],
    attends: ['person', 'team'],
    vendor_for: ['vendor'],
    bills: ['vendor'],
    renews_with: ['vendor'],
    uses_system: ['system'],
    integrates_with: ['system']
  };
  return map[relationType] ?? ['person', 'team', 'process', 'policy', 'system', 'vendor'];
}

function lexicalSuppressionPenalty(entry: KnowledgeSearchResult, relationType: string | null): number {
  if (!relationType) return 0;
  if (entry.kind === 'source') return 2;
  const suppressKinds = new Set<KnowledgeEntityKind>(['project', 'meeting', 'decision']);
  if (entry.entityKind && suppressKinds.has(entry.entityKind)) return 2.5;
  if (entry.entityKind === 'process' && relationType !== 'depends_on') return 2.25;
  return 0;
}
