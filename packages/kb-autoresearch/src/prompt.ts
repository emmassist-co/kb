import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AgentRunOptions } from './types.js';

export function buildAutoresearchPrompt(
  basePrompt: string,
  context: AgentRunOptions['structuredContext'],
  options: { compact?: boolean; mode?: 'diagnose' | 'edit'; diagnosisSummary?: string } = {}
): string {
  const compact = options.compact === true;
  const mode = options.mode ?? 'edit';
  const diagnosisSummary = options.diagnosisSummary?.trim();
  return [
    basePrompt.trim(),
    '',
    '## Iteration Context',
    '',
    `Iteration: ${context.iteration}`,
    `Writable paths: ${context.allowlist.join(', ')}`,
    '',
    '### KB runtime',
    `tenant=${context.kbRuntime.tenantId}, backend=${context.kbRuntime.backend}, transport=${context.kbRuntime.transport}, canonical=${context.kbRuntime.canonical ? 'yes' : 'no'}, role=${context.kbRuntime.workspaceRole}`,
    ...(context.kbRuntime.endpoint ? [`endpoint: ${context.kbRuntime.endpoint}`] : []),
    '',
    '### Current target',
    `Failed categories to focus on: ${context.focus.targetCategories.join(', ') || 'unknown'}`,
    `Representative failing cases: ${context.focus.targetCases.join(', ') || 'unknown'}`,
    ...compactList(context.focus.failureBuckets, compact ? 2 : 4).map((line, index) =>
      `${index === 0 ? 'Failure buckets:' : '                 '} ${line}`
    ),
    ...compactList(context.focus.querySamples, compact ? 2 : 4).map((line, index) =>
      `${index === 0 ? 'Query samples:' : '             '} ${line}`
    ),
    ...compactList(context.focus.externalTargets, compact ? 2 : 4).map((line, index) =>
      `${index === 0 ? 'External targets:' : '                '} ${line}`
    ),
    '',
    '### Current best summary',
    `Dev passes=${context.focus.currentBest.categoryPasses}, Holdout passes=${context.focus.currentBest.holdoutCategoryPasses}, Dev score=${context.focus.currentBest.weightedScore.toFixed(3)}, Holdout score=${context.focus.currentBest.holdoutWeightedScore.toFixed(3)}`,
    '',
    '### Recent outcomes',
    ...compactList(context.focus.recentDecisions, compact ? 2 : 4).map((line) => `- ${line}`),
    ...(compact
      ? []
      : [
          '',
          '### Briefing artifact',
          `- compact briefing: ${context.focus.benchmarkFiles.briefingPath}`,
          `- compact best-score summary: ${context.focus.benchmarkFiles.bestScoreSummaryPath}`,
          `- inspect command: ${context.focus.benchmarkFiles.inspectCommand}`
        ]),
    '',
    compact
      ? 'This is a retry after a context overflow. Stay extremely narrow and finish fast.'
      : 'Start by inspecting only the allowed KB files plus the compact briefing above if you need more detail.',
    `If you need benchmark state, use \`${context.focus.benchmarkFiles.inspectCommand}\` first instead of opening raw JSON artifacts.`,
    'Fetch additional context yourself instead of assuming hidden context is preloaded.',
    'Do not inspect unrelated repo areas.',
    context.kbRuntime.canonical
      ? 'Treat this KB runtime as the canonical production surface when reasoning about deployed behavior.'
      : 'Treat this KB runtime as a support-only workspace. Do not describe local or mirror writes as canonical production truth.',
    compact
      ? 'Do not read eval loaders, full reports, full ledgers, or broad repo files unless a KB file directly points you there.'
      : 'Do not read the full experiment ledger, full reports, or other historical benchmark artifacts unless the compact briefing is insufficient.',
    'Avoid opening giant files directly such as best-score snapshots, baseline cache blobs, package-lock.json, or full admin-world fixture JSON unless a tiny targeted command proves you need one field.',
    'Prefer ranking and tie-break changes in service.ts over adding more extraction synonyms unless the briefing clearly shows missing relation recall.',
    'Do not spend iterations on weekday, sync, or meeting-anchor fallback tweaks unless the sampled failures are true empty-result anchor misses.',
    ...(context.focus.stall
      ? [
          `The loop is currently stalled after ${context.focus.stall.consecutiveFailures} consecutive non-accepted attempts.`,
          'Start by reading the stall diagnosis in the briefing and use it to choose a different hypothesis than the recent failed attempts.'
        ]
      : []),
    ...(mode === 'diagnose'
      ? [
          'This is the diagnosis pass. Do not edit any files in this pass.',
          compact
            ? 'Prefer one or two targeted read/search commands. Stop once you can name one concrete heuristic change to try.'
            : 'Inspect only the allowed KB files and identify one concrete, narrow heuristic change to try.',
          'Return only: target file, failing pattern, proposed small change, and why it should improve admin-world precision without hurting recall.'
        ]
      : [
          'This is the edit pass.',
          diagnosisSummary
            ? `Apply this diagnosis unless the code clearly disproves it: ${diagnosisSummary}`
            : 'Apply one concrete, narrow heuristic improvement.',
          compact
            ? 'Prefer one or two targeted read/search commands. Do not keep exploring once you have a plausible fix.'
            : 'Read the allowed files, make one small heuristic improvement, and stop.',
          'Return a short final summary of what changed.'
        ])
  ].join('\n');
}

export function promptSha256(promptPath: string, context: AgentRunOptions['structuredContext']): string {
  return createHash('sha256')
    .update(readFileSync(promptPath, 'utf8'))
    .update(JSON.stringify(context))
    .digest('hex');
}

export function buildAutoresearchBriefing(context: AgentRunOptions['structuredContext']): string {
  return [
    '# KB Autoresearch Briefing',
    '',
    `Iteration: ${context.iteration}`,
    `Writable paths: ${context.allowlist.join(', ')}`,
    '',
    '## KB Runtime',
    '',
    `- tenant: ${context.kbRuntime.tenantId}`,
    `- backend: ${context.kbRuntime.backend}`,
    `- transport: ${context.kbRuntime.transport}`,
    `- canonical: ${context.kbRuntime.canonical ? 'yes' : 'no'}`,
    `- workspace role: ${context.kbRuntime.workspaceRole}`,
    ...(context.kbRuntime.endpoint ? [`- endpoint: ${context.kbRuntime.endpoint}`] : []),
    '',
    '## Focus',
    '',
    `- categories: ${context.focus.targetCategories.join(', ') || 'unknown'}`,
    `- cases: ${context.focus.targetCases.join(', ') || 'unknown'}`,
    '',
    '## Failure Buckets',
    '',
    ...compactList(context.focus.failureBuckets, 8).map((line) => `- ${line}`),
    '',
    '## Query Samples',
    '',
    ...compactList(context.focus.querySamples, 8).map((line) => `- ${line}`),
    '',
    '## External Targets',
    '',
    ...compactList(context.focus.externalTargets, 8).map((line) => `- ${line}`),
    '',
    '## Current Best',
    '',
    `- dev category passes: ${context.focus.currentBest.categoryPasses}`,
    `- holdout category passes: ${context.focus.currentBest.holdoutCategoryPasses}`,
    `- dev weighted score: ${context.focus.currentBest.weightedScore.toFixed(3)}`,
    `- holdout weighted score: ${context.focus.currentBest.holdoutWeightedScore.toFixed(3)}`,
    '',
    '## Recent Outcomes',
    '',
    ...compactList(context.focus.recentDecisions, 8).map((line) => `- ${line}`),
    ...(context.focus.stall
      ? [
          '',
          '## Stall Diagnosis',
          '',
          `- consecutive non-accepted attempts: ${context.focus.stall.consecutiveFailures}`,
          ...compactList(context.focus.stall.diagnosis, 6).map((line) => `- ${line}`)
        ]
      : []),
    ''
  ].join('\n');
}

function compactList(values: string[] | undefined, limit: number): string[] {
  const trimmed = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed.slice(0, limit) : ['none'];
}
