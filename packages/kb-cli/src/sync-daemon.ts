import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { KnowledgeBaseCliOptions } from './index.js';
import { executeKnowledgeBaseSyncCommand, resolveMirrorRoot } from './sync.js';

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
  const hints = compactHints([
    running ? 'running' : 'not_running',
    status?.detail === 'failed; see log' ? 'check_logs' : null
  ]);
  const summary: Record<string, unknown> = {
    ok: running,
    command: 'daemon',
    action,
    state: running
      ? status?.state ?? 'running'
      : 'stopped',
    counts: {},
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
        await executeKnowledgeBaseSyncCommand(['push'], options);
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
        await runSync('push', input.options, input.logFile, input.statusFile);
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

function isRunningStatusOutput(stdout: string, exitCode: number): boolean {
  if (exitCode !== 0) return false;
  const firstLine = stdout.trim().split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine?.startsWith('kb daemon running') ?? false;
}

function compactHints(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
