import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface UpstreamScorecard {
  adapter: string;
  queries: number;
  runs: number;
  mean_precision_at_k: number;
  mean_recall_at_k: number;
  stddev_precision_at_k: number;
  stddev_recall_at_k: number;
  correct_in_top_k: number;
  total_expected: number;
}

interface UpstreamRunnerOutput {
  scorecards: UpstreamScorecard[];
  queries: number;
  corpus: number;
}

interface ParsedArgs {
  adapter?: string;
}

const PUBLISHED_GBRAIN_REFERENCE = {
  precisionAt5: 0.491,
  recallAt5: 0.979
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gbrainRepo = await resolveGbrainRepo(repoRoot);
  const result = await runAgainstUpstreamHarness(repoRoot, gbrainRepo, args);
  console.log(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const adapter = argv.find((value) => value.startsWith('--adapter='))?.slice('--adapter='.length);
  return { adapter };
}

async function resolveGbrainRepo(repoRoot: string): Promise<string> {
  const candidate = process.env.GBRAIN_EVALS_REPO?.trim()
    ? path.resolve(process.env.GBRAIN_EVALS_REPO)
    : path.resolve(repoRoot, '..', 'gbrain-evals');
  const pkgPath = path.join(candidate, 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { name?: string };
    if (pkg.name !== 'gbrain-evals') {
      throw new Error(`Expected ${pkgPath} to belong to gbrain-evals, got ${pkg.name ?? 'unknown'}`);
    }
    return candidate;
  } catch (error) {
    throw new Error(
      `Unable to locate the upstream gbrain-evals repo. Set GBRAIN_EVALS_REPO or clone it next to this repo. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function runAgainstUpstreamHarness(kbRepoRoot: string, gbrainRepoRoot: string, args: ParsedArgs) {
  const multiAdapterPath = path.join(gbrainRepoRoot, 'eval/runner/multi-adapter.ts');
  const adapterPath = path.join(gbrainRepoRoot, 'eval/runner/adapters/kb-upstream.ts');
  const originalMultiAdapter = sanitizeMultiAdapter(await readFile(multiAdapterPath, 'utf8'));
  const adapterSource = buildAdapterSource(path.join(kbRepoRoot, 'eval/adapters/gbrain-evals/kb-adapter.ts'));

  const patchedMultiAdapter = originalMultiAdapter
    .replace(
      "import { RipgrepBm25Adapter } from './adapters/grep-only.ts';",
      "import { RipgrepBm25Adapter } from './adapters/grep-only.ts';\nimport { KbUpstreamAdapter } from './adapters/kb-upstream.ts';"
    )
    .replace(
      "  const allAdapters: Adapter[] = [\n    new GbrainAfterAdapter(),",
      "  const allAdapters: Adapter[] = [\n    new GbrainAfterAdapter(),\n    new KbUpstreamAdapter(),"
    )
    .replace(
      /const allAdapters: Adapter\[] = \[[\s\S]*?\n  \];/,
      "const allAdapters: Adapter[] = [\n    new GbrainAfterAdapter(),\n    new KbUpstreamAdapter(),\n  ];"
    );

  if (patchedMultiAdapter === originalMultiAdapter) {
    throw new Error('Failed to patch gbrain-evals multi-adapter.ts; upstream layout changed.');
  }

  await writeFile(adapterPath, adapterSource, 'utf8');
  await writeFile(multiAdapterPath, patchedMultiAdapter, 'utf8');

  try {
    await ensureBunLockAndModules(gbrainRepoRoot);
    const bunArgs = ['eval/runner/multi-adapter.ts'];
    if (args.adapter === 'gbrain') bunArgs.push(`--adapter=${args.adapter}`);
    bunArgs.push('--json');
    const raw = await execFile('bun', bunArgs, { cwd: gbrainRepoRoot });
    const parsed = JSON.parse(stripToJson(raw.stdout)) as UpstreamRunnerOutput;
    return formatResult(parsed, args.adapter);
  } finally {
    await writeFile(multiAdapterPath, originalMultiAdapter, 'utf8');
    await unlink(adapterPath).catch(() => undefined);
  }
}

function formatResult(parsed: UpstreamRunnerOutput, adapter?: string) {
  const gbrain = requireScorecard(parsed, 'gbrain');
  const kb = requireScorecard(parsed, 'kb-upstream');

  if (adapter === 'kb-upstream') {
    return formatKbOnly(parsed, kb, gbrain);
  }
  if (adapter === 'gbrain') {
    return formatGbrainOnly(parsed, gbrain);
  }
  return formatComparison(parsed, gbrain, kb);
}

function requireScorecard(parsed: UpstreamRunnerOutput, adapter: string): UpstreamScorecard {
  const scorecard = parsed.scorecards.find((entry) => entry.adapter === adapter);
  if (!scorecard) {
    throw new Error(`Upstream gbrain-evals run completed without a ${adapter} scorecard.`);
  }
  return scorecard;
}

function formatKbOnly(parsed: UpstreamRunnerOutput, kb: UpstreamScorecard, gbrain: UpstreamScorecard) {
  return {
    adapter: kb.adapter,
    benchmark: 'gbrain-evals-upstream',
    queries: parsed.queries,
    corpus: parsed.corpus,
    runs: kb.runs,
    precisionAt5: kb.mean_precision_at_k,
    recallAt5: kb.mean_recall_at_k,
    correctInTopK: kb.correct_in_top_k,
    totalExpected: kb.total_expected,
    stddevPrecisionAt5: kb.stddev_precision_at_k,
    stddevRecallAt5: kb.stddev_recall_at_k,
    publishedReference: PUBLISHED_GBRAIN_REFERENCE,
    realGbrain: {
      precisionAt5: gbrain.mean_precision_at_k,
      recallAt5: gbrain.mean_recall_at_k,
      correctInTopK: gbrain.correct_in_top_k,
      totalExpected: gbrain.total_expected
    },
    deltaVsPublished: {
      precisionAt5: kb.mean_precision_at_k - PUBLISHED_GBRAIN_REFERENCE.precisionAt5,
      recallAt5: kb.mean_recall_at_k - PUBLISHED_GBRAIN_REFERENCE.recallAt5
    },
    deltaVsRealGbrain: {
      precisionAt5: kb.mean_precision_at_k - gbrain.mean_precision_at_k,
      recallAt5: kb.mean_recall_at_k - gbrain.mean_recall_at_k,
      correctInTopK: kb.correct_in_top_k - gbrain.correct_in_top_k
    }
  };
}

function formatGbrainOnly(parsed: UpstreamRunnerOutput, gbrain: UpstreamScorecard) {
  return {
    adapter: gbrain.adapter,
    benchmark: 'gbrain-evals-upstream',
    queries: parsed.queries,
    corpus: parsed.corpus,
    runs: gbrain.runs,
    precisionAt5: gbrain.mean_precision_at_k,
    recallAt5: gbrain.mean_recall_at_k,
    correctInTopK: gbrain.correct_in_top_k,
    totalExpected: gbrain.total_expected,
    stddevPrecisionAt5: gbrain.stddev_precision_at_k,
    stddevRecallAt5: gbrain.stddev_recall_at_k
  };
}

function formatComparison(parsed: UpstreamRunnerOutput, gbrain: UpstreamScorecard, kb: UpstreamScorecard) {
  return {
    benchmark: 'gbrain-evals-upstream-compare',
    queries: parsed.queries,
    corpus: parsed.corpus,
    scorecards: {
      gbrain: formatScorecard(gbrain),
      kbUpstream: formatScorecard(kb)
    },
    deltaKbMinusGbrain: {
      precisionAt5: kb.mean_precision_at_k - gbrain.mean_precision_at_k,
      recallAt5: kb.mean_recall_at_k - gbrain.mean_recall_at_k,
      correctInTopK: kb.correct_in_top_k - gbrain.correct_in_top_k
    }
  };
}

function formatScorecard(scorecard: UpstreamScorecard) {
  return {
    adapter: scorecard.adapter,
    runs: scorecard.runs,
    precisionAt5: scorecard.mean_precision_at_k,
    recallAt5: scorecard.mean_recall_at_k,
    stddevPrecisionAt5: scorecard.stddev_precision_at_k,
    stddevRecallAt5: scorecard.stddev_recall_at_k,
    correctInTopK: scorecard.correct_in_top_k,
    totalExpected: scorecard.total_expected
  };
}

function buildAdapterSource(kbAdapterPath: string): string {
  const importPath = toPosixPath(kbAdapterPath);
  return `import type { Adapter, AdapterConfig, BrainState, Page, Query, RankedDoc } from '../types.ts';
import { KbAdapter } from '${importPath}';

export class KbUpstreamAdapter implements Adapter {
  readonly name = 'kb-upstream';
  private readonly inner = new KbAdapter(this.name);

  async init(rawPages: Page[], config: AdapterConfig): Promise<BrainState> {
    return this.inner.init(rawPages as any, { ...config, name: this.name });
  }

  async query(q: Query, state: BrainState): Promise<RankedDoc[]> {
    return this.inner.query(q as any, state);
  }

  async snapshot(state: BrainState): Promise<string> {
    return (await this.inner.snapshot?.(state)) ?? '';
  }

  async teardown(state: BrainState): Promise<void> {
    await this.inner.teardown?.(state);
  }
}
`;
}

async function ensureBunLockAndModules(repoRoot: string): Promise<void> {
  const nodeModulesPath = path.join(repoRoot, 'node_modules');
  try {
    await stat(nodeModulesPath);
  } catch {
    await execFile('bun', ['install'], { cwd: repoRoot });
  }
}

function execFile(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}\n${stderr || stdout}`));
    });
  });
}

function stripToJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error(`Expected JSON output, received: ${text.slice(0, 200)}`);
  }
  return text.slice(start);
}

function sanitizeMultiAdapter(text: string): string {
  const withoutImportSpam = text.replace(/import \{ KbUpstreamAdapter \} from '\.\/adapters\/kb-upstream\.ts';\n/g, '');
  const withoutAdapterSpam = withoutImportSpam.replace(/^\s*new KbUpstreamAdapter\(\),\n/gm, '');
  return withoutAdapterSpam;
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join(path.posix.sep);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
