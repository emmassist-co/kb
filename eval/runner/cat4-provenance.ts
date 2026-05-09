import { loadCoreSixFixtures } from './loaders.js';
import { searchResultDocs, withSeededKnowledgeBase } from './shared.js';
import { mean, passThresholds, type EvalCategoryResult } from './types.js';

export async function runProvenanceCategory(input: { fixturesPath?: string; k?: number } = {}): Promise<EvalCategoryResult> {
  const loaded = loadCoreSixFixtures(input.fixturesPath ?? new URL('../data/core-six', import.meta.url).pathname);
  const k = input.k ?? 5;
  return withSeededKnowledgeBase(loaded.seed, async ({ service }) => {
    const sourceHitScores: number[] = [];
    const exactEvidenceScores: number[] = [];
    const unsupportedScores: number[] = [];
    const overclaimScores: number[] = [];
    const failures: EvalCategoryResult['failures'] = [];

    for (const testCase of loaded.provenanceCases) {
      const search = await service.search({
        query: testCase.claim,
        limit: k,
        assistQuery: true
      });
      const ranked = searchResultDocs(search.results);
      const cited = [...new Set(ranked.flatMap((doc) => doc.sourceIds))];
      const top = ranked[0];
      const expected = new Set(testCase.expectedSourceIds);
      const alternates = new Set(testCase.allowedAlternateSourceIds ?? []);
      const sourceHit = expected.size === 0
        ? cited.length === 0 || !hasEvidenceField(top?.matchedFields ?? [])
        : [...expected].some((sourceId) => cited.includes(sourceId) || alternates.has(sourceId));
      const exactEvidence = expected.size === 0
        ? sourceHit
        : [...expected].every((sourceId) => cited.includes(sourceId) || alternates.has(sourceId));
      const unsupported = testCase.unsupported
        ? cited.length === 0 || !hasEvidenceField(top?.matchedFields ?? [])
        : true;
      const overclaim = testCase.unsupported && top && hasEvidenceField(top.matchedFields) ? 0 : 1;

      sourceHitScores.push(sourceHit ? 1 : 0);
      exactEvidenceScores.push(exactEvidence ? 1 : 0);
      unsupportedScores.push(unsupported ? 1 : 0);
      overclaimScores.push(overclaim);

      if (!sourceHit || !exactEvidence || !unsupported || overclaim === 0) {
        failures.push({
          caseId: testCase.id,
          summary: 'Provenance lookup missed the required supporting source or overclaimed support.',
          expected: {
            sourceIds: testCase.expectedSourceIds,
            evidenceMode: testCase.evidenceMode,
            unsupported: testCase.unsupported ?? false
          },
          actual: ranked
        });
      }
    }

    const category: EvalCategoryResult = {
      category: 'provenance',
      corpus: loaded.corpusName,
      provenance: loaded.corpusProvenance,
      caseCount: loaded.provenanceCases.length,
      metrics: {
        sourceHitRate: mean(sourceHitScores),
        exactEvidenceMatch: mean(exactEvidenceScores),
        unsupportedClaimRefusalRate: mean(unsupportedScores),
        overclaimRate: 1 - mean(overclaimScores)
      },
      thresholds: {
        sourceHitRate: 0.75,
        exactEvidenceMatch: 0.75,
        unsupportedClaimRefusalRate: 0.75,
        overclaimRate: -0
      },
      passed: false,
      failures,
      sampleSize: Math.min(5, loaded.provenanceCases.length)
    };
    category.passed = passThresholds(category.metrics, category.thresholds);
    return category;
  });
}

function hasEvidenceField(fields: string[]): boolean {
  return fields.some((field) => ['truth', 'timeline', 'summary', 'content'].includes(field));
}
