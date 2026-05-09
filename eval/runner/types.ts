export interface EvalPage {
  id: string;
  type: string;
  title: string;
  compiledTruth: string;
  timeline: string;
  tags?: string[];
  aliases?: string[];
  handles?: string[];
  sources?: string[];
  benchmark?: {
    scenarioId?: string;
    temporalChange?: boolean;
    aliasesInjected?: boolean;
    distractorIds?: string[];
    deprecated?: boolean;
  };
  relations?: Array<{
    type: string;
    targets: string[];
  }>;
}

export type EvalCorpusProvenance =
  | 'upstream-fictional-benchmark'
  | 'first-party-repo-docs'
  | 'deterministic-synthetic-fixtures';

export interface EvalQuery {
  id: string;
  text: string;
  relevant: string[];
  grades?: Record<string, number>;
  relationType?: string;
  anchorId?: string;
  family?: string;
  split?: 'dev' | 'holdout';
  scenarioId?: string;
  expectedTargetTypes?: string[];
  distractorIds?: string[];
  distractorGroups?: {
    wrongType?: string[];
    sibling?: string[];
    lexical?: string[];
    historical?: string[];
  };
  requiresTimeline?: boolean;
  intentionallyAmbiguous?: boolean;
  usesAlias?: boolean;
  indirectPhrasing?: boolean;
  expectedAnchorKinds?: string[];
}

export interface RankedDoc {
  pageId: string;
  score: number;
  rank: number;
  reason?: string[];
  matchedFields?: string[];
  sourceIds?: string[];
  confidence?: 'low' | 'medium' | 'high';
  ambiguous?: boolean;
}

export interface EvalFailure {
  caseId: string;
  summary: string;
  expected: unknown;
  actual: unknown;
}

export interface EvalMetricMap {
  [name: string]: number;
}

export interface EvalThresholdMap {
  [name: string]: number;
}

export interface EvalCase {
  id: string;
  prompt: string;
  notes?: string;
}

export interface EvalCategoryResult {
  category: 'retrieval' | 'temporal' | 'identity' | 'provenance' | 'contradictions' | 'fuzzy';
  corpus: string;
  provenance: EvalCorpusProvenance;
  caseCount: number;
  metrics: EvalMetricMap;
  thresholds: EvalThresholdMap;
  passed: boolean;
  failures: EvalFailure[];
  sampleSize: number;
  artifactPath?: string;
}

export interface EvalScorecard {
  suite: string;
  corpus: string;
  provenance: EvalCorpusProvenance | 'mixed';
  generatedAt: string;
  categories: EvalCategoryResult[];
  overall: {
    passed: boolean;
    categoryPassRate: number;
    metrics: Record<string, number>;
  };
}

export interface EvalRunResult {
  corpus: string;
  mode?: 'search-only' | 'graph-only' | 'graph-first-hybrid';
  lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
  queryCount: number;
  k: number;
  precisionAtK: number;
  recallAtK: number;
  mrrAtK: number;
  ndcgAtK: number;
  familyBreakdown?: Record<string, {
    queryCount: number;
    precisionAtK: number;
    recallAtK: number;
    mrrAtK: number;
    ndcgAtK: number;
    passesFloor?: boolean;
  }>;
  corpusMetadata?: {
    benchmarkTier?: 'product-core' | 'external-reference' | 'regression-guardrail';
    split?: 'all' | 'dev' | 'holdout';
    corpusSize?: number;
    queryCount?: number;
    familyCounts?: Record<string, number>;
    ambiguityRate?: number;
    temporalCaseRate?: number;
    distractorCaseRate?: number;
    averageCandidateDensity?: number;
    aliasQueryRate?: number;
    indirectPhrasingRate?: number;
    wrongTypeDistractorRate?: number;
    distractorDensity?: number;
    coverage?: Record<string, number>;
    generation?: {
      version?: string;
      seed?: number;
      corpusSize?: number;
      aliasCollisionRate?: number;
      temporalChangeRate?: number;
      indirectProseRate?: number;
      distractorDensity?: number;
      multiRelationOverlapRate?: number;
      anchorAmbiguityRate?: number;
      timelineRequiredRate?: number;
      aliasQueryRate?: number;
      wrongTypeDistractorRate?: number;
    };
  };
  gates?: {
    benchmarkTier?: 'product-core' | 'external-reference' | 'regression-guardrail';
    overall: Array<{
      label: string;
      passed: boolean;
      actual: number;
      expected: string;
    }>;
    perFamily?: Array<{
      family: string;
      passed: boolean;
      precisionAtK: number;
      recallAtK: number;
    }>;
    guardrails?: Array<{
      label: string;
      passed: boolean;
      actual: number;
      expected: string;
    }>;
    passed: boolean;
    milestone: 'below-floor' | 'floor-reached' | 'strong-reached' | 'stretch-reached' | 'guardrail-only';
  };
  familyGraphLift?: Record<string, {
    precisionLiftAtK: number;
    recallLiftAtK: number;
    mrrLiftAtK: number;
    ndcgLiftAtK: number;
  }>;
  hardness?: {
    searchOnlyPrecisionAtK?: number;
    searchOnlyMrrAtK?: number;
    graphFirstPrecisionAtK?: number;
    graphFirstMrrAtK?: number;
    precisionLift?: number;
    mrrLift?: number;
    searchOnlyPrecisionCapPassed?: boolean;
    searchOnlyMrrCapPassed?: boolean;
    passed: boolean;
    reasons: string[];
  };
  diagnostics?: {
    anchorResolutionFailures: string[];
    anchorResolutionFailureRate?: number;
    wrongAnchorSelections?: string[];
    wrongAnchorSelectionRate?: number;
    wrongTypeTopResultCount?: number;
    wrongTypeTopResultRate?: number;
    anchorPageOverAnswerCount?: number;
    anchorPageOverAnswerRate?: number;
    distractorWinCount?: number;
    distractorWinRate?: number;
    timelineNeededButMissedCount?: number;
    timelineNeededButMissedRate?: number;
    historicalOverCurrentCount?: number;
    historicalOverCurrentRate?: number;
    weakMentionBeatExplicitCount?: number;
    weakMentionBeatExplicitRate?: number;
    siblingDistractorWinCount?: number;
    siblingDistractorWinRate?: number;
    lexicalDistractorWinCount?: number;
    lexicalDistractorWinRate?: number;
    graphEdgeMissingCount?: number;
    graphEdgePresentButBadlyRankedCount?: number;
    averageCandidateDensity?: number;
    topFalsePositives: Array<{ queryId: string; returned: string[]; relevant: string[] }>;
  };
  extractionQuality?: {
    explicitSupportRate?: number;
    structuredSupportRate?: number;
    proseSupportRate?: number;
    graphLinkCoverageRate?: number;
    familyGraphLinkCoverage?: Record<string, number>;
  };
  perQuery: Array<{
    id: string;
    text: string;
    relevant: string[];
    family?: string;
    anchorId?: string;
    expectedTargetTypes?: string[];
    distractorIds?: string[];
    distractorGroups?: {
      wrongType?: string[];
      sibling?: string[];
      lexical?: string[];
      historical?: string[];
    };
    requiresTimeline?: boolean;
    intentionallyAmbiguous?: boolean;
    usesAlias?: boolean;
    indirectPhrasing?: boolean;
    returned: RankedDoc[];
    precisionAtK: number;
    recallAtK: number;
    reciprocalRank: number;
    ndcgAtK: number;
  }>;
}

export interface TemporalEvalCase extends EvalCase {
  entityId: string;
  mode: 'point-in-time' | 'as-of' | 'range' | 'latest' | 'changed-over-time';
  expectedAnswer: string;
  expectedSources?: string[];
  queryDate?: string;
  startDate?: string;
  endDate?: string;
}

export interface IdentityEvalCase extends EvalCase {
  query: string;
  relevant: string[];
  disallowed?: string[];
}

export interface ProvenanceEvalCase extends EvalCase {
  claim: string;
  relevantEntityIds?: string[];
  expectedSourceIds: string[];
  allowedAlternateSourceIds?: string[];
  evidenceMode: 'direct-quote' | 'paraphrased-summary' | 'timeline-derived' | 'multi-source-synthesis';
  unsupported?: boolean;
}

export interface ContradictionEvalCase extends EvalCase {
  entityId: string;
  expectedStatus: 'resolved' | 'uncertain';
  winningSourceIds?: string[];
  losingSourceIds?: string[];
  requiredMentions?: string[];
}

export interface FuzzyEvalCase extends EvalCase {
  query: string;
  relevant: string[];
  requireExplainability?: boolean;
  allowAmbiguous?: boolean;
}

export interface EvalCorpus {
  corpusName: string;
  provenance: EvalCorpusProvenance;
  pages: EvalPage[];
  queries: EvalQuery[];
  metadata?: {
    benchmarkTier?: 'product-core' | 'external-reference' | 'regression-guardrail';
    split?: 'all' | 'dev' | 'holdout';
    familyCounts?: Record<string, number>;
    ambiguityRate?: number;
    temporalCaseRate?: number;
    distractorCaseRate?: number;
    aliasQueryRate?: number;
    indirectPhrasingRate?: number;
    wrongTypeDistractorRate?: number;
    distractorDensity?: number;
    coverage?: Record<string, number>;
    generation?: {
      version?: string;
      seed?: number;
      corpusSize?: number;
      aliasCollisionRate?: number;
      temporalChangeRate?: number;
      indirectProseRate?: number;
      distractorDensity?: number;
      multiRelationOverlapRate?: number;
      anchorAmbiguityRate?: number;
      timelineRequiredRate?: number;
      aliasQueryRate?: number;
      wrongTypeDistractorRate?: number;
    };
  };
}

export function precisionAtK(docs: RankedDoc[], relevant: Set<string>, k: number): number {
  const top = docs.slice(0, k);
  if (top.length === 0) return 0;
  let hits = 0;
  for (const doc of top) {
    if (relevant.has(doc.pageId)) hits += 1;
  }
  return hits / k;
}

export function recallAtK(docs: RankedDoc[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const top = docs.slice(0, k);
  let hits = 0;
  for (const doc of top) {
    if (relevant.has(doc.pageId)) hits += 1;
  }
  return hits / relevant.size;
}

export function reciprocalRankAtK(docs: RankedDoc[], relevant: Set<string>, k: number): number {
  const top = docs.slice(0, k);
  for (let index = 0; index < top.length; index += 1) {
    if (relevant.has(top[index].pageId)) return 1 / (index + 1);
  }
  return 0;
}

export function ndcgAtK(docs: RankedDoc[], grades: Map<string, number>, k: number): number {
  const top = docs.slice(0, k);
  let dcg = 0;
  for (let index = 0; index < top.length; index += 1) {
    const rel = grades.get(top[index].pageId) ?? 0;
    if (rel > 0) {
      dcg += rel / log2(index + 2);
    }
  }

  const ideal = [...grades.values()].sort((left, right) => right - left).slice(0, k);
  let idcg = 0;
  for (let index = 0; index < ideal.length; index += 1) {
    if (ideal[index] > 0) idcg += ideal[index] / log2(index + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function passThresholds(metrics: EvalMetricMap, thresholds: EvalThresholdMap): boolean {
  return Object.entries(thresholds).every(([key, threshold]) => {
    const value = metrics[key] ?? 0;
    if (Object.is(threshold, -0) || threshold < 0) {
      return value <= Math.abs(threshold);
    }
    return value >= threshold;
  });
}

function log2(value: number): number {
  return Math.log(value) / Math.log(2);
}
