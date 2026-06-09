import type { KnowledgeExportSnapshot, KnowledgeRelationQueryResult, KnowledgeSearchResult } from '../../packages/kb-core/src/types.js';
import { loadAdminWorldCorpus, loadFixtureCorpus, loadGbrainWorldCorpus, loadRepoDocsCorpus } from './loaders.js';
import { searchResultDocs, withSeededKnowledgeBase } from './shared.js';
import type { EvalCategoryResult, EvalCorpus, EvalQuery, EvalRunResult, RankedDoc } from './types.js';
import { mean, ndcgAtK, passThresholds, precisionAtK, recallAtK, reciprocalRankAtK } from './types.js';

export async function runRetrievalCategory(input: {
  corpusPath?: string;
  gbrainWorldPath?: string;
  gbrainWorldContract?: 'github-benchmark' | 'corpus-linkable';
  adminWorldPath?: string;
  repoDocsPath?: string;
  k?: number;
  mode?: 'search-only' | 'graph-only' | 'graph-first-hybrid';
  lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
  split?: 'all' | 'dev' | 'holdout';
}): Promise<{ category: EvalCategoryResult; benchmark: EvalRunResult }> {
  const loaded: EvalCorpus = input.gbrainWorldPath
    ? loadGbrainWorldCorpus(input.gbrainWorldPath, input.gbrainWorldContract)
    : input.adminWorldPath
      ? loadAdminWorldCorpus(input.adminWorldPath, input.split)
    : input.repoDocsPath
      ? loadRepoDocsCorpus(input.repoDocsPath)
      : loadFixtureCorpus(input.corpusPath ?? new URL('../data/kb-world-v0', import.meta.url).pathname);
  const k = input.k ?? 5;
  const benchmark = await runRetrievalBenchmark({
    corpusName: loaded.corpusName,
    pages: loaded.pages,
    queries: loaded.queries,
    k,
    mode: input.mode ?? 'graph-first-hybrid',
    lexicalBackend: input.lexicalBackend,
    metadata: loaded.metadata
  });
  const explainability = mean(
    benchmark.perQuery.map((query) => (query.returned.every((doc) => (doc.matchedFields?.length ?? 0) > 0) ? 1 : 0))
  );
  const category: EvalCategoryResult = {
    category: 'retrieval',
    corpus: loaded.corpusName,
    provenance: loaded.provenance,
    caseCount: loaded.queries.length,
    metrics: {
      precisionAtK: benchmark.precisionAtK,
      recallAtK: benchmark.recallAtK,
      mrrAtK: benchmark.mrrAtK,
      ndcgAtK: benchmark.ndcgAtK,
      explainabilityRate: explainability
    },
    thresholds: {
      precisionAtK: 0.25,
      recallAtK: 0.5,
      mrrAtK: 0.5,
      ndcgAtK: 0.5,
      explainabilityRate: 1
    },
    passed: false,
    failures: benchmark.perQuery
      .filter((query) => query.returned.length === 0 || query.returned.some((doc) => (doc.matchedFields?.length ?? 0) === 0))
      .slice(0, 10)
      .map((query) => ({
        caseId: query.id,
        summary: 'Retrieval result was empty or lacked explainable matched fields.',
        expected: query.relevant,
        actual: query.returned
      })),
    sampleSize: Math.min(10, benchmark.perQuery.length)
  };
  category.passed = passThresholds(category.metrics, category.thresholds);
  return { category, benchmark };
}

export async function runRetrievalBenchmark(input: {
  corpusName: string;
  pages: Array<{
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
  }>;
  queries: EvalQuery[];
  k: number;
  mode?: 'search-only' | 'graph-only' | 'graph-first-hybrid';
  lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
  metadata?: EvalCorpus['metadata'];
  adapter?: RetrievalBenchmarkAdapter;
}): Promise<EvalRunResult> {
  if (input.adapter) {
    return scoreRetrievalBenchmark(input, input.adapter);
  }
  const benchmarkK = Math.min(input.k, Math.max(1, input.pages.length));
  return withSeededKnowledgeBase(
    {
      pages: input.pages
    },
    async ({ service, snapshot }) => {
      const perQuery: EvalRunResult['perQuery'] = [];
      const familyMetrics = new Map<string, Array<{ p: number; r: number; mrr: number; ndcg: number }>>();
      const familyGraphCoverage = new Map<string, { covered: number; total: number }>();
      let totalP = 0;
      let totalR = 0;
      let totalMrr = 0;
      let totalNdcg = 0;
      const anchorResolutionFailures: string[] = [];
      const wrongAnchorSelections: string[] = [];
      let wrongTypeTopResultCount = 0;
      let anchorPageOverAnswerCount = 0;
      let distractorWinCount = 0;
      let timelineNeededButMissedCount = 0;
      let historicalOverCurrentCount = 0;
      let weakMentionBeatExplicitCount = 0;
      let siblingDistractorWinCount = 0;
      let lexicalDistractorWinCount = 0;
      let graphEdgeMissingCount = 0;
      let graphEdgePresentButBadlyRankedCount = 0;
      let totalCandidateDensity = 0;
      const topFalsePositives: Array<{ queryId: string; returned: string[]; relevant: string[] }> = [];
      const exportSnapshot = await snapshot();
      const pageTypeById = new Map(input.pages.map((page) => [page.id, page.type]));
      let graphSupportedQueries = 0;
      let explicitSupportedQueries = 0;
      let structuredSupportedQueries = 0;
      let proseSupportedQueries = 0;
      const candidateLimit = Math.min(input.pages.length, Math.max(input.k * 4, 25));
      const explanationLimit = Math.min(candidateLimit, Math.max(input.k * 3, 15));

      for (const query of input.queries) {
        const search = await service.search({
          query: query.text,
          limit: candidateLimit,
          mode: input.mode ?? 'graph-first-hybrid',
          lexicalBackend: input.lexicalBackend,
          captureReplay: false
        });
        const graphExplanation = query.anchorId || query.relationType
          ? await service.queryRelations({
              query: query.text,
              limit: explanationLimit,
              mode: 'graph-only',
              lexicalBackend: input.lexicalBackend,
              captureReplay: false
            })
          : null;
        const returnedAll = searchResultDocs(search.results) as RankedDoc[];
        const returned = returnedAll.slice(0, input.k);
        const relevant = new Set(query.relevant);
        const grades = new Map<string, number>(
          Object.entries(query.grades ?? Object.fromEntries(query.relevant.map((id) => [id, 1])))
        );
        const p = precisionAtK(returned, relevant, benchmarkK);
        const r = recallAtK(returned, relevant, benchmarkK);
        const mrr = reciprocalRankAtK(returned, relevant, benchmarkK);
        const ndcg = ndcgAtK(returned, grades, benchmarkK);
        totalP += p;
        totalR += r;
        totalMrr += mrr;
        totalNdcg += ndcg;
        totalCandidateDensity += returnedAll.length;
        if (query.family) {
          const family = familyMetrics.get(query.family) ?? [];
          family.push({ p, r, mrr, ndcg });
          familyMetrics.set(query.family, family);
        }
        if (query.anchorId && graphExplanation && graphExplanation.classification.anchorId !== query.anchorId) {
          if (graphExplanation.classification.anchorId == null) anchorResolutionFailures.push(query.id);
          else wrongAnchorSelections.push(query.id);
        } else if (query.anchorId && input.mode !== 'search-only' && returned.length === 0) {
          anchorResolutionFailures.push(query.id);
        }
        if (returned.length && !relevant.has(returned[0].pageId)) {
          topFalsePositives.push({ queryId: query.id, returned: returned.map((doc) => doc.pageId), relevant: query.relevant });
        }
        if (returned.length && query.expectedTargetTypes?.length) {
          const topType = pageTypeById.get(returned[0].pageId);
          if (!topType || !query.expectedTargetTypes.includes(topType)) {
            wrongTypeTopResultCount += 1;
          }
        }
        if (returned.length && query.anchorId && returned[0].pageId === query.anchorId && !relevant.has(query.anchorId)) {
          anchorPageOverAnswerCount += 1;
        }
        if (returned.length && (query.distractorIds?.length ?? 0) > 0) {
          if (query.distractorIds?.includes(returned[0].pageId)) {
            distractorWinCount += 1;
          }
        }
        if (returned.length && (query.distractorGroups?.historical?.length ?? 0) > 0 && query.distractorGroups?.historical?.includes(returned[0].pageId)) {
          historicalOverCurrentCount += 1;
        }
        if (returned.length && (query.distractorGroups?.sibling?.length ?? 0) > 0 && query.distractorGroups?.sibling?.includes(returned[0].pageId)) {
          siblingDistractorWinCount += 1;
        }
        if (returned.length && (query.distractorGroups?.lexical?.length ?? 0) > 0 && query.distractorGroups?.lexical?.includes(returned[0].pageId)) {
          lexicalDistractorWinCount += 1;
        }
        if (query.requiresTimeline && r === 0) {
          timelineNeededButMissedCount += 1;
        }
        if (graphExplanation?.results.some((doc) => doc.reason.includes('current-truth')) && returned[0]?.reason?.some((reason) => reason.includes('contains:'))) {
          weakMentionBeatExplicitCount += 1;
        }
        if (query.anchorId && query.relationType && input.mode !== 'search-only') {
          const graphLinks = exportSnapshot.links.filter(
            (link) => link.fromId === query.anchorId && link.type === query.relationType && relevant.has(link.toId)
          );
          if (query.family) {
            const familyCoverage = familyGraphCoverage.get(query.family) ?? { covered: 0, total: 0 };
            familyCoverage.total += 1;
            if (graphLinks.length > 0) familyCoverage.covered += 1;
            familyGraphCoverage.set(query.family, familyCoverage);
          }
          if (graphLinks.length === 0) {
            graphEdgeMissingCount += 1;
          } else if (r === 0 || !returned.some((doc) => relevant.has(doc.pageId))) {
            graphEdgePresentButBadlyRankedCount += 1;
          }
          if (graphLinks.length > 0) {
            graphSupportedQueries += 1;
            if (graphLinks.some((link) => link.explicitReference || link.evidenceStrength === 'explicit-ref')) explicitSupportedQueries += 1;
            if (graphLinks.some((link) => link.evidenceKind === 'structured' || link.sourceSurface === 'structured')) structuredSupportedQueries += 1;
            if (graphLinks.some((link) => link.sourceSurface !== 'structured')) proseSupportedQueries += 1;
          }
        }
        perQuery.push({
          id: query.id,
          text: query.text,
          relevant: query.relevant,
          family: query.family,
          anchorId: query.anchorId,
          expectedTargetTypes: query.expectedTargetTypes,
          distractorIds: query.distractorIds,
          distractorGroups: query.distractorGroups,
          requiresTimeline: query.requiresTimeline,
          intentionallyAmbiguous: query.intentionallyAmbiguous,
          usesAlias: query.usesAlias,
          indirectPhrasing: query.indirectPhrasing,
          returned,
          precisionAtK: p,
          recallAtK: r,
          reciprocalRank: mrr,
          ndcgAtK: ndcg
        });
      }

      const result: EvalRunResult = {
        corpus: input.corpusName,
        mode: input.mode ?? 'graph-first-hybrid',
        lexicalBackend: input.lexicalBackend,
        queryCount: input.queries.length,
        k: input.k,
        precisionAtK: input.queries.length ? totalP / input.queries.length : 0,
        recallAtK: input.queries.length ? totalR / input.queries.length : 0,
        mrrAtK: input.queries.length ? totalMrr / input.queries.length : 0,
        ndcgAtK: input.queries.length ? totalNdcg / input.queries.length : 0,
        familyBreakdown: Object.fromEntries(
          [...familyMetrics.entries()].map(([family, values]) => [
            family,
            {
              queryCount: values.length,
              precisionAtK: mean(values.map((value) => value.p)),
              recallAtK: mean(values.map((value) => value.r)),
              mrrAtK: mean(values.map((value) => value.mrr)),
              ndcgAtK: mean(values.map((value) => value.ndcg)),
              passesFloor: meetsFloor(mean(values.map((value) => value.p)), mean(values.map((value) => value.r)))
            }
          ])
        ),
        corpusMetadata: {
          ...input.metadata,
          corpusSize: input.pages.length,
          queryCount: input.queries.length,
          averageCandidateDensity: input.queries.length ? totalCandidateDensity / input.queries.length : 0
        },
        diagnostics: {
          anchorResolutionFailures,
          anchorResolutionFailureRate: input.queries.length ? anchorResolutionFailures.length / input.queries.length : 0,
          wrongAnchorSelections,
          wrongAnchorSelectionRate: input.queries.length ? wrongAnchorSelections.length / input.queries.length : 0,
          wrongTypeTopResultCount,
          wrongTypeTopResultRate: input.queries.length ? wrongTypeTopResultCount / input.queries.length : 0,
          anchorPageOverAnswerCount,
          anchorPageOverAnswerRate: input.queries.length ? anchorPageOverAnswerCount / input.queries.length : 0,
          distractorWinCount,
          distractorWinRate: input.queries.length ? distractorWinCount / input.queries.length : 0,
          timelineNeededButMissedCount,
          timelineNeededButMissedRate: input.queries.length ? timelineNeededButMissedCount / input.queries.length : 0,
          historicalOverCurrentCount,
          historicalOverCurrentRate: input.queries.length ? historicalOverCurrentCount / input.queries.length : 0,
          weakMentionBeatExplicitCount,
          weakMentionBeatExplicitRate: input.queries.length ? weakMentionBeatExplicitCount / input.queries.length : 0,
          siblingDistractorWinCount,
          siblingDistractorWinRate: input.queries.length ? siblingDistractorWinCount / input.queries.length : 0,
          lexicalDistractorWinCount,
          lexicalDistractorWinRate: input.queries.length ? lexicalDistractorWinCount / input.queries.length : 0,
          graphEdgeMissingCount,
          graphEdgePresentButBadlyRankedCount,
          averageCandidateDensity: input.queries.length ? totalCandidateDensity / input.queries.length : 0,
          topFalsePositives: topFalsePositives.slice(0, 10)
        },
        extractionQuality: {
          explicitSupportRate: input.queries.length ? explicitSupportedQueries / input.queries.length : 0,
          structuredSupportRate: input.queries.length ? structuredSupportedQueries / input.queries.length : 0,
          proseSupportRate: input.queries.length ? proseSupportedQueries / input.queries.length : 0,
          graphLinkCoverageRate: input.queries.length ? graphSupportedQueries / input.queries.length : 0,
          familyGraphLinkCoverage: Object.fromEntries(
            [...familyGraphCoverage.entries()].map(([family, coverage]) => [
              family,
              coverage.total ? coverage.covered / coverage.total : 0
            ])
          )
        },
        perQuery
      };

      result.gates = buildBenchmarkGates(result);
      return result;
    }
  );
}

export interface RetrievalBenchmarkAdapter {
  search(input: {
    query: string;
    limit: number;
    mode: 'search-only' | 'graph-only' | 'graph-first-hybrid';
    lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
  }): Promise<{ query: string; mode: string; results: KnowledgeSearchResult[] }>;
  queryRelations(input: {
    query: string;
    limit: number;
    mode: 'graph-only';
    lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
  }): Promise<KnowledgeRelationQueryResult>;
  exportSnapshot(): Promise<KnowledgeExportSnapshot>;
}

async function scoreRetrievalBenchmark(
  input: {
    corpusName: string;
    pages: Array<{
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
    }>;
    queries: EvalQuery[];
    k: number;
    mode?: 'search-only' | 'graph-only' | 'graph-first-hybrid';
    lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
    metadata?: EvalCorpus['metadata'];
  },
  adapter: RetrievalBenchmarkAdapter
): Promise<EvalRunResult> {
  const benchmarkK = Math.min(input.k, Math.max(1, input.pages.length));
  const perQuery: EvalRunResult['perQuery'] = [];
  const familyMetrics = new Map<string, Array<{ p: number; r: number; mrr: number; ndcg: number }>>();
  const familyGraphCoverage = new Map<string, { covered: number; total: number }>();
  let totalP = 0;
  let totalR = 0;
  let totalMrr = 0;
  let totalNdcg = 0;
  const anchorResolutionFailures: string[] = [];
  const wrongAnchorSelections: string[] = [];
  let wrongTypeTopResultCount = 0;
  let anchorPageOverAnswerCount = 0;
  let distractorWinCount = 0;
  let timelineNeededButMissedCount = 0;
  let historicalOverCurrentCount = 0;
  let weakMentionBeatExplicitCount = 0;
  let siblingDistractorWinCount = 0;
  let lexicalDistractorWinCount = 0;
  let graphEdgeMissingCount = 0;
  let graphEdgePresentButBadlyRankedCount = 0;
  let totalCandidateDensity = 0;
  const topFalsePositives: Array<{ queryId: string; returned: string[]; relevant: string[] }> = [];
  const exportSnapshot = await adapter.exportSnapshot();
  const pageTypeById = new Map(input.pages.map((page) => [page.id, page.type]));
  let graphSupportedQueries = 0;
  let explicitSupportedQueries = 0;
  let structuredSupportedQueries = 0;
  let proseSupportedQueries = 0;
  const candidateLimit = Math.min(input.pages.length, Math.max(input.k * 4, 25));
  const explanationLimit = Math.min(candidateLimit, Math.max(input.k * 3, 15));

  for (const query of input.queries) {
    const search = await adapter.search({
      query: query.text,
      limit: candidateLimit,
      mode: input.mode ?? 'graph-first-hybrid',
      lexicalBackend: input.lexicalBackend
    });
    const graphExplanation = query.anchorId || query.relationType
      ? await adapter.queryRelations({
          query: query.text,
          limit: explanationLimit,
          mode: 'graph-only',
          lexicalBackend: input.lexicalBackend
        })
      : null;
    const returnedAll = searchResultDocs(search.results) as RankedDoc[];
    const returned = returnedAll.slice(0, input.k);
    const relevant = new Set(query.relevant);
    const grades = new Map<string, number>(
      Object.entries(query.grades ?? Object.fromEntries(query.relevant.map((id) => [id, 1])))
    );
    const p = precisionAtK(returned, relevant, benchmarkK);
    const r = recallAtK(returned, relevant, benchmarkK);
    const mrr = reciprocalRankAtK(returned, relevant, benchmarkK);
    const ndcg = ndcgAtK(returned, grades, benchmarkK);
    totalP += p;
    totalR += r;
    totalMrr += mrr;
    totalNdcg += ndcg;
    totalCandidateDensity += returnedAll.length;
    if (query.family) {
      const family = familyMetrics.get(query.family) ?? [];
      family.push({ p, r, mrr, ndcg });
      familyMetrics.set(query.family, family);
    }
    if (query.anchorId && graphExplanation && graphExplanation.classification.anchorId !== query.anchorId) {
      if (graphExplanation.classification.anchorId == null) anchorResolutionFailures.push(query.id);
      else wrongAnchorSelections.push(query.id);
    } else if (query.anchorId && input.mode !== 'search-only' && returned.length === 0) {
      anchorResolutionFailures.push(query.id);
    }
    if (returned.length && !relevant.has(returned[0].pageId)) {
      topFalsePositives.push({ queryId: query.id, returned: returned.map((doc) => doc.pageId), relevant: query.relevant });
    }
    if (returned.length && query.expectedTargetTypes?.length) {
      const topType = pageTypeById.get(returned[0].pageId);
      if (!topType || !query.expectedTargetTypes.includes(topType)) {
        wrongTypeTopResultCount += 1;
      }
    }
    if (returned.length && query.anchorId && returned[0].pageId === query.anchorId && !relevant.has(query.anchorId)) {
      anchorPageOverAnswerCount += 1;
    }
    if (returned.length && (query.distractorIds?.length ?? 0) > 0 && query.distractorIds?.includes(returned[0].pageId)) {
      distractorWinCount += 1;
    }
    if (returned.length && (query.distractorGroups?.historical?.length ?? 0) > 0 && query.distractorGroups?.historical?.includes(returned[0].pageId)) {
      historicalOverCurrentCount += 1;
    }
    if (returned.length && (query.distractorGroups?.sibling?.length ?? 0) > 0 && query.distractorGroups?.sibling?.includes(returned[0].pageId)) {
      siblingDistractorWinCount += 1;
    }
    if (returned.length && (query.distractorGroups?.lexical?.length ?? 0) > 0 && query.distractorGroups?.lexical?.includes(returned[0].pageId)) {
      lexicalDistractorWinCount += 1;
    }
    if (query.requiresTimeline && r === 0) {
      timelineNeededButMissedCount += 1;
    }
    if (graphExplanation?.results.some((doc) => doc.reason.includes('current-truth')) && returned[0]?.reason?.some((reason) => reason.includes('contains:'))) {
      weakMentionBeatExplicitCount += 1;
    }
    if (query.anchorId && query.relationType && input.mode !== 'search-only') {
      const graphLinks = exportSnapshot.links.filter(
        (link) => link.fromId === query.anchorId && link.type === query.relationType && relevant.has(link.toId)
      );
      if (query.family) {
        const familyCoverage = familyGraphCoverage.get(query.family) ?? { covered: 0, total: 0 };
        familyCoverage.total += 1;
        if (graphLinks.length > 0) familyCoverage.covered += 1;
        familyGraphCoverage.set(query.family, familyCoverage);
      }
      if (graphLinks.length === 0) {
        graphEdgeMissingCount += 1;
      } else if (r === 0 || !returned.some((doc) => relevant.has(doc.pageId))) {
        graphEdgePresentButBadlyRankedCount += 1;
      }
      if (graphLinks.length > 0) {
        graphSupportedQueries += 1;
        if (graphLinks.some((link) => link.explicitReference || link.evidenceStrength === 'explicit-ref')) explicitSupportedQueries += 1;
        if (graphLinks.some((link) => link.evidenceKind === 'structured' || link.sourceSurface === 'structured')) structuredSupportedQueries += 1;
        if (graphLinks.some((link) => link.sourceSurface !== 'structured')) proseSupportedQueries += 1;
      }
    }
    perQuery.push({
      id: query.id,
      text: query.text,
      relevant: query.relevant,
      family: query.family,
      anchorId: query.anchorId,
      expectedTargetTypes: query.expectedTargetTypes,
      distractorIds: query.distractorIds,
      distractorGroups: query.distractorGroups,
      requiresTimeline: query.requiresTimeline,
      intentionallyAmbiguous: query.intentionallyAmbiguous,
      usesAlias: query.usesAlias,
      indirectPhrasing: query.indirectPhrasing,
      returned,
      precisionAtK: p,
      recallAtK: r,
      reciprocalRank: mrr,
      ndcgAtK: ndcg
    });
  }

  const result: EvalRunResult = {
    corpus: input.corpusName,
    mode: input.mode ?? 'graph-first-hybrid',
    lexicalBackend: input.lexicalBackend,
    queryCount: input.queries.length,
    k: input.k,
    precisionAtK: input.queries.length ? totalP / input.queries.length : 0,
    recallAtK: input.queries.length ? totalR / input.queries.length : 0,
    mrrAtK: input.queries.length ? totalMrr / input.queries.length : 0,
    ndcgAtK: input.queries.length ? totalNdcg / input.queries.length : 0,
    familyBreakdown: Object.fromEntries(
      [...familyMetrics.entries()].map(([family, values]) => [
        family,
        {
          queryCount: values.length,
          precisionAtK: mean(values.map((value) => value.p)),
          recallAtK: mean(values.map((value) => value.r)),
          mrrAtK: mean(values.map((value) => value.mrr)),
          ndcgAtK: mean(values.map((value) => value.ndcg)),
          passesFloor: meetsFloor(mean(values.map((value) => value.p)), mean(values.map((value) => value.r)))
        }
      ])
    ),
    corpusMetadata: {
      ...input.metadata,
      corpusSize: input.pages.length,
      queryCount: input.queries.length,
      averageCandidateDensity: input.queries.length ? totalCandidateDensity / input.queries.length : 0
    },
    diagnostics: {
      anchorResolutionFailures,
      anchorResolutionFailureRate: input.queries.length ? anchorResolutionFailures.length / input.queries.length : 0,
      wrongAnchorSelections,
      wrongAnchorSelectionRate: input.queries.length ? wrongAnchorSelections.length / input.queries.length : 0,
      wrongTypeTopResultCount,
      wrongTypeTopResultRate: input.queries.length ? wrongTypeTopResultCount / input.queries.length : 0,
      anchorPageOverAnswerCount,
      anchorPageOverAnswerRate: input.queries.length ? anchorPageOverAnswerCount / input.queries.length : 0,
      distractorWinCount,
      distractorWinRate: input.queries.length ? distractorWinCount / input.queries.length : 0,
      timelineNeededButMissedCount,
      timelineNeededButMissedRate: input.queries.length ? timelineNeededButMissedCount / input.queries.length : 0,
      historicalOverCurrentCount,
      historicalOverCurrentRate: input.queries.length ? historicalOverCurrentCount / input.queries.length : 0,
      weakMentionBeatExplicitCount,
      weakMentionBeatExplicitRate: input.queries.length ? weakMentionBeatExplicitCount / input.queries.length : 0,
      siblingDistractorWinCount,
      siblingDistractorWinRate: input.queries.length ? siblingDistractorWinCount / input.queries.length : 0,
      lexicalDistractorWinCount,
      lexicalDistractorWinRate: input.queries.length ? lexicalDistractorWinCount / input.queries.length : 0,
      graphEdgeMissingCount,
      graphEdgePresentButBadlyRankedCount,
      averageCandidateDensity: input.queries.length ? totalCandidateDensity / input.queries.length : 0,
      topFalsePositives: topFalsePositives.slice(0, 10)
    },
    extractionQuality: {
      explicitSupportRate: input.queries.length ? explicitSupportedQueries / input.queries.length : 0,
      structuredSupportRate: input.queries.length ? structuredSupportedQueries / input.queries.length : 0,
      proseSupportRate: input.queries.length ? proseSupportedQueries / input.queries.length : 0,
      graphLinkCoverageRate: input.queries.length ? graphSupportedQueries / input.queries.length : 0,
      familyGraphLinkCoverage: Object.fromEntries(
        [...familyGraphCoverage.entries()].map(([family, coverage]) => [
          family,
          coverage.total ? coverage.covered / coverage.total : 0
        ])
      )
    },
    perQuery
  };

  result.gates = buildBenchmarkGates(result);
  return result;
}

export function extractRankedDocs(results: KnowledgeSearchResult[]): RankedDoc[] {
  return searchResultDocs(results) as RankedDoc[];
}

function buildBenchmarkGates(result: EvalRunResult): EvalRunResult['gates'] {
  const tier = result.corpusMetadata?.benchmarkTier;
  if (tier === 'product-core') {
    const meets = (actual: number, threshold: number) => actual + 1e-9 >= threshold;
    const overall = [
      gate('V3 floor P@5', result.precisionAtK, '>= 35%', meets(result.precisionAtK, 0.35)),
      gate('V3 floor R@5', result.recallAtK, '>= 90%', meets(result.recallAtK, 0.9)),
      gate('V3 floor MRR@5', result.mrrAtK, '>= 85%', meets(result.mrrAtK, 0.85)),
      gate('V3 floor nDCG@5', result.ndcgAtK, '>= 90%', meets(result.ndcgAtK, 0.9)),
      gate('Anchor resolution failures', result.diagnostics?.anchorResolutionFailureRate ?? 0, '<= 10%', (result.diagnostics?.anchorResolutionFailureRate ?? 0) <= 0.1),
      gate('Wrong anchor selections', result.diagnostics?.wrongAnchorSelectionRate ?? 0, '<= 10%', (result.diagnostics?.wrongAnchorSelectionRate ?? 0) <= 0.1),
      gate('Anchor page over answer', result.diagnostics?.anchorPageOverAnswerRate ?? 0, '<= 15%', (result.diagnostics?.anchorPageOverAnswerRate ?? 0) <= 0.15)
    ];
    const perFamily = Object.entries(result.familyBreakdown ?? {}).map(([family, metrics]) => ({
      family,
      passed: meets(metrics.precisionAtK, 0.25) && meets(metrics.recallAtK, 0.8),
      precisionAtK: metrics.precisionAtK,
      recallAtK: metrics.recallAtK
    }));
    const strong =
      meets(result.precisionAtK, 0.42) &&
      meets(result.recallAtK, 0.93) &&
      meets(result.mrrAtK, 0.9) &&
      meets(result.ndcgAtK, 0.93);
    const stretch =
      meets(result.precisionAtK, 0.5) &&
      meets(result.recallAtK, 0.95) &&
      meets(result.mrrAtK, 0.93) &&
      meets(result.ndcgAtK, 0.95);
    const floor = overall.every((entry) => entry.passed) && perFamily.every((entry) => entry.passed);
    return {
      benchmarkTier: tier,
      overall,
      perFamily,
      passed: floor,
      milestone: stretch ? 'stretch-reached' : strong ? 'strong-reached' : floor ? 'floor-reached' : 'below-floor'
    };
  }
  if (tier === 'external-reference') {
    const guardrails = [
      gate('GBrain guardrail P@5', result.precisionAtK, '>= 26%', result.precisionAtK >= 0.26),
      gate('GBrain guardrail R@5', result.recallAtK, '>= 82%', result.recallAtK >= 0.82),
      gate('GBrain stretch P@5', result.precisionAtK, '>= 32%', result.precisionAtK >= 0.32),
      gate('GBrain stretch R@5', result.recallAtK, '>= 88%', result.recallAtK >= 0.88)
    ];
    return {
      benchmarkTier: tier,
      overall: [],
      guardrails,
      passed: guardrails[0].passed && guardrails[1].passed,
      milestone: 'guardrail-only'
    };
  }
  return {
    benchmarkTier: tier,
    overall: [],
    passed: true,
    milestone: 'guardrail-only'
  };
}

function gate(label: string, actual: number, expected: string, passed: boolean) {
  return { label, actual, expected, passed };
}

function meetsFloor(precisionAtK: number, recallAtK: number) {
  return precisionAtK + 1e-9 >= 0.25 && recallAtK + 1e-9 >= 0.8;
}
