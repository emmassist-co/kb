import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EvalRunResult } from '../../../eval/runner/types.js';
import type { BenchmarkSnapshot, CandidateEvaluation, CommandRunner, UpstreamGbrainRunResult } from './types.js';
import { buildCandidateScore, buildScreeningSummary } from './scorer.js';

const NODE_TSX_COMMAND = 'node';
const NODE_TSX_IMPORT_ARGS = ['--import', 'tsx/esm'];
const ONE_MINUTE_MS = 60_000;
const TYPECHECK_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const KB_TEST_TIMEOUT_MS = 6 * ONE_MINUTE_MS;
const ADMIN_BENCHMARK_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const CORE_SIX_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const GBRAIN_ADAPTER_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const GBRAIN_UPSTREAM_TIMEOUT_MS = 8 * ONE_MINUTE_MS;
const GBRAIN_HELDOUT_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const KB_TYPECHECK_COMMAND = './node_modules/.bin/tsc';
const KB_TYPECHECK_ARGS = [
  '--noEmit',
  '--pretty',
  'false',
  '--skipLibCheck',
  'true',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--target',
  'ES2022',
  '--resolveJsonModule',
  'true',
  '--esModuleInterop',
  'true',
  '--allowSyntheticDefaultImports',
  'true',
  '--strict',
  'true',
  '--types',
  'node',
  '--baseUrl',
  '.',
  'packages/kb-core/src/service.ts',
  'packages/kb-core/src/relations.ts'
];
const KB_TEST_ARGS = [...NODE_TSX_IMPORT_ARGS, '--test', 'tests/kb-benchmark.test.ts', 'tests/kb-autoresearch.test.ts'];
const GBRAIN_UPSTREAM_ARGS = [...NODE_TSX_IMPORT_ARGS, 'scripts/run-gbrain-evals-upstream.ts', '--adapter=kb-upstream'];
const GBRAIN_ADAPTER_ARGS = [...NODE_TSX_IMPORT_ARGS, 'scripts/run-gbrain-evals-kb-adapter.ts'];

type CommandSpec = { command: string; args: string[]; env?: Record<string, string | undefined>; timeoutMs?: number };

export class KbAutoresearchEvaluator {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: {
      onLog?: (message: string) => void;
      repoRoot?: string;
    } = {}
  ) {}

  async evaluateBaseline(worktreePath: string, fixturesRoot: string): Promise<CandidateEvaluation> {
    const outputs = await this.runCommands(worktreePath, buildEvaluationCommands(fixturesRoot, this.options.repoRoot));
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
    const outputs = await this.runCommands(worktreePath, buildScreeningCommands(fixturesRoot, this.options.repoRoot));
    if ('failed' in outputs) {
      return outputs.failed;
    }

    try {
      const adminWorldDev = JSON.parse(stripToJson(outputs.completed[2].stdout));
      const gbrainUpstream = JSON.parse(stripToJson(outputs.completed[3].stdout)) as UpstreamGbrainRunResult;
      const gbrainWorld = normalizeGbrainAdapterSnapshot(JSON.parse(stripToJson(outputs.completed[4].stdout)), {
        corpusLabel: 'gbrain-evals-adapter:canonical',
        floor: { precisionAt5: 0.3, recallAt5: 0.95, mrrAt5: 0.95, ndcgAt5: 0.94 },
        description: 'Canonical upstream-shaped adapter slice'
      });
      const gbrainHeldout = normalizeGbrainAdapterSnapshot(JSON.parse(stripToJson(outputs.completed[5].stdout)), {
        corpusLabel: 'gbrain-evals-adapter:synthetic',
        floor: { precisionAt5: 0.2, recallAt5: 0.5, mrrAt5: 0.45, ndcgAt5: 0.45 },
        description: 'Synthetic held-out adapter slice'
      });
      return {
        ok: true,
        typecheckOk: true,
        testsOk: true,
        stageReached: 'screen',
        screening: buildScreeningSummary(adminWorldDev),
        adminWorldDev,
        gbrainWorld,
        gbrainHeldout,
        gbrainUpstream,
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
      const result = await this.runner.run(entry.command, entry.args, { cwd: worktreePath, env: entry.env, timeoutMs: entry.timeoutMs });
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

function buildGbrainUpstreamEnv(repoRoot?: string): Record<string, string | undefined> | undefined {
  if (!repoRoot) return undefined;
  return {
    GBRAIN_EVALS_REPO: path.resolve(repoRoot, '..', 'gbrain-evals')
  };
}

export function buildScreeningCommands(fixturesRoot: string, repoRoot?: string): CommandSpec[] {
  const gbrainUpstreamEnv = buildGbrainUpstreamEnv(repoRoot);
  return [
    { command: KB_TYPECHECK_COMMAND, args: KB_TYPECHECK_ARGS, timeoutMs: TYPECHECK_TIMEOUT_MS },
    { command: NODE_TSX_COMMAND, args: KB_TEST_ARGS, env: { KB_TEST_SHARD: 'core' }, timeoutMs: KB_TEST_TIMEOUT_MS },
    {
      command: NODE_TSX_COMMAND,
      args: [...NODE_TSX_IMPORT_ARGS, 'eval/runner/kb-benchmark.ts', '--admin-world', path.join(fixturesRoot, 'admin-world-v3'), '--json', '--split', 'dev'],
      timeoutMs: ADMIN_BENCHMARK_TIMEOUT_MS
    },
    {
      command: NODE_TSX_COMMAND,
      args: GBRAIN_UPSTREAM_ARGS,
      env: gbrainUpstreamEnv,
      timeoutMs: GBRAIN_UPSTREAM_TIMEOUT_MS
    },
    {
      command: NODE_TSX_COMMAND,
      args: GBRAIN_ADAPTER_ARGS,
      env: { KB_GBRAIN_QUERY_SET: 'canonical', KB_GBRAIN_COMPACT: 'true' },
      timeoutMs: GBRAIN_ADAPTER_TIMEOUT_MS
    },
    {
      command: NODE_TSX_COMMAND,
      args: GBRAIN_ADAPTER_ARGS,
      env: { KB_GBRAIN_QUERY_SET: 'synthetic', KB_GBRAIN_COMPACT: 'true' },
      timeoutMs: GBRAIN_HELDOUT_TIMEOUT_MS
    }
  ];
}

export function buildPromotionCommands(fixturesRoot: string): CommandSpec[] {
  return [
    {
      command: NODE_TSX_COMMAND,
      args: [...NODE_TSX_IMPORT_ARGS, 'eval/runner/kb-eval.ts', '--json', '--no-write-scorecard', '--fixtures', path.join(fixturesRoot, 'core-six-dev')],
      timeoutMs: CORE_SIX_TIMEOUT_MS
    },
    {
      command: NODE_TSX_COMMAND,
      args: [...NODE_TSX_IMPORT_ARGS, 'eval/runner/kb-eval.ts', '--json', '--no-write-scorecard', '--fixtures', path.join(fixturesRoot, 'core-six-holdout')],
      timeoutMs: CORE_SIX_TIMEOUT_MS
    },
    {
      command: NODE_TSX_COMMAND,
      args: [...NODE_TSX_IMPORT_ARGS, 'eval/runner/kb-benchmark.ts', '--admin-world', path.join(fixturesRoot, 'admin-world-v3'), '--json', '--split', 'holdout'],
      timeoutMs: ADMIN_BENCHMARK_TIMEOUT_MS
    }
  ];
}

export function buildEvaluationCommands(fixturesRoot: string, repoRoot?: string): CommandSpec[] {
  return [...buildScreeningCommands(fixturesRoot, repoRoot), ...buildPromotionCommands(fixturesRoot)];
}

function parseSnapshot(outputs: CandidateEvaluation['commandOutputs']): BenchmarkSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    adminWorldDev: JSON.parse(stripToJson(outputs[2].stdout)),
    gbrainUpstream: JSON.parse(stripToJson(outputs[3].stdout)) as UpstreamGbrainRunResult,
    gbrainWorld: normalizeGbrainAdapterSnapshot(JSON.parse(stripToJson(outputs[4].stdout)), {
      corpusLabel: 'gbrain-evals-adapter:canonical',
      floor: { precisionAt5: 0.3, recallAt5: 0.95, mrrAt5: 0.95, ndcgAt5: 0.94 },
      description: 'Canonical upstream-shaped adapter slice'
    }),
    gbrainHeldout: normalizeGbrainAdapterSnapshot(JSON.parse(stripToJson(outputs[5].stdout)), {
      corpusLabel: 'gbrain-evals-adapter:synthetic',
      floor: { precisionAt5: 0.2, recallAt5: 0.5, mrrAt5: 0.45, ndcgAt5: 0.45 },
      description: 'Synthetic held-out adapter slice'
    }),
    devScorecard: JSON.parse(stripToJson(outputs[6].stdout)),
    holdoutScorecard: JSON.parse(stripToJson(outputs[7].stdout)),
    adminWorldHoldout: JSON.parse(stripToJson(outputs[8].stdout))
  };
}

function normalizeGbrainAdapterSnapshot(raw: {
  queryCount: number;
  precisionAt5: number;
  recallAt5: number;
  mrrAt5: number;
  ndcgAt5: number;
  familyMetrics?: Record<string, {
    queryCount: number;
    precisionAt5: number;
    recallAt5: number;
    mrrAt5: number;
    ndcgAt5: number;
  }>;
  queryDetails?: Array<{
    id: string;
    text: string;
    relevant: string[];
    family?: string;
    returned: string[];
    precisionAt5: number;
    recallAt5: number;
    mrrAt5: number;
    ndcgAt5: number;
  }>;
}, options: {
  corpusLabel: string;
  floor: {
    precisionAt5: number;
    recallAt5: number;
    mrrAt5: number;
    ndcgAt5: number;
  };
  description: string;
}): EvalRunResult {
  const gateChecks = [
    {
      label: `${options.description} P@5`,
      actual: raw.precisionAt5,
      expected: `>= ${(options.floor.precisionAt5 * 100).toFixed(0)}%`,
      passed: raw.precisionAt5 >= options.floor.precisionAt5
    },
    {
      label: `${options.description} Recall@5`,
      actual: raw.recallAt5,
      expected: `>= ${(options.floor.recallAt5 * 100).toFixed(0)}%`,
      passed: raw.recallAt5 >= options.floor.recallAt5
    },
    {
      label: `${options.description} MRR@5`,
      actual: raw.mrrAt5,
      expected: `>= ${(options.floor.mrrAt5 * 100).toFixed(0)}%`,
      passed: raw.mrrAt5 >= options.floor.mrrAt5
    },
    {
      label: `${options.description} nDCG@5`,
      actual: raw.ndcgAt5,
      expected: `>= ${(options.floor.ndcgAt5 * 100).toFixed(0)}%`,
      passed: raw.ndcgAt5 >= options.floor.ndcgAt5
    }
  ];
  const passed = gateChecks.every((entry) => entry.passed);

  return {
    corpus: options.corpusLabel,
    mode: 'graph-first-hybrid',
    queryCount: raw.queryCount,
    k: 5,
    precisionAtK: raw.precisionAt5,
    recallAtK: raw.recallAt5,
    mrrAtK: raw.mrrAt5,
    ndcgAtK: raw.ndcgAt5,
    familyBreakdown: raw.familyMetrics
      ? Object.fromEntries(
          Object.entries(raw.familyMetrics).map(([family, metrics]) => [
            family,
            {
              queryCount: metrics.queryCount,
              precisionAtK: metrics.precisionAt5,
              recallAtK: metrics.recallAt5,
              mrrAtK: metrics.mrrAt5,
              ndcgAtK: metrics.ndcgAt5,
              passesFloor: metrics.precisionAt5 >= 0.3 && metrics.recallAt5 >= 0.95
            }
          ])
        )
      : undefined,
    corpusMetadata: {
      benchmarkTier: 'external-reference',
      split: 'all',
      queryCount: raw.queryCount
    },
    gates: {
      benchmarkTier: 'external-reference',
      overall: gateChecks,
      passed,
      milestone: passed ? 'guardrail-only' : 'below-floor'
    },
    hardness: {
      passed,
      reasons: passed ? [`${options.description} stays above the configured floor.`] : [`${options.description} fell below the configured floor.`]
    },
    diagnostics: {
      anchorResolutionFailures: [],
      anchorResolutionFailureRate: 0,
      wrongTypeTopResultCount: 0,
      wrongTypeTopResultRate: 0,
      anchorPageOverAnswerCount: 0,
      anchorPageOverAnswerRate: 0,
      distractorWinCount: 0,
      distractorWinRate: 0,
      historicalOverCurrentCount: 0,
      historicalOverCurrentRate: 0,
      weakMentionBeatExplicitCount: 0,
      weakMentionBeatExplicitRate: 0,
      siblingDistractorWinCount: 0,
      siblingDistractorWinRate: 0,
      lexicalDistractorWinCount: 0,
      lexicalDistractorWinRate: 0,
      topFalsePositives: []
    },
    perQuery: (raw.queryDetails ?? []).map((query) => ({
      id: query.id,
      text: query.text,
      relevant: query.relevant,
      family: query.family,
      returned: query.returned.map((pageId, index) => ({
        pageId,
        score: 0,
        rank: index + 1
      })),
      top1Hit: query.returned.length > 0 && query.relevant.includes(query.returned[0] ?? ''),
      precisionAtK: query.precisionAt5,
      recallAtK: query.recallAt5,
      reciprocalRank: query.mrrAt5,
      ndcgAtK: query.ndcgAt5
    }))
  };
}

function stripToJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('Benchmark output did not contain JSON.');
  }
  return text.slice(start).trim();
}
