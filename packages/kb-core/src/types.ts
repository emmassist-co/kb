export type KnowledgeBaseMode = 'basic' | 'hybrid' | 'compound';
export type KnowledgeSearchMode = 'search-only' | 'graph-only' | 'graph-first-hybrid';
export type KnowledgeLexicalBackend = 'legacy-lexical' | 'bm25-lexical';

export interface KnowledgeBaseConfig {
  enabled: boolean;
  mode: KnowledgeBaseMode;
  writePolicy: 'mixed';
  persistence: {
    backend: 'auto' | 'file' | 'cloudflare' | 'r2';
    cacheRefreshPolicy: 'per-run' | 'on-start' | 'none';
    rootDir: string;
  };
  ingest: {
    agentTurns: boolean;
    userCorrections: boolean;
    workspaceSignals: boolean;
    externalResearch: boolean;
  };
}

export type KnowledgeEntityKind =
  | 'company'
  | 'person'
  | 'process'
  | 'project'
  | 'policy'
  | 'vendor'
  | 'decision'
  | 'system'
  | 'team'
  | 'meeting';

export type KnowledgeConfidence = 'low' | 'medium' | 'high';
export type KnowledgeFreshnessStatus = 'fresh' | 'needs_review' | 'stale';
export type KnowledgeSourceKind = 'note' | 'research' | 'workspace' | 'chat';
export type KnowledgeLinkEvidenceKind = 'direct' | 'timeline' | 'summary' | 'mention' | 'structured';
export type KnowledgeLinkDirection = 'forward' | 'reverse' | 'bidirectional';
export type KnowledgeLinkEvidenceStrength = 'explicit-ref' | 'keyword' | 'page-prior' | 'co-mention';
export type KnowledgeLinkStatus = 'active' | 'historical';
export type KnowledgePageFamily = 'process' | 'meeting' | 'project' | 'decision' | 'policy' | 'system' | 'team' | 'entity';
export type KnowledgeQueryIntentMode =
  | 'single-profile'
  | 'entity-set'
  | 'aggregation'
  | 'attribute-intersection'
  | 'background'
  | 'relationship-depth';
export type KnowledgeQueryTemporalFocus = 'current' | 'historical' | 'mixed';
export type KnowledgeLinkSourceSurface =
  | 'current-truth'
  | 'timeline'
  | 'source-summary'
  | 'source-content'
  | 'event-summary'
  | 'structured';

export type KnowledgeTrustCurrentness = 'current' | 'historical' | 'superseded' | 'raw' | 'unknown';
export type KnowledgeTrustEvidenceRole =
  | 'canonical_truth'
  | 'supporting_evidence'
  | 'raw_evidence'
  | 'timeline_evidence'
  | 'relation_evidence'
  | 'review_state'
  | 'debt_signal';
export type KnowledgeTrustCaveatSeverity = 'info' | 'warning' | 'error';
export type KnowledgeTrustCaveatCode =
  | 'freshness_stale'
  | 'freshness_needs_review'
  | 'freshness_unknown'
  | 'superseded_record'
  | 'historical_record'
  | 'raw_unpromoted_evidence'
  | 'unsupported_current_truth'
  | 'missing_source_reference'
  | 'ambiguous_result'
  | 'low_confidence'
  | 'conflicting_evidence'
  | 'review_pending';

export interface KnowledgeTrustCaveat {
  code: KnowledgeTrustCaveatCode;
  severity: KnowledgeTrustCaveatSeverity;
  message: string;
  relatedIds?: string[];
}

export interface KnowledgeTrustEnvelope {
  currentness: KnowledgeTrustCurrentness;
  evidenceRole: KnowledgeTrustEvidenceRole;
  freshnessStatus?: KnowledgeFreshnessStatus;
  lastReviewedAt?: string;
  confidence: KnowledgeConfidence;
  sourceIds: string[];
  supersedes: string[];
  supersededBy: string[];
  caveats: KnowledgeTrustCaveat[];
}

export interface KnowledgeQueryIntent {
  rawQuery: string;
  relationType: string | null;
  candidateRelationTypes: string[];
  anchorQuery: string | null;
  expectedKinds: KnowledgeEntityKind[];
  attributeTerms: string[];
  roleTerms: string[];
  modes: KnowledgeQueryIntentMode[];
  expectsMultiple: boolean;
  temporalFocus: KnowledgeQueryTemporalFocus;
}

export type KnowledgeCandidatePlannerActivation =
  | 'none'
  | 'degraded-non-relation-set';

export interface KnowledgeCandidateRetrievalPlan {
  intent: KnowledgeQueryIntent;
  activation: KnowledgeCandidatePlannerActivation;
  activationReason: string[];
  matchTokens: string[];
  expectedKinds: KnowledgeEntityKind[];
  anchorQuery: string | null;
  anchorTokens: string[];
  roleTerms: string[];
  attributeTerms: string[];
  sourceSuppression: number;
  prefersConnectedAnchor: boolean;
  requireExpectedKind: boolean;
  requireRoleEvidence: boolean;
  minimumAttributeMatches: number;
  requireRelationshipDepthEvidence: boolean;
}

export interface KnowledgeEvidenceSpan {
  start: number;
  end: number;
  text: string;
}

export interface KnowledgePagePriorRule {
  primaryKinds: KnowledgeEntityKind[];
  pageFamilies?: KnowledgePageFamily[];
  activationSurfaces?: KnowledgeLinkSourceSurface[];
  keywords?: string[];
  cuePatterns?: string[];
  titlePatterns?: string[];
  matchMode?: 'any' | 'all';
  direction?: KnowledgeLinkDirection;
  sourceKinds?: KnowledgeEntityKind[];
  targetKinds?: KnowledgeEntityKind[];
  confidence?: number;
}

export interface KnowledgeDoctorIssueDetail {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  entityId?: string;
  sourceId?: string;
  eventId?: string;
  linkId?: string;
  path?: string;
  relatedIds?: string[];
  nextAction?: string;
}

export interface KnowledgeLinkRule {
  id: string;
  type: string;
  sourceKinds?: KnowledgeEntityKind[];
  targetKinds?: KnowledgeEntityKind[];
  keywords: string[];
  negativeKeywords?: string[];
  direction?: KnowledgeLinkDirection;
  confidence: number;
  explicitReferenceBoost?: number;
  priority?: number;
  pagePriors?: KnowledgePagePriorRule[];
}

export interface KnowledgeLink {
  id: string;
  tenantId: string;
  type: string;
  fromId: string;
  toId: string;
  sourceIds: string[];
  confidence: number;
  evidenceKind: KnowledgeLinkEvidenceKind;
  evidenceStrength?: KnowledgeLinkEvidenceStrength;
  sourceSurface?: KnowledgeLinkSourceSurface;
  explicitReference?: boolean;
  createdAt: string;
  validFrom?: string;
  validTo?: string;
  status?: KnowledgeLinkStatus;
  supersededBy?: string;
  originKind?: 'entity' | 'source' | 'event' | 'seed';
  originId?: string;
  ruleId?: string;
  extractorId?: string;
  evidenceText?: string;
  evidenceSpan?: KnowledgeEvidenceSpan;
}

export interface KnowledgeRelationProposal {
  type: string;
  fromId: string;
  toId: string;
  sourceIds: string[];
  confidence: number;
  evidenceKind: KnowledgeLinkEvidenceKind;
  evidenceStrength: KnowledgeLinkEvidenceStrength;
  sourceSurface: KnowledgeLinkSourceSurface;
  explicitReference: boolean;
  originKind: 'entity' | 'source' | 'event' | 'seed';
  originId: string;
  ruleId: string;
  extractorId: string;
  createdAt?: string;
  evidenceText: string;
  evidenceSpan?: KnowledgeEvidenceSpan;
}

export interface KnowledgeEntityRegistryEntry {
  entityId: string;
  kind: KnowledgeEntityKind;
  title: string;
  aliases: string[];
  handles: string[];
  externalIds: string[];
  canonicalTokens: string[];
  pageFamily: KnowledgePageFamily;
  updatedAt: string;
}

export interface EntityFrontmatter {
  id: string;
  tenantId: string;
  kind: KnowledgeEntityKind;
  title: string;
  aliases: string[];
  handles: string[];
  tags: string[];
  status?: string;
  owners: string[];
  sources: string[];
  updatedAt: string;
  confidence: KnowledgeConfidence;
  supersedes?: string[];
  freshnessStatus?: KnowledgeFreshnessStatus;
  lastReviewedAt?: string;
}

export interface EntityDocument {
  meta: EntityFrontmatter;
  currentTruth: string;
  openQuestions: string[];
  timeline: string[];
  sources: string[];
}

export interface SourceFrontmatter {
  id: string;
  tenantId: string;
  kind: KnowledgeSourceKind;
  title: string;
  url?: string;
  authors: string[];
  tags: string[];
  linkedEntities: string[];
  createdAt: string;
  rawSourceRef?: string;
  supersedes?: string[];
  freshnessStatus?: KnowledgeFreshnessStatus;
  lastReviewedAt?: string;
}

export interface SourceDocument {
  meta: SourceFrontmatter;
  summary: string;
  content: string;
  citations: string[];
}

export interface KnowledgeEvent {
  id: string;
  tenantId: string;
  entityIds: string[];
  summary: string;
  sourceIds: string[];
  provenance?: string;
  createdAt: string;
}

export interface EntityDraft {
  entityId: string;
  tenantId: string;
  title?: string;
  kind?: KnowledgeEntityKind;
  summary?: string;
  openQuestions: string[];
  sourceIds: string[];
  timelineNotes: string[];
  updatedAt: string;
}

export type KnowledgePromotionOperation = 'record' | 'remember' | 'relate' | 'annotate';
export type KnowledgePromotionStatus =
  | 'proposed'
  | 'review_pending'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'needs_more_evidence'
  | 'archived';

export interface KnowledgePromotionProposal {
  id: string;
  tenantId: string;
  status: KnowledgePromotionStatus;
  operation: KnowledgePromotionOperation;
  payload: Record<string, unknown>;
  title?: string;
  summary?: string;
  targetEntityIds: string[];
  sourceIds: string[];
  warnings: string[];
  submittedBy?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  appliedMutation?: KnowledgeMutationResult;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  appliedAt?: string;
}

export type KnowledgeReviewItemStatus =
  | 'open'
  | 'assigned'
  | 'in_review'
  | 'approved'
  | 'applied'
  | 'resolved'
  | 'rejected'
  | 'snoozed'
  | 'duplicate'
  | 'blocked'
  | 'invalidated'
  | 'reopened';
export type KnowledgeReviewItemType = 'promotion' | 'stale' | 'conflict' | 'duplicate' | 'unsupported' | 'provenance' | 'dangling' | 'other';

export interface KnowledgeReviewItem {
  id: string;
  tenantId: string;
  type: KnowledgeReviewItemType;
  status: KnowledgeReviewItemStatus;
  severity: 'info' | 'warning' | 'error';
  title: string;
  summary: string;
  targetIds: string[];
  sourceIds: string[];
  relatedIds: string[];
  proposalId?: string;
  assignedTo?: string;
  reviewer?: string;
  notes?: string;
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface KnowledgeMemoryDebtItem {
  id: string;
  tenantId: string;
  type: KnowledgeReviewItemType;
  status: 'open' | 'linked_to_review' | 'resolved' | 'invalidated';
  severity: 'info' | 'warning' | 'error';
  title: string;
  summary: string;
  targetIds: string[];
  sourceIds: string[];
  relatedIds: string[];
  reviewItemId?: string;
  nextAction?: string;
}

export interface KnowledgeLock {
  key: string;
  token: string;
  expiresAt: number;
}

export interface KnowledgeSearchInput {
  query: string;
  kind?: KnowledgeEntityKind;
  limit?: number;
  assistQuery?: boolean;
  mode?: KnowledgeSearchMode;
  lexicalBackend?: KnowledgeLexicalBackend;
  temporalFocus?: KnowledgeQueryTemporalFocus;
  evidenceOnly?: boolean;
  captureReplay?: boolean;
}

export interface KnowledgeSearchResult {
  id: string;
  kind: 'entity' | 'source';
  entityKind?: KnowledgeEntityKind;
  title: string;
  score: number;
  reason: string[];
  matchedFields: string[];
  sourceIds: string[];
  confidence: KnowledgeConfidence;
  ambiguous: boolean;
  excerpt: string;
  retrievalMode?: KnowledgeSearchMode;
  relationTypes?: string[];
  trust?: KnowledgeTrustEnvelope;
}

export interface KnowledgeExportSnapshot {
  tenantId: string;
  mode: KnowledgeBaseMode;
  entities: EntityDocument[];
  sources: SourceDocument[];
  events: KnowledgeEvent[];
  drafts: EntityDraft[];
  links: KnowledgeLink[];
  proposals?: KnowledgePromotionProposal[];
  reviewItems?: KnowledgeReviewItem[];
}

export const KNOWLEDGE_TRUST_SUBSTRATE_CONTRACT_VERSION = '2026-07-16.trust-substrate' as const;

export interface KnowledgeTrustSubstrateCapabilities {
  version: typeof KNOWLEDGE_TRUST_SUBSTRATE_CONTRACT_VERSION;
  trustAwareRetrieval: true;
  evidenceViews: true;
  promotionReview: true;
  memoryDebt: true;
  decisionViews: true;
  recallBundles: true;
  recallMutatesState: false;
}

export interface KnowledgeWorkspaceCapabilities {
  tenantId: string;
  backend: 'file' | 'r2-mirror' | 'cloudflare' | 'r2' | 'http' | 'runtime';
  transport: 'local' | 'http' | 'flue' | 'worker';
  mode: KnowledgeBaseMode | 'local';
  canonical: boolean;
  workspaceRole: 'canonical-production' | 'local-development' | 'mirror-support' | 'runtime-support';
  rootDir?: string;
  baseUrl?: string;
  dashboard?: {
    readOnly: boolean;
    basePath: string;
  };
  trustSubstrate?: KnowledgeTrustSubstrateCapabilities;
}

export interface KnowledgeRelationQueryInput {
  query: string;
  limit?: number;
  mode?: Extract<KnowledgeSearchMode, 'graph-only' | 'graph-first-hybrid'>;
  lexicalBackend?: KnowledgeLexicalBackend;
  currentOnly?: boolean;
  asOf?: string;
}

export interface KnowledgeRelationQueryResult {
  query: string;
  classification: {
    relationType: string | null;
    anchorId: string | null;
    confidence: number;
    degraded: boolean;
    candidateRelationTypes?: string[];
    intent?: KnowledgeQueryIntent;
  };
  results: KnowledgeSearchResult[];
  traversedLinks: KnowledgeLink[];
}

export interface KnowledgeMutationHydratedState {
  entities: EntityDocument[];
  sources: SourceDocument[];
  events: KnowledgeEvent[];
  links: KnowledgeLink[];
}

export interface KnowledgeMutationResult {
  mutated: true;
  entityIds: string[];
  sourceIds: string[];
  eventIds: string[];
  warnings: string[];
  hydrated: KnowledgeMutationHydratedState;
}

export interface KnowledgeEvidenceSourceSummary {
  id: string;
  kind: KnowledgeSourceKind;
  title: string;
  summary: string;
  rawSourceRef?: string;
  freshnessStatus?: KnowledgeFreshnessStatus;
  lastReviewedAt?: string;
  trust: KnowledgeTrustEnvelope;
}

export interface KnowledgeEvidenceClaim {
  id: string;
  text: string;
  sourceIds: string[];
  eventIds: string[];
  linkIds: string[];
  trust: KnowledgeTrustEnvelope;
}

export interface KnowledgeDecisionView {
  id: string;
  title: string;
  status: string;
  decidedAt?: string;
  effectiveAt?: string;
  owner?: string;
  rationale?: string;
  alternatives: string[];
  sourceIds: string[];
  supersedes: string[];
  supersededBy: string[];
  trust: KnowledgeTrustEnvelope;
}

export interface KnowledgeEntityEvidenceView {
  id: string;
  entity: EntityDocument;
  trust: KnowledgeTrustEnvelope;
  currentTruth: {
    text: string;
    claims: KnowledgeEvidenceClaim[];
  };
  sources: KnowledgeEvidenceSourceSummary[];
  events: KnowledgeEvent[];
  relations: KnowledgeLink[];
  rawEvidence: KnowledgeEvidenceSourceSummary[];
  supersedes: string[];
  supersededBy: string[];
  openQuestions: string[];
  decision?: KnowledgeDecisionView;
  caveats: KnowledgeTrustCaveat[];
}

export interface KnowledgeRecallInput {
  query?: string;
  purpose?: string;
  entityIds?: string[];
  limit?: number;
  maxTokens?: number;
  temporalFocus?: KnowledgeQueryTemporalFocus;
}

export interface KnowledgeRecallClaim {
  id: string;
  entityId?: string;
  text: string;
  sourceIds: string[];
  trust: KnowledgeTrustEnvelope;
}

export interface KnowledgeRecallBundle {
  purpose?: string;
  query?: string;
  temporalFocus: KnowledgeQueryTemporalFocus;
  generatedAt: string;
  maxTokens: number;
  estimatedTokens: number;
  claims: KnowledgeRecallClaim[];
  decisions: KnowledgeDecisionView[];
  caveats: KnowledgeTrustCaveat[];
  citations: KnowledgeEvidenceSourceSummary[];
  omitted: Array<{ id: string; reason: string }>;
}

export interface KnowledgeSearchExplanation {
  query: string;
  lexicalBackend?: KnowledgeLexicalBackend;
  classification: {
    relationType: string | null;
    anchorId: string | null;
    confidence: number;
    degraded: boolean;
    candidateRelationTypes?: string[];
    intent?: KnowledgeQueryIntent;
  };
  lexical: KnowledgeSearchResult[];
  graph: KnowledgeSearchResult[];
  hybrid: KnowledgeSearchResult[];
}

export interface KnowledgeReplayRecord {
  tenantId: string;
  capturedAt: string;
  query: string;
  mode: KnowledgeSearchMode | 'query-relations';
  lexicalBackend?: KnowledgeLexicalBackend;
  limit: number;
  durationMs: number;
  resultIds: string[];
  relationType?: string | null;
  anchorId?: string | null;
}

export interface KnowledgeReplaySummary {
  recordCount: number;
  meanJaccardAtK: number;
  top1Stability: number;
  meanLatencyDeltaMs: number;
  regressions: Array<{
    query: string;
    previousTop1: string | null;
    currentTop1: string | null;
    jaccardAtK: number;
    latencyDeltaMs: number;
  }>;
}
