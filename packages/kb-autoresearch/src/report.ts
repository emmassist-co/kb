import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRunConfig } from './config.js';
import type { AutoresearchStatus, CandidateScore, ExperimentLedgerEntry } from './types.js';

export function renderAutoresearchReport(repoRoot: string, runId?: string): string {
  const config = runId ? loadRunConfig(repoRoot, runId) : loadCurrentConfig(repoRoot);
  const bestScorePath = existsSync(config.paths.bestScorePath) ? config.paths.bestScorePath : config.paths.currentBestScorePath;
  const reportPath = existsSync(config.paths.reportPath) ? config.paths.reportPath : config.paths.currentReportPath;
  const bestScore = JSON.parse(readFileSync(bestScorePath, 'utf8')) as CandidateScore;
  let report = readFileSync(reportPath, 'utf8');
  report += '\n## Current Best Summary\n\n';
  report += `- weighted score: ${bestScore.summary.weightedScore.toFixed(3)}\n`;
  report += `- holdout weighted score: ${bestScore.summary.holdoutWeightedScore.toFixed(3)}\n`;
  report += `- category passes: ${bestScore.summary.categoryPasses}\n`;
  report += `- holdout category passes: ${bestScore.summary.holdoutCategoryPasses}\n`;
  report += `- artifacts: ${path.relative(repoRoot, config.paths.currentRoot)}\n`;
  return report;
}

export function renderAutoresearchSummary(repoRoot: string): string {
  const currentConfig = loadCurrentConfig(repoRoot);
  const bestScore = JSON.parse(readFileSync(currentConfig.paths.currentBestScorePath, 'utf8')) as CandidateScore;
  const results = readCompactResults(currentConfig.paths.resultsPath);
  const accepted = [...results].reverse().find((entry) => entry.decision === 'accepted');
  const lines = [
    '# KB Autoresearch Summary',
    '',
    `Run: \`${currentConfig.runId}\``,
    `Current report: \`${path.relative(repoRoot, currentConfig.paths.currentReportPath)}\``,
    `Current score: ${bestScore.summary.categoryPasses}/${6} categories, weighted ${bestScore.summary.weightedScore.toFixed(3)}, holdout ${bestScore.summary.holdoutWeightedScore.toFixed(3)}`,
    ''
  ];

  if (!accepted) {
    lines.push('No accepted iteration recorded yet.');
    return lines.join('\n');
  }

  lines.push('## Latest Accepted');
  lines.push('');
  lines.push(`- run: \`${accepted.runId}\``);
  lines.push(`- iteration: ${accepted.iteration}`);
  lines.push(`- branch: \`${accepted.branchName}\``);
  if (accepted.candidateCommit) {
    lines.push(`- commit: \`${accepted.candidateCommit}\``);
  }
  lines.push(`- changed files: ${accepted.changedFiles.join(', ') || 'none'}`);
  lines.push(`- diff lines: ${accepted.unifiedDiffLines}`);
  if (typeof accepted.categoryPassDelta === 'number') {
    lines.push(`- category pass delta: ${formatSigned(accepted.categoryPassDelta)}`);
  }
  if (typeof accepted.holdoutCategoryPassDelta === 'number') {
    lines.push(`- holdout pass delta: ${formatSigned(accepted.holdoutCategoryPassDelta)}`);
  }
  if (typeof accepted.weightedDelta === 'number') {
    lines.push(`- weighted delta: ${formatSigned(accepted.weightedDelta, 3)}`);
  }
  if (typeof accepted.holdoutWeightedDelta === 'number') {
    lines.push(`- holdout weighted delta: ${formatSigned(accepted.holdoutWeightedDelta, 3)}`);
  }
  if (accepted.finalMessage) {
    lines.push(`- agent note: ${accepted.finalMessage}`);
  }

  return lines.join('\n');
}

export function renderAutoresearchStatus(repoRoot: string): string {
  const currentConfig = loadCurrentConfig(repoRoot);
  const statusPath = currentConfig.paths.currentStatusPath;
  if (!existsSync(statusPath)) {
    return [
      '# KB Autoresearch Status',
      '',
      `Run: \`${currentConfig.runId}\``,
      'No live status file is present right now.',
      'Start a new autoresearch run to see phase-by-phase progress here.'
    ].join('\n');
  }
  const status = JSON.parse(readFileSync(statusPath, 'utf8')) as AutoresearchStatus;
  return readFileSync(currentConfig.paths.currentStatusMarkdownPath, 'utf8') +
    '\n\n' +
    `Artifacts: \`${path.relative(repoRoot, currentConfig.paths.currentRoot)}\`\n`;
}

function loadCurrentConfig(repoRoot: string) {
  const currentConfigPath = path.resolve(repoRoot, 'artifacts/kb-autoresearch/current/config.json');
  if (!existsSync(currentConfigPath)) {
    throw new Error('No current autoresearch report found.');
  }
  return JSON.parse(readFileSync(currentConfigPath, 'utf8')) as ReturnType<typeof loadRunConfig>;
}

function readCompactResults(resultsPath: string): Array<
  Pick<
    ExperimentLedgerEntry,
    'runId' | 'iteration' | 'decision' | 'branchName' | 'candidateCommit' | 'changedFiles' | 'unifiedDiffLines' | 'finalMessage'
  > & {
    categoryPassDelta?: number;
    holdoutCategoryPassDelta?: number;
    weightedDelta?: number;
    holdoutWeightedDelta?: number;
  }
> {
  if (!existsSync(resultsPath)) return [];
  return readFileSync(resultsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReturnType<typeof readCompactResults>[number]);
}

function formatSigned(value: number, digits = 0): string {
  const rounded = digits > 0 ? value.toFixed(digits) : String(value);
  return value > 0 ? `+${rounded}` : rounded;
}
