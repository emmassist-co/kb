import type { KnowledgeBaseCliOptions } from './index.js';
import { executeKnowledgeBaseMirrorValidationCommand } from './mirror-validation.js';
import { executeKnowledgeBaseConflictsCommand } from './conflicts.js';
import { executeKnowledgeBaseSyncCommand, summarizeKnowledgeBaseSyncResult } from './sync.js';
import {
  executeKnowledgeBaseSyncDaemonCommand,
  summarizeKnowledgeBaseSyncDaemonResult
} from './sync-daemon.js';

export function renderKnowledgeBaseHealthHelp(): string {
  return 'kb health [--stats] [--verbose]';
}

export async function executeKnowledgeBaseHealthCommand(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): Promise<Record<string, unknown>> {
  const flags = parseFlags(argv);
  const env = options.env ?? process.env;
  assertR2MirrorBackend(env);
  const tenantId = env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  const syncRaw = await executeKnowledgeBaseSyncCommand(['status'], options);
  const sync = summarizeKnowledgeBaseSyncResult(syncRaw, { changes: true, conflicts: true, stats: flags.stats || flags.verbose });
  const validation = await executeKnowledgeBaseMirrorValidationCommand([
    ...(flags.verbose ? ['--changes'] : []),
    ...(flags.stats || flags.verbose ? ['--stats'] : [])
  ], options);
  const daemonResult = await executeKnowledgeBaseSyncDaemonCommand(['status'], options);
  const daemon = summarizeKnowledgeBaseSyncDaemonResult(daemonResult, { stats: flags.stats || flags.verbose });
  const conflicts = await executeKnowledgeBaseConflictsCommand(['list'], options);

  const result = summarizeKnowledgeBaseHealthChecks({
    tenantId,
    sync,
    validation,
    daemon,
    conflicts
  });
  if (flags.stats || flags.verbose) {
    result.checks = {
      sync,
      validation,
      daemon,
      conflicts
    };
  }
  return result;
}

export function summarizeKnowledgeBaseHealthChecks(input: {
  tenantId: string;
  sync: Record<string, unknown>;
  validation: Record<string, unknown>;
  daemon: Record<string, unknown>;
  conflicts: Record<string, unknown>;
}): Record<string, unknown> {
  const blockers = compact([
    readState(input.sync) === 'conflict' ? 'sync_conflicts' : null,
    readState(input.sync) === 'rejected' ? 'rejected_local_edits' : null,
    input.validation.ok === false ? 'mirror_validation_failed' : null,
    readCount(input.conflicts, 'conflicts') > 0 ? 'conflicts_review_required' : null
  ]);
  const warnings = compact([
    input.daemon.ok === false ? 'daemon_not_running' : null,
    readState(input.sync) === 'drift' ? 'mirror_drift' : null
  ]);
  const state = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'degraded' : 'healthy';
  return {
    ok: blockers.length === 0 && warnings.length === 0,
    command: 'health',
    state,
    tenantId: input.tenantId,
    workspace: {
      backend: 'r2-mirror',
      canonical: false
    },
    counts: {
      syncChanged: readCount(input.sync, 'changed'),
      syncConflicts: readCount(input.sync, 'conflicts'),
      validationBlockers: readCount(input.validation, 'blockers'),
      conflicts: readCount(input.conflicts, 'conflicts')
    },
    blockers,
    warnings,
    nextActions: nextActionsFor({ blockers, warnings })
  };
}

function parseFlags(argv: string[]): { stats?: boolean; verbose?: boolean } {
  const flags: { stats?: boolean; verbose?: boolean } = {};
  for (const token of argv) {
    if (token === '--stats') flags.stats = true;
    else if (token === '--verbose') flags.verbose = true;
    else throw new Error(`Usage: ${renderKnowledgeBaseHealthHelp()}`);
  }
  return flags;
}

function readState(value: unknown): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).state === 'string'
    ? (value as Record<string, string>).state
    : undefined;
}

function readCount(value: unknown, key: string): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const counts = (value as Record<string, unknown>).counts;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return 0;
  const count = (counts as Record<string, unknown>)[key];
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

function nextActionsFor(input: { blockers: string[]; warnings: string[] }): string[] {
  const actions: string[] = [];
  if (input.blockers.includes('mirror_validation_failed') || input.blockers.includes('rejected_local_edits')) actions.push('run_validate_mirror');
  if (input.blockers.includes('sync_conflicts') || input.blockers.includes('conflicts_review_required')) actions.push('review_conflicts');
  if (input.warnings.includes('daemon_not_running')) actions.push('start_daemon');
  if (input.warnings.includes('mirror_drift')) actions.push('run_sync_pull_or_push');
  return [...new Set(actions)];
}

function compact(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function assertR2MirrorBackend(env: Record<string, string | undefined>): void {
  if (env.KB_BACKEND?.trim().toLowerCase() !== 'r2-mirror') {
    throw new Error('`kb health` is only supported with KB_BACKEND=r2-mirror.');
  }
}
