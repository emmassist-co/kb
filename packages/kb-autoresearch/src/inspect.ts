import type { CandidateScore } from './types.js';

export function buildCompactBestScoreSummary(score: CandidateScore) {
  return {
    summary: {
      categoryPasses: score.summary.categoryPasses,
      holdoutCategoryPasses: score.summary.holdoutCategoryPasses,
      weightedScore: score.summary.weightedScore,
      holdoutWeightedScore: score.summary.holdoutWeightedScore,
      protectedMetrics: score.summary.protectedMetrics
    },
    adminWorld: {
      dev: summarizeRun(score.snapshot.adminWorldDev),
      holdout: summarizeRun(score.snapshot.adminWorldHoldout),
      gbrainWorld: summarizeRun(score.snapshot.gbrainWorld),
      gbrainHeldout: summarizeRun(score.snapshot.gbrainHeldout),
      gbrainUpstream: {
        precisionAt5: score.snapshot.gbrainUpstream.precisionAt5,
        recallAt5: score.snapshot.gbrainUpstream.recallAt5,
        runs: score.snapshot.gbrainUpstream.runs,
        queries: score.snapshot.gbrainUpstream.queries,
        deltaVsPublished: score.snapshot.gbrainUpstream.deltaVsPublished
      }
    },
    failures: {
      devCategories: collectFailedCategories(score.snapshot.devScorecard),
      holdoutCategories: collectFailedCategories(score.snapshot.holdoutScorecard),
      devCases: collectFailedCases(score.snapshot.devScorecard),
      holdoutCases: collectFailedCases(score.snapshot.holdoutScorecard)
    }
  };
}

function summarizeRun(run: CandidateScore['snapshot']['adminWorldDev']) {
  return {
    precisionAtK: run.precisionAtK,
    recallAtK: run.recallAtK,
    mrrAtK: run.mrrAtK,
    ndcgAtK: run.ndcgAtK,
    diagnostics: run.diagnostics
      ? {
          wrongTypeTopResultRate: run.diagnostics.wrongTypeTopResultRate,
          anchorPageOverAnswerRate: run.diagnostics.anchorPageOverAnswerRate,
          distractorWinRate: run.diagnostics.distractorWinRate,
          historicalOverCurrentRate: run.diagnostics.historicalOverCurrentRate,
          topFalsePositives: run.diagnostics.topFalsePositives.slice(0, 5),
          anchorResolutionFailures: run.diagnostics.anchorResolutionFailures.slice(0, 5)
        }
      : undefined
  };
}

function collectFailedCategories(scorecard: CandidateScore['snapshot']['devScorecard']): string[] {
  return scorecard.categories.filter((category) => !category.passed).map((category) => category.category);
}

function collectFailedCases(scorecard: CandidateScore['snapshot']['devScorecard']): string[] {
  return scorecard.categories.flatMap((category) => category.failures.slice(0, 3).map((failure) => failure.caseId));
}
