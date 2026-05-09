import builtInRules from './relation-rules.json' with { type: 'json' };
import type {
  EntityDocument,
  KnowledgeEntityKind,
  KnowledgeLink,
  KnowledgeLinkDirection,
  KnowledgeLinkEvidenceStrength,
  KnowledgeLinkRule,
  KnowledgeRelationQueryInput,
  KnowledgeSearchMode,
  SourceDocument
} from './types.js';

interface KnownEntity {
  id: string;
  kind: KnowledgeEntityKind;
  title: string;
  aliases: string[];
  handles: string[];
  tags: string[];
}

export interface RelationContext {
  tenantId: string;
  entities: EntityDocument[];
  sources: SourceDocument[];
}

export interface RelationExtractionInput {
  originKind: 'entity' | 'source' | 'event' | 'seed';
  originId: string;
  text: string;
  sourceIds: string[];
  evidenceKind: KnowledgeLink['evidenceKind'];
  sourceSurface?: KnowledgeLink['sourceSurface'];
  createdAt?: string;
  primaryEntityId?: string;
}

interface PageRolePrior {
  relationType: string;
  keywords: string[];
  sourceKinds?: KnowledgeEntityKind[];
  targetKinds?: KnowledgeEntityKind[];
  direction?: KnowledgeLinkDirection;
}

export interface RelationQueryClassification {
  relationType: string | null;
  anchorQuery: string | null;
  confidence: number;
  candidateRelationTypes?: string[];
}

const RELATION_QUERY_RULES: Array<{ type: string; patterns: RegExp[] }> = [
  { type: 'owns', patterns: [/who\s+owns\s+(.+)\??$/i, /who\s+carries\s+(.+)\??$/i, /who\s+owns\s+(.+?)\s+and\s+which\s+team\s+carries\s+it\??$/i] },
  { type: 'approves', patterns: [/who\s+approves\s+(.+)\??$/i, /who\s+currently\s+approves\s+(.+)\??$/i, /who\s+signs\s+off\s+on\s+(.+)\??$/i] },
  { type: 'reviews', patterns: [/who\s+reviews\s+(.+)\??$/i, /who\s+checks\s+(.+?)\s+before\s+it\s+closes\??$/i] },
  { type: 'escalates_to', patterns: [/who\s+do(?:es)?\s+we\s+escalate\s+(.+?)\s+to\??$/i, /who\s+handles\s+escalation\s+for\s+(.+)\??$/i] },
  { type: 'escalates_to', patterns: [/who\s+handles\s+the\s+exception\s+path\s+for\s+(.+)\??$/i, /if\s+(.+?)\s+gets\s+weird,\s*who\s+does\s+it\s+go\s+to\??$/i] },
  { type: 'applies_to', patterns: [/what\s+policy\s+applies\s+to\s+(.+)\??$/i, /what\s+control\s+set\s+governs\s+(.+)\??$/i, /which\s+policy\s+covers\s+(.+)\??$/i] },
  { type: 'uses_system', patterns: [/what\s+system\s+does\s+(.+)\s+use\??$/i, /what\s+tool\s+does\s+(.+)\s+use\??$/i, /what\s+toolchain\s+runs\s+(.+)\??$/i, /what\s+system\s+are\s+we\s+actually\s+using\s+now\s+for\s+(.+)\??$/i, /what\s+system\s+does\s+(.+)\s+use\s+right\s+now\??$/i] },
  { type: 'vendor_for', patterns: [/what\s+vendor\s+supports\s+(.+)\??$/i, /what\s+vendor\s+bills\s+(.+)\??$/i, /which\s+outside\s+provider\s+backs\s+(.+)\??$/i] },
  { type: 'depends_on', patterns: [/what\s+depends\s+on\s+(.+)\??$/i, /what\s+does\s+(.+)\s+depend\s+on\??$/i, /what\s+is\s+(.+)\s+blocked\s+on\??$/i] },
  { type: 'attends', patterns: [/who\s+attended\s+(.+)\??$/i, /who\s+usually\s+sits\s+in\s+on\s+(.+)\??$/i, /who\s+should\s+be\s+in\s+the\s+(.+)\s+sync\??$/i, /who\s+attends\s+the\s+(.+)\??$/i] },
  { type: 'member_of', patterns: [/who\s+works\s+at\s+(.+)\??$/i, /who\s+is\s+on\s+(.+)\??$/i] },
  { type: 'invested_in', patterns: [/who\s+invested\s+in\s+(.+)\??$/i] },
  { type: 'advises', patterns: [/who\s+advises\s+(.+)\??$/i] }
];

export function defaultRelationRules(): KnowledgeLinkRule[] {
  return builtInRules as KnowledgeLinkRule[];
}

export function classifyRelationQuery(query: string): RelationQueryClassification {
  const normalized = query.trim();
  const candidateRelationTypes = detectCandidateRelationTypes(normalized);
  for (const rule of RELATION_QUERY_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(normalized);
      if (match?.[1]) {
        return {
          relationType: rule.type,
          anchorQuery: normalizeAnchorQuery(match[1].trim(), rule.type),
          confidence: 0.92,
          candidateRelationTypes
        };
      }
    }
  }
  return {
    relationType: null,
    anchorQuery: null,
    confidence: 0,
    candidateRelationTypes
  };
}

export function extractLinksFromText(
  context: RelationContext,
  rules: KnowledgeLinkRule[],
  input: RelationExtractionInput
): KnowledgeLink[] {
  const sanitized = sanitizeExtractionText(input.text);
  const sentences = splitSentences(sanitized);
  const knownEntities = buildKnownEntities(context.entities);
  const primaryEntity = input.primaryEntityId ? context.entities.find((entity) => entity.meta.id === input.primaryEntityId) ?? null : null;
  const links: KnowledgeLink[] = [];

  for (const sentence of sentences) {
    const clauses = splitClauses(sentence);
    let typedLinkCount = 0;

    for (const clause of clauses) {
      const mentions = resolveMentions(clause, knownEntities, primaryEntity?.meta.id);
      if (mentions.length === 0) continue;

      for (const rule of rules) {
        if (!ruleMatchesSentence(rule, clause)) continue;
        const typedLinks = buildLinksForRule(context.tenantId, rule, clause, mentions, input);
        links.push(...typedLinks);
        typedLinkCount += typedLinks.length;
      }

      if (typedLinkCount === 0 && primaryEntity) {
        const priorLinks = buildLinksFromPageRolePriors(context.tenantId, clause, primaryEntity, mentions, input);
        links.push(...priorLinks);
        typedLinkCount += priorLinks.length;
      }

      if (mentions.length >= 2) {
        for (let index = 0; index < mentions.length; index += 1) {
          for (let nextIndex = index + 1; nextIndex < mentions.length; nextIndex += 1) {
            links.push(
              createLink(context.tenantId, {
                type: 'mentioned_in',
                fromId: mentions[index].id,
                toId: mentions[nextIndex].id,
                sourceIds: input.sourceIds,
                confidence: 0.25,
                evidenceKind: 'mention',
                evidenceStrength: 'co-mention',
                sourceSurface: input.sourceSurface ?? inferSourceSurface(input.originKind, input.evidenceKind),
                explicitReference: false,
                originKind: input.originKind,
                originId: input.originId,
                ruleId: 'mentioned_in',
                createdAt: input.createdAt
              })
            );
          }
        }
      }
    }
  }

  return dedupeLinks(links);
}

export function findEntityByQuery(
  query: string,
  entities: EntityDocument[],
  relationType?: string | null,
  links: KnowledgeLink[] = []
): EntityDocument | null {
  const needle = normalizeText(query);
  const queryTokens = tokenize(needle);
  const queryPrefersLane = Boolean(relationType) && queryTokens.includes('lane');
  const queryPrefersDesk = Boolean(relationType) && queryTokens.includes('desk');
  const queryAcronym = normalizeAcronym(query);
  const queryBase = normalizeWorkflowBase(needle);
  let best: { entity: EntityDocument; score: number } | null = null;
  for (const entity of entities) {
    const candidates = [entity.meta.title, ...entity.meta.aliases, ...entity.meta.handles];
    const normalizedCandidates = candidates.map((candidate) => normalizeText(candidate)).filter(Boolean);
    const hasLaneCandidate = queryPrefersLane && normalizedCandidates.some((candidate) => candidate.split(/[^a-z0-9]+/i).includes('lane'));
    const hasDeskCandidate = queryPrefersDesk && normalizedCandidates.some((candidate) => candidate.split(/[^a-z0-9]+/i).includes('desk'));
    let score = relationAnchorKindBoost(relationType, entity.meta.kind);
    let exactTitleHit = false;
    let exactAliasHit = false;
    let exactHandleHit = false;
    let acronymHit = false;
    for (const [index, normalized] of normalizedCandidates.entries()) {
      const original = candidates[index] ?? '';
      if (normalized === needle) {
        if (original === entity.meta.title) {
          exactTitleHit = true;
          score = Math.max(score, 24);
        } else if (entity.meta.handles.includes(original)) {
          exactHandleHit = true;
          score = Math.max(score, 22);
        } else {
          exactAliasHit = true;
          score = Math.max(score, 23);
        }
      } else if (normalized.includes(needle) || needle.includes(normalized)) score = Math.max(score, 13);
      else if (sharedTokens(normalized, needle) >= 2) score = Math.max(score, 8);
      if (normalizeAcronym(normalized) && normalizeAcronym(normalized) === queryAcronym) {
        acronymHit = true;
        score = Math.max(score, 17);
      }
    }
    score += exactTitleHit ? 2 : 0;
    score += exactAliasHit ? 1.5 : 0;
    score += exactHandleHit ? 1.5 : 0;
    score += acronymHit ? 1 : 0;
    score += queryPrefersLane ? (hasLaneCandidate ? 1 : -1) : 0;
    score += queryPrefersDesk ? (hasDeskCandidate ? 1 : -1) : 0;
    score += overlapScore(queryTokens, new Set(tokenize(entity.meta.title)));
    score += shorthandCompatibilityBoost(queryBase, entity.meta.title);
    score += siblingWorkflowPenalty(queryTokens, queryBase, entity.meta.title, relationType);
    score += Math.min(1.5, countConnectedLinks(entity.meta.id, relationType, links) * 0.25);
    if (!best || score > best.score || (score === best.score && entity.meta.title.length < (best?.entity.meta.title.length ?? Number.MAX_SAFE_INTEGER))) {
      best = { entity, score };
    }
  }
  return best && best.score >= 6 ? best.entity : null;
}

export function relationResultMode(mode: KnowledgeSearchMode | undefined): Extract<KnowledgeSearchMode, 'graph-only' | 'graph-first-hybrid'> {
  return mode === 'graph-only' ? 'graph-only' : 'graph-first-hybrid';
}

function buildLinksForRule(
  tenantId: string,
  rule: KnowledgeLinkRule,
  sentence: string,
  mentions: KnownEntity[],
  input: RelationExtractionInput
): KnowledgeLink[] {
  const candidates = mentions.filter((entity) => entity.kind !== 'meeting' || rule.type === 'attends');
  const pairs = pairMentions(candidates, rule.direction ?? 'forward', input.primaryEntityId);
  const links: KnowledgeLink[] = [];

  for (const [source, target] of pairs) {
    if (!isAllowedKind(rule.sourceKinds, source.kind)) continue;
    if (!isAllowedKind(rule.targetKinds, target.kind)) continue;
    const explicitReference = hasExplicitReference(sentence, source) || hasExplicitReference(sentence, target);
    const explicitBoost = explicitReference
      ? rule.explicitReferenceBoost ?? 0
      : 0;
    const evidenceStrength: KnowledgeLinkEvidenceStrength = explicitReference ? 'explicit-ref' : 'keyword';
    links.push(
      createLink(tenantId, {
        type: rule.type,
        fromId: source.id,
        toId: target.id,
        sourceIds: input.sourceIds,
        confidence: Math.min(0.99, rule.confidence + explicitBoost),
        evidenceKind: input.evidenceKind,
        evidenceStrength,
        sourceSurface: input.sourceSurface ?? inferSourceSurface(input.originKind, input.evidenceKind),
        explicitReference,
        originKind: input.originKind,
        originId: input.originId,
        ruleId: rule.id,
        createdAt: input.createdAt
      })
    );
  }

  return links;
}

function buildLinksFromPageRolePriors(
  tenantId: string,
  sentence: string,
  primaryEntity: EntityDocument,
  mentions: KnownEntity[],
  input: RelationExtractionInput
): KnowledgeLink[] {
  if (primaryEntity.meta.kind !== 'person' && primaryEntity.meta.kind !== 'team') return [];
  const primaryMention = mentions.find((mention) => mention.id === primaryEntity.meta.id);
  const otherMentions = mentions.filter((mention) => mention.id !== primaryEntity.meta.id);
  if (otherMentions.length === 0) return [];
  const priors = inferPageRolePriors(primaryEntity);
  const links: KnowledgeLink[] = [];

  for (const prior of priors) {
    if (!prior.keywords.some((keyword) => normalizeText(sentence).includes(normalizeText(keyword)))) continue;
    const candidates = primaryMention ? [primaryMention, ...otherMentions] : otherMentions;
    const pairs = pairMentions(candidates, prior.direction ?? 'forward', primaryEntity.meta.id);
    for (const [source, target] of pairs) {
      if (!isAllowedKind(prior.sourceKinds, source.kind)) continue;
      if (!isAllowedKind(prior.targetKinds, target.kind)) continue;
      if (source.id === target.id) continue;
      const explicitReference = hasExplicitReference(sentence, source) || hasExplicitReference(sentence, target);
      links.push(
        createLink(tenantId, {
          type: prior.relationType,
          fromId: source.id,
          toId: target.id,
          sourceIds: input.sourceIds,
          confidence: explicitReference ? 0.72 : 0.58,
          evidenceKind: input.evidenceKind,
          evidenceStrength: 'page-prior',
          sourceSurface: input.sourceSurface ?? inferSourceSurface(input.originKind, input.evidenceKind),
          explicitReference,
          originKind: input.originKind,
          originId: input.originId,
          ruleId: `page-prior:${prior.relationType}`,
          createdAt: input.createdAt
        })
      );
    }
  }

  return links;
}

function pairMentions(mentions: KnownEntity[], direction: KnowledgeLinkDirection, primaryEntityId?: string): Array<[KnownEntity, KnownEntity]> {
  if (primaryEntityId) {
    const primary = mentions.find((entity) => entity.id === primaryEntityId);
    if (primary) {
      const others = mentions.filter((entity) => entity.id !== primaryEntityId);
      if (others.length > 0) {
        return others.flatMap((entity) => {
          if (direction === 'reverse') return [[entity, primary] as [KnownEntity, KnownEntity]];
          if (direction === 'bidirectional') return [[primary, entity] as [KnownEntity, KnownEntity], [entity, primary] as [KnownEntity, KnownEntity]];
          return [[primary, entity] as [KnownEntity, KnownEntity]];
        });
      }
    }
  }
  const pairs: Array<[KnownEntity, KnownEntity]> = [];
  for (let index = 0; index < mentions.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < mentions.length; nextIndex += 1) {
      const left = mentions[index];
      const right = mentions[nextIndex];
      if (direction === 'forward') pairs.push([left, right]);
      else if (direction === 'reverse') pairs.push([right, left]);
      else {
        pairs.push([left, right], [right, left]);
      }
    }
  }
  return pairs;
}

function buildKnownEntities(entities: EntityDocument[]): KnownEntity[] {
  return entities.map((entity) => ({
    id: entity.meta.id,
    kind: entity.meta.kind,
    title: entity.meta.title,
    aliases: entity.meta.aliases,
    handles: entity.meta.handles,
    tags: entity.meta.tags
  }));
}

function resolveMentions(sentence: string, entities: KnownEntity[], primaryEntityId?: string): KnownEntity[] {
  const lowered = normalizeText(sentence);
  const resolved = entities
    .map((entity) => {
      const values = [entity.title, ...entity.aliases, ...entity.handles];
      let score = 0;
      for (const value of values) {
        const normalized = normalizeText(value);
        if (!normalized) continue;
        if (lowered === normalized) score = Math.max(score, 12);
        else if (lowered.includes(normalized)) score = Math.max(score, value === entity.title ? 10 : 8);
        else if (sharedTokens(lowered, normalized) >= 2) score = Math.max(score, 5);
      }
      return { entity, score };
    })
    .filter((entry) => entry.score >= 5)
    .sort((left, right) => right.score - left.score || left.entity.title.length - right.entity.title.length)
    .map((entry) => entry.entity);
  if (primaryEntityId && !resolved.some((entry) => entry.id === primaryEntityId)) {
    const primary = entities.find((entry) => entry.id === primaryEntityId);
    if (primary) return [primary, ...resolved];
  }
  return resolved;
}

function ruleMatchesSentence(rule: KnowledgeLinkRule, sentence: string): boolean {
  const lowered = normalizeText(sentence);
  if (!rule.keywords.some((keyword) => lowered.includes(normalizeText(keyword)))) return false;
  if (rule.negativeKeywords?.some((keyword) => lowered.includes(normalizeText(keyword)))) return false;
  return true;
}

function hasExplicitReference(sentence: string, entity: KnownEntity): boolean {
  return [entity.id, slugify(entity.title), entity.title, ...entity.aliases, ...entity.handles].some((value) => sentence.includes(value));
}

function createLink(
  tenantId: string,
  input: {
    type: string;
    fromId: string;
    toId: string;
    sourceIds: string[];
    confidence: number;
    evidenceKind: KnowledgeLink['evidenceKind'];
    evidenceStrength: KnowledgeLinkEvidenceStrength;
    sourceSurface: KnowledgeLink['sourceSurface'];
    explicitReference: boolean;
    originKind: KnowledgeLink['originKind'];
    originId: KnowledgeLink['originId'];
    ruleId: string;
    createdAt?: string;
  }
): KnowledgeLink {
  const sourceKey = [...input.sourceIds].sort().join(',');
  const id = `${input.type}:${input.fromId}:${input.toId}:${input.sourceSurface}:${input.evidenceKind}:${sourceKey || `${input.originKind}:${input.originId}`}`;
  return {
    id,
    tenantId,
    type: input.type,
    fromId: input.fromId,
    toId: input.toId,
    sourceIds: [...new Set(input.sourceIds)],
    confidence: Number(input.confidence.toFixed(3)),
    evidenceKind: input.evidenceKind,
    evidenceStrength: input.evidenceStrength,
    sourceSurface: input.sourceSurface,
    explicitReference: input.explicitReference,
    createdAt: input.createdAt ?? new Date().toISOString(),
    originKind: input.originKind,
    originId: input.originId,
    ruleId: input.ruleId
  };
}

function dedupeLinks(links: KnowledgeLink[]): KnowledgeLink[] {
  return [...new Map(links.map((link) => [link.id, link])).values()];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function splitClauses(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\band\s+(?=(?:approved?|reviewed?|owned?|uses?|escalat(?:e|es)|attends?|depends?)))\s*/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeAnchorQuery(value: string, relationType: string): string {
  const cleaned = normalizeText(value)
    .replace(/\b(currently|current|right now|actually|situation|it)\b/g, ' ')
    .replace(/\b(exception|exceptions|workflow|workflows)\b/g, relationType === 'attends' ? ' ' : ' ')
    .replace(/\b(review room|room)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (relationType === 'attends') {
    return cleaned
      .replace(/\brecon\b/g, 'reconciliation')
      .replace(/\bsync\b/g, 'weekly review')
      .trim();
  }
  return cleaned
    .replace(/\bexec\b/g, 'executive')
    .replace(/\brecon\b/g, 'reconciliation')
    .replace(/\brenewals\b/g, 'renewal')
    .replace(/\bredlines\b/g, 'redline triage')
    .replace(/\bapprovals\b/g, 'approval')
    .trim();
}

function detectCandidateRelationTypes(query: string): string[] {
  const normalized = normalizeText(query);
  const candidates = new Set<string>();
  if (/\b(owner|owns|carries)\b/.test(normalized)) candidates.add('owns');
  if (/\b(approve|approves|approved|signs off|sign off)\b/.test(normalized)) candidates.add('approves');
  if (/\b(review|reviews|reviewed|checks)\b/.test(normalized)) candidates.add('reviews');
  if (/\b(escalate|escalation|exception path|go to)\b/.test(normalized)) candidates.add('escalates_to');
  if (/\b(policy|control set|governs|covers)\b/.test(normalized)) candidates.add('applies_to');
  if (/\b(system|tool|toolchain|using now)\b/.test(normalized)) candidates.add('uses_system');
  if (/\b(vendor|provider|backs|supports)\b/.test(normalized)) candidates.add('vendor_for');
  if (/\b(blocked on|depend|depends)\b/.test(normalized)) candidates.add('depends_on');
  if (/\b(attend|attended|sits in|should be in|sync)\b/.test(normalized)) candidates.add('attends');
  return [...candidates];
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(/[^a-z0-9@._-]+/i).filter(Boolean);
}

function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeAcronym(value: string): string {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((token) => token[0]?.toLowerCase() ?? '')
    .join('');
}

function sharedTokens(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  return tokenize(right).filter((token) => leftTokens.has(token)).length;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n.!?]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isAllowedKind(allowed: KnowledgeEntityKind[] | undefined, kind: KnowledgeEntityKind): boolean {
  return !allowed?.length || allowed.includes(kind);
}

function sanitizeExtractionText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/(^|\n)\s*[-*]\s*(todo|note|status|metadata)\s*:/gi, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSourceSurface(originKind: RelationExtractionInput['originKind'], evidenceKind: KnowledgeLink['evidenceKind']): KnowledgeLink['sourceSurface'] {
  if (originKind === 'event') return 'event-summary';
  if (originKind === 'source') return evidenceKind === 'summary' ? 'source-summary' : 'source-content';
  if (originKind === 'entity') return evidenceKind === 'timeline' ? 'timeline' : 'current-truth';
  return 'structured';
}

function relationAnchorKindBoost(relationType: string | null | undefined, kind: KnowledgeEntityKind): number {
  if (!relationType) return 0;
  const preferred: Record<string, KnowledgeEntityKind[]> = {
    attends: ['meeting'],
    member_of: ['company', 'team'],
    invested_in: ['company', 'project'],
    advises: ['company', 'team', 'project'],
    owns: ['process', 'project', 'policy', 'system', 'vendor', 'team', 'decision'],
    approves: ['process', 'project', 'policy', 'decision'],
    reviews: ['process', 'project', 'policy', 'decision'],
    escalates_to: ['process', 'team', 'person'],
    applies_to: ['process', 'policy', 'project', 'team', 'system'],
    uses_system: ['process', 'team', 'person'],
    vendor_for: ['process', 'system', 'project'],
    depends_on: ['process', 'system', 'project']
  };
  return preferred[relationType]?.includes(kind) ? 4 : 0;
}

function overlapScore(queryTokens: string[], entityTokens: Set<string>): number {
  return queryTokens.filter((token) => entityTokens.has(token)).length;
}

function countConnectedLinks(entityId: string, relationType: string | null | undefined, links: KnowledgeLink[]): number {
  if (!relationType) return 0;
  return links.filter((link) => link.type === relationType && (link.fromId === entityId || link.toId === entityId)).length;
}

function inferPageRolePriors(entity: EntityDocument): PageRolePrior[] {
  const priors: PageRolePrior[] = [];
  const haystack = normalizeText([entity.meta.title, entity.currentTruth, entity.timeline.join(' '), entity.meta.tags.join(' ')].join(' '));
  const push = (
    relationType: string,
    keywords: string[],
    sourceKinds: KnowledgeEntityKind[] | undefined,
    targetKinds: KnowledgeEntityKind[] | undefined,
    direction: KnowledgeLinkDirection
  ) => {
    if (keywords.some((keyword) => haystack.includes(normalizeText(keyword)))) {
      priors.push({ relationType, keywords, sourceKinds, targetKinds, direction });
    }
  };

  push('owns', ['owner', 'owns', 'relationship owner', 'responsible for'], ['process', 'project', 'policy', 'system', 'vendor', 'decision'], ['person', 'team'], 'reverse');
  push('approves', ['approver', 'approval owner', 'approves', 'signs off'], ['process', 'project', 'policy', 'decision'], ['person', 'team'], 'reverse');
  push('reviews', ['reviewer', 'reviews'], ['process', 'project', 'policy', 'decision'], ['person', 'team'], 'reverse');
  push('escalates_to', ['escalation', 'escalate to', 'exception path'], ['process', 'project', 'policy', 'team'], ['person', 'team'], 'reverse');
  push('attends', ['attends', 'attendee', 'sits in on'], ['meeting'], ['person', 'team'], 'reverse');
  push('member_of', ['member of', 'works at', 'part of'], ['person'], ['company', 'team'], 'forward');
  push('advises', ['advisor', 'advises'], ['person'], ['company', 'team', 'project'], 'forward');
  push('invested_in', ['investor', 'invested in'], ['person'], ['company', 'project'], 'forward');
  return priors;
}

function normalizeWorkflowBase(value: string): string {
  return tokenize(value)
    .filter((token) => !['lane', 'desk', 'workflow', 'process', 'policy', 'system', 'project', 'meeting', 'team'].includes(token))
    .join(' ');
}

function shorthandCompatibilityBoost(queryBase: string, title: string): number {
  if (!queryBase) return 0;
  const titleBase = normalizeWorkflowBase(title);
  if (!titleBase) return 0;
  if (titleBase === queryBase) return 2;
  return sharedTokens(titleBase, queryBase) >= 2 ? 1 : 0;
}

function siblingWorkflowPenalty(
  queryTokens: string[],
  queryBase: string,
  title: string,
  relationType: string | null | undefined
): number {
  if (!relationType) return 0;
  const titleTokens = tokenize(title);
  const titleBase = normalizeWorkflowBase(title);
  if (!titleBase || !queryBase || titleBase !== queryBase) return 0;
  const laneMismatch = titleTokens.includes('lane') && !queryTokens.includes('lane');
  const deskMismatch = titleTokens.includes('desk') && !queryTokens.includes('desk');
  return laneMismatch || deskMismatch ? -2.5 : 0;
}
