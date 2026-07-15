import { fileURLToPath } from 'node:url';
import { runRetrievalBenchmark, runRetrievalCategory } from './cat1-retrieval.js';
import type { EvalRunResult } from './types.js';

interface ParsedArgs {
  corpusPath?: string;
  gbrainWorldPath?: string;
  gbrainWorldContract?: 'github-benchmark' | 'corpus-linkable';
  adminWorldPath?: string;
  repoDocsPath?: string;
  relationParaphrasePath?: string;
  relationTransferPath?: string;
  json: boolean;
  k: number;
  mode?: 'search-only' | 'graph-only' | 'graph-first-hybrid';
  lexicalBackend?: 'legacy-lexical' | 'bm25-lexical';
  sideBySide: boolean;
  split: 'all' | 'dev' | 'holdout';
}

interface BenchmarkComparison {
  corpus: string;
  split: 'all' | 'dev' | 'holdout';
  metadata?: EvalRunResult['corpusMetadata'];
  modes: EvalRunResult[];
  hardness: NonNullable<EvalRunResult['hardness']>;
  bestStack: EvalRunResult;
  externalReference?: {
    name: string;
    precisionAtK: number;
    recallAtK: number;
    precisionScorer: 'hits/returned_docs';
    recallScorer: 'hits/gold_answers';
    source: string;
  };
  primary: EvalRunResult;
}

const GBRAIN_HEADLINE_REFERENCE = {
  name: 'gbrain-readme-headline',
  precisionAtK: 0.491,
  recallAtK: 0.979,
  precisionScorer: 'hits/returned_docs' as const,
  recallScorer: 'hits/gold_answers' as const,
  source: 'upstream gbrain-evals public headline'
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.sideBySide) {
    const comparison = await runComparison(args, true);
    if (args.json) {
      console.log(JSON.stringify(comparison, null, 2));
      return;
    }
    printSideBySide(comparison);
    return;
  }

  const { benchmark } = await runRetrievalCategory({
    corpusPath: args.corpusPath,
    gbrainWorldPath: args.gbrainWorldPath,
    gbrainWorldContract: args.gbrainWorldContract,
    adminWorldPath: args.adminWorldPath,
    repoDocsPath: args.repoDocsPath,
    relationParaphrasePath: args.relationParaphrasePath,
    relationTransferPath: args.relationTransferPath,
    k: args.k,
    mode: args.mode,
    lexicalBackend: args.lexicalBackend,
    split: args.split
  });
  if (args.adminWorldPath && benchmark.mode === 'graph-first-hybrid') {
    const searchOnly = await runSingleMode(args, { mode: 'search-only', lexicalBackend: args.lexicalBackend ?? 'legacy-lexical' });
    benchmark.hardness = {
      searchOnlyPrecisionAtK: searchOnly.precisionAtK,
      searchOnlyMrrAtK: searchOnly.mrrAtK,
      graphFirstPrecisionAtK: benchmark.precisionAtK,
      graphFirstMrrAtK: benchmark.mrrAtK,
      precisionLift: benchmark.precisionAtK - searchOnly.precisionAtK,
      mrrLift: benchmark.mrrAtK - searchOnly.mrrAtK,
      searchOnlyPrecisionCapPassed: searchOnly.precisionAtK <= 0.28,
      searchOnlyMrrCapPassed: searchOnly.mrrAtK <= 0.82,
      passed:
        (benchmark.precisionAtK - searchOnly.precisionAtK >= 0.08 ||
          benchmark.mrrAtK - searchOnly.mrrAtK >= 0.08) &&
        searchOnly.precisionAtK <= 0.28 &&
        searchOnly.mrrAtK <= 0.82,
      reasons: buildHardnessReasons(searchOnly, benchmark)
    };
  }
  if (args.json) {
    console.log(JSON.stringify(benchmark, null, 2));
    return;
  }
  printMarkdown(benchmark);
}

export async function runBenchmark(input: Parameters<typeof runRetrievalBenchmark>[0]): Promise<EvalRunResult> {
  return runRetrievalBenchmark(input);
}

export function compareBenchmarkParity(
  local: Pick<EvalRunResult, 'precisionAtK' | 'recallAtK' | 'mrrAtK' | 'ndcgAtK'>,
  deployed: Pick<EvalRunResult, 'precisionAtK' | 'recallAtK' | 'mrrAtK' | 'ndcgAtK'>,
  threshold = 0.05
): {
  threshold: number;
  passed: boolean;
  metrics: Record<'precisionAtK' | 'recallAtK' | 'mrrAtK' | 'ndcgAtK', {
    local: number;
    deployed: number;
    absoluteDrift: number;
    relativeDrift: number;
    passed: boolean;
  }>;
} {
  const metrics = {
    precisionAtK: compareMetric(local.precisionAtK, deployed.precisionAtK, threshold),
    recallAtK: compareMetric(local.recallAtK, deployed.recallAtK, threshold),
    mrrAtK: compareMetric(local.mrrAtK, deployed.mrrAtK, threshold),
    ndcgAtK: compareMetric(local.ndcgAtK, deployed.ndcgAtK, threshold)
  };
  return {
    threshold,
    passed: Object.values(metrics).every((metric) => metric.passed),
    metrics
  };
}

export function buildComparisonModes(
  canonicalLexicalBackend: ParsedArgs['lexicalBackend'] = 'legacy-lexical',
  includeAllLexicalVariants = false
): Array<{ mode: NonNullable<ParsedArgs['mode']>; lexicalBackend?: ParsedArgs['lexicalBackend'] }> {
  if (!includeAllLexicalVariants) {
    return [{ mode: 'search-only', lexicalBackend: canonicalLexicalBackend }];
  }
  return [
    { mode: 'search-only', lexicalBackend: 'legacy-lexical' },
    { mode: 'search-only', lexicalBackend: 'bm25-lexical' },
    { mode: 'graph-only' },
    { mode: 'graph-first-hybrid', lexicalBackend: 'legacy-lexical' },
    { mode: 'graph-first-hybrid', lexicalBackend: 'bm25-lexical' }
  ];
}

async function runComparison(args: ParsedArgs, includeAllLexicalVariants: boolean): Promise<BenchmarkComparison> {
  const canonicalLexicalBackend = args.lexicalBackend ?? 'legacy-lexical';
  const modes = buildComparisonModes(canonicalLexicalBackend, includeAllLexicalVariants);
  const results: EvalRunResult[] = [];
  for (const mode of modes) {
    const benchmark = await runSingleMode(args, mode);
    results.push(benchmark);
  }
  const searchOnly = results.find(
    (result) => result.mode === 'search-only' && result.lexicalBackend === canonicalLexicalBackend
  );
  const graphFirst = results.find(
    (result) => result.mode === 'graph-first-hybrid' && result.lexicalBackend === canonicalLexicalBackend
  );
  if (!searchOnly || !graphFirst) {
    throw new Error('Missing comparison modes for hardness summary.');
  }
  const hardness = {
    searchOnlyPrecisionAtK: searchOnly.precisionAtK,
    searchOnlyMrrAtK: searchOnly.mrrAtK,
    graphFirstPrecisionAtK: graphFirst.precisionAtK,
    graphFirstMrrAtK: graphFirst.mrrAtK,
    precisionLift: graphFirst.precisionAtK - searchOnly.precisionAtK,
    mrrLift: graphFirst.mrrAtK - searchOnly.mrrAtK,
    searchOnlyPrecisionCapPassed: searchOnly.precisionAtK <= 0.28,
    searchOnlyMrrCapPassed: searchOnly.mrrAtK <= 0.82,
    passed:
      (graphFirst.precisionAtK - searchOnly.precisionAtK >= 0.08 ||
        graphFirst.mrrAtK - searchOnly.mrrAtK >= 0.08) &&
      searchOnly.precisionAtK <= 0.28 &&
      searchOnly.mrrAtK <= 0.82,
    reasons: buildHardnessReasons(searchOnly, graphFirst)
  };
  return {
    corpus: graphFirst.corpus,
    split: args.split,
    metadata: graphFirst.corpusMetadata,
    modes: results,
    hardness,
    bestStack: selectBestStack(results),
    externalReference: args.gbrainWorldPath ? GBRAIN_HEADLINE_REFERENCE : undefined,
    primary: {
      ...graphFirst,
      hardness,
      familyGraphLift: buildFamilyGraphLift(searchOnly, graphFirst)
    }
  };
}

async function runSingleMode(
  args: ParsedArgs,
  mode: { mode: NonNullable<ParsedArgs['mode']>; lexicalBackend?: ParsedArgs['lexicalBackend'] }
): Promise<EvalRunResult> {
  const { benchmark } = await runRetrievalCategory({
    corpusPath: args.corpusPath,
    gbrainWorldPath: args.gbrainWorldPath,
    gbrainWorldContract: args.gbrainWorldContract,
    adminWorldPath: args.adminWorldPath,
    repoDocsPath: args.repoDocsPath,
    relationParaphrasePath: args.relationParaphrasePath,
    relationTransferPath: args.relationTransferPath,
    k: args.k,
    mode: mode.mode,
    lexicalBackend: mode.lexicalBackend,
    split: args.split
  });
  return benchmark;
}

function printMarkdown(result: EvalRunResult) {
  console.log('# KB Benchmark');
  console.log('');
  console.log(`Corpus: \`${result.corpus}\``);
  console.log(`Mode: \`${result.mode ?? 'graph-first-hybrid'}\``);
  if (result.lexicalBackend) {
    console.log(`Lexical backend: \`${result.lexicalBackend}\``);
  }
  if (result.corpusMetadata?.split) {
    console.log(`Split: \`${result.corpusMetadata.split}\``);
  }
  if (result.corpusMetadata?.benchmarkContractLabel) {
    console.log(`Benchmark contract: \`${result.corpusMetadata.benchmarkContractLabel}\``);
  }
  console.log(`Queries: ${result.queryCount}`);
  console.log(`Top-K: ${result.k}`);
  console.log('');
  console.log(`- Fixed P@${result.k} (hits / requested top-k slots): ${(result.precisionAtK * 100).toFixed(1)}%`);
  console.log(`- Returned-denominator P@${result.k} (hits / returned docs): ${percent(result.returnedPrecisionAtK)}`);
  console.log(`- Fixed P@${result.k} ceiling: ${percent(result.fixedPrecisionAtKCeiling)}`);
  console.log(`- Returned docs@${result.k}: ${formatReturnedCountStats(result.returnedCountStats)}`);
  console.log(`- Recall@${result.k}: ${(result.recallAtK * 100).toFixed(1)}%`);
  console.log(`- MRR@${result.k}: ${(result.mrrAtK * 100).toFixed(1)}%`);
  console.log(`- nDCG@${result.k}: ${(result.ndcgAtK * 100).toFixed(1)}%`);
  if (result.gates) {
    console.log('');
    console.log(`Milestone: \`${result.gates.milestone}\``);
    console.log(`Gates passed: ${result.gates.passed ? 'yes' : 'no'}`);
  }
  if (result.corpusMetadata) {
    console.log('');
    console.log('## Metadata');
    console.log(`- corpus size: ${result.corpusMetadata.corpusSize ?? 'n/a'}`);
    console.log(`- ambiguity rate: ${percent(result.corpusMetadata.ambiguityRate)}`);
    console.log(`- temporal-case rate: ${percent(result.corpusMetadata.temporalCaseRate)}`);
    console.log(`- distractor-case rate: ${percent(result.corpusMetadata.distractorCaseRate)}`);
    console.log(`- alias-query rate: ${percent(result.corpusMetadata.aliasQueryRate)}`);
    console.log(`- indirect-phrasing rate: ${percent(result.corpusMetadata.indirectPhrasingRate)}`);
    console.log(`- wrong-type distractor rate: ${percent(result.corpusMetadata.wrongTypeDistractorRate)}`);
    console.log(`- distractor density: ${formatNumber(result.corpusMetadata.distractorDensity)}`);
    console.log(`- avg candidate density: ${formatNumber(result.corpusMetadata.averageCandidateDensity)}`);
  }
  if (result.familyBreakdown && Object.keys(result.familyBreakdown).length > 0) {
    console.log('');
    console.log('## Families');
    for (const [family, metrics] of Object.entries(result.familyBreakdown)) {
      console.log(`- ${family}: fixed P@${result.k} ${(metrics.precisionAtK * 100).toFixed(1)}%, returned P@${result.k} ${percent(metrics.returnedPrecisionAtK)}, ceiling ${percent(metrics.fixedPrecisionAtKCeiling)}, R@${result.k} ${(metrics.recallAtK * 100).toFixed(1)}%, MRR ${(metrics.mrrAtK * 100).toFixed(1)}%, returned ${formatReturnedCountStats(metrics.returnedCountStats)}, gate ${metrics.passesFloor ? 'pass' : 'fail'}`);
    }
  }
  if (result.familyGraphLift && Object.keys(result.familyGraphLift).length > 0) {
    console.log('');
    console.log('## Graph Lift');
    for (const [family, metrics] of Object.entries(result.familyGraphLift)) {
      console.log(`- ${family}: P@${result.k} lift ${percent(metrics.precisionLiftAtK)}, MRR lift ${percent(metrics.mrrLiftAtK)}, nDCG lift ${percent(metrics.ndcgLiftAtK)}`);
    }
  }
  if (result.gates?.overall.length) {
    console.log('');
    console.log('## Gates');
    for (const entry of result.gates.overall) {
      console.log(`- ${entry.label}: ${percent(entry.actual)} vs ${entry.expected} (${entry.passed ? 'pass' : 'fail'})`);
    }
  }
  if (result.diagnostics) {
    console.log('');
    console.log('## Diagnostics');
    console.log(`- anchor resolution failure rate: ${percent(result.diagnostics.anchorResolutionFailureRate)}`);
    console.log(`- wrong anchor selection rate: ${percent(result.diagnostics.wrongAnchorSelectionRate)}`);
    console.log(`- wrong-type top result rate: ${percent(result.diagnostics.wrongTypeTopResultRate)}`);
    console.log(`- anchor-page-over-answer rate: ${percent(result.diagnostics.anchorPageOverAnswerRate)}`);
    console.log(`- distractor win rate: ${percent(result.diagnostics.distractorWinRate)}`);
    console.log(`- timeline-needed-but-missed rate: ${percent(result.diagnostics.timelineNeededButMissedRate)}`);
    console.log(`- historical-over-current rate: ${percent(result.diagnostics.historicalOverCurrentRate)}`);
    console.log(`- weak-mention-over-explicit rate: ${percent(result.diagnostics.weakMentionBeatExplicitRate)}`);
    console.log(`- sibling distractor win rate: ${percent(result.diagnostics.siblingDistractorWinRate)}`);
    console.log(`- lexical distractor win rate: ${percent(result.diagnostics.lexicalDistractorWinRate)}`);
    console.log(`- graph edge missing count: ${result.diagnostics.graphEdgeMissingCount ?? 0}`);
    console.log(`- graph edge present but badly ranked count: ${result.diagnostics.graphEdgePresentButBadlyRankedCount ?? 0}`);
    console.log(`- false-positive rate over returned docs: ${percent(result.diagnostics.falsePositiveRate)}`);
    if (result.diagnostics.falsePositiveBuckets) {
      console.log(`- false-positive buckets: ${formatBuckets(result.diagnostics.falsePositiveBuckets)}`);
    }
  }
  if (result.extractionQuality) {
    console.log('');
    console.log('## Extraction Quality');
    console.log(`- graph link coverage rate: ${percent(result.extractionQuality.graphLinkCoverageRate)}`);
    console.log(`- explicit support rate: ${percent(result.extractionQuality.explicitSupportRate)}`);
    console.log(`- structured support rate: ${percent(result.extractionQuality.structuredSupportRate)}`);
    console.log(`- prose support rate: ${percent(result.extractionQuality.proseSupportRate)}`);
  }
  if (result.hardness) {
    console.log('');
    console.log('## Hardness');
    console.log(`- passed: ${result.hardness.passed ? 'yes' : 'no'}`);
    console.log(`- precision lift vs search-only: ${percent(result.hardness.precisionLift)}`);
    console.log(`- MRR lift vs search-only: ${percent(result.hardness.mrrLift)}`);
    for (const reason of result.hardness.reasons) {
      console.log(`- ${reason}`);
    }
  }
  console.log('');
  console.log('| Query | Fixed P@K | Returned P@K | R@K | MRR | nDCG |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const query of result.perQuery.slice(0, 20)) {
    console.log(`| ${escapePipe(query.text)} | ${(query.precisionAtK * 100).toFixed(1)}% | ${percent(query.returnedPrecisionAtK)} | ${(query.recallAtK * 100).toFixed(1)}% | ${(query.reciprocalRank * 100).toFixed(1)}% | ${(query.ndcgAtK * 100).toFixed(1)}% |`);
  }
}

function compareMetric(local: number, deployed: number, threshold: number) {
  const absoluteDrift = deployed - local;
  const relativeDrift = local === 0 ? (deployed === 0 ? 0 : Number.POSITIVE_INFINITY) : absoluteDrift / local;
  return {
    local,
    deployed,
    absoluteDrift,
    relativeDrift,
    passed: relativeDrift >= -threshold
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    json: false,
    k: 5,
    mode: 'graph-first-hybrid',
    sideBySide: false,
    split: 'all',
    gbrainWorldContract: 'github-benchmark'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--corpus') {
      parsed.corpusPath = argv[index + 1];
      index += 1;
    } else if (arg === '--gbrain-world') {
      parsed.gbrainWorldPath = argv[index + 1];
      index += 1;
    } else if (arg === '--gbrain-world-contract') {
      const value = argv[index + 1];
      if (value !== 'github-benchmark' && value !== 'corpus-linkable') {
        throw new Error(`Unsupported gbrain world contract: ${value}`);
      }
      parsed.gbrainWorldContract = value;
      index += 1;
    } else if (arg === '--repo-docs') {
      parsed.repoDocsPath = argv[index + 1];
      index += 1;
    } else if (arg === '--relation-paraphrase') {
      parsed.relationParaphrasePath = argv[index + 1];
      index += 1;
    } else if (arg === '--relation-transfer') {
      parsed.relationTransferPath = argv[index + 1];
      index += 1;
    } else if (arg === '--admin-world') {
      parsed.adminWorldPath = argv[index + 1];
      index += 1;
    } else if (arg === '--k') {
      parsed.k = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg === '--mode') {
      parsed.mode = argv[index + 1] as ParsedArgs['mode'];
      index += 1;
    } else if (arg === '--lexical-backend') {
      parsed.lexicalBackend = argv[index + 1] as ParsedArgs['lexicalBackend'];
      index += 1;
    } else if (arg === '--side-by-side') {
      parsed.sideBySide = true;
    } else if (arg === '--split') {
      parsed.split = argv[index + 1] as ParsedArgs['split'];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printSideBySide(comparison: BenchmarkComparison) {
  console.log('# KB Benchmark Side By Side');
  console.log('');
  console.log(`Corpus: \`${comparison.corpus}\``);
  console.log(`Split: \`${comparison.split}\``);
  if (comparison.metadata?.benchmarkContractLabel) {
    console.log(`Benchmark contract: \`${comparison.metadata.benchmarkContractLabel}\``);
  }
  console.log(`Best stack: \`${comparison.bestStack.mode}\` / \`${comparison.bestStack.lexicalBackend ?? 'n/a'}\``);
  if (comparison.externalReference) {
    console.log(`External reference: \`${comparison.externalReference.name}\` returned-denominator P@5 ${(comparison.externalReference.precisionAtK * 100).toFixed(1)}%, R@5 ${(comparison.externalReference.recallAtK * 100).toFixed(1)}% (${comparison.externalReference.source})`);
    console.log(`Best-stack returned-denominator delta vs reference: P@5 ${signedPercent((comparison.bestStack.returnedPrecisionAtK ?? comparison.bestStack.precisionAtK) - comparison.externalReference.precisionAtK)}, R@5 ${signedPercent(comparison.bestStack.recallAtK - comparison.externalReference.recallAtK)}`);
  }
  console.log('');
  console.log('## Headline');
  console.log(`- Fixed P@K (hits / requested top-k slots): ${(comparison.bestStack.precisionAtK * 100).toFixed(1)}%`);
  console.log(`- Returned-denominator P@K (hits / returned docs): ${percent(comparison.bestStack.returnedPrecisionAtK)}`);
  console.log(`- Fixed P@K ceiling: ${percent(comparison.bestStack.fixedPrecisionAtKCeiling)}`);
  console.log(`- Returned docs@K: ${formatReturnedCountStats(comparison.bestStack.returnedCountStats)}`);
  console.log(`- R@K: ${(comparison.bestStack.recallAtK * 100).toFixed(1)}%`);
  console.log(`- MRR: ${(comparison.bestStack.mrrAtK * 100).toFixed(1)}%`);
  console.log(`- nDCG: ${(comparison.bestStack.ndcgAtK * 100).toFixed(1)}%`);
  console.log('');
  console.log('## Ablations');
  console.log('| Mode | Lexical | Fixed P@K | Returned P@K | Ceiling | R@K | MRR | nDCG |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of comparison.modes) {
    console.log(`| ${result.mode} | ${result.lexicalBackend ?? 'n/a'} | ${(result.precisionAtK * 100).toFixed(1)}% | ${percent(result.returnedPrecisionAtK)} | ${percent(result.fixedPrecisionAtKCeiling)} | ${(result.recallAtK * 100).toFixed(1)}% | ${(result.mrrAtK * 100).toFixed(1)}% | ${(result.ndcgAtK * 100).toFixed(1)}% |`);
  }
  console.log('');
  console.log(`Hardness passed: ${comparison.hardness.passed ? 'yes' : 'no'}`);
  console.log(`Precision lift: ${percent(comparison.hardness.precisionLift)}`);
  console.log(`MRR lift: ${percent(comparison.hardness.mrrLift)}`);
  for (const reason of comparison.hardness.reasons) {
    console.log(`- ${reason}`);
  }
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function buildHardnessReasons(searchOnly: EvalRunResult, graphFirst: EvalRunResult): string[] {
  const reasons: string[] = [];
  const precisionLift = graphFirst.precisionAtK - searchOnly.precisionAtK;
  const mrrLift = graphFirst.mrrAtK - searchOnly.mrrAtK;
  if (precisionLift >= 0.08 || mrrLift >= 0.08) {
    reasons.push('Graph-first materially outperforms search-only on the benchmark.');
  } else {
    reasons.push('Benchmark is too easy or graph path is not adding enough separation from search-only.');
  }
  if (searchOnly.precisionAtK > 0.28) {
    reasons.push('Search-only precision is still too high for admin-world-v3 hardness.');
  }
  if (searchOnly.mrrAtK > 0.82) {
    reasons.push('Search-only MRR is still too high for admin-world-v3 hardness.');
  }
  return reasons;
}

function buildFamilyGraphLift(searchOnly: EvalRunResult, graphFirst: EvalRunResult): NonNullable<EvalRunResult['familyGraphLift']> {
  const families = new Set([
    ...Object.keys(searchOnly.familyBreakdown ?? {}),
    ...Object.keys(graphFirst.familyBreakdown ?? {})
  ]);
  return Object.fromEntries(
    [...families].map((family) => {
      const search = searchOnly.familyBreakdown?.[family];
      const graph = graphFirst.familyBreakdown?.[family];
      return [
        family,
        {
          precisionLiftAtK: (graph?.precisionAtK ?? 0) - (search?.precisionAtK ?? 0),
          recallLiftAtK: (graph?.recallAtK ?? 0) - (search?.recallAtK ?? 0),
          mrrLiftAtK: (graph?.mrrAtK ?? 0) - (search?.mrrAtK ?? 0),
          ndcgLiftAtK: (graph?.ndcgAtK ?? 0) - (search?.ndcgAtK ?? 0)
        }
      ];
    })
  );
}

function selectBestStack(results: EvalRunResult[]): EvalRunResult {
  return [...results]
    .sort(
      (left, right) =>
        right.mrrAtK - left.mrrAtK ||
        right.ndcgAtK - left.ndcgAtK ||
        right.precisionAtK - left.precisionAtK ||
        right.recallAtK - left.recallAtK
    )[0];
}

function percent(value?: number): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pts`;
}

function formatNumber(value?: number): string {
  return value == null ? 'n/a' : value.toFixed(2);
}

function formatReturnedCountStats(stats?: EvalRunResult['returnedCountStats']): string {
  if (!stats) return 'n/a';
  return `min ${stats.min}, mean ${stats.mean.toFixed(2)}, max ${stats.max}`;
}

function formatBuckets(buckets: Record<string, number>): string {
  return Object.entries(buckets)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(', ');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
