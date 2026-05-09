import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { computeBaselineCacheKey } from './cache.js';
import { KbAutoresearchEvaluator } from './evaluator.js';
import { isAllowedPath, validateCandidateDiff } from './guards.js';
import { AgentConfigurationError } from './pi-adapter.js';
import { buildAutoresearchBriefing, promptSha256 } from './prompt.js';
import { compareScores, compareScreening } from './scorer.js';
import { ExperimentRecorder } from './recorder.js';
import { CandidateWorkspaceManager } from './workspace.js';
import type { EvalFailure, EvalScorecard } from '../../../eval/runner/types.js';
import type { AgentAdapter, AutoresearchStatus, CandidateScore, ExperimentLedgerEntry, KbAutoresearchRunConfig } from './types.js';

const STALL_DIAGNOSIS_THRESHOLD = 3;
const MAX_CONSECUTIVE_FAILURES = 6;

export class LoopRunner {
  constructor(
    private readonly repoRoot: string,
    private readonly workspaceManager: CandidateWorkspaceManager,
    private readonly evaluator: KbAutoresearchEvaluator,
    private readonly agent: AgentAdapter,
    private readonly recorder: ExperimentRecorder
  ) {}

  async run(config: KbAutoresearchRunConfig): Promise<void> {
    mkdirSync(config.paths.runRoot, { recursive: true });
    this.recorder.pruneOldRunArtifacts();
    const fixturesRoot = path.resolve(this.repoRoot, 'eval/data');
    const runStartedAt = new Date().toISOString();
    let bestScore = this.recorder.readBestScore();
    let baselineScore = bestScore;
    const headCommit = await this.workspaceManager.revParse('HEAD', this.repoRoot);
    const baselineCacheKey = computeBaselineCacheKey(this.repoRoot, headCommit);
    const existingLedger = this.recorder.readLedger();
    const startingIteration = (existingLedger.at(-1)?.iteration ?? 0) + 1;
    const worktreeRoot = config.worktreeRoot ? path.resolve(config.worktreeRoot) : path.join(config.paths.runRoot, 'worktrees');
    mkdirSync(config.paths.promptRoot, { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });
    this.recorder.writeStatus(buildStatus(config, {
      runStartedAt,
      state: 'initializing',
      phase: 'baseline',
      message: 'Preparing autoresearch run.',
      bestScore: bestScore ?? undefined
    }));
    try {
      await this.agent.preflight?.({ cwd: this.repoRoot, model: config.model });
    } catch (error) {
      this.recorder.writeStatus(buildStatus(config, {
        runStartedAt,
        state: 'failed',
        phase: 'idle',
        message: error instanceof Error ? error.message : String(error),
        bestScore: bestScore ?? undefined
      }));
      return;
    }
    if (!bestScore) {
      await this.workspaceManager.ensureResearchBranch(config.baseBranch);
    }
    if (!bestScore) {
      const cachedBaseline = this.recorder.readCachedBaseline(baselineCacheKey);
      if (cachedBaseline) {
        bestScore = cachedBaseline;
        baselineScore = cachedBaseline;
        this.recorder.initialize(bestScore);
        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'idle',
          message: 'Reused cached baseline.',
          bestScore
        }));
      }
    }
    if (!bestScore) {
      const baselineWorktree = await this.workspaceManager.createCandidateWorktree(worktreeRoot, config.baseBranch, 0);
      try {
        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'baseline',
          message: 'Running baseline evaluation.'
        }));
        let baseline = await this.evaluator.evaluateBaseline(baselineWorktree.worktreePath, fixturesRoot);
        let baselineRepaired = false;
        if (!baseline.ok && !baseline.typecheckOk && !config.dryRun) {
          const typecheckFeedback = extractTypecheckFeedback(baseline);
          if (typecheckFeedback) {
            const outOfBoundsTypecheckPath = firstTypecheckPathOutsideAllowlist(typecheckFeedback.referencedPaths, config.allowlist);
            if (outOfBoundsTypecheckPath) {
              throw new Error(
                `Baseline typecheck failed outside KB allowlist: ${outOfBoundsTypecheckPath}. Autoresearch can only repair ${config.allowlist.join(', ')}.`
              );
            }
            const promptText = readFileSync(path.resolve(this.repoRoot, 'eval/autoresearch/program.md'), 'utf8');
            const repairPromptPath = path.join(config.paths.promptRoot, 'baseline-typecheck-repair.md');
            const repairContext = buildBootstrapPromptContext(config, this.repoRoot, 'Baseline typecheck failed before scoring.');
            this.recorder.appendLog(
              `[baseline-typecheck-repair] sending compiler feedback back to the agent: ${typecheckFeedback.summary}`
            );
            this.recorder.writeStatus(buildStatus(config, {
              runStartedAt,
              state: 'running',
              phase: 'agent-mutation',
              message: 'Baseline typecheck failed; asking the agent to repair the baseline before scoring.'
            }));
            writeFileSync(repairPromptPath, buildTypecheckRepairPrompt(promptText, typecheckFeedback), 'utf8');
            await this.agent.runCandidate({
              cwd: baselineWorktree.worktreePath,
              model: config.model,
              promptPath: repairPromptPath,
              structuredContext: repairContext
            });
            const repairedDiffSummary = await this.workspaceManager.summarizeDiff(baselineWorktree.worktreePath);
            const repairedDiffCheck = validateCandidateDiff(
              repairedDiffSummary,
              config.allowlist,
              config.maxChangedFiles,
              config.maxUnifiedDiffLines
            );
            if (!repairedDiffCheck.ok) {
              throw new Error(repairedDiffCheck.reason ?? 'Baseline repair violated diff guard.');
            }
            this.recorder.writeStatus(buildStatus(config, {
              runStartedAt,
              state: 'running',
              phase: 'baseline',
              message: 'Retrying baseline evaluation after typecheck repair.'
            }));
            baseline = await this.evaluator.evaluateBaseline(baselineWorktree.worktreePath, fixturesRoot);
            baselineRepaired = true;
          }
        }
        if (!baseline.ok || !baseline.score) {
          throw new Error(baseline.rejectReason ?? 'Failed to evaluate baseline state.');
        }
        if (baselineRepaired && !config.dryRun) {
          const baselineCommit = await this.workspaceManager.commitCandidate(
            baselineWorktree.worktreePath,
            'kb-autoresearch: baseline typecheck repair'
          );
          await this.workspaceManager.fastForwardResearchBranch(config.baseBranch, baselineCommit);
        }
        bestScore = baseline.score;
        baselineScore = baseline.score;
        this.recorder.initialize(bestScore);
        if (!baselineRepaired) {
          this.recorder.writeCachedBaseline(baselineCacheKey, bestScore);
        }
        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'idle',
          message: 'Baseline captured.',
          bestScore
        }));
        this.evaluator.writeSnapshotArtifacts(config.paths.runRoot, 'baseline', baseline.score.snapshot);
      } finally {
        await this.workspaceManager.removeWorktree(baselineWorktree.worktreePath);
      }
    }
    baselineScore ??= bestScore!;
    this.recorder.writeBriefing(buildAutoresearchBriefing(buildPromptContext(config, this.repoRoot, bestScore!, existingLedger, startingIteration, 0)));

    const startedAt = Date.now();
    let consecutiveFailures = 0;
    const acceptedIterations: number[] = [];
    for (let iteration = startingIteration; iteration < startingIteration + config.iterations; iteration += 1) {
      if ((Date.now() - startedAt) / 60_000 >= config.timeBudgetMin) break;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;

      const candidate = await this.workspaceManager.createCandidateWorktree(worktreeRoot, config.baseBranch, iteration);
      this.recorder.writeStatus(buildStatus(config, {
        runStartedAt,
        state: 'running',
        phase: 'prepare-candidate',
        iteration,
        message: 'Prepared candidate worktree.',
        bestScore
      }));
      const promptPath = path.join(config.paths.promptRoot, `iteration-${String(iteration).padStart(4, '0')}.md`);
      const promptText = readFileSync(path.resolve(this.repoRoot, 'eval/autoresearch/program.md'), 'utf8');
      writeFileSync(promptPath, promptText, 'utf8');
      const startedIterationAt = new Date().toISOString();
      const promptContext = buildPromptContext(config, this.repoRoot, bestScore, this.recorder.readLedger(), iteration, consecutiveFailures);
      const promptDigest = promptSha256(promptPath, promptContext);
      this.recorder.writeBriefing(buildAutoresearchBriefing(promptContext));

      try {
        const scoreBefore = bestScore;
        let sessionId: string | undefined;
        let mutationFinalMessage: string | undefined;
        if (!config.dryRun) {
          this.recorder.writeStatus(buildStatus(config, {
            runStartedAt,
            state: 'running',
            phase: 'agent-mutation',
            iteration,
            message: 'Agent is proposing a heuristic change.',
            bestScore
          }));
          try {
            const mutation = await this.agent.runCandidate({
              cwd: candidate.worktreePath,
              model: config.model,
              promptPath,
              structuredContext: promptContext
            });
            sessionId = mutation.sessionId;
            mutationFinalMessage = mutation.finalMessage;
          } catch (error) {
            consecutiveFailures += 1;
            const rejectReason = error instanceof Error ? error.message : String(error);
            this.recorder.append(buildLedger({
              config,
              iteration,
              parentCommit: candidate.baseCommit,
              branchName: config.baseBranch,
              changedFiles: [],
              unifiedDiffLines: 0,
              decision: 'failed',
              rejectReason,
              promptPath,
              promptSha256: promptDigest,
              startedAt: startedIterationAt,
              completedAt: new Date().toISOString(),
              scoreBefore: scoreBefore.summary
            }));
            this.recorder.writeStatus(buildStatus(config, {
              runStartedAt,
              state: error instanceof AgentConfigurationError ? 'failed' : 'running',
              phase: error instanceof AgentConfigurationError ? 'idle' : 'rejecting',
              iteration,
              message: rejectReason,
              bestScore,
              latestDecision: {
                iteration,
                decision: 'failed',
                changedFiles: [],
                rejectReason
              }
            }));
            if (error instanceof AgentConfigurationError) {
              return;
            }
            continue;
          }
        }

        const diffSummary = await this.workspaceManager.summarizeDiff(candidate.worktreePath);
        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'diff-review',
          iteration,
          message: 'Reviewing candidate diff.',
          bestScore
        }));
        const diffCheck = validateCandidateDiff(diffSummary, config.allowlist, config.maxChangedFiles, config.maxUnifiedDiffLines);
        if (!diffCheck.ok) {
          consecutiveFailures += 1;
          this.recorder.append(buildLedger({
            config,
            iteration,
            parentCommit: candidate.baseCommit,
            branchName: config.baseBranch,
            changedFiles: diffSummary.changedFiles,
            unifiedDiffLines: diffSummary.unifiedDiffLines,
            decision: diffSummary.changedFiles.length === 0 ? 'noop' : 'rejected',
            rejectReason: diffCheck.reason,
            promptPath,
            promptSha256: promptDigest,
            sessionId,
            finalMessage: mutationFinalMessage,
            startedAt: startedIterationAt,
            completedAt: new Date().toISOString(),
            scoreBefore: scoreBefore.summary
          }));
          this.recorder.writeStatus(buildStatus(config, {
            runStartedAt,
            state: 'running',
            phase: 'rejecting',
            iteration,
            message: diffCheck.reason ?? 'Candidate rejected by diff guard.',
            bestScore,
            latestDecision: {
              iteration,
              decision: diffSummary.changedFiles.length === 0 ? 'noop' : 'rejected',
              changedFiles: diffSummary.changedFiles,
              rejectReason: diffCheck.reason
            }
          }));
          continue;
        }

        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'evaluation',
          iteration,
          message: 'Running screening benchmarks.',
          bestScore
        }));
        let screening = await this.evaluator.evaluateScreening(candidate.worktreePath, fixturesRoot);
        if (!screening.ok && !screening.typecheckOk) {
          const typecheckFeedback = extractTypecheckFeedback(screening);
          if (typecheckFeedback) {
            const outOfBoundsTypecheckPath = firstTypecheckPathOutsideAllowlist(typecheckFeedback.referencedPaths, config.allowlist);
            if (outOfBoundsTypecheckPath) {
              consecutiveFailures += 1;
              const rejectReason = `Typecheck failed outside KB allowlist: ${outOfBoundsTypecheckPath}. Autoresearch can only repair ${config.allowlist.join(', ')}.`;
              this.recorder.append(buildLedger({
                config,
                iteration,
                parentCommit: candidate.baseCommit,
                branchName: config.baseBranch,
                changedFiles: diffSummary.changedFiles,
                unifiedDiffLines: diffSummary.unifiedDiffLines,
                decision: 'failed',
                rejectReason,
                promptPath,
                promptSha256: promptDigest,
                sessionId,
                finalMessage: mutationFinalMessage,
                startedAt: startedIterationAt,
                completedAt: new Date().toISOString(),
                scoreBefore: scoreBefore.summary
              }));
              this.recorder.writeStatus(buildStatus(config, {
                runStartedAt,
                state: 'running',
                phase: 'rejecting',
                iteration,
                message: rejectReason,
                bestScore,
                latestDecision: {
                  iteration,
                  decision: 'failed',
                  changedFiles: diffSummary.changedFiles,
                  rejectReason
                }
              }));
              continue;
            }
            this.recorder.appendLog(
              `[typecheck-repair] iteration=${iteration} sending compiler feedback back to the agent: ${typecheckFeedback.summary}`
            );
            this.recorder.writeStatus(buildStatus(config, {
              runStartedAt,
              state: 'running',
              phase: 'agent-mutation',
              iteration,
              message: 'Typecheck failed; asking the agent to repair the candidate before retrying screening.',
              bestScore
            }));
            try {
              const repairPromptPath = path.join(
                config.paths.promptRoot,
                `iteration-${String(iteration).padStart(4, '0')}-typecheck-repair.md`
              );
              writeFileSync(
                repairPromptPath,
                buildTypecheckRepairPrompt(promptText, typecheckFeedback),
                'utf8'
              );
              const repairMutation = await this.agent.runCandidate({
                cwd: candidate.worktreePath,
                model: config.model,
                promptPath: repairPromptPath,
                structuredContext: promptContext
              });
              sessionId = repairMutation.sessionId ?? sessionId;
              mutationFinalMessage = repairMutation.finalMessage;
              const repairedDiffSummary = await this.workspaceManager.summarizeDiff(candidate.worktreePath);
              const repairedDiffCheck = validateCandidateDiff(
                repairedDiffSummary,
                config.allowlist,
                config.maxChangedFiles,
                config.maxUnifiedDiffLines
              );
              if (!repairedDiffCheck.ok) {
                consecutiveFailures += 1;
                this.recorder.append(buildLedger({
                  config,
                  iteration,
                  parentCommit: candidate.baseCommit,
                  branchName: config.baseBranch,
                  changedFiles: repairedDiffSummary.changedFiles,
                  unifiedDiffLines: repairedDiffSummary.unifiedDiffLines,
                  decision: repairedDiffSummary.changedFiles.length === 0 ? 'noop' : 'rejected',
                  rejectReason: repairedDiffCheck.reason,
                  promptPath: repairPromptPath,
                  promptSha256: promptDigest,
                  sessionId,
                  finalMessage: mutationFinalMessage,
                  startedAt: startedIterationAt,
                  completedAt: new Date().toISOString(),
                  scoreBefore: scoreBefore.summary
                }));
                this.recorder.writeStatus(buildStatus(config, {
                  runStartedAt,
                  state: 'running',
                  phase: 'rejecting',
                  iteration,
                  message: repairedDiffCheck.reason ?? 'Candidate rejected by diff guard after typecheck repair.',
                  bestScore,
                  latestDecision: {
                    iteration,
                    decision: repairedDiffSummary.changedFiles.length === 0 ? 'noop' : 'rejected',
                    changedFiles: repairedDiffSummary.changedFiles,
                    rejectReason: repairedDiffCheck.reason
                  }
                }));
                continue;
              }
              diffSummary.changedFiles = repairedDiffSummary.changedFiles;
              diffSummary.unifiedDiffLines = repairedDiffSummary.unifiedDiffLines;
              diffSummary.diff = repairedDiffSummary.diff;
              this.recorder.writeStatus(buildStatus(config, {
                runStartedAt,
                state: 'running',
                phase: 'evaluation',
                iteration,
                message: 'Retrying screening after typecheck repair.',
                bestScore
              }));
              screening = await this.evaluator.evaluateScreening(candidate.worktreePath, fixturesRoot);
            } catch (error) {
              consecutiveFailures += 1;
              const rejectReason = error instanceof Error ? error.message : String(error);
              this.recorder.append(buildLedger({
                config,
                iteration,
                parentCommit: candidate.baseCommit,
                branchName: config.baseBranch,
                changedFiles: diffSummary.changedFiles,
                unifiedDiffLines: diffSummary.unifiedDiffLines,
                decision: 'failed',
                rejectReason,
                promptPath,
                promptSha256: promptDigest,
                sessionId,
                finalMessage: mutationFinalMessage,
                startedAt: startedIterationAt,
                completedAt: new Date().toISOString(),
                scoreBefore: scoreBefore.summary
              }));
              this.recorder.writeStatus(buildStatus(config, {
                runStartedAt,
                state: 'running',
                phase: 'rejecting',
                iteration,
                message: rejectReason,
                bestScore,
                latestDecision: {
                  iteration,
                  decision: 'failed',
                  changedFiles: diffSummary.changedFiles,
                  rejectReason
                }
              }));
              continue;
            }
          }
        }
        if (!screening.ok || !screening.screening) {
          consecutiveFailures += 1;
          this.recorder.append(buildLedger({
            config,
            iteration,
            parentCommit: candidate.baseCommit,
            branchName: config.baseBranch,
            changedFiles: diffSummary.changedFiles,
            unifiedDiffLines: diffSummary.unifiedDiffLines,
            decision: 'failed',
            rejectReason: screening.rejectReason,
            promptPath,
            promptSha256: promptDigest,
            sessionId,
            finalMessage: mutationFinalMessage,
            startedAt: startedIterationAt,
            completedAt: new Date().toISOString(),
            scoreBefore: scoreBefore.summary
          }));
          this.recorder.writeStatus(buildStatus(config, {
            runStartedAt,
            state: 'running',
            phase: 'rejecting',
            iteration,
            message: screening.rejectReason ?? 'Screening evaluation failed.',
            bestScore,
            latestDecision: {
              iteration,
              decision: 'failed',
              changedFiles: diffSummary.changedFiles,
              rejectReason: screening.rejectReason
            }
          }));
          continue;
        }

        const screeningDelta = compareScreening(bestScore, screening.adminWorldDev ?? bestScore.snapshot.adminWorldDev);
        if (!screeningDelta.improved) {
          consecutiveFailures += 1;
          this.recorder.append(buildLedger({
            config,
            iteration,
            parentCommit: candidate.baseCommit,
            branchName: config.baseBranch,
            changedFiles: diffSummary.changedFiles,
            unifiedDiffLines: diffSummary.unifiedDiffLines,
            decision: 'rejected',
            rejectReason: summarizeScreeningRejection(screeningDelta),
            promptPath,
            promptSha256: promptDigest,
            sessionId,
            finalMessage: mutationFinalMessage,
            startedAt: startedIterationAt,
            completedAt: new Date().toISOString(),
            scoreBefore: scoreBefore.summary,
            screeningBefore: screeningDelta.before,
            screeningAfter: screeningDelta.after,
            screeningDelta: {
              weightedDelta: screeningDelta.weightedDelta,
              introducedGuardrailFailures: screeningDelta.introducedGuardrailFailures,
              guardrailFailures: screeningDelta.guardrailFailures,
              improved: screeningDelta.improved
            }
          }));
          this.recorder.writeStatus(buildStatus(config, {
            runStartedAt,
            state: 'running',
            phase: 'rejecting',
            iteration,
            message: summarizeScreeningRejection(screeningDelta),
            bestScore,
            latestDecision: {
              iteration,
              decision: 'rejected',
              changedFiles: diffSummary.changedFiles,
              rejectReason: summarizeScreeningRejection(screeningDelta)
            }
          }));
          continue;
        }

        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'evaluation',
          iteration,
          message: 'Running acceptance and guardrail benchmarks.',
          bestScore
        }));
        const evaluation = await this.evaluator.evaluatePromoted(candidate.worktreePath, fixturesRoot, screening.commandOutputs);
        if (!evaluation.ok || !evaluation.score) {
          consecutiveFailures += 1;
          this.recorder.append(buildLedger({
            config,
            iteration,
            parentCommit: candidate.baseCommit,
            branchName: config.baseBranch,
            changedFiles: diffSummary.changedFiles,
            unifiedDiffLines: diffSummary.unifiedDiffLines,
            decision: 'failed',
            rejectReason: evaluation.rejectReason,
            promptPath,
            promptSha256: promptDigest,
            sessionId,
            finalMessage: mutationFinalMessage,
            startedAt: startedIterationAt,
            completedAt: new Date().toISOString(),
            scoreBefore: scoreBefore.summary
          }));
          this.recorder.writeStatus(buildStatus(config, {
            runStartedAt,
            state: 'running',
            phase: 'rejecting',
            iteration,
            message: evaluation.rejectReason ?? 'Acceptance evaluation failed.',
            bestScore,
            latestDecision: {
              iteration,
              decision: 'failed',
              changedFiles: diffSummary.changedFiles,
              rejectReason: evaluation.rejectReason
            }
          }));
          continue;
        }

        const delta = compareScores(bestScore, evaluation.score, config.protectedMetrics);
        if (!delta.improved) {
          consecutiveFailures += 1;
          this.recorder.append(buildLedger({
            config,
            iteration,
            parentCommit: candidate.baseCommit,
            branchName: config.baseBranch,
            changedFiles: diffSummary.changedFiles,
            unifiedDiffLines: diffSummary.unifiedDiffLines,
            decision: 'rejected',
            rejectReason: summarizeDeltaRejection(delta),
            promptPath,
            promptSha256: promptDigest,
            sessionId,
            finalMessage: mutationFinalMessage,
            startedAt: startedIterationAt,
            completedAt: new Date().toISOString(),
            scoreBefore: scoreBefore.summary,
            scoreAfter: evaluation.score.summary,
            scoreDelta: delta
          }));
          this.recorder.writeStatus(buildStatus(config, {
            runStartedAt,
            state: 'running',
            phase: 'rejecting',
            iteration,
            message: summarizeDeltaRejection(delta),
            bestScore,
            latestDecision: {
              iteration,
              decision: 'rejected',
              changedFiles: diffSummary.changedFiles,
              rejectReason: summarizeDeltaRejection(delta)
            }
          }));
          continue;
        }

        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'accepting',
          iteration,
          message: 'Accepting improved candidate.',
          bestScore
        }));
        const commit = config.dryRun
          ? candidate.baseCommit
          : await this.workspaceManager.commitCandidate(candidate.worktreePath, `kb-autoresearch: iteration ${iteration}`);
        if (!config.dryRun) {
          await this.workspaceManager.fastForwardResearchBranch(config.baseBranch, commit);
        }
        bestScore = evaluation.score;
        consecutiveFailures = 0;
        acceptedIterations.push(iteration);
        this.recorder.writeBestScore(bestScore);
        this.evaluator.writeSnapshotArtifacts(config.paths.runRoot, `accepted-${String(iteration).padStart(4, '0')}`, bestScore.snapshot);
        this.recorder.append(buildLedger({
          config,
          iteration,
          parentCommit: candidate.baseCommit,
          candidateCommit: commit,
          branchName: config.baseBranch,
          changedFiles: diffSummary.changedFiles,
          unifiedDiffLines: diffSummary.unifiedDiffLines,
          decision: 'accepted',
          promptPath,
          promptSha256: promptDigest,
          sessionId,
          finalMessage: mutationFinalMessage,
          startedAt: startedIterationAt,
          completedAt: new Date().toISOString(),
          scoreBefore: scoreBefore.summary,
          scoreAfter: evaluation.score.summary,
          scoreDelta: delta
        }));
        this.recorder.writeStatus(buildStatus(config, {
          runStartedAt,
          state: 'running',
          phase: 'idle',
          iteration,
          message: 'Accepted improved candidate.',
          bestScore,
          latestDecision: {
            iteration,
            decision: 'accepted',
            changedFiles: diffSummary.changedFiles,
            candidateCommit: commit
          }
        }));
      } finally {
        await this.workspaceManager.removeWorktree(candidate.worktreePath);
      }
    }

    this.recorder.writeReport({
      runId: config.runId,
      bestCommit: await this.workspaceManager.revParse(config.baseBranch, this.repoRoot),
      acceptedIterations,
      startScore: baselineScore!,
      bestScore: bestScore!
    });
    this.recorder.writeStatus(buildStatus(config, {
      runStartedAt,
      state: 'completed',
      phase: 'idle',
      message: 'Autoresearch run completed.',
      bestScore
    }));
    this.recorder.finalizeCurrentRun();
    this.recorder.pruneCompletedRunArtifacts();
  }
}

function buildStatus(
  config: KbAutoresearchRunConfig,
  input: {
    runStartedAt: string;
    state: AutoresearchStatus['state'];
    phase: AutoresearchStatus['phase'];
    message: string;
    iteration?: number;
    bestScore?: CandidateScore;
    latestDecision?: AutoresearchStatus['latestDecision'];
  }
): AutoresearchStatus {
  return {
    runId: config.runId,
    branchName: config.baseBranch,
    state: input.state,
    phase: input.phase,
    iteration: input.iteration,
    startedAt: input.runStartedAt,
    updatedAt: new Date().toISOString(),
    message: input.message,
    currentBest: input.bestScore
      ? {
          categoryPasses: input.bestScore.summary.categoryPasses,
          holdoutCategoryPasses: input.bestScore.summary.holdoutCategoryPasses,
          weightedScore: input.bestScore.summary.weightedScore,
          holdoutWeightedScore: input.bestScore.summary.holdoutWeightedScore
        }
      : undefined,
    latestDecision: input.latestDecision
  };
}

function buildBootstrapPromptContext(config: KbAutoresearchRunConfig, repoRoot: string, message: string) {
  return {
    iteration: 0,
    allowlist: config.allowlist,
    focus: {
      targetCategories: ['typecheck-repair'],
      targetCases: ['baseline-typecheck'],
      currentBest: {
        categoryPasses: 0,
        holdoutCategoryPasses: 0,
        weightedScore: 0,
        holdoutWeightedScore: 0
      },
      benchmarkFiles: {
        briefingPath: path.relative(path.join(repoRoot, 'src/lib/kb'), config.paths.currentBriefingPath),
        bestScoreSummaryPath: path.relative(path.join(repoRoot, 'src/lib/kb'), path.join(config.paths.currentRoot, 'best-score-summary.json')),
        inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
      },
      recentDecisions: [message]
    }
  };
}

function buildLedger(input: {
  config: KbAutoresearchRunConfig;
  iteration: number;
  parentCommit: string;
  candidateCommit?: string;
  branchName: string;
  changedFiles: string[];
  unifiedDiffLines: number;
  decision: ExperimentLedgerEntry['decision'];
  rejectReason?: string;
  promptPath: string;
  promptSha256: string;
  sessionId?: string;
  finalMessage?: string;
  startedAt: string;
  completedAt: string;
  scoreBefore?: ExperimentLedgerEntry['scoreBefore'];
  scoreAfter?: ExperimentLedgerEntry['scoreAfter'];
  scoreDelta?: ExperimentLedgerEntry['scoreDelta'];
  screeningBefore?: ExperimentLedgerEntry['screeningBefore'];
  screeningAfter?: ExperimentLedgerEntry['screeningAfter'];
  screeningDelta?: ExperimentLedgerEntry['screeningDelta'];
}): ExperimentLedgerEntry {
  return {
    runId: input.config.runId,
    iteration: input.iteration,
    parentCommit: input.parentCommit,
    candidateCommit: input.candidateCommit,
    branchName: input.branchName,
    changedFiles: input.changedFiles,
    unifiedDiffLines: input.unifiedDiffLines,
    decision: input.decision,
    rejectReason: input.rejectReason,
    promptPath: input.promptPath,
    promptSha256: input.promptSha256,
    sessionId: input.sessionId,
    finalMessage: input.finalMessage,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    scoreBefore: input.scoreBefore,
    scoreAfter: input.scoreAfter,
    scoreDelta: input.scoreDelta,
    screeningBefore: input.screeningBefore,
    screeningAfter: input.screeningAfter,
    screeningDelta: input.screeningDelta
  };
}

function buildPromptContext(
  config: KbAutoresearchRunConfig,
  repoRoot: string,
  bestScore: CandidateScore,
  ledger: ExperimentLedgerEntry[],
  iteration: number,
  consecutiveFailures: number
) {
  const stalled = consecutiveFailures >= STALL_DIAGNOSIS_THRESHOLD;
  const failedCategories = collectFailedCategories(bestScore.snapshot.devScorecard)
    .concat(collectFailedCategories(bestScore.snapshot.holdoutScorecard))
    .slice(0, 4);
  const failedCases = collectFailedCases(bestScore.snapshot.devScorecard)
    .concat(collectFailedCases(bestScore.snapshot.holdoutScorecard))
    .slice(0, 4);
  const retrievalTargets = collectRetrievalTargets(bestScore, { diversify: stalled });
  const targetCategories = stalled
    ? Array.from(new Set([...retrievalTargets.categories, ...failedCategories]))
    : Array.from(new Set([...failedCategories, ...retrievalTargets.categories]));
  const targetCases = stalled
    ? Array.from(new Set([...retrievalTargets.cases, ...failedCases]))
    : Array.from(new Set([...failedCases, ...retrievalTargets.cases]));
  return {
    iteration,
    allowlist: config.allowlist,
    focus: {
      targetCategories,
      targetCases,
      currentBest: {
        categoryPasses: bestScore.summary.categoryPasses,
        holdoutCategoryPasses: bestScore.summary.holdoutCategoryPasses,
        weightedScore: bestScore.summary.weightedScore,
        holdoutWeightedScore: bestScore.summary.holdoutWeightedScore
      },
      benchmarkFiles: {
        briefingPath: path.relative(path.join(repoRoot, 'src/lib/kb'), config.paths.currentBriefingPath),
        bestScoreSummaryPath: path.relative(path.join(repoRoot, 'src/lib/kb'), path.join(config.paths.currentRoot, 'best-score-summary.json')),
        inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
      },
      recentDecisions: summarizeRecentDecisions(ledger),
      stall: stalled
        ? {
            consecutiveFailures,
            diagnosis: buildStallDiagnosis(bestScore, ledger, config.allowlist)
          }
        : undefined
    }
  };
}

function summarizeRecentDecisions(ledger: ExperimentLedgerEntry[]): string[] {
  return ledger
    .slice(-8)
    .reverse()
    .map((entry) => {
      const delta = entry.scoreDelta;
      const screeningDelta = entry.screeningDelta;
      const changeSummary =
        typeof delta?.weightedDelta === 'number' && typeof delta?.holdoutWeightedDelta === 'number'
          ? ` (${formatSigned(delta.weightedDelta)} dev, ${formatSigned(delta.holdoutWeightedDelta)} holdout)`
          : '';
      const screeningSummary =
        typeof screeningDelta?.weightedDelta === 'number'
          ? ` (screening delta ${formatSigned(screeningDelta.weightedDelta)})`
          : '';
      if (entry.decision === 'accepted') {
        return `iteration ${entry.iteration} accepted ${entry.changedFiles.join(', ') || 'no files'}${changeSummary}`;
      }
      if (entry.rejectReason) {
        return `iteration ${entry.iteration} ${entry.decision}: ${entry.rejectReason}${screeningSummary}`;
      }
      return `iteration ${entry.iteration} ${entry.decision}${screeningSummary}`;
    });
}

function extractTypecheckFeedback(
  evaluation: {
    typecheckOk: boolean;
    commandOutputs: Array<{ command: string; exitCode: number; stdout: string; stderr: string }>;
    rejectReason?: string;
  }
): { summary: string; detail: string; referencedPaths: string[] } | null {
  if (evaluation.typecheckOk) return null;
  const output = evaluation.commandOutputs.find((entry) => /npm run typecheck/.test(entry.command));
  if (!output) {
    return {
      summary: evaluation.rejectReason ?? 'Typecheck failed.',
      detail: evaluation.rejectReason ?? 'Typecheck failed.',
      referencedPaths: []
    };
  }
  const combined = [output.stderr, output.stdout].join('\n');
  const raw = combined
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const excerpt = raw.slice(0, 8).join('\n');
  return {
    summary: raw[0] ?? evaluation.rejectReason ?? 'Typecheck failed.',
    detail: excerpt || evaluation.rejectReason || 'Typecheck failed.',
    referencedPaths: extractReferencedTypecheckPaths(combined)
  };
}

function extractReferencedTypecheckPaths(text: string): string[] {
  const matches = text.match(/(?:^|\s)((?:\.\.\/|\.\/|\/)?[\w./-]+\.(?:ts|tsx|js|json))(?::\d+(?::\d+)?)?/gm) ?? [];
  const normalized = matches
    .map((match) => match.trim().replace(/^\s+/, ''))
    .map((match) => match.match(/((?:\.\.\/|\.\/|\/)?[\w./-]+\.(?:ts|tsx|js|json))/)?.[1] ?? '')
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))
    .map((file) => file.startsWith('/') ? file : file.replace(/^.*?(src\/|eval\/)/, '$1'));
  return Array.from(new Set(normalized));
}

function firstTypecheckPathOutsideAllowlist(referencedPaths: string[], allowlist: string[]): string | null {
  for (const file of referencedPaths) {
    if (file.startsWith('src/') && !isAllowedPath(file, allowlist)) {
      return file;
    }
  }
  return null;
}

function buildTypecheckRepairPrompt(basePrompt: string, feedback: { summary: string; detail: string }): string {
  return [
    basePrompt.trim(),
    '',
    '## Typecheck repair request',
    '',
    'Your previous change broke TypeScript typecheck.',
    'Do not chase benchmark improvements yet.',
    'Repair the typecheck failure in the current candidate, keep the change narrow, and stop once `npm run typecheck` should pass again.',
    '',
    '### Compiler feedback',
    feedback.detail,
    ''
  ].join('\n');
}

function buildStallDiagnosis(bestScore: CandidateScore, ledger: ExperimentLedgerEntry[], allowlist: string[]): string[] {
  const recent = ledger.slice(-6);
  const lines: string[] = [];
  const repeatedReasons = mostCommon(
    recent.map((entry) => entry.rejectReason).filter((value): value is string => Boolean(value))
  );
  if (repeatedReasons.length > 0) {
    lines.push(`Repeated rejection reasons: ${repeatedReasons.join(' | ')}`);
  }
  const touchedFiles = mostCommon(recent.flatMap((entry) => entry.changedFiles));
  if (touchedFiles.length > 0) {
    lines.push(`Recent attempts clustered in: ${touchedFiles.join(', ')}`);
  }
  const touchedSet = new Set(recent.flatMap((entry) => entry.changedFiles));
  const alternativeFiles = allowlist.filter((file) => !touchedSet.has(file));
  if (touchedFiles.length > 0 && alternativeFiles.length > 0) {
    lines.push(`Diversify next attempts toward: ${alternativeFiles.join(', ')}`);
  }
  const failureCases = Array.from(
    new Set(
      collectFailedCases(bestScore.snapshot.devScorecard)
        .concat(collectFailedCases(bestScore.snapshot.holdoutScorecard))
        .slice(0, 4)
    )
  );
  if (failureCases.length > 0) {
    lines.push(`The same failing cases are still open: ${failureCases.join(', ')}`);
  }
  const stagnantGuardrails = bestScore.summary.guardrailFailures;
  if (stagnantGuardrails.length > 0) {
    lines.push(`Outstanding guardrails remain: ${stagnantGuardrails.join(', ')}`);
  }
  const positiveButRejected = recent.filter(
    (entry) =>
      entry.decision === 'rejected' &&
      (entry.scoreDelta?.weightedDelta ?? 0) > 0 &&
      (entry.scoreDelta?.introducedGuardrailFailures?.length ?? 0) === 0
  );
  if (positiveButRejected.length > 0) {
    lines.push('At least one recent attempt improved score without expanding guardrail failures; use that as a clue for the next hypothesis.');
  }
  const screeningRejects = recent.filter((entry) => entry.screeningDelta);
  if (screeningRejects.length > 0) {
    lines.push(
      `Recent screening deltas: ${screeningRejects
        .map((entry) => formatSigned(entry.screeningDelta?.weightedDelta ?? 0))
        .join(', ')}`
    );
  }
  return lines.length > 0 ? lines : ['Recent attempts have not changed the benchmark failure shape. Pick a different heuristic area than the last few edits.'];
}

function mostCommon(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([value]) => value);
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function collectFailedCategories(scorecard: EvalScorecard): string[] {
  return scorecard.categories
    .filter((category) => category.failures.length > 0)
    .sort((left, right) => right.failures.length - left.failures.length)
    .map((category) => category.category);
}

function collectFailedCases(scorecard: EvalScorecard): string[] {
  return scorecard.categories
    .filter((category) => category.failures.length > 0)
    .flatMap((category) => category.failures.slice(0, 1).map((failure: EvalFailure) => failure.caseId));
}

function collectRetrievalTargets(bestScore: CandidateScore, options: { diversify?: boolean } = {}): { categories: string[]; cases: string[] } {
  const categoryLimit = options.diversify ? 6 : 4;
  const falsePositiveLimit = options.diversify ? 4 : 2;
  const caseLimit = options.diversify ? 6 : 4;
  const categories: string[] = [];
  const cases: string[] = [];
  if (!bestScore.snapshot.adminWorldDev.gates?.passed || !bestScore.snapshot.adminWorldHoldout.gates?.passed) {
    categories.push('admin-world-v3');
  }
  if (!bestScore.snapshot.adminWorldDev.hardness?.passed || !bestScore.snapshot.adminWorldHoldout.hardness?.passed) {
    categories.push('admin-world-v3-hardness');
  }
  if (!bestScore.snapshot.gbrainWorld.gates?.passed) {
    categories.push('gbrain-world');
  }
  for (const result of [bestScore.snapshot.adminWorldDev, bestScore.snapshot.adminWorldHoldout]) {
    for (const [family, metrics] of Object.entries(result.familyBreakdown ?? {})) {
      if (!metrics.passesFloor) categories.push(`family:${family}`);
    }
    if ((result.diagnostics?.wrongTypeTopResultRate ?? 0) > 0) categories.push('diag:wrong-type-top');
    if ((result.diagnostics?.distractorWinRate ?? 0) > 0) categories.push('diag:distractor-win');
    if ((result.diagnostics?.historicalOverCurrentRate ?? 0) > 0) categories.push('diag:historical-over-current');
    if ((result.diagnostics?.wrongAnchorSelectionRate ?? 0) > 0) categories.push('diag:wrong-anchor');
  }
  for (const result of [bestScore.snapshot.adminWorldDev, bestScore.snapshot.adminWorldHoldout]) {
    for (const failure of result.diagnostics?.topFalsePositives?.slice(0, falsePositiveLimit) ?? []) {
      cases.push(failure.queryId);
    }
  }
  return {
    categories: categories.slice(0, categoryLimit),
    cases: cases.slice(0, caseLimit)
  };
}

function summarizeScreeningRejection(delta: ReturnType<typeof compareScreening>): string {
  if (delta.introducedGuardrailFailures.length > 0) {
    return `Admin-world dev regressed: ${delta.introducedGuardrailFailures.join(', ')}`;
  }
  if (delta.guardrailFailures.length > 0) {
    return `Candidate did not improve admin-world dev enough to reduce the remaining dev failures: ${delta.guardrailFailures.join(', ')}`;
  }
  return 'Candidate did not improve admin-world dev screening score.';
}

function summarizeDeltaRejection(delta: ReturnType<typeof compareScores>): string {
  if (delta.protectedMetricRegressions.length > 0) {
    return `Protected metrics regressed: ${delta.protectedMetricRegressions.join(', ')}`;
  }
  if (delta.introducedGuardrailFailures.length > 0) {
    return `Benchmark guardrails regressed: ${delta.introducedGuardrailFailures.join(', ')}`;
  }
  if (delta.holdoutCategoryPassDelta < 0) {
    return 'Holdout category passes regressed.';
  }
  if (delta.holdoutWeightedDelta < 0) {
    return 'Holdout weighted score regressed.';
  }
  if (delta.guardrailFailures.length > 0) {
    return `Candidate did not improve enough to reduce the remaining guardrail set: ${delta.guardrailFailures.join(', ')}`;
  }
  return 'Candidate did not improve category passes or weighted score.';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
