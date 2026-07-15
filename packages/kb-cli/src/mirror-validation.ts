import path from 'node:path';
import type { KnowledgeBaseCliOptions } from './index.js';
import { executeKnowledgeBaseSyncCommand, resolveMirrorRoot } from './sync.js';
import { classifySemanticMirrorPath } from './semantic-sync/contract.js';
import { diffSemanticMirrorRecord } from './semantic-sync/diff.js';
import {
  readLocalMirrorFile,
  readTenantKbBaseFile,
  type TenantKbStatusEntry
} from './r2-sync-lib.js';
import {
  compactNextActions,
  summarizeOperatorIssues,
  type KnowledgeBaseOperatorIssue
} from './operator-diagnostics.js';

interface MirrorValidationOptions {
  all?: boolean;
  changes?: boolean;
  stats?: boolean;
  verbose?: boolean;
}

export interface MirrorValidationResult {
  issues: KnowledgeBaseOperatorIssue[];
  validatedPaths: string[];
  checkedPaths: string[];
}

export function renderKnowledgeBaseMirrorValidationHelp(): string {
  return 'kb validate-mirror [--all] [--changes] [--stats] [--verbose]';
}

export async function executeKnowledgeBaseMirrorValidationCommand(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): Promise<Record<string, unknown>> {
  const flags = parseFlags(argv);
  const env = options.env ?? process.env;
  assertR2MirrorBackend(env);
  const tenantId = env.KB_WORKSPACE_ID ?? env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  const cwd = options.cwd ?? process.cwd();
  const mirrorRoot = resolveMirrorRoot(cwd, env, tenantId);
  const syncStatus = await executeKnowledgeBaseSyncCommand(['status'], options);
  const entries = readStatusEntries(syncStatus.entries);
  const validation = await validateKnowledgeBaseMirrorEntries({
    mirrorRoot,
    entries,
    all: flags.all
  });
  const issues = validation.issues;

  const issueSummary = summarizeOperatorIssues(issues);
  const result: Record<string, unknown> = {
    ok: issueSummary.counts.blockers === 0,
    command: 'validate-mirror',
    state: issueSummary.counts.blockers > 0 ? 'invalid' : 'valid',
    tenantId,
    counts: {
      checked: validation.checkedPaths.length,
      validated: validation.validatedPaths.length,
      blockers: issueSummary.counts.blockers,
      warnings: issueSummary.counts.warnings
    },
    nextActions: compactNextActions(issues)
  };
  if (flags.changes || flags.verbose) result.issues = issues;
  if (flags.stats || flags.verbose) {
    result.stats = {
      mirrorRoot,
      totalEntries: entries.length,
      checkedPaths: validation.checkedPaths
    };
  }
  return result;
}

export async function validateKnowledgeBaseMirrorEntries(input: {
  mirrorRoot: string;
  entries: TenantKbStatusEntry[];
  all?: boolean;
}): Promise<MirrorValidationResult> {
  const selectedEntries = input.all ? input.entries : input.entries.filter((entry) => entry.state !== 'unchanged');
  const issues: KnowledgeBaseOperatorIssue[] = [];
  const validatedPaths: string[] = [];

  for (const entry of selectedEntries) {
    const classification = classifySemanticMirrorPath(entry.path);
    if (classification.pathClass === 'daemon-state') continue;
    if (classification.pathClass !== 'editable-record') {
      if (entry.state === 'rejected-local' || entry.state === 'modified-local' || entry.state === 'added-local' || entry.state === 'deleted-local') {
        issues.push({
          path: entry.path,
          code: 'support_only_edit',
          severity: 'error',
          message: `Support-only mirror file was edited locally: ${entry.path}`,
          nextAction: 'revert_support_only_edit_or_use_operator_repair'
        });
      }
      continue;
    }

    if (entry.state === 'conflict') {
      issues.push({
        path: entry.path,
        recordKind: classification.recordKind,
        code: 'remote_drift',
        severity: 'error',
        message: `Canonical record changed since last sync: ${entry.path}`,
        nextAction: 'review_conflicts'
      });
      continue;
    }
    if (entry.state === 'deleted-local') {
      issues.push({
        path: entry.path,
        recordKind: classification.recordKind,
        code: 'unsupported_delete',
        severity: 'error',
        message: `Semantic mirror validation does not support deleting editable records: ${entry.path}`,
        nextAction: 'restore_or_delete_through_canonical_kb'
      });
      continue;
    }
    if (entry.state !== 'modified-local' && entry.state !== 'added-local' && !input.all) continue;

    let editedMarkdown = '';
    try {
      editedMarkdown = (await readLocalMirrorFile(input.mirrorRoot, entry.path)).toString('utf8');
    } catch (error) {
      issues.push({
        path: entry.path,
        recordKind: classification.recordKind,
        code: 'read_error',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
        nextAction: 'restore_or_pull_mirror'
      });
      continue;
    }
    const baselineMarkdown = (await readTenantKbBaseFile(input.mirrorRoot, entry.path))?.toString('utf8') ?? null;
    if (!baselineMarkdown && entry.state !== 'added-local') {
      issues.push({
        path: entry.path,
        recordKind: classification.recordKind,
        code: 'missing_baseline',
        severity: 'error',
        message: `No baseline snapshot found for ${entry.path}.`,
        nextAction: 'run_sync_pull_before_validating'
      });
      continue;
    }

    const diff = diffSemanticMirrorRecord({
      path: entry.path,
      baselineMarkdown,
      editedMarkdown,
      canonicalMarkdown: baselineMarkdown
    });
    validatedPaths.push(entry.path);
    if (!diff.ok) {
      issues.push({
        path: diff.path,
        recordKind: classification.recordKind,
        code: diff.code,
        severity: 'error',
        message: diff.message,
        issues: diff.issues,
        nextAction: nextActionForDiffCode(diff.code)
      });
    }
  }
  return {
    issues,
    validatedPaths,
    checkedPaths: selectedEntries.map((entry) => entry.path)
  };
}

function parseFlags(argv: string[]): MirrorValidationOptions {
  const flags: MirrorValidationOptions = {};
  for (const token of argv) {
    if (token === '--all') flags.all = true;
    else if (token === '--changes') flags.changes = true;
    else if (token === '--stats') flags.stats = true;
    else if (token === '--verbose') flags.verbose = true;
    else throw new Error(`Usage: ${renderKnowledgeBaseMirrorValidationHelp()}`);
  }
  return flags;
}

function readStatusEntries(value: unknown): TenantKbStatusEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { path?: unknown; state?: unknown } => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      path: typeof entry.path === 'string' ? entry.path : '',
      state: typeof entry.state === 'string' ? entry.state as TenantKbStatusEntry['state'] : 'unchanged'
    }))
    .filter((entry) => entry.path !== '');
}

function nextActionForDiffCode(code: string): string {
  if (code === 'parse_error' || code === 'validation_error') return 'fix_markdown_and_rerun_validate_mirror';
  if (code === 'remote_drift') return 'review_conflicts';
  if (code === 'unsupported_path') return 'revert_support_only_edit_or_use_operator_repair';
  return 'inspect_issue';
}

function assertR2MirrorBackend(env: Record<string, string | undefined>): void {
  if (env.KB_BACKEND?.trim().toLowerCase() !== 'r2-mirror') {
    throw new Error('`kb validate-mirror` is only supported with KB_BACKEND=r2-mirror.');
  }
}
