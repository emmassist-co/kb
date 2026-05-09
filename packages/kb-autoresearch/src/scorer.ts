import type { EvalCategoryResult, EvalRunResult } from '../../../eval/runner/types.js';
import type { BenchmarkSnapshot, CandidateScore, ScoreBreakdown, ScoreDelta, ScreeningSummary } from './types.js';

const CATEGORY_WEIGHTS: Record<string, number> = {
  retrieval: 1,
  temporal: 2,
  identity: 2,
  provenance: 2,
  contradictions: 4,
  fuzzy: 4
};

const ADMIN_WORLD_PRECISION_WEIGHT = 140;
const ADMIN_WORLD_SCREENING_PRECISION_WEIGHT = 180;
const DISTRACTOR_WIN_PENALTY = 110;
const SCREENING_DISTRACTOR_WIN_PENALTY = 140;
const HISTORICAL_OVER_CURRENT_PENALTY = 140;
const SCREENING_HISTORICAL_OVER_CURRENT_PENALTY = 170;

export function buildCandidateScore(snapshot: BenchmarkSnapshot): CandidateScore {
  const summary: ScoreBreakdown = {
    categoryPasses: snapshot.devScorecard.categories.filter((category) => category.passed).length,
    holdoutCategoryPasses: snapshot.holdoutScorecard.categories.filter((category) => category.passed).length,
    weightedScore: computeWeightedScore(snapshot.devScorecard, snapshot.adminWorldDev, snapshot.gbrainWorld),
    holdoutWeightedScore: computeWeightedScore(snapshot.holdoutScorecard, snapshot.adminWorldHoldout, snapshot.gbrainWorld),
    protectedMetrics: extractProtectedMetrics(snapshot),
    guardrailFailures: extractGuardrailFailures(snapshot)
  };
  return { summary, snapshot };
}

export function buildScreeningSummary(adminWorldDev: EvalRunResult): ScreeningSummary {
  return {
    weightedScore: computeAdminWorldScreeningScore(adminWorldDev),
    guardrailFailures: extractAdminWorldGuardrailFailures(adminWorldDev, 'admin-world-dev')
  };
}

export function compareScreening(previous: CandidateScore, nextAdminWorldDev: EvalRunResult): {
  improved: boolean;
  weightedDelta: number;
  introducedGuardrailFailures: string[];
  guardrailFailures: string[];
  before: ScreeningSummary;
  after: ScreeningSummary;
} {
  const previousSummary = buildScreeningSummary(previous.snapshot.adminWorldDev);
  const nextSummary = buildScreeningSummary(nextAdminWorldDev);
  const introducedGuardrailFailures = nextSummary.guardrailFailures.filter(
    (failure) => !previousSummary.guardrailFailures.includes(failure)
  );
  const removedGuardrailFailures = previousSummary.guardrailFailures.filter(
    (failure) => !nextSummary.guardrailFailures.includes(failure)
  );
  const weightedDelta = nextSummary.weightedScore - previousSummary.weightedScore;
  return {
    improved:
      introducedGuardrailFailures.length === 0 &&
      (removedGuardrailFailures.length > 0 || weightedDelta > 0),
    weightedDelta,
    introducedGuardrailFailures,
    guardrailFailures: nextSummary.guardrailFailures,
    before: previousSummary,
    after: nextSummary
  };
}

export function compareScores(
  previous: CandidateScore,
  next: CandidateScore,
  protectedMetrics: string[]
): ScoreDelta {
  const protectedMetricRegressions = protectedMetrics.filter((metric) => {
    const before = previous.summary.protectedMetrics[metric];
    const after = next.summary.protectedMetrics[metric];
    return after > before;
  });
  const categoryPassDelta = next.summary.categoryPasses - previous.summary.categoryPasses;
  const holdoutCategoryPassDelta = next.summary.holdoutCategoryPasses - previous.summary.holdoutCategoryPasses;
  const weightedDelta = next.summary.weightedScore - previous.summary.weightedScore;
  const holdoutWeightedDelta = next.summary.holdoutWeightedScore - previous.summary.holdoutWeightedScore;
  const guardrailFailures = next.summary.guardrailFailures;
  const introducedGuardrailFailures = next.summary.guardrailFailures.filter(
    (failure) => !previous.summary.guardrailFailures.includes(failure)
  );
  const removedGuardrailFailures = previous.summary.guardrailFailures.filter(
    (failure) => !next.summary.guardrailFailures.includes(failure)
  );
  const improved =
    protectedMetricRegressions.length === 0 &&
    introducedGuardrailFailures.length === 0 &&
    holdoutCategoryPassDelta >= 0 &&
    holdoutWeightedDelta >= 0 &&
    (
      removedGuardrailFailures.length > 0 ||
      categoryPassDelta > 0 ||
      holdoutCategoryPassDelta > 0 ||
      weightedDelta > 0
    );

  return {
    categoryPassDelta,
    holdoutCategoryPassDelta,
    weightedDelta,
    holdoutWeightedDelta,
    protectedMetricRegressions,
    introducedGuardrailFailures,
    guardrailFailures,
    improved
  };
}

function computeWeightedScore(
  scorecard: BenchmarkSnapshot['devScorecard'],
  adminWorld: EvalRunResult,
  gbrainWorld: EvalRunResult
): number {
  let total = 0;
  total += scorecard.categories.filter((category) => category.passed).length * 100;

  for (const category of scorecard.categories) {
    const weight = CATEGORY_WEIGHTS[category.category] ?? 1;
    total += Number(category.passed) * 15 * weight;
    total += averageMetrics(category.metrics) * 10 * weight;
  }

  total += averageMetrics({
    precisionAtK: adminWorld.precisionAtK,
    recallAtK: adminWorld.recallAtK,
    mrrAtK: adminWorld.mrrAtK,
    ndcgAtK: adminWorld.ndcgAtK
  }) * 80;
  total += adminWorld.precisionAtK * ADMIN_WORLD_PRECISION_WEIGHT;
  total += (adminWorld.gates?.passed ? 40 : 0);
  total += (adminWorld.hardness?.passed ? 35 : -35);
  total += (adminWorld.hardness?.precisionLift ?? 0) * 40;
  total += (adminWorld.hardness?.mrrLift ?? 0) * 40;
  total += milestoneWeight(adminWorld.gates?.milestone);
  total -= (adminWorld.diagnostics?.anchorPageOverAnswerRate ?? 0) * 60;
  total -= (adminWorld.diagnostics?.wrongTypeTopResultRate ?? 0) * 80;
  total -= (adminWorld.diagnostics?.distractorWinRate ?? 0) * DISTRACTOR_WIN_PENALTY;
  total -= (adminWorld.diagnostics?.wrongAnchorSelectionRate ?? 0) * 70;
  total -= (adminWorld.diagnostics?.historicalOverCurrentRate ?? 0) * HISTORICAL_OVER_CURRENT_PENALTY;
  total -= (adminWorld.diagnostics?.siblingDistractorWinRate ?? 0) * 55;
  total -= (adminWorld.diagnostics?.lexicalDistractorWinRate ?? 0) * 55;
  total -= (adminWorld.diagnostics?.weakMentionBeatExplicitRate ?? 0) * 45;

  total += averageMetrics({
    precisionAtK: gbrainWorld.precisionAtK,
    recallAtK: gbrainWorld.recallAtK,
    mrrAtK: gbrainWorld.mrrAtK,
    ndcgAtK: gbrainWorld.ndcgAtK
  }) * 20;

  return total;
}

function computeAdminWorldScreeningScore(adminWorld: EvalRunResult): number {
  let total = averageMetrics({
    precisionAtK: adminWorld.precisionAtK,
    recallAtK: adminWorld.recallAtK,
    mrrAtK: adminWorld.mrrAtK,
    ndcgAtK: adminWorld.ndcgAtK
  }) * 100;
  total += adminWorld.precisionAtK * ADMIN_WORLD_SCREENING_PRECISION_WEIGHT;
  total += (adminWorld.gates?.passed ? 50 : 0);
  total += (adminWorld.hardness?.passed ? 40 : -40);
  total += (adminWorld.hardness?.precisionLift ?? 0) * 45;
  total += (adminWorld.hardness?.mrrLift ?? 0) * 45;
  total += milestoneWeight(adminWorld.gates?.milestone);
  total -= (adminWorld.diagnostics?.wrongTypeTopResultRate ?? 0) * 80;
  total -= (adminWorld.diagnostics?.distractorWinRate ?? 0) * SCREENING_DISTRACTOR_WIN_PENALTY;
  total -= (adminWorld.diagnostics?.wrongAnchorSelectionRate ?? 0) * 80;
  total -= (adminWorld.diagnostics?.historicalOverCurrentRate ?? 0) * SCREENING_HISTORICAL_OVER_CURRENT_PENALTY;
  total -= (adminWorld.diagnostics?.weakMentionBeatExplicitRate ?? 0) * 50;
  return total;
}

function averageMetrics(metrics: Record<string, number>): number {
  const values = Object.values(metrics);
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function extractProtectedMetrics(snapshot: BenchmarkSnapshot): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const scorecard of [snapshot.devScorecard, snapshot.holdoutScorecard]) {
    for (const category of scorecard.categories as EvalCategoryResult[]) {
      for (const [key, value] of Object.entries(category.metrics) as Array<[string, number]>) {
        if (key === 'falseCertaintyRate' || key === 'overclaimRate' || key === 'falseMergeRate') {
          metrics[key] = Math.max(metrics[key] ?? 0, value);
        }
      }
    }
  }
  return metrics;
}

function extractGuardrailFailures(snapshot: BenchmarkSnapshot): string[] {
  const failures: string[] = [];
  failures.push(...extractAdminWorldGuardrailFailures(snapshot.adminWorldDev, 'admin-world-dev'));
  failures.push(...extractAdminWorldGuardrailFailures(snapshot.adminWorldHoldout, 'admin-world-holdout'));
  if (!snapshot.gbrainWorld.gates?.passed) failures.push('gbrain-world');
  if (snapshot.devScorecard.categories.some((category) => !category.passed)) failures.push('core-six-dev');
  if (snapshot.holdoutScorecard.categories.some((category) => !category.passed)) failures.push('core-six-holdout');
  return failures;
}

function extractAdminWorldGuardrailFailures(result: EvalRunResult, label: 'admin-world-dev' | 'admin-world-holdout'): string[] {
  const failures: string[] = [];
  if (!result.gates?.passed) failures.push(label);
  if (!result.hardness?.passed) failures.push(`${label}-hardness`);
  return failures;
}

function milestoneWeight(milestone?: string): number {
  switch (milestone) {
    case 'stretch-reached':
      return 40;
    case 'strong-reached':
      return 25;
    case 'floor-reached':
      return 10;
    default:
      return 0;
  }
}
