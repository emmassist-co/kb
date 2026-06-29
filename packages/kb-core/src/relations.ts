import builtInRules from './relation-rules.json' with { type: 'json' };
import { inferPageFamily } from './page-families.js';
import type {
  EntityDocument,
  KnowledgeEntityKind,
  KnowledgeEvidenceSpan,
  KnowledgeLink,
  KnowledgeLinkDirection,
  KnowledgeLinkEvidenceStrength,
  KnowledgePageFamily,
  KnowledgeLinkRule,
  KnowledgeLinkSourceSurface,
  KnowledgePagePriorRule,
  KnowledgeQueryIntent,
  KnowledgeRelationProposal,
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

export interface RelationExtractor {
  id: string;
  extract(context: RelationContext, rules: KnowledgeLinkRule[], input: RelationExtractionInput): KnowledgeRelationProposal[];
}

interface PageRolePrior {
  relationType: string;
  pageFamilies?: KnowledgePageFamily[];
  activationSurfaces?: KnowledgeLinkSourceSurface[];
  keywords: string[];
  cuePatterns: RegExp[];
  titlePatterns: RegExp[];
  matchMode: 'any' | 'all';
  sourceKinds?: KnowledgeEntityKind[];
  targetKinds?: KnowledgeEntityKind[];
  direction?: KnowledgeLinkDirection;
  confidence: number;
}

export interface RelationQueryClassification {
  relationType: string | null;
  anchorQuery: string | null;
  confidence: number;
  candidateRelationTypes?: string[];
  intent?: KnowledgeQueryIntent;
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
  { type: 'advises', patterns: [/who\s+advises\s+(.+)\??$/i, /who\s+else\s+advises\s+(.+)\??$/i] }
];

export function defaultRelationRules(): KnowledgeLinkRule[] {
  return builtInRules as KnowledgeLinkRule[];
}

export function classifyRelationQuery(query: string): RelationQueryClassification {
  const intent = inferQueryIntent(query);
  return {
    relationType: intent.relationType,
    anchorQuery: intent.anchorQuery,
    confidence: inferClassificationConfidence(intent),
    candidateRelationTypes: intent.candidateRelationTypes,
    intent
  };
}

export function inferQueryIntent(query: string): KnowledgeQueryIntent {
  const normalized = query.trim();
  const candidateRelationTypes = detectCandidateRelationTypes(normalized);
  let relationType: string | null = null;
  let anchorQuery: string | null = null;
  for (const rule of RELATION_QUERY_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(normalized);
      if (match?.[1]) {
        relationType = rule.type;
        anchorQuery = normalizeAnchorQuery(match[1].trim(), rule.type);
        break;
      }
    }
    if (relationType) break;
  }
  if (!relationType) {
    const profileFallback = inferProfileRelationQuery(normalized, candidateRelationTypes);
    if (profileFallback) {
      relationType = profileFallback.relationType;
      anchorQuery = profileFallback.anchorQuery;
    }
  }
  if (!anchorQuery) {
    anchorQuery = inferGenericAnchorQuery(normalized, relationType, candidateRelationTypes);
  }
  const expectedKinds = inferIntentExpectedKinds(normalized, relationType, candidateRelationTypes, anchorQuery);
  const roleTerms = inferRoleTerms(normalized);
  const anchorTokens = new Set(anchorQuery ? tokenize(normalizeAnchorQuery(anchorQuery, relationType ?? 'generic')) : []);
  const attributeTerms = tokenize(normalized).filter(
    (token) =>
      !INTENT_STOPWORDS.has(token) &&
      !roleTerms.includes(token) &&
      !anchorTokens.has(token) &&
      !INTENT_KIND_TERMS.has(token)
  );
  const expectsMultiple =
    Boolean(relationType && ['member_of', 'attends', 'advises', 'invested_in'].includes(relationType)) ||
    /\b(all|list|people|companies|advisors|engineers|employees|founders)\b/i.test(normalized) ||
    Boolean(anchorQuery && expectedKinds.includes('person') && !/\b(background|history|prior|details)\b/i.test(normalized));
  const aggregation = /\b(list all|all\b|everyone|entire corpus|our corpus)\b/i.test(normalized);
  const background = /\b(background|details|experience|history|prior|previous|before joining)\b/i.test(normalized);
  const relationshipDepth = /\b(multi-year|ongoing|long[- ]term|relationship|years)\b/i.test(normalized);
  const intersection = /\bboth\b/i.test(normalized) || /\bassociated with both\b/i.test(normalized);
  const modes: KnowledgeQueryIntent['modes'] = [];
  modes.push(expectsMultiple ? 'entity-set' : 'single-profile');
  if (aggregation) modes.push('aggregation');
  if (background) modes.push('background');
  if (relationshipDepth) modes.push('relationship-depth');
  if (intersection) modes.push('attribute-intersection');
  const temporalFocus: KnowledgeQueryIntent['temporalFocus'] = background ? 'historical' : relationshipDepth ? 'mixed' : 'current';
  return {
    rawQuery: query,
    relationType,
    candidateRelationTypes,
    anchorQuery,
    expectedKinds,
    attributeTerms,
    roleTerms,
    modes: uniqueModes(modes),
    expectsMultiple,
    temporalFocus
  };
}

function inferClassificationConfidence(intent: KnowledgeQueryIntent): number {
  if (intent.relationType && intent.anchorQuery) return 0.92;
  if (intent.relationType || intent.anchorQuery || intent.modes.length > 1) return 0.6;
  return 0;
}

export function extractLinksFromText(
  context: RelationContext,
  rules: KnowledgeLinkRule[],
  input: RelationExtractionInput
): KnowledgeLink[] {
  return materializeRelationLinks(context.tenantId, extractRelationProposalsFromText(context, rules, input));
}

export function extractRelationProposalsFromText(
  context: RelationContext,
  rules: KnowledgeLinkRule[],
  input: RelationExtractionInput
): KnowledgeRelationProposal[] {
  const sanitized = sanitizeExtractionText(input.text);
  const paragraphs = splitParagraphs(sanitized);
  const sentences = splitSentences(sanitized);
  const knownEntities = buildKnownEntities(context.entities);
  const primaryEntity = input.primaryEntityId ? context.entities.find((entity) => entity.meta.id === input.primaryEntityId) ?? null : null;
  const proposals: KnowledgeRelationProposal[] = [];

  if (primaryEntity) {
    for (const paragraph of paragraphs) {
      const mentions = resolveMentions(paragraph, knownEntities, primaryEntity.meta.id);
      if (mentions.length < 2) continue;
      proposals.push(...buildProposalsFromPageRolePriors(rules, paragraph, primaryEntity, mentions, input, sanitized));
    }
  }

  for (const sentence of sentences) {
    const clauses = splitClauses(sentence);
    let typedLinkCount = 0;

    for (const clause of clauses) {
      const mentions = resolveMentions(clause, knownEntities, primaryEntity?.meta.id);
      if (mentions.length === 0) continue;

      for (const rule of rules) {
        if (!ruleMatchesSentence(rule, clause)) continue;
        const typedProposals = buildProposalsForRule(rule, clause, mentions, input, sanitized);
        proposals.push(...typedProposals);
        typedLinkCount += typedProposals.length;
      }

      if (typedLinkCount === 0 && primaryEntity) {
        const priorProposals = buildProposalsFromPageRolePriors(rules, clause, primaryEntity, mentions, input, sanitized);
        proposals.push(...priorProposals);
        typedLinkCount += priorProposals.length;
      }

      if (mentions.length >= 2) {
        for (let index = 0; index < mentions.length; index += 1) {
          for (let nextIndex = index + 1; nextIndex < mentions.length; nextIndex += 1) {
            proposals.push(
              createProposal({
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
                createdAt: input.createdAt,
                evidenceText: clause,
                evidenceSpan: findEvidenceSpan(sanitized, clause)
              })
            );
          }
        }
      }
    }
  }

  return dedupeProposals(proposals);
}

export function materializeRelationLinks(tenantId: string, proposals: KnowledgeRelationProposal[]): KnowledgeLink[] {
  return dedupeLinks(proposals.map((proposal) => proposalToLink(tenantId, proposal)));
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

function buildProposalsForRule(
  rule: KnowledgeLinkRule,
  sentence: string,
  mentions: KnownEntity[],
  input: RelationExtractionInput,
  fullText: string
): KnowledgeRelationProposal[] {
  const candidates = mentions.filter((entity) => entity.kind !== 'meeting' || rule.type === 'attends');
  const pairs = pairMentions(candidates, rule.direction ?? 'forward', input.primaryEntityId, rule.sourceKinds, rule.targetKinds);
  const proposals: KnowledgeRelationProposal[] = [];

  for (const [source, target] of pairs) {
    if (!isAllowedKind(rule.sourceKinds, source.kind)) continue;
    if (!isAllowedKind(rule.targetKinds, target.kind)) continue;
    const explicitReference = hasExplicitReference(sentence, source) || hasExplicitReference(sentence, target);
    const explicitBoost = explicitReference
      ? rule.explicitReferenceBoost ?? 0
      : 0;
    const evidenceStrength: KnowledgeLinkEvidenceStrength = explicitReference ? 'explicit-ref' : 'keyword';
    proposals.push(
      createProposal({
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
        createdAt: input.createdAt,
        evidenceText: sentence,
        evidenceSpan: findEvidenceSpan(fullText, sentence)
      })
    );
  }

  return proposals;
}

function buildProposalsFromPageRolePriors(
  rules: KnowledgeLinkRule[],
  sentence: string,
  primaryEntity: EntityDocument,
  mentions: KnownEntity[],
  input: RelationExtractionInput,
  fullText: string
): KnowledgeRelationProposal[] {
  if (
    primaryEntity.meta.kind !== 'person' &&
    primaryEntity.meta.kind !== 'team' &&
    primaryEntity.meta.kind !== 'meeting' &&
    primaryEntity.meta.kind !== 'company'
  ) {
    return [];
  }
  const primaryMention = mentions.find((mention) => mention.id === primaryEntity.meta.id);
  const otherMentions = mentions.filter((mention) => mention.id !== primaryEntity.meta.id);
  if (otherMentions.length === 0) return [];
  const priors = inferPageRolePriors(primaryEntity, rules);
  const proposals: KnowledgeRelationProposal[] = [];
  const normalizedSentence = normalizeText(sentence);

  for (const prior of priors) {
    if (!pagePriorAllowsSurface(prior, input.sourceSurface ?? inferSourceSurface(input.originKind, input.evidenceKind))) continue;
    if (!pageRolePriorMatches(prior, normalizedSentence, primaryEntity)) continue;
    const candidates = primaryMention ? [primaryMention, ...otherMentions] : otherMentions;
    const pairs = pairMentions(candidates, prior.direction ?? 'forward', primaryEntity.meta.id, prior.sourceKinds, prior.targetKinds);
    for (const [source, target] of pairs) {
      if (!isAllowedKind(prior.sourceKinds, source.kind)) continue;
      if (!isAllowedKind(prior.targetKinds, target.kind)) continue;
      if (source.id === target.id) continue;
      const explicitReference = hasExplicitReference(sentence, source) || hasExplicitReference(sentence, target);
      proposals.push(
        createProposal({
          type: prior.relationType,
          fromId: source.id,
          toId: target.id,
          sourceIds: input.sourceIds,
          confidence: explicitReference ? Math.min(0.92, prior.confidence + 0.08) : prior.confidence,
          evidenceKind: input.evidenceKind,
          evidenceStrength: 'page-prior',
          sourceSurface: input.sourceSurface ?? inferSourceSurface(input.originKind, input.evidenceKind),
          explicitReference,
          originKind: input.originKind,
          originId: input.originId,
          ruleId: `page-prior:${prior.relationType}`,
          createdAt: input.createdAt,
          evidenceText: sentence,
          evidenceSpan: findEvidenceSpan(fullText, sentence)
        })
      );
    }
  }

  return proposals;
}

function pairMentions(
  mentions: KnownEntity[],
  direction: KnowledgeLinkDirection,
  primaryEntityId?: string,
  sourceKinds?: KnowledgeEntityKind[],
  targetKinds?: KnowledgeEntityKind[]
): Array<[KnownEntity, KnownEntity]> {
  if (primaryEntityId) {
    const primary = mentions.find((entity) => entity.id === primaryEntityId);
    if (primary) {
      const others = mentions.filter((entity) => entity.id !== primaryEntityId);
      if (others.length > 0) {
        const primaryCanBeSource = isAllowedKind(sourceKinds, primary.kind);
        const primaryCanBeTarget = isAllowedKind(targetKinds, primary.kind);
        return others.flatMap((entity) => {
          if (!primaryCanBeSource && primaryCanBeTarget) {
            if (direction === 'bidirectional') return [[primary, entity] as [KnownEntity, KnownEntity], [entity, primary] as [KnownEntity, KnownEntity]];
            return [[entity, primary] as [KnownEntity, KnownEntity]];
          }
          if (primaryCanBeSource && !primaryCanBeTarget) {
            if (direction === 'bidirectional') return [[primary, entity] as [KnownEntity, KnownEntity], [entity, primary] as [KnownEntity, KnownEntity]];
            return [[primary, entity] as [KnownEntity, KnownEntity]];
          }
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

function createProposal(
  input: {
    type: string;
    fromId: string;
    toId: string;
    sourceIds: string[];
    confidence: number;
    evidenceKind: KnowledgeLink['evidenceKind'];
    evidenceStrength: KnowledgeLinkEvidenceStrength;
    sourceSurface: KnowledgeLinkSourceSurface;
    explicitReference: boolean;
    originKind: 'entity' | 'source' | 'event' | 'seed';
    originId: string;
    ruleId: string;
    createdAt?: string;
    evidenceText: string;
    evidenceSpan?: KnowledgeEvidenceSpan;
  }
): KnowledgeRelationProposal {
  return {
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
    ruleId: input.ruleId,
    extractorId: 'heuristic-rules',
    evidenceText: input.evidenceText,
    evidenceSpan: input.evidenceSpan
  };
}

function dedupeLinks(links: KnowledgeLink[]): KnowledgeLink[] {
  return [...new Map(links.map((link) => [link.id, link])).values()];
}

function dedupeProposals(proposals: KnowledgeRelationProposal[]): KnowledgeRelationProposal[] {
  return [...new Map(proposals.map((proposal) => [proposalIdentity(proposal), proposal])).values()];
}

function proposalToLink(tenantId: string, proposal: KnowledgeRelationProposal): KnowledgeLink {
  const sourceKey = [...proposal.sourceIds].sort().join(',');
  const id = `${proposal.type}:${proposal.fromId}:${proposal.toId}:${proposal.sourceSurface}:${proposal.evidenceKind}:${sourceKey || `${proposal.originKind}:${proposal.originId}`}`;
  return {
    id,
    tenantId,
    type: proposal.type,
    fromId: proposal.fromId,
    toId: proposal.toId,
    sourceIds: [...new Set(proposal.sourceIds)],
    confidence: Number(proposal.confidence.toFixed(3)),
    evidenceKind: proposal.evidenceKind,
    evidenceStrength: proposal.evidenceStrength,
    sourceSurface: proposal.sourceSurface,
    explicitReference: proposal.explicitReference,
    createdAt: proposal.createdAt ?? new Date().toISOString(),
    originKind: proposal.originKind,
    originId: proposal.originId,
    ruleId: proposal.ruleId,
    extractorId: proposal.extractorId,
    evidenceText: proposal.evidenceText,
    evidenceSpan: proposal.evidenceSpan
  };
}

function proposalIdentity(proposal: KnowledgeRelationProposal): string {
  const sourceKey = [...proposal.sourceIds].sort().join(',');
  return `${proposal.type}:${proposal.fromId}:${proposal.toId}:${proposal.sourceSurface}:${proposal.evidenceKind}:${sourceKey || `${proposal.originKind}:${proposal.originId}`}`;
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
    .replace(/[?!.,:;]+/g, ' ')
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
  if (/\b(founder|engineer|employee|staff|works?\s+at)\b/.test(normalized)) candidates.add('member_of');
  if (/\b(advisor|advises)\b/.test(normalized)) candidates.add('advises');
  if (/\b(investor|invested)\b/.test(normalized)) candidates.add('invested_in');
  return [...candidates];
}

function inferGenericAnchorQuery(query: string, relationType: string | null, candidateRelationTypes: string[]): string | null {
  const patterns = [
    /\b(?:at|of|for|in)\s+(.+?)(?:\s+\b(before joining|before|who|that|which)\b|$)/i,
    /\bwith\s+(.+?)\s+\bexperience\b/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(query);
    const anchor = match?.[1]?.trim();
    if (!anchor) continue;
    return normalizeAnchorQuery(anchor, relationType ?? candidateRelationTypes[0] ?? 'generic');
  }
  return null;
}

function inferIntentExpectedKinds(
  query: string,
  relationType: string | null,
  candidateRelationTypes: string[],
  anchorQuery: string | null
): KnowledgeEntityKind[] {
  const queryTokens = tokenize(query);
  const effectiveRelationType = relationType ?? (candidateRelationTypes.length === 1 ? candidateRelationTypes[0] ?? null : null);
  if (queryTokens.includes('company') || queryTokens.includes('companies')) return ['company'];
  if (queryTokens.some((token) => EXPLICIT_PERSON_QUERY_TERMS.has(token))) return ['person'];
  if (effectiveRelationType === 'attends') return ['person', 'team'];
  if (effectiveRelationType === 'member_of' || effectiveRelationType === 'advises' || effectiveRelationType === 'invested_in') return ['person'];
  const hasRoleTerms = queryTokens.some((token) => ROLE_QUERY_TERMS.has(token));
  if (anchorQuery && hasRoleTerms) return ['person'];
  if (/\b(all|list)\b/i.test(query) && hasRoleTerms) return ['person'];
  return [];
}

function inferRoleTerms(query: string): string[] {
  return tokenize(query).filter((token) => ROLE_QUERY_TERMS.has(token));
}

function uniqueModes(values: KnowledgeQueryIntent['modes']): KnowledgeQueryIntent['modes'] {
  return [...new Set(values)];
}

function inferProfileRelationQuery(query: string, candidateRelationTypes: string[]): RelationQueryClassification | null {
  const trimmed = query.trim().replace(/\?+$/, '');
  const patterns: Array<{ type: string; pattern: RegExp; anchorIndex: number }> = [
    {
      type: 'member_of',
      pattern: /(?:background|details|experience|history|prior experience|previous experience)\s+of\s+(.+?)\s+(?:(?:senior|staff|lead|principal)\s+)?(founder|engineer|engineers|employee|employees|staff)\b/i,
      anchorIndex: 1
    },
    {
      type: 'member_of',
      pattern: /\b(founder|engineer|engineers|employee|employees|staff)\b[^?]*\b(?:at|of)\s+(.+)$/i,
      anchorIndex: 2
    },
    {
      type: 'advises',
      pattern: /\b(advisor|advisors)\b[^?]*\b(?:for|at|of)\s+(.+)$/i,
      anchorIndex: 2
    },
    {
      type: 'invested_in',
      pattern: /\b(investor|investors)\b[^?]*\b(?:for|at|of|in)\s+(.+)$/i,
      anchorIndex: 2
    },
    {
      type: 'member_of',
      pattern: /\balso\s+at\s+(.+)$/i,
      anchorIndex: 1
    }
  ];
  for (const entry of patterns) {
    const match = entry.pattern.exec(trimmed);
    const anchor = match?.[entry.anchorIndex]?.trim();
    if (!anchor) continue;
    return {
      relationType: entry.type,
      anchorQuery: normalizeAnchorQuery(anchor, entry.type),
      confidence: 0.6,
      candidateRelationTypes
    };
  }
  return null;
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(/[^a-z0-9@._-]+/i).filter(Boolean);
}

const EXPLICIT_PERSON_QUERY_TERMS = new Set([
  'who',
  'person',
  'people',
  'anyone',
  'someone'
]);

const ROLE_QUERY_TERMS = new Set([
  'advisor',
  'advisors',
  'founder',
  'founders',
  'engineer',
  'engineers',
  'employee',
  'employees',
  'staff',
  'security'
]);

const INTENT_KIND_TERMS = new Set([
  'company',
  'companies',
  'person',
  'people',
  'anyone',
  'someone',
  'advisor',
  'advisors',
  'founder',
  'founders',
  'engineer',
  'engineers',
  'employee',
  'employees',
  'staff'
]);

const INTENT_STOPWORDS = new Set([
  'a',
  'an',
  'all',
  'and',
  'anyone',
  'are',
  'at',
  'be',
  'both',
  'but',
  'by',
  'can',
  'corpus',
  'details',
  'do',
  'does',
  'else',
  'experience',
  'for',
  'from',
  'given',
  'have',
  'has',
  'history',
  'i',
  'in',
  'is',
  'it',
  'its',
  'know',
  'list',
  'need',
  'of',
  'on',
  'our',
  'please',
  'prior',
  'pull',
  'show',
  'someone',
  'there',
  'we',
  'where',
  'who',
  'whom',
  'whose',
  'working',
  'works',
  'work',
  'associated',
  'show',
  'that',
  'the',
  'their',
  'these',
  'this',
  'what',
  'which',
  'with',
  'would',
  'you'
]);

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

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.trim())
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
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findEvidenceSpan(text: string, fragment: string): KnowledgeEvidenceSpan | undefined {
  const haystack = text.toLowerCase();
  const needle = fragment.trim().toLowerCase();
  if (!needle) return undefined;
  const start = haystack.indexOf(needle);
  if (start === -1) return undefined;
  return {
    start,
    end: start + needle.length,
    text: text.slice(start, start + needle.length)
  };
}

function inferSourceSurface(originKind: RelationExtractionInput['originKind'], evidenceKind: KnowledgeLink['evidenceKind']): KnowledgeLinkSourceSurface {
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

function pageRolePriorMatches(prior: PageRolePrior, sentence: string, entity: EntityDocument): boolean {
  const pageFamily = inferPageFamily(entity.meta.kind);
  if (prior.pageFamilies?.length && !prior.pageFamilies.includes(pageFamily)) return false;
  const checks = [
    prior.keywords.length ? prior.keywords.some((keyword) => sentence.includes(normalizeText(keyword))) : null,
    prior.cuePatterns.length ? prior.cuePatterns.some((pattern) => pattern.test(sentence)) : null,
    prior.titlePatterns.length ? prior.titlePatterns.some((pattern) => pattern.test(normalizeText(entity.meta.title))) : null
  ].filter((value): value is boolean => value !== null);
  if (checks.length === 0) return false;
  return prior.matchMode === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

function inferPageRolePriors(entity: EntityDocument, rules: KnowledgeLinkRule[]): PageRolePrior[] {
  const priors: PageRolePrior[] = [];
  const haystack = normalizeText([entity.meta.title, entity.currentTruth, entity.timeline.join(' '), entity.meta.tags.join(' ')].join(' '));
  for (const rule of rules) {
    const baseDirection = rule.direction ?? 'forward';
    const matchesSource = isAllowedKind(rule.sourceKinds, entity.meta.kind);
    const matchesTarget = isAllowedKind(rule.targetKinds, entity.meta.kind);
    const pagePriors = rule.pagePriors?.filter((prior) => prior.primaryKinds.includes(entity.meta.kind)) ?? [];

    if (pagePriors.length > 0) {
      for (const prior of pagePriors) {
        if (!pagePriorActivates(prior, haystack, entity.meta.title)) continue;
        priors.push(materializePagePrior(rule, prior));
      }
      continue;
    }

    if (!matchesSource && !matchesTarget) continue;
    if (!rule.keywords.some((keyword) => haystack.includes(normalizeText(keyword)))) continue;
      priors.push({
        relationType: rule.type,
        pageFamilies: [inferPageFamily(entity.meta.kind)],
        activationSurfaces: defaultPagePriorActivationSurfaces(),
        keywords: rule.keywords,
        cuePatterns: [],
        titlePatterns: [],
      matchMode: 'any',
      sourceKinds: rule.sourceKinds,
      targetKinds: rule.targetKinds,
      direction: matchesSource && !matchesTarget ? baseDirection : invertDirection(baseDirection),
      confidence: 0.58
    });
  }
  return dedupePageRolePriors(priors);
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

function dedupePageRolePriors(priors: PageRolePrior[]): PageRolePrior[] {
  const seen = new Set<string>();
  const deduped: PageRolePrior[] = [];
  for (const prior of priors) {
    const key = `${prior.relationType}:${prior.direction ?? 'forward'}:${(prior.sourceKinds ?? []).join(',')}:${(prior.targetKinds ?? []).join(',')}:${prior.keywords.join(',')}:${prior.cuePatterns.map((pattern) => pattern.source).join(',')}:${prior.titlePatterns.map((pattern) => pattern.source).join(',')}:${prior.matchMode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(prior);
  }
  return deduped;
}

function pagePriorActivates(prior: KnowledgePagePriorRule, haystack: string, title: string): boolean {
  const titleText = normalizeText(title);
  const checks = [
    prior.keywords?.length ? prior.keywords.some((keyword) => haystack.includes(normalizeText(keyword))) : null,
    prior.cuePatterns?.length ? prior.cuePatterns.some((pattern) => new RegExp(pattern, 'i').test(haystack)) : null,
    prior.titlePatterns?.length ? prior.titlePatterns.some((pattern) => new RegExp(pattern, 'i').test(titleText)) : null
  ].filter((value): value is boolean => value !== null);
  if (checks.length === 0) return false;
  return (prior.matchMode ?? 'any') === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

function materializePagePrior(rule: KnowledgeLinkRule, prior: KnowledgePagePriorRule): PageRolePrior {
  return {
    relationType: rule.type,
    pageFamilies: prior.pageFamilies,
    activationSurfaces: prior.activationSurfaces ?? defaultPagePriorActivationSurfaces(),
    keywords: prior.keywords ?? [],
    cuePatterns: (prior.cuePatterns ?? []).map((pattern) => new RegExp(pattern, 'i')),
    titlePatterns: (prior.titlePatterns ?? []).map((pattern) => new RegExp(pattern, 'i')),
    matchMode: prior.matchMode ?? 'any',
    sourceKinds: prior.sourceKinds ?? rule.sourceKinds,
    targetKinds: prior.targetKinds ?? rule.targetKinds,
    direction: prior.direction ?? rule.direction ?? 'forward',
    confidence: prior.confidence ?? 0.58
  };
}

function pagePriorAllowsSurface(prior: PageRolePrior, sourceSurface: KnowledgeLinkSourceSurface | undefined): boolean {
  if (!prior.activationSurfaces?.length) return true;
  if (!sourceSurface) return false;
  return prior.activationSurfaces.includes(sourceSurface);
}

function defaultPagePriorActivationSurfaces(): KnowledgeLinkSourceSurface[] {
  return ['current-truth', 'source-summary', 'source-content', 'event-summary', 'structured'];
}

function invertDirection(direction: KnowledgeLinkDirection): KnowledgeLinkDirection {
  if (direction === 'forward') return 'reverse';
  if (direction === 'reverse') return 'forward';
  return 'bidirectional';
}
