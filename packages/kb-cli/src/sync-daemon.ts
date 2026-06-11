import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { KnowledgeBaseCliOptions } from './index.js';
import { createExecutor } from './index.js';
import { executeKnowledgeBaseSyncCommand, resolveMirrorRoot } from './sync.js';
import type { KnowledgeMutationResult } from '@emmassist-co/kb-core';
import type {
  SemanticAnnotateInput,
  SemanticRecordInput,
  SemanticRecordSourceInput
} from './semantic-sync/compile.js';
import { classifySemanticMirrorPath } from './semantic-sync/contract.js';
import { diffSemanticMirrorRecord } from './semantic-sync/diff.js';
import { compileSemanticMirrorDiff } from './semantic-sync/compile.js';
import { applySemanticMutationPlan } from './semantic-sync/apply.js';
import { readLocalMirrorFile, readTenantKbBaseFile, type TenantKbStatusEntry } from './r2-sync-lib.js';

interface KnowledgeBaseSyncDaemonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface KnowledgeBaseSyncDaemonSummaryOptions {
  action?: string;
  verbose?: boolean;
  logs?: boolean;
  stats?: boolean;
}

type KnowledgeBaseSyncDaemonAction = 'start' | 'stop' | 'restart' | 'status' | 'logs' | 'once' | 'run-internal';

interface SemanticSyncStatus {
  state: 'ok' | 'blocked';
  appliedEdits: number;
  rejectedEdits: number;
  conflicts: number;
  refreshFailed?: boolean;
}

export interface SemanticMirrorApplyResult {
  appliedEdits: number;
  rejectedEdits: number;
  conflicts: number;
  touchedPaths: string[];
  issues: Array<{ path: string; code: string; message: string }>;
}

interface SemanticMirrorExecutor {
  get(id: string): Promise<{ kind: 'entity' | 'source'; markdown: string; parsed: unknown }>;
  record(input: SemanticRecordInput): Promise<KnowledgeMutationResult>;
  recordSource(input: SemanticRecordSourceInput): Promise<KnowledgeMutationResult>;
  annotate(input: SemanticAnnotateInput): Promise<KnowledgeMutationResult>;
}

export function renderKnowledgeBaseSyncDaemonHelp(): string {
  return 'kb daemon <start|stop|restart|status|logs|once> [--verbose] [--logs] [--stats]';
}

export function summarizeKnowledgeBaseSyncDaemonResult(
  result: KnowledgeBaseSyncDaemonResult,
  options: KnowledgeBaseSyncDaemonSummaryOptions = {}
): Record<string, unknown> {
  if (options.verbose) {
    return {
      ok: result.exitCode === 0,
      command: 'daemon',
      action: options.action ?? 'status',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    };
  }
  const action = options.action ?? 'status';
  if (action === 'logs') {
    const lineCount = result.stdout.trim() ? result.stdout.trim().split('\n').length : 0;
    const summary: Record<string, unknown> = {
      ok: result.exitCode === 0,
      command: 'daemon',
      action: 'logs',
      state: result.exitCode === 0 ? 'ok' : 'error',
      counts: {
        lines: lineCount
      },
      hints: ['use_verbose_for_log_lines']
    };
    if (options.logs) summary.logs = result.stdout;
    return summary;
  }

  const status = parseDaemonStatusPayload(result.stdout);
  const running = isRunningStatusOutput(result.stdout, result.exitCode);
  const semantic = readSemanticStatus(status);
  const hints = compactHints([
    running ? 'running' : 'not_running',
    semantic?.state === 'blocked' ? 'semantic_sync_blocked' : null,
    status?.detail === 'failed; see log' ? 'check_logs' : null
  ]);
  const summary: Record<string, unknown> = {
    ok: running,
    command: 'daemon',
    action,
    state: running
      ? semantic?.state === 'blocked'
        ? 'semantic_blocked'
        : status?.state ?? 'running'
      : 'stopped',
    counts: semantic
      ? {
          ...(typeof semantic.rejectedEdits === 'number' && semantic.rejectedEdits > 0 ? { rejectedEdits: semantic.rejectedEdits } : {}),
          ...(typeof semantic.conflicts === 'number' && semantic.conflicts > 0 ? { semanticConflicts: semantic.conflicts } : {})
        }
      : {},
    hints
  };
  if (options.stats && status) {
    summary.stats = status;
  }
  return summary;
}

export async function executeKnowledgeBaseSyncDaemonCommand(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): Promise<KnowledgeBaseSyncDaemonResult> {
  const action = (argv[0] ?? 'status') as KnowledgeBaseSyncDaemonAction;
  const env = options.env ?? process.env;
  if (env.KB_BACKEND?.trim().toLowerCase() !== 'r2-mirror') {
    return {
      stdout: '',
      stderr: '`kb daemon` is only supported with KB_BACKEND=r2-mirror.',
      exitCode: 1
    };
  }
  if (!isDaemonAction(action)) {
    return {
      stdout: '',
      stderr: `Usage: ${renderKnowledgeBaseSyncDaemonHelp()}`,
      exitCode: 1
    };
  }

  const cwd = options.cwd ?? process.cwd();
  const tenantId = env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  const stateDir = path.resolve(cwd, env.KB_SYNC_STATE_DIR ?? '.state/kb-sync');
  const pidFile = path.join(stateDir, 'daemon.pid');
  const logFile = path.join(stateDir, 'daemon.log');
  const statusFile = path.join(stateDir, 'daemon.status.json');
  const mirrorRoot = resolveMirrorRoot(cwd, env, tenantId);
  mkdirSync(stateDir, { recursive: true });

  switch (action) {
    case 'start':
      if (isRunning(pidFile)) {
        return { stdout: `kb daemon already running (pid ${readPid(pidFile)})`, stderr: '', exitCode: 0 };
      }
      writeFileSync(logFile, '', 'utf8');
      startDetachedDaemon(options);
      return { stdout: 'kb daemon started', stderr: '', exitCode: 0 };
    case 'stop':
      if (!isRunning(pidFile)) {
        rmSync(pidFile, { force: true });
        return { stdout: 'kb daemon not running', stderr: '', exitCode: 0 };
      }
      process.kill(readPid(pidFile), 'SIGTERM');
      return { stdout: 'kb daemon stopped', stderr: '', exitCode: 0 };
    case 'restart':
      if (isRunning(pidFile)) process.kill(readPid(pidFile), 'SIGTERM');
      startDetachedDaemon(options);
      return { stdout: 'kb daemon restarted', stderr: '', exitCode: 0 };
    case 'status': {
      if (isRunning(pidFile)) {
        const extra = existsSync(statusFile) ? `\n${readFileSync(statusFile, 'utf8').trim()}` : '';
        return { stdout: `kb daemon running (pid ${readPid(pidFile)})${extra}`, stderr: '', exitCode: 0 };
      }
      const extra = existsSync(statusFile) ? `\n${readFileSync(statusFile, 'utf8').trim()}` : '';
      return { stdout: `kb daemon not running${extra}`, stderr: '', exitCode: 1 };
    }
    case 'logs': {
      const lines = Number.parseInt(argv[1] ?? '80', 10);
      const content = existsSync(logFile)
        ? readFileSync(logFile, 'utf8').trim().split('\n').slice(-Math.max(1, lines)).join('\n')
        : '';
      return { stdout: content, stderr: '', exitCode: 0 };
    }
    case 'once':
      try {
        await executeKnowledgeBaseSyncCommand(['pull'], options);
        if (isSemanticSyncEnabled(env)) {
          const outcome = await runSemanticSyncPass(options, stateDir);
          if (outcome.appliedEdits > 0) {
            await executeKnowledgeBaseSyncCommand(['pull'], options);
          } else if (outcome.rejectedEdits === 0 && outcome.conflicts === 0) {
            await executeKnowledgeBaseSyncCommand(['push'], options);
          }
        } else {
          await executeKnowledgeBaseSyncCommand(['push'], options);
        }
        return { stdout: `kb daemon once completed for ${mirrorRoot}`, stderr: '', exitCode: 0 };
      } catch (error) {
        return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1 };
      }
    case 'run-internal':
      await runLoop({ options, pidFile, logFile, statusFile, mirrorRoot });
      return { stdout: '', stderr: '', exitCode: 0 };
  }
}

async function runLoop(input: {
  options: KnowledgeBaseCliOptions;
  pidFile: string;
  logFile: string;
  statusFile: string;
  mirrorRoot: string;
}): Promise<void> {
  const env = input.options.env ?? process.env;
  const pullInterval = readPositiveInt(env.KB_SYNC_PULL_INTERVAL_SECONDS, 300);
  const pushDebounce = readPositiveInt(env.KB_SYNC_PUSH_DEBOUNCE_SECONDS, 10);
  const loopSeconds = readPositiveInt(env.KB_SYNC_LOOP_SECONDS, 5);
  const jitterSeconds = readPositiveInt(env.KB_SYNC_JITTER_SECONDS, 30);

  writeFileSync(input.pidFile, `${process.pid}\n`, 'utf8');
  const cleanup = () => {
    rmSync(input.pidFile, { force: true });
    writeStatus(input.statusFile, 'stopped', 'exit', 'stopped');
  };
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  writeStatus(input.statusFile, 'starting', 'daemon', 'starting');
  let lastSignature = computeLocalSignature(input.mirrorRoot);
  let nextPull = 0;

  while (true) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= nextPull) {
      await runSync('pull', input.options, input.logFile, input.statusFile);
      lastSignature = computeLocalSignature(input.mirrorRoot);
      const jitter = jitterSeconds > 0 ? Math.floor(Math.random() * (jitterSeconds + 1)) : 0;
      nextPull = now + pullInterval + jitter;
    }

    const currentSignature = computeLocalSignature(input.mirrorRoot);
    if (currentSignature !== lastSignature) {
      writeStatus(input.statusFile, 'debouncing', 'push', 'local changes detected');
      await sleep(pushDebounce * 1000);
      const afterDebounce = computeLocalSignature(input.mirrorRoot);
      if (afterDebounce !== lastSignature) {
        if (isSemanticSyncEnabled(env)) {
          const outcome = await runSemanticSyncPass(input.options, path.dirname(input.statusFile));
          if (outcome.appliedEdits > 0) {
            await runSync('pull', input.options, input.logFile, input.statusFile);
          } else if (outcome.rejectedEdits === 0 && outcome.conflicts === 0) {
            await runSync('push', input.options, input.logFile, input.statusFile);
          }
        } else {
          await runSync('push', input.options, input.logFile, input.statusFile);
        }
        lastSignature = computeLocalSignature(input.mirrorRoot);
      }
    } else {
      writeStatus(input.statusFile, 'idle', 'sleep', `next pull at ${nextPull}`);
    }

    await sleep(loopSeconds * 1000);
  }
}

async function runSync(
  command: 'pull' | 'push',
  options: KnowledgeBaseCliOptions,
  logFile: string,
  statusFile: string
): Promise<void> {
  writeStatus(statusFile, 'syncing', command, 'running');
  appendLog(logFile, `kb sync ${command}`);
  try {
    const result = await executeKnowledgeBaseSyncCommand([command], options);
    appendLog(logFile, JSON.stringify(result));
    writeStatus(statusFile, 'idle', command, 'ok');
  } catch (error) {
    appendLog(logFile, error instanceof Error ? error.message : String(error));
    writeStatus(statusFile, 'error', command, 'failed; see log');
  }
}

function startDetachedDaemon(options: KnowledgeBaseCliOptions): void {
  const env = { ...process.env, ...(options.env ?? {}) };
  const cliEntry = fileURLToPath(new URL('../bin/kb-local.mjs', import.meta.url));
  const child = spawn(process.execPath, [cliEntry, 'daemon', 'run-internal'], {
    cwd: options.cwd ?? process.cwd(),
    env,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function computeLocalSignature(mirrorRoot: string): string {
  if (!existsSync(mirrorRoot)) return 'missing';
  const hash = createHash('sha256');
  const walk = (currentDir: string) => {
    for (const entry of readdirSync(currentDir).sort()) {
      if (entry === '.kb-sync-base' || entry === '.kb-sync-conflicts' || entry === '.kb-sync-manifest.json') continue;
      const fullPath = path.join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      hash.update(path.relative(mirrorRoot, fullPath));
      hash.update(readFileSync(fullPath));
    }
  };
  walk(mirrorRoot);
  return hash.digest('hex');
}

function writeStatus(statusFile: string, state: string, action: string, detail: string): void {
  writeFileSync(statusFile, JSON.stringify({
    state,
    action,
    detail,
    pid: process.pid,
    updatedAt: new Date().toISOString()
  }), 'utf8');
}

async function runSemanticSyncPass(
  options: KnowledgeBaseCliOptions,
  stateDir: string
): Promise<SemanticMirrorApplyResult> {
  const status = await executeKnowledgeBaseSyncCommand(['status'], options);
  const entries = readStatusEntries(status.entries);
  const cliExecutor = await createExecutor(options);
  const executor: SemanticMirrorExecutor = {
    get: async (id) => await cliExecutor.get(id) as { kind: 'entity' | 'source'; markdown: string; parsed: unknown },
    record: async (input) => await cliExecutor.record(input as unknown as Record<string, unknown>) as KnowledgeMutationResult,
    recordSource: async (input) => await cliExecutor.recordSource(input) as KnowledgeMutationResult,
    annotate: async (input) => await cliExecutor.annotate(input as unknown as Record<string, unknown>) as KnowledgeMutationResult
  };
  const mirrorRoot = resolveMirrorRoot(options.cwd ?? process.cwd(), options.env ?? process.env, options.env?.KB_TENANT_ID ?? options.env?.WORKSPACE_TENANT_ID ?? 'default');
  const outcome = await applyKnowledgeBaseSemanticSyncEdits({
    mirrorRoot,
    statusEntries: entries,
    executor
  });
  const semanticStatus: SemanticSyncStatus = {
    state: outcome.rejectedEdits > 0 || outcome.conflicts > 0 ? 'blocked' : 'ok',
    appliedEdits: outcome.appliedEdits,
    rejectedEdits: outcome.rejectedEdits,
    conflicts: outcome.conflicts
  };
  if (outcome.issues.length > 0) {
    appendLog(path.join(stateDir, 'daemon.log'), JSON.stringify({ semanticIssues: outcome.issues }));
  }
  writeStatusWithSemantic(
    path.join(stateDir, 'daemon.status.json'),
    semanticStatus.state === 'blocked' ? 'blocked' : 'idle',
    'semantic-sync',
    semanticStatus.state === 'blocked' ? 'blocked by local edits' : 'ok',
    semanticStatus
  );
  return outcome;
}

export async function applyKnowledgeBaseSemanticSyncEdits(input: {
  mirrorRoot: string;
  statusEntries: TenantKbStatusEntry[];
  executor: SemanticMirrorExecutor;
}): Promise<SemanticMirrorApplyResult> {
  const outcome: SemanticMirrorApplyResult = {
    appliedEdits: 0,
    rejectedEdits: 0,
    conflicts: 0,
    touchedPaths: [],
    issues: []
  };

  for (const entry of input.statusEntries) {
    const classification = classifySemanticMirrorPath(entry.path);
    if (classification.pathClass !== 'editable-record') {
      if (entry.state === 'rejected-local') {
        outcome.rejectedEdits += 1;
        outcome.issues.push({ path: entry.path, code: 'rejected_local', message: 'Support-only mirror file was edited locally.' });
      }
      continue;
    }

    if (entry.state === 'conflict') {
      outcome.conflicts += 1;
      outcome.issues.push({ path: entry.path, code: 'remote_conflict', message: 'Remote canonical record changed since last sync.' });
      continue;
    }
    if (entry.state === 'deleted-local' || entry.state === 'rejected-local') {
      outcome.rejectedEdits += 1;
      outcome.issues.push({ path: entry.path, code: 'unsupported_edit', message: `Semantic sync does not support ${entry.state}.` });
      continue;
    }
    if (entry.state !== 'modified-local' && entry.state !== 'added-local') {
      continue;
    }

    const editedMarkdown = (await readLocalMirrorFile(input.mirrorRoot, entry.path)).toString('utf8');
    const baselineMarkdown = (await readTenantKbBaseFile(input.mirrorRoot, entry.path))?.toString('utf8') ?? null;
    const recordId = path.basename(entry.path, '.md');
    let canonicalMarkdown: string | null = null;
    try {
      const canonical = await input.executor.get(recordId);
      if (canonical.kind !== classification.recordKind) {
        outcome.conflicts += 1;
        outcome.issues.push({ path: entry.path, code: 'kind_mismatch', message: `Canonical record kind mismatch for ${recordId}.` });
        continue;
      }
      canonicalMarkdown = canonical.markdown;
    } catch (error) {
      if (entry.state !== 'added-local') {
        outcome.conflicts += 1;
        outcome.issues.push({
          path: entry.path,
          code: 'canonical_lookup_failed',
          message: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
    }

    const diff = diffSemanticMirrorRecord({
      path: entry.path,
      baselineMarkdown,
      editedMarkdown,
      canonicalMarkdown
    });
    const plan = compileSemanticMirrorDiff(diff);
    if (!plan.ok) {
      if (plan.code === 'diff_failed' && diff.ok === false && diff.code === 'remote_drift') {
        outcome.conflicts += 1;
      } else {
        outcome.rejectedEdits += 1;
      }
      outcome.issues.push({ path: entry.path, code: plan.code, message: plan.message });
      continue;
    }

    await applySemanticMutationPlan(input.executor, plan);
    outcome.appliedEdits += 1;
    outcome.touchedPaths.push(entry.path);
  }

  return outcome;
}

function writeStatusWithSemantic(
  statusFile: string,
  state: string,
  action: string,
  detail: string,
  semanticSync: SemanticSyncStatus
): void {
  writeFileSync(statusFile, JSON.stringify({
    state,
    action,
    detail,
    semanticSync,
    pid: process.pid,
    updatedAt: new Date().toISOString()
  }), 'utf8');
}

function appendLog(logFile: string, message: string): void {
  appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function isRunning(pidFile: string): boolean {
  if (!existsSync(pidFile)) return false;
  try {
    process.kill(readPid(pidFile), 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidFile: string): number {
  return Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isDaemonAction(value: string): value is KnowledgeBaseSyncDaemonAction {
  return ['start', 'stop', 'restart', 'status', 'logs', 'once', 'run-internal'].includes(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDaemonStatusPayload(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine?.startsWith('{')) return null;
  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isSemanticSyncEnabled(env: Record<string, string | undefined>): boolean {
  return Boolean(env.KB_BASE_URL?.trim());
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

function readSemanticStatus(status: Record<string, unknown> | null): {
  state?: string;
  rejectedEdits?: number;
  conflicts?: number;
} | null {
  if (!status) return null;
  const semantic = status.semanticSync;
  if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) return null;
  const value = semantic as Record<string, unknown>;
  return {
    state: typeof value.state === 'string' ? value.state : undefined,
    rejectedEdits: typeof value.rejectedEdits === 'number' && Number.isFinite(value.rejectedEdits) ? value.rejectedEdits : undefined,
    conflicts: typeof value.conflicts === 'number' && Number.isFinite(value.conflicts) ? value.conflicts : undefined
  };
}

function isRunningStatusOutput(stdout: string, exitCode: number): boolean {
  if (exitCode !== 0) return false;
  const firstLine = stdout.trim().split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine?.startsWith('kb daemon running') ?? false;
}

function compactHints(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
