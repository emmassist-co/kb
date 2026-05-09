import path from 'node:path';
import { buildRunConfig, loadRunConfig } from '../packages/kb-autoresearch/src/config.js';
import { ShellCommandRunner } from '../packages/kb-autoresearch/src/command-runner.js';
import { CodexExecAgentAdapter } from '../packages/kb-autoresearch/src/codex-adapter.js';
import { KbAutoresearchEvaluator } from '../packages/kb-autoresearch/src/evaluator.js';
import { LoopRunner } from '../packages/kb-autoresearch/src/loop.js';
import { PiAgentAdapter } from '../packages/kb-autoresearch/src/pi-adapter.js';
import { ExperimentRecorder } from '../packages/kb-autoresearch/src/recorder.js';
import { CandidateWorkspaceManager } from '../packages/kb-autoresearch/src/workspace.js';
import type { KbAutoresearchCliOptions } from '../packages/kb-autoresearch/src/types.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const config = options.resumeRunId ? loadRunConfig(repoRoot, options.resumeRunId) : buildRunConfig(repoRoot, options);
  const recorder = new ExperimentRecorder(config);
  const runner = new ShellCommandRunner();
  const workspaceManager = new CandidateWorkspaceManager(runner, repoRoot);
  const evaluator = new KbAutoresearchEvaluator(runner, { onLog: (message) => recorder.appendLog(message) });
  const agent =
    config.agentBackend === 'pi'
      ? new PiAgentAdapter(runner, { command: config.agentCommand, provider: config.agentProvider, onLog: (message) => recorder.appendLog(message) })
      : new CodexExecAgentAdapter(runner, { onLog: (message) => recorder.appendLog(message) });
  const loop = new LoopRunner(repoRoot, workspaceManager, evaluator, agent, recorder);
  await loop.run(config);
  console.log(`kb-autoresearch run complete: ${config.runId}`);
  console.log(`report: ${path.relative(repoRoot, config.paths.reportPath)}`);
}

function parseArgs(argv: string[]) {
  const parsed: KbAutoresearchCliOptions = {
    iterations: 5,
    timeBudgetMin: 30,
    agentBackend: 'pi',
    benchmarkSubset: 'all',
    dryRun: false,
    keepDebugArtifacts: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--iterations') {
      parsed.iterations = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg === '--time-budget-min') {
      parsed.timeBudgetMin = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg === '--model') {
      parsed.model = argv[index + 1];
      index += 1;
    } else if (arg === '--agent-backend') {
      parsed.agentBackend = (argv[index + 1] as 'codex' | 'pi') ?? 'pi';
      index += 1;
    } else if (arg === '--agent-command') {
      parsed.agentCommand = argv[index + 1];
      index += 1;
    } else if (arg === '--agent-provider') {
      parsed.agentProvider = argv[index + 1];
      index += 1;
    } else if (arg === '--worktree-root') {
      parsed.worktreeRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--benchmark-subset') {
      parsed.benchmarkSubset = (argv[index + 1] as 'all' | 'fast') ?? 'all';
      index += 1;
    } else if (arg === '--resume') {
      parsed.resumeRunId = argv[index + 1];
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--debug-artifacts') {
      parsed.keepDebugArtifacts = true;
    } else if (arg === '--max-changed-files') {
      parsed.maxChangedFiles = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg === '--max-unified-diff-lines') {
      parsed.maxUnifiedDiffLines = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
