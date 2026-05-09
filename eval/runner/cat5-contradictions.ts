import type { KnowledgeExportSnapshot } from '../../packages/kb-core/src/types.js';
import { loadCoreSixFixtures } from './loaders.js';
import { withSeededKnowledgeBase } from './shared.js';
import { mean, passThresholds, type EvalCategoryResult } from './types.js';

export async function runContradictionsCategory(input: { fixturesPath?: string } = {}): Promise<EvalCategoryResult> {
  const loaded = loadCoreSixFixtures(input.fixturesPath ?? new URL('../data/core-six', import.meta.url).pathname);
  return withSeededKnowledgeBase(loaded.seed, async ({ snapshot }) => {
    const exported = await snapshot();
    const detectionScores: number[] = [];
    const winnerScores: number[] = [];
    const uncertaintyScores: number[] = [];
    const certaintyScores: number[] = [];
    const failures: EvalCategoryResult['failures'] = [];

    for (const testCase of loaded.contradictions) {
      const evaluation = evaluateContradictionCase(exported, testCase);
      detectionScores.push(evaluation.detected ? 1 : 0);
      winnerScores.push(evaluation.winnerCorrect ? 1 : 0);
      uncertaintyScores.push(evaluation.uncertaintyPreserved ? 1 : 0);
      certaintyScores.push(evaluation.falseCertainty ? 0 : 1);
      if (!evaluation.detected || !evaluation.winnerCorrect || !evaluation.uncertaintyPreserved || evaluation.falseCertainty) {
        failures.push({
          caseId: testCase.id,
          summary: 'Contradiction handling did not preserve or resolve conflict as expected.',
          expected: testCase,
          actual: evaluation
        });
      }
    }

    const category: EvalCategoryResult = {
      category: 'contradictions',
      corpus: loaded.corpusName,
      provenance: loaded.corpusProvenance,
      caseCount: loaded.contradictions.length,
      metrics: {
        contradictionDetectionRate: mean(detectionScores),
        correctWinnerSelectionRate: mean(winnerScores),
        uncertaintyPreservationRate: mean(uncertaintyScores),
        falseCertaintyRate: 1 - mean(certaintyScores)
      },
      thresholds: {
        contradictionDetectionRate: 1,
        correctWinnerSelectionRate: 0.5,
        uncertaintyPreservationRate: 1,
        falseCertaintyRate: -0
      },
      passed: false,
      failures,
      sampleSize: Math.min(5, loaded.contradictions.length)
    };
    category.passed = passThresholds(category.metrics, category.thresholds);
    return category;
  });
}

function evaluateContradictionCase(
  snapshot: KnowledgeExportSnapshot,
  testCase: ReturnType<typeof loadCoreSixFixtures>['contradictions'][number]
): {
  detected: boolean;
  winnerCorrect: boolean;
  uncertaintyPreserved: boolean;
  falseCertainty: boolean;
  text: string;
} {
  const entity = snapshot.entities.find((entry) => entry.meta.id === testCase.entityId);
  const sources = snapshot.sources.filter((source) => source.meta.linkedEntities.includes(testCase.entityId));
  const text = [entity?.currentTruth ?? '', ...(entity?.timeline ?? []), ...(entity?.openQuestions ?? []), ...sources.map((source) => source.summary), ...sources.map((source) => source.content)].join('\n').toLowerCase();
  const detected = (testCase.requiredMentions ?? []).every((mention) => text.includes(mention.toLowerCase()));
  const winnerCorrect = (testCase.winningSourceIds ?? []).length === 0
    ? true
    : (testCase.winningSourceIds ?? []).every((sourceId) => {
        const source = snapshot.sources.find((entry) => entry.meta.id === sourceId);
        return source ? text.includes(source.summary.toLowerCase()) || text.includes(source.content.toLowerCase()) : false;
      });
  const uncertaintyPreserved = testCase.expectedStatus === 'uncertain'
    ? /\b(uncertain|unresolved|pending|conflict)\b/.test(text)
    : true;
  const falseCertainty = testCase.expectedStatus === 'uncertain'
    && /\b(confirmed|final|resolved)\b/.test(entity?.currentTruth.toLowerCase() ?? '');
  return {
    detected,
    winnerCorrect,
    uncertaintyPreserved,
    falseCertainty,
    text
  };
}
