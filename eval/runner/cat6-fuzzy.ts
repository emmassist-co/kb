import { loadCoreSixFixtures } from './loaders.js';
import { searchResultDocs, withSeededKnowledgeBase } from './shared.js';
import { mean, passThresholds, recallAtK, reciprocalRankAtK, type EvalCategoryResult } from './types.js';

export async function runFuzzyCategory(input: { fixturesPath?: string; k?: number } = {}): Promise<EvalCategoryResult> {
  const loaded = loadCoreSixFixtures(input.fixturesPath ?? new URL('../data/core-six', import.meta.url).pathname);
  const k = input.k ?? 5;
  return withSeededKnowledgeBase(loaded.seed, async ({ service }) => {
    const recalls: number[] = [];
    const mrrs: number[] = [];
    const explainability: number[] = [];
    const ambiguityCalibration: number[] = [];
    const failures: EvalCategoryResult['failures'] = [];

    for (const testCase of loaded.fuzzy) {
      const search = await service.search({
        query: testCase.query,
        limit: k,
        assistQuery: true
      });
      const ranked = searchResultDocs(search.results);
      const relevant = new Set(testCase.relevant);
      const top = ranked[0];
      const recall = recallAtK(ranked, relevant, k);
      const mrr = reciprocalRankAtK(ranked, relevant, k);
      const explainable = top && (top.matchedFields?.length ?? 0) > 0 ? 1 : 0;
      const calibrated = testCase.allowAmbiguous ? (top?.ambiguous ? 1 : 0) : 1;
      recalls.push(recall);
      mrrs.push(mrr);
      explainability.push(explainable);
      ambiguityCalibration.push(calibrated);
      if (recall < 1 || explainable === 0 || calibrated === 0) {
        failures.push({
          caseId: testCase.id,
          summary: 'Fuzzy query did not return the correct candidate with an explainable result.',
          expected: testCase.relevant,
          actual: ranked
        });
      }
    }

    const category: EvalCategoryResult = {
      category: 'fuzzy',
      corpus: loaded.corpusName,
      provenance: loaded.corpusProvenance,
      caseCount: loaded.fuzzy.length,
      metrics: {
        recallAtK: mean(recalls),
        mrrAtK: mean(mrrs),
        explanationAvailability: mean(explainability),
        confidenceCalibration: mean(ambiguityCalibration)
      },
      thresholds: {
        recallAtK: 0.75,
        mrrAtK: 0.6,
        explanationAvailability: 1,
        confidenceCalibration: 0.75
      },
      passed: false,
      failures,
      sampleSize: Math.min(5, loaded.fuzzy.length)
    };
    category.passed = passThresholds(category.metrics, category.thresholds);
    return category;
  });
}
