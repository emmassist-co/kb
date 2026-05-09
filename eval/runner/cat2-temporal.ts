import type { KnowledgeExportSnapshot } from '../../packages/kb-core/src/types.js';
import { loadCoreSixFixtures } from './loaders.js';
import { mean, passThresholds, type EvalCategoryResult } from './types.js';
import { withSeededKnowledgeBase } from './shared.js';

export async function runTemporalCategory(input: {
  fixturesPath?: string;
}): Promise<EvalCategoryResult> {
  const loaded = loadCoreSixFixtures(input.fixturesPath ?? new URL('../data/core-six', import.meta.url).pathname);
  return withSeededKnowledgeBase(loaded.seed, async ({ snapshot }) => {
    const exported = await snapshot();
    const answerScores: number[] = [];
    const evidenceScores: number[] = [];
    const disambiguationScores: number[] = [];
    const failures: EvalCategoryResult['failures'] = [];

    for (const testCase of loaded.temporal) {
      const evaluation = evaluateTemporalCase(exported, testCase);
      answerScores.push(evaluation.answerCorrect ? 1 : 0);
      evidenceScores.push(evaluation.evidenceCorrect ? 1 : 0);
      disambiguationScores.push(evaluation.disambiguated ? 1 : 0);
      if (!evaluation.answerCorrect || !evaluation.evidenceCorrect) {
        failures.push({
          caseId: testCase.id,
          summary: 'Temporal answer or evidence did not match expectation.',
          expected: {
            answer: testCase.expectedAnswer,
            sources: testCase.expectedSources ?? []
          },
          actual: evaluation
        });
      }
    }

    const category: EvalCategoryResult = {
      category: 'temporal',
      corpus: loaded.corpusName,
      provenance: loaded.corpusProvenance,
      caseCount: loaded.temporal.length,
      metrics: {
        exactAnswerAccuracy: mean(answerScores),
        evidenceCorrectness: mean(evidenceScores),
        temporalDisambiguationRate: mean(disambiguationScores)
      },
      thresholds: {
        exactAnswerAccuracy: 0.8,
        evidenceCorrectness: 0.66,
        temporalDisambiguationRate: 0.8
      },
      passed: false,
      failures,
      sampleSize: Math.min(5, loaded.temporal.length)
    };
    category.passed = passThresholds(category.metrics, category.thresholds);
    return category;
  });
}

function evaluateTemporalCase(
  snapshot: KnowledgeExportSnapshot,
  testCase: ReturnType<typeof loadCoreSixFixtures>['temporal'][number]
): {
  answer: string;
  sourceIds: string[];
  answerCorrect: boolean;
  evidenceCorrect: boolean;
  disambiguated: boolean;
} {
  const entity = snapshot.entities.find((entry) => entry.meta.id === testCase.entityId);
  const directEntitySources = new Set([...(entity?.sources ?? []), ...(entity?.meta.sources ?? [])]);
  const relevantSources = snapshot.sources
    .filter((source) =>
      source.meta.linkedEntities.includes(testCase.entityId) ||
      directEntitySources.has(source.meta.id) ||
      [source.summary, source.content].some((text) => text.toLowerCase().includes(testCase.expectedAnswer.toLowerCase()))
    )
    .sort((left, right) => left.meta.createdAt.localeCompare(right.meta.createdAt));
  const sourceIds: string[] = [];
  const fragments: string[] = [];

  for (const source of relevantSources) {
    const createdAt = source.meta.createdAt.slice(0, 10);
    if (testCase.queryDate && createdAt > testCase.queryDate && testCase.mode !== 'range') continue;
    if (testCase.startDate && createdAt < testCase.startDate) continue;
    if (testCase.endDate && createdAt > testCase.endDate) continue;
    fragments.push([source.summary, source.content].filter(Boolean).join(' '));
    sourceIds.push(source.meta.id);
  }

  const timelineMatches = (entity?.timeline ?? []).filter((line) => {
    const date = line.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
    if (testCase.queryDate && date > testCase.queryDate && testCase.mode !== 'range') return false;
    if (testCase.startDate && date < testCase.startDate) return false;
    if (testCase.endDate && date > testCase.endDate) return false;
    return true;
  });

  const answer = [entity?.currentTruth ?? '', ...timelineMatches, ...fragments].join('\n').trim();
  const answerCorrect = answer.toLowerCase().includes(testCase.expectedAnswer.toLowerCase());
  const expectedSources = new Set(testCase.expectedSources ?? []);
  const evidenceCorrect = expectedSources.size === 0 || [...expectedSources].every((sourceId) => sourceIds.includes(sourceId));
  const disambiguated = Boolean(answer) && timelineMatches.length + sourceIds.length > 0;
  return {
    answer,
    sourceIds,
    answerCorrect,
    evidenceCorrect,
    disambiguated
  };
}
