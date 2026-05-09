import { loadCoreSixFixtures } from './loaders.js';
import { searchResultDocs, withSeededKnowledgeBase } from './shared.js';
import { mean, passThresholds, recallAtK, reciprocalRankAtK, type EvalCategoryResult } from './types.js';

export async function runIdentityCategory(input: { fixturesPath?: string; k?: number } = {}): Promise<EvalCategoryResult> {
  const loaded = loadCoreSixFixtures(input.fixturesPath ?? new URL('../data/core-six', import.meta.url).pathname);
  const k = input.k ?? 5;
  return withSeededKnowledgeBase(loaded.seed, async ({ service }) => {
    const recalls: number[] = [];
    const mrrs: number[] = [];
    const safePrecision: number[] = [];
    const falseMerges: number[] = [];
    const failures: EvalCategoryResult['failures'] = [];

    for (const testCase of loaded.identity) {
      const search = await service.search({
        query: testCase.query,
        limit: k,
        assistQuery: true
      });
      const ranked = searchResultDocs(search.results);
      const relevant = new Set(testCase.relevant);
      const disallowed = new Set(testCase.disallowed ?? []);
      const top = ranked[0];
      const recall = recallAtK(ranked, relevant, k);
      const mrr = reciprocalRankAtK(ranked, relevant, k);
      const precise = top && relevant.has(top.pageId) ? 1 : 0;
      const falseMerge = top && disallowed.has(top.pageId) ? 1 : 0;
      recalls.push(recall);
      mrrs.push(mrr);
      safePrecision.push(precise);
      falseMerges.push(falseMerge);
      if (recall < 1 || precise === 0 || falseMerge > 0) {
        failures.push({
          caseId: testCase.id,
          summary: 'Identity query did not rank the correct entity safely.',
          expected: { relevant: testCase.relevant, disallowed: testCase.disallowed ?? [] },
          actual: ranked
        });
      }
    }

    const category: EvalCategoryResult = {
      category: 'identity',
      corpus: loaded.corpusName,
      provenance: loaded.corpusProvenance,
      caseCount: loaded.identity.length,
      metrics: {
        recallAtK: mean(recalls),
        mrrAtK: mean(mrrs),
        ambiguitySafePrecision: mean(safePrecision),
        falseMergeRate: 1 - mean(falseMerges.map((value) => (value > 0 ? 0 : 1)))
      },
      thresholds: {
        recallAtK: 0.8,
        mrrAtK: 0.7,
        ambiguitySafePrecision: 0.8,
        falseMergeRate: -0
      },
      passed: false,
      failures,
      sampleSize: Math.min(5, loaded.identity.length)
    };
    category.passed = passThresholds(category.metrics, category.thresholds);
    return category;
  });
}
