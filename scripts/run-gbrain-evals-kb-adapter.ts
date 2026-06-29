import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KbAdapter, type KbAdapterQueryDiagnostics } from '../eval/adapters/gbrain-evals/kb-adapter.js';
import type { Page, Query, RankedDoc } from '../eval/adapters/gbrain-evals/upstream-contract.js';
import { sanitizePage, sanitizeQuery } from '../eval/adapters/gbrain-evals/upstream-contract.js';
import { ndcgAtK, precisionAtK, recallAtK, reciprocalRankAtK } from '../eval/runner/types.js';

interface QueryContract {
  queries: Array<{
    id: string;
    text: string;
    relevant: string[];
    family?: string;
  }>;
}

interface TierContract {
  queries: Query[];
}

export interface GbrainSnapshotProgressEvent {
  stage: 'load' | 'init' | 'query' | 'complete';
  resultBudgetMode: 'default' | 'single-answer-tight' | 'adaptive';
  querySet: 'all' | 'canonical' | 'fuzzy' | 'synthetic';
  queryId?: string;
  index?: number;
  total?: number;
}

interface SnapshotRunOptions {
  onProgress?: (event: GbrainSnapshotProgressEvent) => void;
}

export async function runGbrainEvalsKbAdapterSnapshot(
  repoRoot: string,
  resultBudgetMode: 'default' | 'single-answer-tight' | 'adaptive' = 'default',
  querySet: 'all' | 'canonical' | 'fuzzy' | 'synthetic' = 'all',
  options: SnapshotRunOptions = {}
) {
  const corpusRoot = path.join(repoRoot, 'eval/data/gbrain-world-v1');
  options.onProgress?.({ stage: 'load', resultBudgetMode, querySet });
  const pages = loadPages(corpusRoot);
  const queries = loadPublicQueries(corpusRoot, querySet);
  const adapter = new KbAdapter();
  options.onProgress?.({ stage: 'init', resultBudgetMode, querySet, total: queries.length });
  const state = await adapter.init(pages.map(sanitizePage), {
    name: adapter.name,
    k: 5,
    mode: 'graph-first-hybrid',
    resultBudgetMode
  });

  try {
    const perQuery = [];
    const diagnostics: KbAdapterQueryDiagnostics[] = [];
    let totalP = 0;
    let totalR = 0;
    let totalMrr = 0;
    let totalNdcg = 0;

    for (const [index, query] of queries.entries()) {
      options.onProgress?.({
        stage: 'query',
        resultBudgetMode,
        querySet,
        queryId: query.id,
        index: index + 1,
        total: queries.length
      });
      const returned = await adapter.query(sanitizeQuery(query), state);
      const relevant = new Set(query.gold.relevant ?? []);
      const grades = new Map<string, number>(Object.entries(query.gold.grades ?? Object.fromEntries([...relevant].map((slug) => [slug, 1]))));
      const p = precisionAtK(convertRankedDocs(returned), relevant, 5);
      const r = recallAtK(convertRankedDocs(returned), relevant, 5);
      const mrr = reciprocalRankAtK(convertRankedDocs(returned), relevant, 5);
      const ndcg = ndcgAtK(convertRankedDocs(returned), grades, 5);
      diagnostics.push(await adapter.diagnoseQuery(sanitizeQuery(query), state));
      totalP += p;
      totalR += r;
      totalMrr += mrr;
      totalNdcg += ndcg;
      perQuery.push({
        id: query.id,
        tier: query.tier,
        family: diagnostics.at(-1)?.queryFamily ?? inferQueryFamily(query),
        residualBucket: diagnostics.at(-1)?.residualBucket ?? 'none',
        firstFailingStage: diagnostics.at(-1)?.firstFailingStage ?? 'none',
        topResultSupportSurface: diagnostics.at(-1)?.topResult?.supportSurface ?? null,
        topResultReason: diagnostics.at(-1)?.topResult?.reason ?? [],
        topResultEvidenceChannels: uniqueValues((diagnostics.at(-1)?.topResult?.evidence ?? []).map((entry) => entry.channel)),
        anchorSupportSurface: diagnostics.at(-1)?.anchorSearch?.supportSurface ?? null,
        text: query.text,
        relevant: [...relevant],
        returned: returned.map((doc) => doc.page_id),
        precisionAt5: p,
        recallAt5: r,
        mrrAt5: mrr,
        ndcgAt5: ndcg
      });
    }

    const snapshot = {
      adapter: adapter.name,
      corpus: 'gbrain-world-v1',
      resultBudgetMode,
      queryCount: queries.length,
      precisionAt5: totalP / queries.length,
      recallAt5: totalR / queries.length,
      mrrAt5: totalMrr / queries.length,
      ndcgAt5: totalNdcg / queries.length,
      diagnostics: summarizeDiagnostics(diagnostics),
      familyMetrics: summarizeFamilyMetrics(perQuery),
      residualBucketMetrics: summarizeResidualBucketMetrics(perQuery),
      queryDetails: perQuery,
      families: Object.fromEntries(
        queries.reduce((map, query) => {
          map.set(inferQueryFamily(query), (map.get(inferQueryFamily(query)) ?? 0) + 1);
          return map;
        }, new Map<string, number>())
      ),
      sample: perQuery.slice(0, 10)
    };
    options.onProgress?.({ stage: 'complete', resultBudgetMode, querySet, total: queries.length });
    return snapshot;
  } finally {
    await adapter.teardown?.(state);
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resultBudgetMode =
    process.env.KB_GBRAIN_RESULT_BUDGET_MODE === 'single-answer-tight'
      ? 'single-answer-tight'
      : process.env.KB_GBRAIN_RESULT_BUDGET_MODE === 'adaptive'
        ? 'adaptive'
        : 'default';
  const querySet = coerceQuerySet(process.env.KB_GBRAIN_QUERY_SET);
  const compact = String(process.env.KB_GBRAIN_COMPACT ?? '').toLowerCase() === 'true';
  const shouldLogProgress = String(process.env.KB_GBRAIN_PROGRESS ?? '').toLowerCase() === 'true';
  const snapshot = await runGbrainEvalsKbAdapterSnapshot(repoRoot, resultBudgetMode, querySet, {
    onProgress: shouldLogProgress
      ? (event) => {
          if (event.stage === 'query') {
            console.error(
              `[gbrain-kb] ${event.resultBudgetMode} ${event.querySet} ${event.index}/${event.total} ${event.queryId}`
            );
            return;
          }

          console.error(
            `[gbrain-kb] ${event.resultBudgetMode} ${event.querySet} ${event.stage}${typeof event.total === 'number' ? ` total=${event.total}` : ''}`
          );
        }
      : undefined
  });
  const output = compact
    ? {
        ...snapshot,
        queryDetails: undefined,
        sample: undefined,
        diagnostics: {
          ...snapshot.diagnostics,
          sample: undefined
        }
      }
    : snapshot;
  console.log(JSON.stringify(output, null, 2));
}

function summarizeDiagnostics(diagnostics: KbAdapterQueryDiagnostics[]) {
  return {
    relationQueryCount: diagnostics.filter((entry) => entry.relationType).length,
    degradedCount: diagnostics.filter((entry) => entry.degraded).length,
    semanticEligibleCount: diagnostics.filter((entry) => entry.semanticEligible).length,
    semanticUsedCount: diagnostics.filter((entry) => entry.semanticUsed).length,
    zeroTraversedLinkCount: diagnostics.filter((entry) => entry.relationType && entry.traversedLinkCount === 0).length,
    emptyResultCount: diagnostics.filter((entry) => entry.resultCount === 0).length,
    anchorFoundCount: diagnostics.filter((entry) => entry.anchorId).length,
    anchorSupportSurfaces: countSupportSurfaces(diagnostics.map((entry) => entry.anchorSearch?.supportSurface ?? null)),
    topResultSupportSurfaces: countSupportSurfaces(diagnostics.map((entry) => entry.topResult?.supportSurface ?? null)),
    resultBudgetModes: countSupportSurfaces(diagnostics.map((entry) => entry.resultBudgetMode)),
    residualBuckets: countSupportSurfaces(diagnostics.map((entry) => entry.residualBucket)),
    firstFailingStages: countSupportSurfaces(diagnostics.map((entry) => entry.firstFailingStage)),
    byQueryFamily: Object.fromEntries(
      [...diagnostics.reduce((map, entry) => {
        const current = map.get(entry.queryFamily) ?? {
          queries: 0,
          degraded: 0,
          semanticEligible: 0,
          semanticUsed: 0,
          emptyResults: 0,
          zeroTraversedLinks: 0,
          residualBuckets: new Map<string, number>()
        };
        current.queries += 1;
        if (entry.degraded) current.degraded += 1;
        if (entry.semanticEligible) current.semanticEligible += 1;
        if (entry.semanticUsed) current.semanticUsed += 1;
        if (entry.resultCount === 0) current.emptyResults += 1;
        if (entry.relationType && entry.traversedLinkCount === 0) current.zeroTraversedLinks += 1;
        current.residualBuckets.set(entry.residualBucket, (current.residualBuckets.get(entry.residualBucket) ?? 0) + 1);
        map.set(entry.queryFamily, current);
        return map;
      }, new Map<string, { queries: number; degraded: number; semanticEligible: number; semanticUsed: number; emptyResults: number; zeroTraversedLinks: number; residualBuckets: Map<string, number> }>())].map(([family, value]) => [
        family,
        {
          queries: value.queries,
          degraded: value.degraded,
          semanticEligible: value.semanticEligible,
          semanticUsed: value.semanticUsed,
          emptyResults: value.emptyResults,
          zeroTraversedLinks: value.zeroTraversedLinks,
          residualBuckets: Object.fromEntries(value.residualBuckets)
        }
      ])
    ),
    byRelationType: Object.fromEntries(
      diagnostics.reduce((map, entry) => {
        if (!entry.relationType) return map;
        const current = map.get(entry.relationType) ?? { queries: 0, degraded: 0, zeroTraversedLinks: 0, emptyResults: 0 };
        current.queries += 1;
        if (entry.degraded) current.degraded += 1;
        if (entry.traversedLinkCount === 0) current.zeroTraversedLinks += 1;
        if (entry.resultCount === 0) current.emptyResults += 1;
        map.set(entry.relationType, current);
        return map;
      }, new Map<string, { queries: number; degraded: number; zeroTraversedLinks: number; emptyResults: number }>())
    ),
    sample: diagnostics.slice(0, 10)
  };
}

function summarizeFamilyMetrics(
  perQuery: Array<{
    family: string;
    residualBucket: string;
    precisionAt5: number;
    recallAt5: number;
    mrrAt5: number;
    ndcgAt5: number;
  }>
) {
  return Object.fromEntries(
    [
      ...perQuery.reduce((map, entry) => {
        const current = map.get(entry.family) ?? {
          queryCount: 0,
          precisionAt5: 0,
          recallAt5: 0,
          mrrAt5: 0,
          ndcgAt5: 0,
          residualBuckets: new Map<string, number>()
        };
        current.queryCount += 1;
        current.precisionAt5 += entry.precisionAt5;
        current.recallAt5 += entry.recallAt5;
        current.mrrAt5 += entry.mrrAt5;
        current.ndcgAt5 += entry.ndcgAt5;
        current.residualBuckets.set(entry.residualBucket, (current.residualBuckets.get(entry.residualBucket) ?? 0) + 1);
        map.set(entry.family, current);
        return map;
      }, new Map<string, { queryCount: number; precisionAt5: number; recallAt5: number; mrrAt5: number; ndcgAt5: number; residualBuckets: Map<string, number> }>()).entries()
    ].map(([family, metrics]) => [
      family,
      {
        queryCount: metrics.queryCount,
        precisionAt5: metrics.precisionAt5 / metrics.queryCount,
        recallAt5: metrics.recallAt5 / metrics.queryCount,
        mrrAt5: metrics.mrrAt5 / metrics.queryCount,
        ndcgAt5: metrics.ndcgAt5 / metrics.queryCount,
        residualBuckets: Object.fromEntries(metrics.residualBuckets)
      }
    ])
  );
}

function summarizeResidualBucketMetrics(
  perQuery: Array<{
    family: string;
    residualBucket: string;
    precisionAt5: number;
    recallAt5: number;
    mrrAt5: number;
    ndcgAt5: number;
  }>
) {
  return Object.fromEntries(
    [
      ...perQuery.reduce((map, entry) => {
        const current = map.get(entry.residualBucket) ?? {
          queryCount: 0,
          precisionAt5: 0,
          recallAt5: 0,
          mrrAt5: 0,
          ndcgAt5: 0,
          families: new Map<string, number>()
        };
        current.queryCount += 1;
        current.precisionAt5 += entry.precisionAt5;
        current.recallAt5 += entry.recallAt5;
        current.mrrAt5 += entry.mrrAt5;
        current.ndcgAt5 += entry.ndcgAt5;
        current.families.set(entry.family, (current.families.get(entry.family) ?? 0) + 1);
        map.set(entry.residualBucket, current);
        return map;
      }, new Map<string, { queryCount: number; precisionAt5: number; recallAt5: number; mrrAt5: number; ndcgAt5: number; families: Map<string, number> }>()).entries()
    ].map(([bucket, metrics]) => [
      bucket,
      {
        queryCount: metrics.queryCount,
        precisionAt5: metrics.precisionAt5 / metrics.queryCount,
        recallAt5: metrics.recallAt5 / metrics.queryCount,
        mrrAt5: metrics.mrrAt5 / metrics.queryCount,
        ndcgAt5: metrics.ndcgAt5 / metrics.queryCount,
        families: Object.fromEntries(metrics.families)
      }
    ])
  );
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function countSupportSurfaces(values: Array<string | null>) {
  return Object.fromEntries(
    values.reduce((map, value) => {
      if (!value) return map;
      map.set(value, (map.get(value) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  );
}

function inferQueryFamily(query: Query): string {
  const tags = Array.isArray(query.tags) ? query.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0) : [];
  if (query.tier === 'medium') return tags[0] ?? 'canonical-relational';
  if (query.tier === 'fuzzy') return `fuzzy:${tags[0] ?? 'unlabeled'}`;
  if (query.tier === 'externally-authored') return `synthetic:${tags[0] ?? 'unlabeled'}`;
  return tags[0] ?? query.tier;
}

export function loadPages(rootDir: string): Page[] {
  return readdirSync(rootDir)
    .filter(
      (entry) =>
        entry.endsWith('.json') &&
        !entry.startsWith('_') &&
        entry !== 'calibration.json' &&
        entry !== 'canonical-relational-queries.json' &&
        entry !== 'tier5-fuzzy-queries.json' &&
        entry !== 'tier5_5-synthetic-queries.json'
    )
    .map((entry) => JSON.parse(readFileSync(path.join(rootDir, entry), 'utf8')) as Page);
}

export function loadPublicQueries(rootDir: string, querySet: 'all' | 'canonical' | 'fuzzy' | 'synthetic'): Query[] {
  const canonical = JSON.parse(readFileSync(path.join(rootDir, 'canonical-relational-queries.json'), 'utf8')) as QueryContract;
  const fuzzy = JSON.parse(readFileSync(path.join(rootDir, 'tier5-fuzzy-queries.json'), 'utf8')) as TierContract;
  const synthetic = JSON.parse(readFileSync(path.join(rootDir, 'tier5_5-synthetic-queries.json'), 'utf8')) as TierContract;

  const canonicalQueries: Query[] = canonical.queries.map((query) => ({
    id: query.id,
    tier: 'medium',
    text: query.text,
    expected_output_type: 'cited-source-pages',
    gold: {
      relevant: query.relevant.map(denormalizeSlug),
      grades: Object.fromEntries(query.relevant.map((id) => [denormalizeSlug(id), 1]))
    },
    tags: query.family ? [query.family] : undefined
  }));

  const retrievalCompatible = (queries: Query[]) =>
    queries.filter((query) => query.expected_output_type === 'cited-source-pages' && (query.gold.relevant?.length ?? 0) > 0);

  if (querySet === 'canonical') {
    return canonicalQueries;
  }
  if (querySet === 'fuzzy') {
    return retrievalCompatible(fuzzy.queries);
  }
  if (querySet === 'synthetic') {
    return retrievalCompatible(synthetic.queries);
  }

  return [...canonicalQueries, ...retrievalCompatible(fuzzy.queries), ...retrievalCompatible(synthetic.queries)];
}

export function coerceQuerySet(value: unknown): 'all' | 'canonical' | 'fuzzy' | 'synthetic' {
  return value === 'canonical' || value === 'fuzzy' || value === 'synthetic' ? value : 'all';
}

function convertRankedDocs(docs: RankedDoc[]): Array<{ pageId: string; score: number; rank: number }> {
  return docs.map((doc) => ({
    pageId: doc.page_id,
    score: doc.score,
    rank: doc.rank
  }));
}

function denormalizeSlug(id: string): string {
  return id.replace(/__/g, '/');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
