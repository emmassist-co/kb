import path from 'node:path';
import type { Adapter, AdapterConfig, BrainState, PublicPage, PublicQuery, RankedDoc } from './upstream-contract.js';
import { createSeededKnowledgeBaseContext, searchResultDocs } from '../../runner/shared.js';
import { classifyRelationQuery } from '../../../packages/kb-core/src/relations.js';
import { buildQueryRetrievalPlan } from '../../../packages/kb-core/src/service-helpers.js';
import type { KnowledgeLink, KnowledgeSearchResult } from '../../../packages/kb-core/src/types.js';

interface AdapterScoringQuery {
  text: string;
}

interface KbAdapterState {
  context: Awaited<ReturnType<typeof createSeededKnowledgeBaseContext>>;
  config: {
    k: number;
    mode: 'search-only' | 'graph-only' | 'graph-first-hybrid';
    lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
    resultBudgetMode: 'default' | 'single-answer-tight' | 'adaptive';
  };
}

export interface KbAdapterQueryDiagnostics {
  queryId: string;
  text: string;
  queryFamily: string;
  relationType: string | null;
  anchorQuery: string | null;
  anchorId: string | null;
  classificationConfidence: number;
  degraded: boolean;
  traversedLinkCount: number;
  fallbackFired: boolean;
  resultCount: number;
  retrievalMode: 'search-only' | 'graph-only' | 'graph-first-hybrid';
  candidateRelationTypes: string[];
  anchorSearch: KbAdapterResultAttribution | null;
  topResult: KbAdapterResultAttribution | null;
  namedThing: {
    anchorCandidates: KbAdapterResultAttribution[];
    answerCandidates: KbAdapterResultAttribution[];
  };
  firstFailingStage: 'none' | 'relation-classification' | 'anchor-retrieval' | 'graph-traversal' | 'candidate-planning' | 'candidate-filtering' | 'result-ranking';
  residualBucket:
    | 'none'
    | 'anchor-ambiguous'
    | 'structure-thin'
    | 'projection-weak'
    | 'descriptive-tie'
    | 'semantic-candidate'
    | 'classification-thin'
    | 'candidate-plan-thin'
    | 'candidate-filter-thin'
    | 'ranking-thin';
  semanticEligible: boolean;
  semanticUsed: boolean;
  resultBudgetMode: 'default' | 'single-answer-tight' | 'adaptive';
  resultBudgetProfile: 'default' | 'single-answer-tight' | 'descriptive-tight' | 'projection-tight' | 'projection-medium' | 'plural-broad';
  plannerActivation: 'none' | 'degraded-non-relation-set';
  plannerReason: string[];
}

export interface KbAdapterResultAttribution {
  pageId: string;
  supportSurface: 'title' | 'alias' | 'prose' | 'graph' | 'mixed' | 'unknown';
  matchedFields: string[];
  reason: string[];
  score: number;
  retrievalMode: string | null;
  evidence: Array<{
    channel: string;
    evidenceKind: string;
    evidenceStrength?: string;
    sourceSurface?: string;
    trustTier?: string;
    explicitReference?: boolean;
    relationType?: string;
    supportRole?: string;
    pageFamily?: string;
    originKind?: string;
    originId?: string;
  }>;
}

export class KbAdapter implements Adapter {
  readonly name: string;

  constructor(name = 'emmassist-kb') {
    this.name = name;
  }

  async init(rawPages: PublicPage[], config: AdapterConfig): Promise<BrainState> {
    const context = await createSeededKnowledgeBaseContext({
      pages: rawPages.map((page) => ({
        id: normalizeSlug(page.slug),
        type: page.type,
        title: page.title,
        compiledTruth: Array.isArray(page.compiled_truth) ? page.compiled_truth.join('\n\n') : String(page.compiled_truth ?? ''),
        timeline: Array.isArray(page.timeline) ? page.timeline.join('\n') : String(page.timeline ?? ''),
        relations: []
      }))
    });

    return {
      context,
      config: {
        k: typeof config.k === 'number' ? config.k : 5,
        mode: coerceMode(config.mode),
        lexicalBackend: coerceLexicalBackend(config.lexicalBackend),
        resultBudgetMode: coerceResultBudgetMode(config.resultBudgetMode)
      }
    } satisfies KbAdapterState;
  }

  async query(q: PublicQuery, state: BrainState): Promise<RankedDoc[]> {
    const { context, config } = state as KbAdapterState;
    const scoringQuery = toAdapterScoringQuery(q);
    const relationClassification = classifyRelationQuery(scoringQuery.text);
    const planner = buildQueryRetrievalPlan(scoringQuery.text);
    const lexicalBackend = resolveQueryLexicalBackend(scoringQuery.text, config.lexicalBackend);
    if (relationClassification.relationType) {
      const relation = await context.service.queryRelations({
        query: scoringQuery.text,
        limit: config.k,
        mode: config.mode === 'search-only' ? 'graph-first-hybrid' : config.mode,
        lexicalBackend,
        currentOnly: false
      });
      return searchResultDocs(
        applyResultBudget(pruneHistoricalTail(relation.results, relation.classification.relationType), {
          mode: config.resultBudgetMode,
          queryText: scoringQuery.text,
          relationType: relation.classification.relationType,
          planner
        })
      ).map((result) => ({
        page_id: denormalizeSlug(result.pageId),
        score: result.score,
        rank: result.rank
      }));
    }

    const search = await context.service.search({
      query: scoringQuery.text,
      limit: config.k,
      mode: config.mode,
      lexicalBackend
    });

    return searchResultDocs(
      applyResultBudget(search.results, {
        mode: config.resultBudgetMode,
        queryText: scoringQuery.text,
        relationType: null,
        planner
      })
    ).map((result) => ({
      page_id: denormalizeSlug(result.pageId),
      score: result.score,
      rank: result.rank
    }));
  }

  async diagnoseQuery(q: PublicQuery, state: BrainState): Promise<KbAdapterQueryDiagnostics> {
    const { context, config } = state as KbAdapterState;
    const scoringQuery = toAdapterScoringQuery(q);
    const lexicalBackend = resolveQueryLexicalBackend(scoringQuery.text, config.lexicalBackend);
    const planner = buildQueryRetrievalPlan(scoringQuery.text);
    const explanation = await context.service.explainSearch(scoringQuery.text, config.k, lexicalBackend);
    const relationRun = explanation.classification.relationType
      ? await context.service.queryRelations({
          query: scoringQuery.text,
          limit: config.k,
          mode: config.mode === 'search-only' ? 'graph-first-hybrid' : config.mode,
          lexicalBackend,
          currentOnly: false,
          captureReplay: false
        })
      : null;
    const topResults = explanation.classification.relationType
      ? pruneHistoricalTail(explanation.hybrid, explanation.classification.relationType)
      : explanation.lexical;
    const queryFamily = classifyQueryFamily(q);
    const topResult = summarizeAttribution(topResults[0] ?? null);
    return {
      queryId: q.id,
      text: scoringQuery.text,
      queryFamily,
      relationType: explanation.classification.relationType,
      anchorQuery: classifyRelationQuery(scoringQuery.text).anchorQuery ?? null,
      anchorId: explanation.classification.anchorId,
      classificationConfidence: explanation.classification.confidence,
      degraded: explanation.classification.degraded,
      traversedLinkCount: relationRun?.traversedLinks.length ?? 0,
      fallbackFired: Boolean(explanation.classification.relationType) && explanation.classification.degraded,
      resultCount: topResults.length,
      retrievalMode: config.mode,
      candidateRelationTypes: explanation.classification.candidateRelationTypes ?? [],
      anchorSearch: null,
      topResult,
      namedThing: {
        anchorCandidates: [],
        answerCandidates: topResult ? [topResult] : []
      },
      firstFailingStage: classifyFirstFailingStage(planner, explanation.classification.relationType, explanation.classification.degraded, relationRun?.traversedLinks ?? [], topResults),
      residualBucket: classifyResidualBucket(planner, explanation.classification.degraded, relationRun?.traversedLinks ?? [], topResults),
      semanticEligible: false,
      semanticUsed: false,
      resultBudgetMode: config.resultBudgetMode,
      resultBudgetProfile: classifyResultBudgetProfile({
        mode: config.resultBudgetMode,
        queryText: scoringQuery.text,
        relationType: explanation.classification.relationType,
        results: topResults,
        planner
      }),
      plannerActivation: planner.activation,
      plannerReason: planner.activationReason
    };
  }

  async snapshot(state: BrainState): Promise<string> {
    const { context } = state as KbAdapterState;
    const snapshotPath = path.join(context.rootDir, 'gbrain-evals-kb-adapter-snapshot.json');
    const snapshot = await context.snapshot();
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    );
    return snapshotPath;
  }

  async teardown(state: BrainState): Promise<void> {
    const { context } = state as KbAdapterState;
    context.cleanup();
  }
}

function toAdapterScoringQuery(query: PublicQuery): AdapterScoringQuery {
  return { text: query.text };
}

function coerceMode(value: unknown): 'search-only' | 'graph-only' | 'graph-first-hybrid' {
  return value === 'search-only' || value === 'graph-only' || value === 'graph-first-hybrid'
    ? value
    : 'graph-first-hybrid';
}

function coerceLexicalBackend(value: unknown): 'legacy-lexical' | 'bm25-lexical' | undefined {
  return value === 'legacy-lexical' || value === 'bm25-lexical' ? value : undefined;
}

function resolveQueryLexicalBackend(
  query: string,
  configured: 'legacy-lexical' | 'bm25-lexical' | undefined
): 'legacy-lexical' | 'bm25-lexical' | undefined {
  if (configured) return configured;
  const plan = buildQueryRetrievalPlan(query);
  return plan.activation === 'degraded-non-relation-set' ? 'bm25-lexical' : undefined;
}

function coerceResultBudgetMode(value: unknown): 'default' | 'single-answer-tight' | 'adaptive' {
  return value === 'single-answer-tight' || value === 'adaptive' ? value : 'adaptive';
}

function normalizeSlug(slug: string): string {
  return slug.replace(/\//g, '__');
}

function denormalizeSlug(id: string): string {
  return id.replace(/__/g, '/');
}

function summarizeAttribution(result: KnowledgeSearchResult | null): KbAdapterResultAttribution | null {
  if (!result) return null;
  return {
    pageId: denormalizeSlug(result.id),
    supportSurface: inferSupportSurface(result),
    matchedFields: result.matchedFields,
    reason: result.reason,
    score: result.score,
    retrievalMode: result.retrievalMode ?? null,
    evidence: []
  };
}

function applyResultBudget(
  results: KnowledgeSearchResult[],
  input: {
    mode: 'default' | 'single-answer-tight' | 'adaptive';
    queryText: string;
    relationType: string | null;
    planner: ReturnType<typeof buildQueryRetrievalPlan>;
  }
): KnowledgeSearchResult[] {
  const budgetProfile = classifyResultBudgetProfile({
    mode: input.mode,
    queryText: input.queryText,
    relationType: input.relationType,
    results,
    planner: input.planner
  });

  switch (budgetProfile) {
    case 'default':
    case 'plural-broad':
      return results.slice(0, 5);
    case 'projection-medium':
      return results.slice(0, 4);
    case 'single-answer-tight':
    case 'descriptive-tight':
    case 'projection-tight':
      return results.slice(0, 3);
  }
}

function classifyResultBudgetProfile(input: {
  mode: 'default' | 'single-answer-tight' | 'adaptive';
  queryText: string;
  relationType: string | null;
  results: KnowledgeSearchResult[];
  planner: ReturnType<typeof buildQueryRetrievalPlan>;
}): KbAdapterQueryDiagnostics['resultBudgetProfile'] {
  if (input.mode === 'default') return 'default';
  if (input.mode === 'single-answer-tight') return 'single-answer-tight';

  if (!input.relationType) {
    if (input.planner.activation === 'degraded-non-relation-set') {
      if (input.planner.activationReason.includes('aggregation')) return 'plural-broad';
      if (input.planner.activationReason.includes('relationship-depth')) return 'projection-medium';
      if (input.planner.activationReason.includes('attribute-intersection')) return 'projection-medium';
    }
    return 'descriptive-tight';
  }
  if (input.relationType === 'member_of' || input.relationType === 'attends') return 'plural-broad';
  if (input.relationType === 'advises' || input.relationType === 'invested_in') return 'plural-broad';

  return 'projection-medium';
}

function looksProjectionWeak(results: KnowledgeSearchResult[]): boolean {
  const top = results[0] ?? null;
  const second = results[1] ?? null;
  const third = results[2] ?? null;
  const fourth = results[3] ?? null;
  if (!top || !third || !fourth) return false;
  const secondGap = second ? top.score - second.score : Number.POSITIVE_INFINITY;
  const tailGap = third.score - fourth.score;
  const crowded = results.length >= 4;
  return crowded && (top.ambiguous || third.ambiguous || secondGap <= 2.5 || tailGap <= 1.5);
}

function classifyQueryFamily(q: PublicQuery): string {
  const tags = Array.isArray(q.tags) ? q.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0) : [];
  if (q.tier === 'medium') {
    return tags[0] ?? 'canonical-relational';
  }
  if (q.tier === 'fuzzy') {
    return `fuzzy:${tags[0] ?? 'unlabeled'}`;
  }
  if (q.tier === 'externally-authored') {
    return `synthetic:${tags[0] ?? 'unlabeled'}`;
  }
  return tags[0] ?? q.tier;
}

function classifyFirstFailingStage(
  planner: ReturnType<typeof buildQueryRetrievalPlan>,
  relationType: string | null,
  degraded: boolean,
  traversedLinks: KnowledgeLink[],
  results: KnowledgeSearchResult[]
): KbAdapterQueryDiagnostics['firstFailingStage'] {
  if (planner.activation === 'degraded-non-relation-set' && degraded) return 'candidate-planning';
  if (!relationType) return results.length === 0 ? 'result-ranking' : 'none';
  if (degraded) return 'relation-classification';
  if (traversedLinks.length === 0) return 'graph-traversal';
  if (results.length === 0) return 'result-ranking';
  return 'none';
}

function classifyResidualBucket(
  planner: ReturnType<typeof buildQueryRetrievalPlan>,
  degraded: boolean,
  traversedLinks: KnowledgeLink[],
  results: KnowledgeSearchResult[]
): KbAdapterQueryDiagnostics['residualBucket'] {
  if (degraded) {
    if (planner.activation === 'degraded-non-relation-set') return 'candidate-plan-thin';
    return 'classification-thin';
  }
  if (traversedLinks.length === 0) return 'structure-thin';
  if (results.length === 0) return planner.activation === 'degraded-non-relation-set' ? 'candidate-filter-thin' : 'projection-weak';
  if (planner.activation === 'degraded-non-relation-set') {
    const plannerHits = results.filter((result) => result.reason.some((reason) => reason.startsWith('planner-')));
    if (plannerHits.length === 0) return 'candidate-filter-thin';
    if ((results[0]?.ambiguous ?? false) || looksProjectionWeak(results)) return 'ranking-thin';
  }
  if ((results[0]?.ambiguous ?? false) || (results[1]?.ambiguous ?? false)) return 'descriptive-tie';
  return 'none';
}

function inferSupportSurface(result: KnowledgeSearchResult): KbAdapterResultAttribution['supportSurface'] {
  const fields = new Set(result.matchedFields);
  if (fields.has('title')) return 'title';
  if (fields.has('alias') || fields.has('aliases') || fields.has('handle') || fields.has('handles')) return 'alias';
  if (result.retrievalMode === 'graph-only' || result.retrievalMode === 'graph-first-hybrid') return 'graph';
  if (fields.has('currentTruth') || fields.has('timeline') || fields.has('summary') || fields.has('content')) return 'prose';
  return 'unknown';
}

function pruneHistoricalTail(results: KnowledgeSearchResult[], relationType: string | null): KnowledgeSearchResult[] {
  if (!relationType || relationType === 'attends') return results;
  const hasCurrentTruthLeader = results.some(
    (entry) => entry.reason.includes('current-truth') || entry.reason.includes('explicit-ref')
  );
  if (!hasCurrentTruthLeader) return results;
  const pruned = results.filter((entry) => !entry.reason.includes('historical-only'));
  return pruned.length > 0 ? pruned : results;
}
