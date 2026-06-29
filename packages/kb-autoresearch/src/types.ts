import type { EvalScorecard, EvalRunResult } from '../../../eval/runner/types.js';

export interface KbAutoresearchCliOptions {
  iterations: number;
  maxIteration?: number;
  timeBudgetMin: number;
  agentBackend?: 'codex' | 'pi';
  agentCommand?: string;
  agentProvider?: string;
  model?: string;
  worktreeRoot?: string;
  benchmarkSubset: 'all' | 'fast';
  resumeRunId?: string;
  dryRun: boolean;
  keepDebugArtifacts?: boolean;
  maxChangedFiles: number;
  maxUnifiedDiffLines: number;
}

export interface KbAutoresearchRunConfig extends KbAutoresearchCliOptions {
  runId: string;
  createdAt: string;
  baseBranch: string;
  allowlist: string[];
  kbRuntime: {
    tenantId: string;
    backend: 'file' | 'r2-mirror' | 'cloudflare';
    transport: 'local' | 'http';
    canonical: boolean;
    workspaceRole: 'canonical-production' | 'local-development' | 'mirror-support';
    endpoint?: string;
  };
  protectedMetrics: Array<'falseCertaintyRate' | 'overclaimRate' | 'falseMergeRate'>;
  benchmarkPolicy: {
    screening: string[];
    acceptance: string[];
    guardrails: string[];
    skippedFromLoop: string[];
  };
  paths: {
    artifactsRoot: string;
    cacheRoot: string;
    currentRoot: string;
    runRoot: string;
    ledgerPath: string;
    resultsPath: string;
    briefingPath: string;
    logPath: string;
    bestScorePath: string;
    promptRoot: string;
    reportPath: string;
    currentBestScorePath: string;
    currentReportPath: string;
    currentConfigPath: string;
    currentStatusPath: string;
    currentStatusMarkdownPath: string;
    currentBriefingPath: string;
    currentLogPath: string;
  };
}

export interface AutoresearchStatus {
  runId: string;
  branchName: string;
  state: 'initializing' | 'running' | 'completed' | 'failed';
  phase:
    | 'baseline'
    | 'prepare-candidate'
    | 'agent-mutation'
    | 'diff-review'
    | 'evaluation'
    | 'accepting'
    | 'rejecting'
    | 'cleanup'
    | 'idle';
  iteration?: number;
  startedAt: string;
  updatedAt: string;
  message: string;
  currentBest?: {
    categoryPasses: number;
    holdoutCategoryPasses: number;
    weightedScore: number;
    holdoutWeightedScore: number;
  };
  latestDecision?: {
    iteration: number;
    decision: ExperimentLedgerEntry['decision'];
    changedFiles: string[];
    rejectReason?: string;
    candidateCommit?: string;
  };
}

export interface BenchmarkSnapshot {
  generatedAt: string;
  devScorecard: EvalScorecard;
  holdoutScorecard: EvalScorecard;
  adminWorldDev: EvalRunResult;
  adminWorldHoldout: EvalRunResult;
  repoDocsDev?: EvalRunResult;
  repoDocsHoldout?: EvalRunResult;
  gbrainWorld: EvalRunResult;
  gbrainHeldout: EvalRunResult;
  gbrainUpstream: UpstreamGbrainRunResult;
}

export interface UpstreamGbrainRunResult {
  adapter: string;
  benchmark: 'gbrain-evals-upstream';
  queries: number;
  corpus: number;
  runs: number;
  precisionAt5: number;
  recallAt5: number;
  correctInTopK: number;
  totalExpected: number;
  stddevPrecisionAt5: number;
  stddevRecallAt5: number;
  publishedReference: {
    precisionAt5: number;
    recallAt5: number;
  };
  realGbrain?: {
    precisionAt5: number;
    recallAt5: number;
    correctInTopK: number;
    totalExpected: number;
  };
  deltaVsPublished: {
    precisionAt5: number;
    recallAt5: number;
  };
  deltaVsRealGbrain?: {
    precisionAt5: number;
    recallAt5: number;
    correctInTopK: number;
  };
}

export interface ScreeningSummary {
  weightedScore: number;
  guardrailFailures: string[];
}

export interface ScreeningDelta {
  weightedDelta: number;
  introducedGuardrailFailures: string[];
  guardrailFailures: string[];
  gbrainWeightedDelta?: number;
  gbrainIntroducedGuardrailFailures?: string[];
  gbrainGuardrailFailures?: string[];
  gbrainImproved?: boolean;
  heldoutWeightedDelta?: number;
  heldoutIntroducedGuardrailFailures?: string[];
  heldoutGuardrailFailures?: string[];
  heldoutImproved?: boolean;
  improved: boolean;
}

export interface ScoreBreakdown {
  categoryPasses: number;
  holdoutCategoryPasses: number;
  weightedScore: number;
  holdoutWeightedScore: number;
  protectedMetrics: Record<string, number>;
  guardrailFailures: string[];
}

export interface CandidateScore {
  summary: ScoreBreakdown;
  snapshot: BenchmarkSnapshot;
}

export interface ScoreDelta {
  categoryPassDelta: number;
  holdoutCategoryPassDelta: number;
  weightedDelta: number;
  holdoutWeightedDelta: number;
  protectedMetricRegressions: string[];
  introducedGuardrailFailures: string[];
  guardrailFailures: string[];
  gbrainWeightedDelta?: number;
  gbrainIntroducedGuardrailFailures?: string[];
  gbrainGuardrailFailures?: string[];
  gbrainImproved?: boolean;
  heldoutWeightedDelta?: number;
  heldoutIntroducedGuardrailFailures?: string[];
  heldoutGuardrailFailures?: string[];
  heldoutImproved?: boolean;
  improved: boolean;
}

export interface CandidateEvaluation {
  ok: boolean;
  typecheckOk: boolean;
  testsOk: boolean;
  stageReached: 'screen' | 'full';
  score?: CandidateScore;
  screening?: ScreeningSummary;
  adminWorldDev?: EvalRunResult;
  gbrainWorld?: EvalRunResult;
  gbrainHeldout?: EvalRunResult;
  gbrainUpstream?: UpstreamGbrainRunResult;
  rejectReason?: string;
  commandOutputs: Array<{ command: string; exitCode: number; stdout: string; stderr: string }>;
}

export interface KbAutoresearchEvaluatorLike {
  evaluateBaseline(worktreePath: string, fixturesRoot: string): Promise<CandidateEvaluation>;
  evaluateScreening(worktreePath: string, fixturesRoot: string): Promise<CandidateEvaluation>;
  evaluatePromoted(
    worktreePath: string,
    fixturesRoot: string,
    screeningOutputs: CandidateEvaluation['commandOutputs']
  ): Promise<CandidateEvaluation>;
  writeSnapshotArtifacts(runRoot: string, label: string, snapshot: BenchmarkSnapshot): void;
}

export interface CandidateMutationResult {
  finalMessage: string;
  sessionId?: string;
  rawEventsPath?: string;
}

export interface CandidateWorkspaceSnapshot {
  worktreePath: string;
  baseCommit: string;
  branchName: string;
}

export interface CandidateDiffSummary {
  changedFiles: string[];
  unifiedDiffLines: number;
  diff: string;
}

export interface ExperimentLedgerEntry {
  runId: string;
  iteration: number;
  parentCommit: string;
  candidateCommit?: string;
  branchName: string;
  changedFiles: string[];
  unifiedDiffLines: number;
  decision: 'accepted' | 'carried' | 'rejected' | 'noop' | 'failed';
  rejectReason?: string;
  promptPath?: string;
  promptSha256: string;
  sessionId?: string;
  startedAt: string;
  completedAt: string;
  scoreBefore?: ScoreBreakdown;
  scoreAfter?: ScoreBreakdown;
  scoreDelta?: ScoreDelta;
  screeningBefore?: ScreeningSummary;
  screeningAfter?: ScreeningSummary;
  screeningDelta?: ScreeningDelta;
  finalMessage?: string;
}

export interface AgentPromptContext {
  iteration: number;
  allowlist: string[];
  kbRuntime: {
    tenantId: string;
    backend: 'file' | 'r2-mirror' | 'cloudflare';
    transport: 'local' | 'http';
    canonical: boolean;
    workspaceRole: 'canonical-production' | 'local-development' | 'mirror-support';
    endpoint?: string;
  };
  focus: {
    targetCategories: string[];
    targetCases: string[];
    failureBuckets: string[];
    querySamples: string[];
    externalTargets: string[];
    currentBest: {
      categoryPasses: number;
      holdoutCategoryPasses: number;
      weightedScore: number;
      holdoutWeightedScore: number;
    };
    benchmarkFiles: {
      briefingPath: string;
      bestScoreSummaryPath: string;
      inspectCommand: string;
    };
    recentDecisions: string[];
    stall?: {
      consecutiveFailures: number;
      diagnosis: string[];
    };
  };
}

export interface AgentRunOptions {
  cwd: string;
  model?: string;
  promptPath: string;
  structuredContext: AgentPromptContext;
}

export interface AgentAdapter {
  preflight?(options: { cwd: string; model?: string }): Promise<void>;
  runCandidate(options: AgentRunOptions): Promise<CandidateMutationResult>;
}

export interface CommandRunner {
  run(command: string, args: string[], options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    stdinText?: string;
    timeoutMs?: number;
  }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}
