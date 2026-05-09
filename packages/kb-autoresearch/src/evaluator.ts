import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BenchmarkSnapshot, CandidateEvaluation, CommandRunner } from './types.js';
import { buildCandidateScore, buildScreeningSummary } from './scorer.js';

const KB_TEST_ARGS = ['--test', 'tests/kb.test.ts', 'tests/kb-benchmark.test.ts', 'tests/kb-autoresearch.test.ts'];

type CommandSpec = { command: string; args: string[] };

export class KbAutoresearchEvaluator {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: {
      onLog?: (message: string) => void;
    } = {}
  ) {}

  async evaluateBaseline(worktreePath: string, fixturesRoot: string): Promise<CandidateEvaluation> {
    const outputs = await this.runCommands(worktreePath, buildEvaluationCommands(fixturesRoot));
    if ('failed' in outputs) {
      return outputs.failed;
    }

    try {
      const snapshot = parseSnapshot(outputs.completed);
      const score = buildCandidateScore(snapshot);
      return {
        ok: true,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'full',
        score,
        screening: buildScreeningSummary(snapshot.adminWorldDev),
        commandOutputs: outputs.completed
      };
    } catch (error) {
      return {
        ok: false,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'full',
        rejectReason: error instanceof Error ? error.message : String(error),
        commandOutputs: outputs.completed
      };
    }
  }

  async evaluateScreening(worktreePath: string, fixturesRoot: string): Promise<CandidateEvaluation> {
    const outputs = await this.runCommands(worktreePath, buildScreeningCommands(fixturesRoot));
    if ('failed' in outputs) {
      return outputs.failed;
    }

    try {
      const adminWorldDev = JSON.parse(stripToJson(outputs.completed[2].stdout));
      return {
        ok: true,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'screen',
        screening: buildScreeningSummary(adminWorldDev),
        adminWorldDev,
        commandOutputs: outputs.completed
      };
    } catch (error) {
      return {
        ok: false,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'screen',
        rejectReason: error instanceof Error ? error.message : String(error),
        commandOutputs: outputs.completed
      };
    }
  }

  async evaluatePromoted(
    worktreePath: string,
    fixturesRoot: string,
    screeningOutputs: CandidateEvaluation['commandOutputs']
  ): Promise<CandidateEvaluation> {
    const outputs = await this.runCommands(worktreePath, buildPromotionCommands(fixturesRoot), screeningOutputs);
    if ('failed' in outputs) {
      return outputs.failed;
    }

    try {
      const snapshot = parseSnapshot(outputs.completed);
      const score = buildCandidateScore(snapshot);
      return {
        ok: true,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'full',
        score,
        screening: buildScreeningSummary(snapshot.adminWorldDev),
        commandOutputs: outputs.completed
      };
    } catch (error) {
      return {
        ok: false,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'full',
        rejectReason: error instanceof Error ? error.message : String(error),
        commandOutputs: outputs.completed
      };
    }
  }

  writeSnapshotArtifacts(runRoot: string, label: string, snapshot: BenchmarkSnapshot): void {
    const outputDir = path.join(runRoot, 'benchmarks');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, `${label}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  private async runCommands(
    worktreePath: string,
    commands: CommandSpec[],
    existingOutputs: CandidateEvaluation['commandOutputs'] = []
  ): Promise<
    | { completed: CandidateEvaluation['commandOutputs'] }
    | { failed: CandidateEvaluation }
  > {
    const outputs: CandidateEvaluation['commandOutputs'] = [...existingOutputs];
    for (const entry of commands) {
      this.options.onLog?.(`[eval] starting ${entry.command} ${entry.args.join(' ')}`);
      const startedAt = Date.now();
      const result = await this.runner.run(entry.command, entry.args, { cwd: worktreePath });
      this.options.onLog?.(
        `[eval] finished ${entry.command} ${entry.args.join(' ')} exit=${result.exitCode} duration_ms=${Date.now() - startedAt}`
      );
      outputs.push({
        command: [entry.command, ...entry.args].join(' '),
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      });
      if (result.exitCode !== 0) {
        return {
          failed: {
            ok: false,
            typecheckOk: outputs[0]?.exitCode === 0,
            testsOk: outputs[1]?.exitCode === 0,
            stageReached: existingOutputs.length > 0 ? 'full' : 'screen',
            rejectReason: `Command failed: ${entry.command} ${entry.args.join(' ')}`,
            commandOutputs: outputs
          }
        };
      }
    }
    return { completed: outputs };
  }
}

export function buildScreeningCommands(fixturesRoot: string): CommandSpec[] {
  return [
    { command: 'npm', args: ['run', 'typecheck'] },
    { command: './node_modules/.bin/tsx', args: KB_TEST_ARGS },
    { command: 'npm', args: ['run', 'eval:kb:admin-world', '--', '--json', '--split', 'dev'] }
  ];
}

export function buildPromotionCommands(fixturesRoot: string): CommandSpec[] {
  return [
    { command: 'npm', args: ['run', 'eval:kb:all', '--', '--json', '--no-write-scorecard', '--fixtures', path.join(fixturesRoot, 'core-six-dev')] },
    { command: 'npm', args: ['run', 'eval:kb:all', '--', '--json', '--no-write-scorecard', '--fixtures', path.join(fixturesRoot, 'core-six-holdout')] },
    { command: 'npm', args: ['run', 'eval:kb:admin-world', '--', '--json', '--split', 'holdout'] },
    { command: 'npm', args: ['run', 'eval:kb:gbrain-world', '--', '--json'] }
  ];
}

export function buildEvaluationCommands(fixturesRoot: string): CommandSpec[] {
  return [...buildScreeningCommands(fixturesRoot), ...buildPromotionCommands(fixturesRoot)];
}

function parseSnapshot(outputs: CandidateEvaluation['commandOutputs']): BenchmarkSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    adminWorldDev: JSON.parse(stripToJson(outputs[2].stdout)),
    devScorecard: JSON.parse(stripToJson(outputs[3].stdout)),
    holdoutScorecard: JSON.parse(stripToJson(outputs[4].stdout)),
    adminWorldHoldout: JSON.parse(stripToJson(outputs[5].stdout)),
    gbrainWorld: JSON.parse(stripToJson(outputs[6].stdout))
  };
}

function stripToJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('Benchmark output did not contain JSON.');
  }
  return text.slice(start).trim();
}
