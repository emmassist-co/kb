import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readBaselineCache, writeBaselineCache } from './cache.js';
import { buildCompactBestScoreSummary } from './inspect.js';
import type { AutoresearchStatus, CandidateScore, ExperimentLedgerEntry, KbAutoresearchRunConfig } from './types.js';

export class ExperimentRecorder {
  constructor(private readonly config: KbAutoresearchRunConfig) {}

  initialize(score: CandidateScore): void {
    mkdirSync(this.config.paths.runRoot, { recursive: true });
    mkdirSync(this.config.paths.promptRoot, { recursive: true });
    mkdirSync(this.config.paths.currentRoot, { recursive: true });
    writeFileSync(path.join(this.config.paths.runRoot, 'config.json'), `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
    writeFileSync(this.config.paths.currentConfigPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
    if (!existsSync(this.config.paths.logPath)) writeFileSync(this.config.paths.logPath, '', 'utf8');
    if (!existsSync(this.config.paths.currentLogPath)) writeFileSync(this.config.paths.currentLogPath, '', 'utf8');
    this.writeBestScore(score);
  }

  writeStatus(status: AutoresearchStatus): void {
    mkdirSync(this.config.paths.currentRoot, { recursive: true });
    writeFileSync(this.config.paths.currentStatusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    writeFileSync(this.config.paths.currentStatusMarkdownPath, `${renderStatus(status)}\n`, 'utf8');
    this.appendLog(`[status] phase=${status.phase} state=${status.state}${typeof status.iteration === 'number' ? ` iteration=${status.iteration}` : ''} message=${status.message}`);
  }

  writeBriefing(briefing: string): void {
    mkdirSync(this.config.paths.currentRoot, { recursive: true });
    writeFileSync(this.config.paths.briefingPath, briefing, 'utf8');
    writeFileSync(this.config.paths.currentBriefingPath, briefing, 'utf8');
    this.appendLog('[briefing] updated compact briefing');
  }

  appendLog(message: string): void {
    const line = `${new Date().toISOString()} ${message}\n`;
    mkdirSync(this.config.paths.currentRoot, { recursive: true });
    appendFileSync(this.config.paths.logPath, line, 'utf8');
    appendFileSync(this.config.paths.currentLogPath, line, 'utf8');
  }

  append(entry: ExperimentLedgerEntry): void {
    mkdirSync(path.dirname(this.config.paths.ledgerPath), { recursive: true });
    appendFileSync(this.config.paths.ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
    appendFileSync(this.config.paths.resultsPath, `${JSON.stringify(toCompactResult(entry))}\n`, 'utf8');
  }

  writeBestScore(score: CandidateScore): void {
    writeFileSync(this.config.paths.bestScorePath, `${JSON.stringify(score, null, 2)}\n`, 'utf8');
    writeFileSync(this.config.paths.currentBestScorePath, `${JSON.stringify(score, null, 2)}\n`, 'utf8');
    const compact = `${JSON.stringify(buildCompactBestScoreSummary(score), null, 2)}\n`;
    writeFileSync(path.join(this.config.paths.runRoot, 'best-score-summary.json'), compact, 'utf8');
    writeFileSync(path.join(this.config.paths.currentRoot, 'best-score-summary.json'), compact, 'utf8');
  }

  readBestScore(): CandidateScore | null {
    if (!existsSync(this.config.paths.bestScorePath)) return null;
    return JSON.parse(readFileSync(this.config.paths.bestScorePath, 'utf8')) as CandidateScore;
  }

  readCachedBaseline(cacheKey: string): CandidateScore | null {
    return readBaselineCache(this.config.paths.cacheRoot, cacheKey);
  }

  writeCachedBaseline(cacheKey: string, score: CandidateScore): void {
    writeBaselineCache(this.config.paths.cacheRoot, cacheKey, score);
  }

  readLedger(): ExperimentLedgerEntry[] {
    if (!existsSync(this.config.paths.ledgerPath)) return [];
    return readFileSync(this.config.paths.ledgerPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ExperimentLedgerEntry);
  }

  writeReport(summary: {
    runId: string;
    bestCommit: string;
    acceptedIterations: number[];
    startScore: CandidateScore;
    bestScore: CandidateScore;
  }): void {
    const lines = [
      '# KB Autoresearch Report',
      '',
      `Run: \`${summary.runId}\``,
      `Best commit: \`${summary.bestCommit}\``,
      `Accepted iterations: ${summary.acceptedIterations.join(', ') || 'none'}`,
      '',
      '## Start',
      '',
      renderScore(summary.startScore),
      '',
      '## Best',
      '',
      renderScore(summary.bestScore),
      ''
    ];
    writeFileSync(this.config.paths.reportPath, lines.join('\n'), 'utf8');
    writeFileSync(this.config.paths.currentReportPath, lines.join('\n'), 'utf8');
  }

  finalizeCurrentRun(): void {
    mkdirSync(this.config.paths.currentRoot, { recursive: true });
    writeFileSync(this.config.paths.currentConfigPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
  }

  pruneOldRunArtifacts(): void {
    if (this.config.keepDebugArtifacts) return;
    const runsRoot = path.join(this.config.paths.artifactsRoot, 'runs');
    if (!existsSync(runsRoot)) return;
    for (const entry of readdirSync(runsRoot)) {
      if (entry === this.config.runId) continue;
      rmSync(path.join(runsRoot, entry), { recursive: true, force: true });
    }
  }

  pruneCompletedRunArtifacts(): void {
    if (this.config.keepDebugArtifacts) return;
    rmSync(this.config.paths.promptRoot, { recursive: true, force: true });
    rmSync(path.join(this.config.paths.runRoot, 'worktrees'), { recursive: true, force: true });
    rmSync(path.join(this.config.paths.runRoot, 'benchmarks'), { recursive: true, force: true });
  }
}

function toCompactResult(entry: ExperimentLedgerEntry) {
  return {
    runId: entry.runId,
    iteration: entry.iteration,
    decision: entry.decision,
    branchName: entry.branchName,
    parentCommit: entry.parentCommit,
    candidateCommit: entry.candidateCommit,
    changedFiles: entry.changedFiles,
    unifiedDiffLines: entry.unifiedDiffLines,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    rejectReason: entry.rejectReason,
    finalMessage: entry.finalMessage,
    categoryPassDelta: entry.scoreDelta?.categoryPassDelta,
    holdoutCategoryPassDelta: entry.scoreDelta?.holdoutCategoryPassDelta,
    weightedDelta: entry.scoreDelta?.weightedDelta,
    holdoutWeightedDelta: entry.scoreDelta?.holdoutWeightedDelta,
    screeningWeightedDelta: entry.screeningDelta?.weightedDelta,
    screeningGuardrailFailures: entry.screeningDelta?.guardrailFailures
  };
}

function renderScore(score: CandidateScore): string {
  return [
    `- category passes: ${score.summary.categoryPasses}`,
    `- holdout category passes: ${score.summary.holdoutCategoryPasses}`,
    `- weighted score: ${score.summary.weightedScore.toFixed(3)}`,
    `- holdout weighted score: ${score.summary.holdoutWeightedScore.toFixed(3)}`,
    `- protected metrics: ${JSON.stringify(score.summary.protectedMetrics)}`
  ].join('\n');
}

function renderStatus(status: AutoresearchStatus): string {
  const lines = [
    '# KB Autoresearch Status',
    '',
    `Run: \`${status.runId}\``,
    `Branch: \`${status.branchName}\``,
    `State: \`${status.state}\``,
    `Phase: \`${status.phase}\``,
    `Updated: ${status.updatedAt}`,
    `Message: ${status.message}`
  ];
  if (typeof status.iteration === 'number') {
    lines.push(`Iteration: ${status.iteration}`);
  }
  if (status.currentBest) {
    lines.push('');
    lines.push('## Current Best');
    lines.push('');
    lines.push(`- category passes: ${status.currentBest.categoryPasses}`);
    lines.push(`- holdout category passes: ${status.currentBest.holdoutCategoryPasses}`);
    lines.push(`- weighted score: ${status.currentBest.weightedScore.toFixed(3)}`);
    lines.push(`- holdout weighted score: ${status.currentBest.holdoutWeightedScore.toFixed(3)}`);
  }
  if (status.latestDecision) {
    lines.push('');
    lines.push('## Latest Decision');
    lines.push('');
    lines.push(`- iteration: ${status.latestDecision.iteration}`);
    lines.push(`- decision: ${status.latestDecision.decision}`);
    lines.push(`- changed files: ${status.latestDecision.changedFiles.join(', ') || 'none'}`);
    if (status.latestDecision.rejectReason) {
      lines.push(`- reason: ${status.latestDecision.rejectReason}`);
    }
    if (status.latestDecision.candidateCommit) {
      lines.push(`- commit: \`${status.latestDecision.candidateCommit}\``);
    }
  }
  return lines.join('\n');
}
