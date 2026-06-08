import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildRunConfig } from '../packages/kb-autoresearch/src/config.js';
import { ShellCommandRunner } from '../packages/kb-autoresearch/src/command-runner.js';
import { validateCandidateDiff } from '../packages/kb-autoresearch/src/guards.js';
import { LoopRunner } from '../packages/kb-autoresearch/src/loop.js';
import { AgentConfigurationError, PiAgentAdapter, parsePiJsonOutput } from '../packages/kb-autoresearch/src/pi-adapter.js';
import { buildAutoresearchBriefing, buildAutoresearchPrompt } from '../packages/kb-autoresearch/src/prompt.js';
import { ExperimentRecorder } from '../packages/kb-autoresearch/src/recorder.js';
import { compareScores, compareScreening, buildCandidateScore, buildScreeningSummary } from '../packages/kb-autoresearch/src/scorer.js';
import { CandidateWorkspaceManager } from '../packages/kb-autoresearch/src/workspace.js';
import { computeBaselineCacheKey } from '../packages/kb-autoresearch/src/cache.js';
import { buildEvaluationCommands, buildPromotionCommands, buildScreeningCommands } from '../packages/kb-autoresearch/src/evaluator.js';
import type { AgentAdapter, AgentRunOptions, BenchmarkSnapshot, CandidateMutationResult } from '../packages/kb-autoresearch/src/types.js';
import type { EvalCategoryResult, EvalRunResult, EvalScorecard } from '../eval/runner/types.js';

test('validateCandidateDiff enforces allowlist and diff size', () => {
  assert.equal(
    validateCandidateDiff(
      {
        changedFiles: ['src/lib/kb/service.ts'],
        unifiedDiffLines: 10,
        diff: ''
      },
      ['src/lib/kb/service.ts'],
      3,
      100
    ).ok,
    true
  );

  assert.match(
    validateCandidateDiff(
      {
        changedFiles: ['eval/data/core-six/core-six.json'],
        unifiedDiffLines: 10,
        diff: ''
      },
      ['src/lib/kb/service.ts'],
      3,
      100
    ).reason ?? '',
    /forbidden path/
  );
});

test('compareScores rejects protected metric regressions even when score rises', () => {
  const previous = buildCandidateScore(makeSnapshot({ weightedHint: 1, falseCertaintyRate: 0 }));
  const next = buildCandidateScore(makeSnapshot({ weightedHint: 2, falseCertaintyRate: 0.5 }));
  const delta = compareScores(previous, next, ['falseCertaintyRate']);

  assert.equal(delta.protectedMetricRegressions.includes('falseCertaintyRate'), true);
  assert.equal(delta.improved, false);
});

test('compareScores accepts safe incremental progress when guardrail failures do not expand', () => {
  const previous = buildCandidateScore(makeSnapshot({ weightedHint: 1, falseCertaintyRate: 0 }));
  const next = buildCandidateScore(makeSnapshot({ weightedHint: 2, falseCertaintyRate: 0 }));
  const delta = compareScores(previous, next, ['falseCertaintyRate']);

  assert.deepEqual(delta.introducedGuardrailFailures, []);
  assert.equal(delta.improved, true);
});

test('compareScreening promotes only admin-world dev improvements', () => {
  const previous = buildCandidateScore(makeSnapshot({ weightedHint: 1, falseCertaintyRate: 0 }));
  const improved = compareScreening(previous, makeRunResult(2, 'product-core'));
  const flat = compareScreening(previous, makeRunResult(1, 'product-core'));

  assert.equal(improved.improved, true);
  assert.equal(improved.weightedDelta > 0, true);
  assert.equal(flat.improved, false);
});

test('screening summary prefers higher admin-world precision and penalizes ranking noise', () => {
  const clean = buildScreeningSummary(
    makeRunResult(2, 'product-core', {
      precisionAtK: 0.42,
      diagnostics: {
        distractorWinRate: 0.05,
        historicalOverCurrentRate: 0.1
      }
    })
  );
  const noisy = buildScreeningSummary(
    makeRunResult(2, 'product-core', {
      precisionAtK: 0.36,
      diagnostics: {
        distractorWinRate: 0.15,
        historicalOverCurrentRate: 0.3
      }
    })
  );

  assert.equal(clean.weightedScore > noisy.weightedScore, true);
});

test('parsePiJsonOutput extracts session, final text, and error state', () => {
  const parsed = parsePiJsonOutput(
    [
      JSON.stringify({ type: 'session', id: 'sess-123' }),
      JSON.stringify({
        type: 'turn_end',
        message: {
          content: [{ type: 'text', text: 'Changed scoring weights.' }],
          errorMessage: 'No API key for provider: openai-codex'
        }
      })
    ].join('\n')
  );

  assert.equal(parsed.sessionId, 'sess-123');
  assert.equal(parsed.finalMessage, 'Changed scoring weights.');
  assert.equal(parsed.errorMessage, 'No API key for provider: openai-codex');
});

test('parsePiJsonOutput captures assistant-level context overflow errors', () => {
  const parsed = parsePiJsonOutput(
    [
      JSON.stringify({
        role: 'assistant',
        errorMessage: 'Codex error: {"type":"error","error":{"code":"context_length_exceeded"}}'
      })
    ].join('\n')
  );

  assert.match(parsed.errorMessage ?? '', /context_length_exceeded/);
});

test('buildAutoresearchPrompt points the agent at a bounded briefing instead of growing artifacts', () => {
  const prompt = buildAutoresearchPrompt('base prompt', {
    iteration: 12,
    allowlist: ['src/lib/kb/service.ts'],
    kbRuntime: {
      tenantId: 'acme',
      backend: 'cloudflare',
      transport: 'http',
      canonical: true,
      workspaceRole: 'canonical-production',
      endpoint: 'https://kb.example.com'
    },
    focus: {
      targetCategories: ['fuzzy', 'contradictions'],
      targetCases: ['fuzzy-dispute-doc', 'contradiction-refund-unresolved'],
      currentBest: {
        categoryPasses: 4,
        holdoutCategoryPasses: 5,
        weightedScore: 812.5,
        holdoutWeightedScore: 977.5
      },
      benchmarkFiles: {
        briefingPath: '../../../artifacts/kb-autoresearch/current/briefing.md',
        bestScoreSummaryPath: '../../../artifacts/kb-autoresearch/current/best-score-summary.json',
        inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
      },
      recentDecisions: [
        'iteration 10 accepted src/lib/kb/service.ts (+165.000 dev, +2.500 holdout)',
        'iteration 11 rejected: Protected metrics regressed: falseCertaintyRate'
      ]
    }
  });

  assert.match(prompt, /briefing\.md/);
  assert.match(prompt, /best-score-summary\.json/);
  assert.match(prompt, /kb-autoresearch-inspect\.ts/);
  assert.match(prompt, /tenant=acme, backend=cloudflare, transport=http, canonical=yes, role=canonical-production/);
  assert.match(prompt, /endpoint: https:\/\/kb\.example\.com/);
  assert.match(prompt, /canonical production surface/);
  assert.match(prompt, /Recent outcomes/);
  assert.doesNotMatch(prompt, /ledger\.jsonl/);
  assert.doesNotMatch(prompt, /current report/i);
  assert.doesNotMatch(prompt, /scorecard/i);
});

test('buildAutoresearchPrompt diagnosis mode forbids edits and edit mode applies diagnosis', () => {
  const context = {
    iteration: 12,
    allowlist: ['src/lib/kb/service.ts'],
    kbRuntime: {
      tenantId: 'acme',
      backend: 'file',
      transport: 'local',
      canonical: false,
      workspaceRole: 'local-development'
    },
    focus: {
      targetCategories: ['fuzzy'],
      targetCases: ['fuzzy-dispute-doc'],
      currentBest: {
        categoryPasses: 4,
        holdoutCategoryPasses: 5,
        weightedScore: 812.5,
        holdoutWeightedScore: 977.5
      },
      benchmarkFiles: {
        briefingPath: '../../../artifacts/kb-autoresearch/current/briefing.md',
        bestScoreSummaryPath: '../../../artifacts/kb-autoresearch/current/best-score-summary.json',
        inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
      },
      recentDecisions: ['iteration 11 rejected: historical results outranked current answer']
    }
  } satisfies AgentRunOptions['structuredContext'];
  const diagnosisPrompt = buildAutoresearchPrompt('base prompt', context, { mode: 'diagnose' });
  const editPrompt = buildAutoresearchPrompt('base prompt', context, {
    mode: 'edit',
    diagnosisSummary: 'Prefer current owner evidence over older role mentions.'
  });

  assert.match(diagnosisPrompt, /Do not edit any files in this pass/);
  assert.match(diagnosisPrompt, /support-only workspace/);
  assert.match(editPrompt, /Apply this diagnosis unless the code clearly disproves it/);
  assert.match(editPrompt, /Prefer current owner evidence over older role mentions/);
});

test('buildAutoresearchBriefing includes stall diagnosis when the loop is stuck', () => {
  const briefing = buildAutoresearchBriefing({
    iteration: 5,
    allowlist: ['src/lib/kb/service.ts'],
    kbRuntime: {
      tenantId: 'acme',
      backend: 'r2-mirror',
      transport: 'local',
      canonical: false,
      workspaceRole: 'mirror-support'
    },
    focus: {
      targetCategories: ['fuzzy'],
      targetCases: ['fuzzy-dispute-doc'],
      currentBest: {
        categoryPasses: 3,
        holdoutCategoryPasses: 3,
        weightedScore: 479.6,
        holdoutWeightedScore: 463.5
      },
      benchmarkFiles: {
        briefingPath: '../../../artifacts/kb-autoresearch/current/briefing.md',
        bestScoreSummaryPath: '../../../artifacts/kb-autoresearch/current/best-score-summary.json',
        inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
      },
      recentDecisions: ['iteration 4 rejected: Benchmark guardrails failed: core-six-dev'],
      stall: {
        consecutiveFailures: 3,
        diagnosis: [
          'Three consecutive attempts failed without changing the guardrail set.',
          'Recent edits clustered in src/lib/kb/relations.ts.'
        ]
      }
    }
  });

  assert.match(briefing, /## KB Runtime/);
  assert.match(briefing, /workspace role: mirror-support/);
  assert.match(briefing, /Stall Diagnosis/);
  assert.match(briefing, /Three consecutive attempts failed/);
});

test('buildEvaluationCommands uses KB-only tests instead of full npm test', () => {
  const screening = buildScreeningCommands('/tmp/fixtures');
  const promotion = buildPromotionCommands('/tmp/fixtures');
  const commands = buildEvaluationCommands('/tmp/fixtures');

  assert.equal(screening[0]?.command, 'npm');
  assert.deepEqual(screening[0]?.args, ['run', 'typecheck']);
  assert.match([screening[1]?.command, ...(screening[1]?.args ?? [])].join(' '), /tests\/kb\.test\.ts/);
  assert.match([screening[1]?.command, ...(screening[1]?.args ?? [])].join(' '), /tests\/kb-benchmark\.test\.ts/);
  assert.match([screening[1]?.command, ...(screening[1]?.args ?? [])].join(' '), /tests\/kb-autoresearch\.test\.ts/);
  assert.doesNotMatch([screening[1]?.command, ...(screening[1]?.args ?? [])].join(' '), /npm test/);
  assert.equal(screening.some((entry) => entry.args.includes('repo-docs')), false);
  assert.equal(promotion.some((entry) => entry.args.includes('repo-docs')), false);
  assert.deepEqual(commands, [...screening, ...promotion]);
});

test('pi backend defaults point to a direct local binary and codex subscription provider', () => {
  const repoRoot = createFixtureRepo();
  try {
    const config = buildRunConfig(repoRoot, {
      iterations: 1,
      timeBudgetMin: 1,
      benchmarkSubset: 'all',
      dryRun: true,
      maxChangedFiles: 3,
      maxUnifiedDiffLines: 100,
      agentBackend: 'pi'
    });

    assert.match(config.agentCommand ?? '', /node_modules\/\.bin\/pi$/);
    assert.equal(config.agentProvider, 'openai-codex');
    assert.equal(config.model, 'gpt-5.3-codex-spark');
    assert.deepEqual(config.benchmarkPolicy.screening, ['admin-world-v3 dev']);
    assert.deepEqual(config.benchmarkPolicy.acceptance, ['admin-world-v3 holdout']);
    assert.deepEqual(config.benchmarkPolicy.guardrails, ['core-six dev', 'core-six holdout', 'gbrain-world']);
    assert.deepEqual(config.benchmarkPolicy.skippedFromLoop, ['repo-docs dev', 'repo-docs holdout']);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('computeBaselineCacheKey changes when benchmark inputs change', () => {
  const repoRoot = createFixtureRepo();
  try {
    const first = computeBaselineCacheKey(repoRoot, 'abc123');
    writeFileSync(path.join(repoRoot, 'src/lib/kb-autoresearch/scorer.ts'), 'changed\n', 'utf8');
    const second = computeBaselineCacheKey(repoRoot, 'abc123');
    assert.notEqual(first, second);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('computeBaselineCacheKey ignores unrelated commits and files', () => {
  const repoRoot = createFixtureRepo();
  try {
    const first = computeBaselineCacheKey(repoRoot, 'abc123');
    writeFileSync(path.join(repoRoot, 'README.md'), 'unrelated\n', 'utf8');
    const second = computeBaselineCacheKey(repoRoot, 'def456');
    assert.equal(first, second);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('computeBaselineCacheKey changes when KB logic changes', () => {
  const repoRoot = createFixtureRepo();
  try {
    const first = computeBaselineCacheKey(repoRoot, 'abc123');
    writeFileSync(path.join(repoRoot, 'src/lib/kb/service.ts'), 'export const kbHeuristic = "changed";\n', 'utf8');
    const second = computeBaselineCacheKey(repoRoot, 'abc123');
    assert.notEqual(first, second);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('fresh runs reuse cached baseline instead of reevaluating it', async () => {
  const repoRoot = createFixtureRepo();
  const runner = new ShellCommandRunner();
  const workspaceManager = new CandidateWorkspaceManager(runner, repoRoot);
  const evaluator = new CountingEvaluator();

  try {
    const firstConfig = buildRunConfig(repoRoot, {
      iterations: 0,
      timeBudgetMin: 5,
      benchmarkSubset: 'all',
      dryRun: false,
      maxChangedFiles: 3,
      maxUnifiedDiffLines: 200
    });
    await new LoopRunner(repoRoot, workspaceManager, evaluator, new NoopAgent(), new ExperimentRecorder(firstConfig)).run(firstConfig);

    const secondConfig = buildRunConfig(repoRoot, {
      iterations: 0,
      timeBudgetMin: 5,
      benchmarkSubset: 'all',
      dryRun: false,
      maxChangedFiles: 3,
      maxUnifiedDiffLines: 200
    });
    await new LoopRunner(repoRoot, workspaceManager, evaluator, new NoopAgent(), new ExperimentRecorder(secondConfig)).run(secondConfig);

    assert.equal(evaluator.calls, 1);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop fails fast on agent preflight configuration errors before baseline evaluation', async () => {
  const repoRoot = createFixtureRepo();
  const runner = new ShellCommandRunner();
  const workspaceManager = new CandidateWorkspaceManager(runner, repoRoot);
  const evaluator = new CountingEvaluator();
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const recorder = new ExperimentRecorder(config);

  try {
    await new LoopRunner(repoRoot, workspaceManager, evaluator, new PreflightFailAgent(), recorder).run(config);
    assert.equal(evaluator.calls, 0);
    const status = JSON.parse(readFileSync(config.paths.currentStatusPath, 'utf8'));
    assert.equal(status.state, 'failed');
    assert.match(status.message, /No API key found/);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop repairs a baseline typecheck failure before starting iterations', async () => {
  const repoRoot = createFixtureRepo();
  const runner = new ShellCommandRunner();
  const workspaceManager = new CandidateWorkspaceManager(runner, repoRoot);
  appendFileSync(path.join(repoRoot, 'src/lib/kb/service.ts'), '\nBROKEN_BASELINE\n', 'utf8');
  spawnSync('git', ['add', 'src/lib/kb/service.ts'], { cwd: repoRoot });
  spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'break baseline'], { cwd: repoRoot });
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const recorder = new ExperimentRecorder(config);
  const agent = new BaselineTypecheckRepairAgent();
  const loop = new LoopRunner(
    repoRoot,
    workspaceManager,
    new BaselineTypecheckRepairEvaluator(),
    agent,
    recorder
  );

  try {
    await loop.run(config);
    const ledger = recorder.readLedger();
    assert.equal(agent.prompts.length >= 2, true);
    assert.match(agent.prompts[0] ?? '', /Typecheck repair request/);
    assert.match(agent.prompts[0] ?? '', /error TS2304: Cannot find name 'BROKEN_BASELINE'/);
    assert.equal(ledger.some((entry) => entry.decision === 'accepted'), true);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop fails baseline clearly when typecheck points outside the KB allowlist', async () => {
  const repoRoot = createFixtureRepo();
  const runner = new ShellCommandRunner();
  const workspaceManager = new CandidateWorkspaceManager(runner, repoRoot);
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const recorder = new ExperimentRecorder(config);
  const agent = new BaselineTypecheckRepairAgent();
  const loop = new LoopRunner(
    repoRoot,
    workspaceManager,
    new OutsideAllowlistBaselineTypecheckEvaluator(),
    agent,
    recorder
  );

  try {
    await assert.rejects(
      () => loop.run(config),
      /Baseline typecheck failed outside KB allowlist: src\/lib\/workspace\.ts/
    );
    assert.equal(agent.prompts.length, 0);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('buildScreeningSummary is admin-world only', () => {
  const summary = buildScreeningSummary(makeRunResult(2, 'product-core'));
  assert.equal(summary.weightedScore > 0, true);
  assert.deepEqual(summary.guardrailFailures, []);
});

test('research branch snapshots dirty tracked and untracked workspace state', async () => {
  const repoRoot = createFixtureRepo();
  const runner = new ShellCommandRunner();
  const manager = new CandidateWorkspaceManager(runner, repoRoot);
  const trackedPath = path.join(repoRoot, 'src/lib/kb/service.ts');
  const untrackedPath = path.join(repoRoot, 'src/lib/chat/snapshot-helper.ts');
  writeFileSync(trackedPath, 'export const kbHeuristic = "dirty";\n', 'utf8');
  mkdirSync(path.dirname(untrackedPath), { recursive: true });
  writeFileSync(untrackedPath, 'export const helper = true;\n', 'utf8');

  try {
    await manager.ensureResearchBranch('kb-test');
    const snapshot = await manager.createCandidateWorktree(path.join(repoRoot, '.tmp-worktrees'), 'kb-test', 1);
    assert.match(readFileSync(path.join(snapshot.worktreePath, 'src/lib/kb/service.ts'), 'utf8'), /dirty/);
    assert.match(readFileSync(path.join(snapshot.worktreePath, 'src/lib/chat/snapshot-helper.ts'), 'utf8'), /helper = true/);
    await manager.removeWorktree(snapshot.worktreePath);
  } finally {
    rmSync(path.join(repoRoot, '.tmp-worktrees'), { force: true, recursive: true });
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('candidate worktrees outside the repo link back to root node_modules', async () => {
  const repoRoot = createFixtureRepo();
  mkdirSync(path.join(repoRoot, 'node_modules'), { recursive: true });
  const runner = new ShellCommandRunner();
  const manager = new CandidateWorkspaceManager(runner, repoRoot);
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'kb-worktree-root-'));

  try {
    await manager.ensureResearchBranch('kb-test');
    const snapshot = await manager.createCandidateWorktree(externalRoot, 'kb-test', 1);
    const nodeModulesPath = path.join(snapshot.worktreePath, 'node_modules');
    assert.equal(lstatSync(nodeModulesPath).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(snapshot.worktreePath, '.git'), 'utf8').length > 0, true);
    await manager.removeWorktree(snapshot.worktreePath);
  } finally {
    rmSync(externalRoot, { force: true, recursive: true });
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop accepts an improving candidate in isolated worktree without touching active checkout', async () => {
  const repoRoot = createFixtureRepo();
  const dirtyPath = path.join(repoRoot, 'local-note.txt');
  writeFileSync(dirtyPath, 'do not touch\n', 'utf8');
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new FakeEvaluator(),
    new AppendTokenAgent('// IMPROVE'),
    new ExperimentRecorder(config)
  );

  try {
    await loop.run(config);
    const ledger = new ExperimentRecorder(config).readLedger();
    assert.equal(ledger.some((entry) => entry.decision === 'accepted'), true);
    assert.equal(readFileSync(dirtyPath, 'utf8'), 'do not touch\n');
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop rejects a candidate that regresses false certainty', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new FakeEvaluator(),
    new AppendTokenAgent('// IMPROVE\n// REGRESS_FALSE_CERTAINTY'),
    recorder
  );

  try {
    await loop.run(config);
    const ledger = recorder.readLedger();
    assert.equal(ledger.some((entry) => entry.rejectReason?.includes('Protected metrics regressed')), true);
    const best = recorder.readBestScore();
    assert.equal(best?.summary.protectedMetrics.falseCertaintyRate, 0);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop records screening deltas for rejected screening candidates and surfaces them in the next briefing', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 2,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new ScreeningRejectEvaluator(),
    new AppendTokenAgent('// SCREENING_REJECT'),
    recorder
  );

  try {
    await loop.run(config);
    const ledger = recorder.readLedger().filter((entry) => entry.runId === config.runId);
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0]?.decision, 'rejected');
    assert.equal(typeof ledger[0]?.screeningAfter?.weightedScore, 'number');
    assert.equal(typeof ledger[0]?.screeningDelta?.weightedDelta, 'number');
    assert.match(readFileSync(config.paths.currentBriefingPath, 'utf8'), /screening delta/i);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop records a failed iteration when the agent mutation throws', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new FakeEvaluator(),
    new ThrowingAgent(),
    recorder
  );

  try {
    await loop.run(config);
    const ledger = recorder.readLedger();
    assert.equal(ledger.some((entry) => entry.decision === 'failed' && /context_length_exceeded/.test(entry.rejectReason ?? '')), true);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop records distinct prompt hashes when iteration context changes', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 2,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new FakeEvaluator(),
    new ThrowingAgent(),
    recorder
  );

  try {
    await loop.run(config);
    const ledger = recorder.readLedger().filter((entry) => entry.runId === config.runId);
    assert.equal(ledger.length, 2);
    assert.notEqual(ledger[0]?.promptSha256, ledger[1]?.promptSha256);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('stall diagnosis suggests diversified KB files after repeated screening rejects cluster in one file', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 4,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new ScreeningRejectEvaluator(),
    new AppendTokenAgent('// SCREENING_REJECT', 'src/lib/kb/service.ts'),
    recorder
  );

  try {
    await loop.run(config);
    const briefing = readFileSync(config.paths.currentBriefingPath, 'utf8');
    assert.match(briefing, /Diversify next attempts toward:/);
    assert.match(briefing, /src\/lib\/kb\/service\.ts/);
    assert.match(briefing, /src\/lib\/kb\/relations\.ts/);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('loop sends typecheck failures back to the model for an in-iteration repair attempt', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);
  const agent = new TypecheckRepairAgent();
  const loop = new LoopRunner(
    repoRoot,
    new CandidateWorkspaceManager(runner, repoRoot),
    new TypecheckRepairEvaluator(),
    agent,
    recorder
  );

  try {
    await loop.run(config);
    const ledger = recorder.readLedger();
    assert.equal(agent.prompts.length, 2);
    assert.match(agent.prompts[1] ?? '', /Typecheck repair request/);
    assert.match(agent.prompts[1] ?? '', /error TS1109: Expression expected/);
    assert.equal(ledger.some((entry) => entry.decision === 'accepted'), true);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('pi adapter splits diagnosis and edit, then retries the edit with a compact prompt on context overflow', async () => {
  const calls: Array<{ prompt?: string }> = [];
  const runner: ShellCommandRunner = {
    async run(_command, args, _options) {
      calls.push({ prompt: args.at(-1) });
      if (calls.length === 1) {
        return {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: 'session', id: 'sess-diagnose' }),
            JSON.stringify({ type: 'turn_end', message: { content: [{ type: 'text', text: 'Target service.ts and prefer current evidence.' }] } })
          ].join('\n'),
          stderr: ''
        };
      }
      if (calls.length === 2) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            role: 'assistant',
            errorMessage: 'Codex error: {"type":"error","error":{"code":"context_length_exceeded"}}'
          }),
          stderr: ''
        };
      }
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: 'session', id: 'sess-1' }),
          JSON.stringify({ type: 'turn_end', message: { content: [{ type: 'text', text: 'ok' }] } })
        ].join('\n'),
        stderr: ''
      };
    }
  };
  const root = createFixtureRepo();
  const promptDir = mkdtempSync(path.join(tmpdir(), 'kb-pi-prompt-'));
  const promptPath = path.join(promptDir, 'prompt.md');
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/.bin/pi'), '', 'utf8');
  writeFileSync(promptPath, 'base prompt', 'utf8');
  mkdirSync(path.join(process.env.HOME ?? '', '.pi/agent'), { recursive: true });
  writeFileSync(path.join(process.env.HOME ?? '', '.pi/agent/auth.json'), '{}', 'utf8');

  try {
    const adapter = new PiAgentAdapter(runner, { command: 'npx', provider: 'openai-codex' });
    const result = await adapter.runCandidate({
      cwd: root,
      model: 'gpt-5.3-codex-spark',
      promptPath,
      structuredContext: {
        iteration: 1,
        allowlist: ['src/lib/kb/service.ts'],
        kbRuntime: {
          tenantId: 'acme',
          backend: 'cloudflare',
          transport: 'http',
          canonical: true,
          workspaceRole: 'canonical-production',
          endpoint: 'https://kb.example.com'
        },
        focus: {
          targetCategories: ['retrieval'],
          targetCases: ['case-1'],
          currentBest: {
            categoryPasses: 1,
            holdoutCategoryPasses: 1,
            weightedScore: 1,
            holdoutWeightedScore: 1
          },
          benchmarkFiles: {
            briefingPath: 'briefing.md',
            bestScoreSummaryPath: 'best-score-summary.json',
            inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
          },
          recentDecisions: ['decision one', 'decision two', 'decision three']
        }
      }
    });

    assert.equal(result.finalMessage, 'ok');
    assert.equal(calls.length, 3);
    assert.match(calls[0]?.prompt ?? '', /Briefing artifact/);
    assert.match(calls[0]?.prompt ?? '', /inspect command:/);
    assert.match(calls[0]?.prompt ?? '', /Do not edit any files in this pass/);
    assert.match(calls[1]?.prompt ?? '', /Apply this diagnosis unless the code clearly disproves it/);
    assert.match(calls[1]?.prompt ?? '', /Target service\.ts and prefer current evidence\./);
    assert.doesNotMatch(calls[2]?.prompt ?? '', /Briefing artifact/);
    assert.match(calls[2]?.prompt ?? '', /retry after a context overflow/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(promptDir, { force: true, recursive: true });
  }
});

test('pi adapter preflight fails immediately on missing auth or models', async () => {
  const calls: Array<{ args: string[] }> = [];
  const runner: ShellCommandRunner = {
    async run(_command, args, _options) {
      calls.push({ args });
      return {
        exitCode: 0,
        stdout: 'Warning: No models match pattern "openai-codex/gpt-5.3-codex-spark"\nNo models available. Use /login.\nNo API key found for openai-codex.',
        stderr: ''
      };
    }
  };
  const root = createFixtureRepo();
  mkdirSync(path.join(process.env.HOME ?? '', '.pi/agent'), { recursive: true });
  writeFileSync(path.join(process.env.HOME ?? '', '.pi/agent/auth.json'), '{}', 'utf8');

  try {
    const adapter = new PiAgentAdapter(runner, { command: 'npx', provider: 'openai-codex' });
    await assert.rejects(
      () => adapter.preflight?.({ cwd: root, model: 'gpt-5.3-codex-spark' }) ?? Promise.resolve(),
      AgentConfigurationError
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.args.includes('--list-models'), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('pi adapter falls back to autoresearch preflight auth when home auth is empty', async () => {
  const calls: Array<{ env?: Record<string, string | undefined> }> = [];
  const runner: ShellCommandRunner = {
    async run(_command, _args, options) {
      calls.push({ env: options.env });
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: 'session', id: 'sess-diagnose' }),
          JSON.stringify({ type: 'turn_end', message: { content: [{ type: 'text', text: 'diagnosis ok' }] } })
        ].join('\n'),
        stderr: ''
      };
    }
  };
  const root = createFixtureRepo();
  const promptDir = mkdtempSync(path.join(tmpdir(), 'kb-pi-fallback-'));
  const promptPath = path.join(promptDir, 'prompt.md');
  const homeAuthDir = path.join(process.env.HOME ?? '', '.pi/agent');
  const fallbackAuthPath = path.join(root, 'artifacts/kb-autoresearch/pi-preflight/pi-home/auth.json');
  mkdirSync(path.dirname(fallbackAuthPath), { recursive: true });
  writeFileSync(fallbackAuthPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'token' } }), 'utf8');
  mkdirSync(homeAuthDir, { recursive: true });
  writeFileSync(path.join(homeAuthDir, 'auth.json'), '{}', 'utf8');
  writeFileSync(promptPath, 'base prompt', 'utf8');

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const adapter = new PiAgentAdapter(runner, { command: 'npx', provider: 'openai-codex' });
    const result = await adapter.runCandidate({
      cwd: root,
      model: 'gpt-5.3-codex-spark',
      promptPath,
      structuredContext: {
        iteration: 1,
        allowlist: ['src/lib/kb/service.ts'],
        kbRuntime: {
          tenantId: 'acme',
          backend: 'file',
          transport: 'local',
          canonical: false,
          workspaceRole: 'local-development'
        },
        focus: {
          targetCategories: ['retrieval'],
          targetCases: ['case-1'],
          currentBest: {
            categoryPasses: 1,
            holdoutCategoryPasses: 1,
            weightedScore: 1,
            holdoutWeightedScore: 1
          },
          benchmarkFiles: {
            briefingPath: 'briefing.md',
            bestScoreSummaryPath: 'best-score-summary.json',
            inspectCommand: 'tsx ../../../scripts/kb-autoresearch-inspect.ts'
          },
          recentDecisions: ['decision one']
        }
      }
    });

    assert.equal(result.finalMessage, 'diagnosis ok');
    const copiedAuthPath = path.join(promptDir, 'pi-home', 'auth.json');
    assert.match(readFileSync(copiedAuthPath, 'utf8'), /openai-codex/);
    assert.equal(calls.length > 0, true);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { force: true, recursive: true });
    rmSync(promptDir, { force: true, recursive: true });
  }
});

test('loop resume continues from next iteration and preserves best branch state', async () => {
  const repoRoot = createFixtureRepo();
  const config = buildRunConfig(repoRoot, {
    iterations: 1,
    timeBudgetMin: 5,
    benchmarkSubset: 'all',
    dryRun: false,
    maxChangedFiles: 3,
    maxUnifiedDiffLines: 200
  });
  const runner = new ShellCommandRunner();
  const recorder = new ExperimentRecorder(config);

  try {
    const noOpLoop = new LoopRunner(
      repoRoot,
      new CandidateWorkspaceManager(runner, repoRoot),
      new FakeEvaluator(),
      new NoopAgent(),
      recorder
    );
    await noOpLoop.run(config);

    const resumeLoop = new LoopRunner(
      repoRoot,
      new CandidateWorkspaceManager(runner, repoRoot),
      new FakeEvaluator(),
      new AppendTokenAgent('// IMPROVE'),
      recorder
    );
    await resumeLoop.run(config);

    const ledger = recorder.readLedger();
    assert.equal(ledger.some((entry) => entry.iteration === 1), true);
    assert.equal(ledger.some((entry) => entry.iteration === 2 && entry.decision === 'accepted'), true);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

function createFixtureRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-autoresearch-'));
  mkdirSync(path.join(root, 'src/lib/kb'), { recursive: true });
  mkdirSync(path.join(root, 'src/lib/kb-autoresearch'), { recursive: true });
  mkdirSync(path.join(root, 'eval/runner'), { recursive: true });
  mkdirSync(path.join(root, 'eval/autoresearch'), { recursive: true });
  mkdirSync(path.join(root, 'eval/data'), { recursive: true });
  writeFileSync(path.join(root, 'src/lib/kb/service.ts'), 'export const kbHeuristic = "base";\n', 'utf8');
  writeFileSync(path.join(root, 'src/lib/kb-autoresearch/scorer.ts'), 'score\n', 'utf8');
  writeFileSync(path.join(root, 'src/lib/kb-autoresearch/evaluator.ts'), 'eval\n', 'utf8');
  writeFileSync(path.join(root, 'src/lib/kb-autoresearch/prompt.ts'), 'prompt\n', 'utf8');
  writeFileSync(path.join(root, 'src/lib/kb-autoresearch/types.ts'), 'types\n', 'utf8');
  writeFileSync(path.join(root, 'src/lib/kb-autoresearch/loop.ts'), 'loop\n', 'utf8');
  writeFileSync(path.join(root, 'eval/runner/kb-eval.ts'), 'runner\n', 'utf8');
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n', 'utf8');
  writeFileSync(path.join(root, 'package.json'), '{}\n', 'utf8');
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n', 'utf8');
  writeFileSync(path.join(root, 'eval/autoresearch/program.md'), 'program\n', 'utf8');
  writeFileSync(path.join(root, 'eval/autoresearch/agent-output.schema.json'), '{}\n', 'utf8');
  writeFileSync(path.join(root, 'eval/data/fixture.json'), '{}\n', 'utf8');
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'add', '.'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], { cwd: root });
  return root;
}

class AppendTokenAgent implements AgentAdapter {
  constructor(private readonly token: string, private readonly target = 'src/lib/kb/service.ts') {}
  async runCandidate(options: AgentRunOptions): Promise<CandidateMutationResult> {
    appendFileSync(path.join(options.cwd, this.target), `\n${this.token}\n`, 'utf8');
    return { finalMessage: this.token };
  }
}

class NoopAgent implements AgentAdapter {
  async runCandidate(): Promise<CandidateMutationResult> {
    return { finalMessage: 'noop' };
  }
}

class ThrowingAgent implements AgentAdapter {
  async runCandidate(): Promise<CandidateMutationResult> {
    throw new Error('context_length_exceeded');
  }
}

class PreflightFailAgent implements AgentAdapter {
  async preflight(): Promise<void> {
    throw new AgentConfigurationError('No API key found for openai-codex.');
  }
  async runCandidate(): Promise<CandidateMutationResult> {
    return { finalMessage: 'noop' };
  }
}

class TypecheckRepairAgent implements AgentAdapter {
  prompts: string[] = [];

  async runCandidate(options: AgentRunOptions): Promise<CandidateMutationResult> {
    const prompt = readFileSync(options.promptPath, 'utf8');
    this.prompts.push(prompt);
    const targetPath = path.join(options.cwd, 'src/lib/kb/service.ts');
    if (this.prompts.length === 1) {
      appendFileSync(targetPath, '\nTYPEFAIL\n', 'utf8');
      return { finalMessage: 'introduced a candidate heuristic change' };
    }
    const repaired = readFileSync(targetPath, 'utf8').replace('\nTYPEFAIL\n', '\nFIXED\n// IMPROVE\n');
    writeFileSync(targetPath, repaired, 'utf8');
    return { finalMessage: 'repaired typecheck failure' };
  }
}

class BaselineTypecheckRepairAgent implements AgentAdapter {
  prompts: string[] = [];

  async runCandidate(options: AgentRunOptions): Promise<CandidateMutationResult> {
    const prompt = readFileSync(options.promptPath, 'utf8');
    this.prompts.push(prompt);
    const targetPath = path.join(options.cwd, 'src/lib/kb/service.ts');
    if (prompt.includes('Typecheck repair request')) {
      const repaired = readFileSync(targetPath, 'utf8').replace('\nBROKEN_BASELINE\n', '\nFIXED_BASELINE\n');
      writeFileSync(targetPath, repaired, 'utf8');
      return { finalMessage: 'repaired baseline typecheck failure' };
    }
    appendFileSync(targetPath, '\n// IMPROVE\n', 'utf8');
    return { finalMessage: 'improved heuristic after baseline repair' };
  }
}

class FakeEvaluator {
  async evaluateBaseline(worktreePath: string): Promise<{ ok: boolean; typecheckOk: boolean; testsOk: boolean; stageReached: 'full'; score: ReturnType<typeof buildCandidateScore>; screening: ReturnType<typeof buildScreeningSummary>; adminWorldDev: EvalRunResult; commandOutputs: [] }> {
    const source = readFileSync(path.join(worktreePath, 'src/lib/kb/service.ts'), 'utf8');
    const falseCertaintyRate = source.includes('REGRESS_FALSE_CERTAINTY') ? 0.5 : 0;
    const improved = source.includes('IMPROVE');
    const snapshot = makeSnapshot({ weightedHint: improved ? 2 : 1, falseCertaintyRate });
    return {
      ok: true,
      typecheckOk: true,
      testsOk: true,
      stageReached: 'full',
      score: buildCandidateScore(snapshot),
      screening: buildScreeningSummary(snapshot.adminWorldDev),
      adminWorldDev: snapshot.adminWorldDev,
      commandOutputs: []
    };
  }

  async evaluateScreening(worktreePath: string): Promise<{ ok: boolean; typecheckOk: boolean; testsOk: boolean; stageReached: 'screen'; screening: ReturnType<typeof buildScreeningSummary>; adminWorldDev: EvalRunResult; commandOutputs: [] }> {
    const source = readFileSync(path.join(worktreePath, 'src/lib/kb/service.ts'), 'utf8');
    const falseCertaintyRate = source.includes('REGRESS_FALSE_CERTAINTY') ? 0.5 : 0;
    const improved = source.includes('IMPROVE');
    const snapshot = makeSnapshot({ weightedHint: improved ? 2 : 1, falseCertaintyRate });
    return {
      ok: true,
      typecheckOk: true,
      testsOk: true,
      stageReached: 'screen',
      screening: buildScreeningSummary(snapshot.adminWorldDev),
      adminWorldDev: snapshot.adminWorldDev,
      commandOutputs: []
    };
  }

  async evaluatePromoted(worktreePath: string): Promise<{ ok: boolean; typecheckOk: boolean; testsOk: boolean; stageReached: 'full'; score: ReturnType<typeof buildCandidateScore>; screening: ReturnType<typeof buildScreeningSummary>; adminWorldDev: EvalRunResult; commandOutputs: [] }> {
    const source = readFileSync(path.join(worktreePath, 'src/lib/kb/service.ts'), 'utf8');
    const falseCertaintyRate = source.includes('REGRESS_FALSE_CERTAINTY') ? 0.5 : 0;
    const improved = source.includes('IMPROVE');
    const snapshot = makeSnapshot({ weightedHint: improved ? 2 : 1, falseCertaintyRate });
    return {
      ok: true,
      typecheckOk: true,
      testsOk: true,
      stageReached: 'full',
      score: buildCandidateScore(snapshot),
      screening: buildScreeningSummary(snapshot.adminWorldDev),
      adminWorldDev: snapshot.adminWorldDev,
      commandOutputs: []
    };
  }

  writeSnapshotArtifacts(): void {}
}

class BaselineTypecheckRepairEvaluator extends FakeEvaluator {
  baselineAttempts = 0;

  override async evaluateBaseline(worktreePath: string) {
    this.baselineAttempts += 1;
    const source = readFileSync(path.join(worktreePath, 'src/lib/kb/service.ts'), 'utf8');
    if (source.includes('BROKEN_BASELINE')) {
      return {
        ok: false,
        typecheckOk: false,
        testsOk: false,
        stageReached: 'screen' as const,
        rejectReason: 'Command failed: npm run typecheck',
        commandOutputs: [
          {
            command: 'npm run typecheck',
            exitCode: 2,
            stdout: '',
            stderr: "src/lib/kb/service.ts:3:7 - error TS2304: Cannot find name 'BROKEN_BASELINE'."
          }
        ]
      };
    }
    return super.evaluateBaseline(worktreePath);
  }
}

class OutsideAllowlistBaselineTypecheckEvaluator extends FakeEvaluator {
  override async evaluateBaseline() {
    return {
      ok: false,
      typecheckOk: false,
      testsOk: false,
      stageReached: 'screen' as const,
      rejectReason: 'Command failed: npm run typecheck',
      commandOutputs: [
        {
          command: 'npm run typecheck',
          exitCode: 2,
          stdout: '',
          stderr: "src/lib/workspace.ts:31:5 - error TS2322: Property 'flushKnowledgeBase' is missing."
        }
      ]
    };
  }
}

class TypecheckRepairEvaluator extends FakeEvaluator {
  override async evaluateScreening(worktreePath: string) {
    const source = readFileSync(path.join(worktreePath, 'src/lib/kb/service.ts'), 'utf8');
    if (source.includes('TYPEFAIL')) {
      return {
        ok: false,
        typecheckOk: false,
        testsOk: false,
        stageReached: 'screen' as const,
        rejectReason: 'Command failed: npm run typecheck',
        commandOutputs: [
          {
            command: 'npm run typecheck',
            exitCode: 2,
            stdout: '',
            stderr: 'src/lib/kb/service.ts:3:1 - error TS1109: Expression expected.'
          }
        ]
      };
    }
    return super.evaluateScreening(worktreePath);
  }
}

class ScreeningRejectEvaluator extends FakeEvaluator {
  override async evaluateScreening(worktreePath: string) {
    const source = readFileSync(path.join(worktreePath, 'src/lib/kb/service.ts'), 'utf8');
    const mutated = source.includes('SCREENING_REJECT');
    return {
      ok: true,
      typecheckOk: true,
      testsOk: true,
      stageReached: 'screen' as const,
      screening: buildScreeningSummary(
        makeRunResult(1, 'product-core', {
          precisionAtK: mutated ? 0.09 : 0.1,
          diagnostics: {
            distractorWinRate: mutated ? 0.12 : 0.1,
            historicalOverCurrentRate: mutated ? 0.24 : 0.2
          }
        })
      ),
      adminWorldDev: makeRunResult(1, 'product-core', {
        precisionAtK: mutated ? 0.09 : 0.1,
        diagnostics: {
          distractorWinRate: mutated ? 0.12 : 0.1,
          historicalOverCurrentRate: mutated ? 0.24 : 0.2
        }
      }),
      commandOutputs: []
    };
  }
}

class CountingEvaluator extends FakeEvaluator {
  calls = 0;

  override async evaluateBaseline(worktreePath: string) {
    this.calls += 1;
    return super.evaluateBaseline(worktreePath);
  }
}

function makeSnapshot(input: { weightedHint: number; falseCertaintyRate: number }): BenchmarkSnapshot {
  const category = (name: EvalCategoryResult['category'], passed: boolean, extra: Record<string, number> = {}): EvalCategoryResult => ({
    category: name,
    corpus: 'test',
    provenance: 'deterministic-synthetic-fixtures',
    caseCount: 1,
    metrics: {
      baseline: input.weightedHint,
      ...extra
    },
    thresholds: {},
    passed,
    failures: [],
    sampleSize: 1
  });
  const categories = [
    category('retrieval', true),
    category('temporal', true),
    category('identity', true, { falseMergeRate: 0 }),
    category('provenance', true, { overclaimRate: 0 }),
    category('contradictions', input.weightedHint > 1, { falseCertaintyRate: input.falseCertaintyRate }),
    category('fuzzy', input.weightedHint > 1)
  ];
  return {
    generatedAt: new Date().toISOString(),
    devScorecard: makeScorecard('dev', categories),
    holdoutScorecard: makeScorecard('holdout', categories),
    adminWorldDev: makeRunResult(input.weightedHint, 'product-core'),
    adminWorldHoldout: makeRunResult(input.weightedHint, 'product-core'),
    gbrainWorld: makeRunResult(input.weightedHint, 'external-reference')
  };
}

function makeScorecard(corpus: string, categories: EvalCategoryResult[]): EvalScorecard {
  return {
    suite: corpus,
    corpus,
    provenance: 'deterministic-synthetic-fixtures',
    generatedAt: new Date().toISOString(),
    categories,
    overall: {
      passed: categories.every((category) => category.passed),
      categoryPassRate: categories.filter((category) => category.passed).length / categories.length,
      metrics: {}
    }
  };
}

function makeRunResult(
  weightedHint: number,
  benchmarkTier?: 'product-core' | 'external-reference',
  overrides: {
    precisionAtK?: number;
    recallAtK?: number;
    mrrAtK?: number;
    ndcgAtK?: number;
    diagnostics?: Partial<NonNullable<EvalRunResult['diagnostics']>>;
  } = {}
): EvalRunResult {
  return {
    corpus: 'test',
    queryCount: 1,
    k: 5,
    precisionAtK: overrides.precisionAtK ?? weightedHint / 10,
    recallAtK: overrides.recallAtK ?? 1,
    mrrAtK: overrides.mrrAtK ?? weightedHint / 10,
    ndcgAtK: overrides.ndcgAtK ?? weightedHint / 10,
    corpusMetadata: {
      benchmarkTier
    },
    diagnostics: {
      anchorResolutionFailures: [],
      topFalsePositives: [],
      wrongTypeTopResultRate: 0,
      anchorPageOverAnswerRate: 0,
      distractorWinRate: 0,
      historicalOverCurrentRate: 0,
      ...overrides.diagnostics
    },
    hardness: benchmarkTier === 'product-core'
      ? {
          searchOnlyPrecisionAtK: Math.max(0, weightedHint / 10 - 0.1),
          searchOnlyMrrAtK: Math.max(0, weightedHint / 10 - 0.1),
          graphFirstPrecisionAtK: weightedHint / 10,
          graphFirstMrrAtK: weightedHint / 10,
          precisionLift: 0.1,
          mrrLift: 0.1,
          searchOnlyPrecisionCapPassed: true,
          searchOnlyMrrCapPassed: true,
          passed: weightedHint > 1,
          reasons: []
        }
      : undefined,
    gates: benchmarkTier === 'product-core'
      ? {
          benchmarkTier,
          overall: [],
          perFamily: [],
          passed: weightedHint > 1,
          milestone: weightedHint > 1 ? 'floor-reached' : 'below-floor'
        }
      : benchmarkTier === 'external-reference'
        ? {
            benchmarkTier,
            overall: [],
            guardrails: [],
            passed: true,
            milestone: 'guardrail-only'
          }
        : undefined,
    perQuery: []
  };
}
