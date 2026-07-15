import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runRetrievalCategory } from './cat1-retrieval.js';
import { runTemporalCategory } from './cat2-temporal.js';
import { runIdentityCategory } from './cat3-identity.js';
import { runProvenanceCategory } from './cat4-provenance.js';
import { runContradictionsCategory } from './cat5-contradictions.js';
import { runFuzzyCategory } from './cat6-fuzzy.js';
import { summarizeOverall, writeScorecardArtifacts } from './shared.js';
import type { EvalCategoryResult, EvalScorecard } from './types.js';

interface ParsedArgs {
  category?: EvalCategoryResult['category'];
  json: boolean;
  k: number;
  corpusPath?: string;
  fixturesPath?: string;
  gbrainWorldPath?: string;
  gbrainWorldContract?: 'github-benchmark' | 'corpus-linkable';
  repoDocsPath?: string;
  outputDir?: string;
  writeScorecard: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const categories = await runSelectedCategories(args);
  const scorecard: EvalScorecard = {
    suite: args.category ? `kb:${args.category}` : 'kb:core-six',
    corpus: args.gbrainWorldPath
      ? `gbrain-world-v1:${args.gbrainWorldContract ?? 'github-benchmark'}:${args.gbrainWorldPath}`
      : args.repoDocsPath
        ? `repo-docs-v1:${args.repoDocsPath}`
        : 'kb-core-six',
    provenance: inferScorecardProvenance(categories),
    generatedAt: new Date().toISOString(),
    policy: buildScorecardPolicy(args),
    categories,
    overall: summarizeOverall(categories)
  };
  if (args.writeScorecard) {
    writeScorecardArtifacts(scorecard, args.outputDir);
  }
  if (args.json) {
    console.log(JSON.stringify(scorecard, null, 2));
    return;
  }
  printMarkdown(scorecard);
}

export async function runSelectedCategories(args: ParsedArgs): Promise<EvalCategoryResult[]> {
  if (args.category === 'retrieval') {
    return [(await runRetrievalCategory({ corpusPath: args.corpusPath, gbrainWorldPath: args.gbrainWorldPath, gbrainWorldContract: args.gbrainWorldContract, repoDocsPath: args.repoDocsPath, k: args.k })).category];
  }
  if (args.category === 'temporal') return [await runTemporalCategory({ fixturesPath: args.fixturesPath })];
  if (args.category === 'identity') return [await runIdentityCategory({ fixturesPath: args.fixturesPath, k: args.k })];
  if (args.category === 'provenance') return [await runProvenanceCategory({ fixturesPath: args.fixturesPath, k: args.k })];
  if (args.category === 'contradictions') return [await runContradictionsCategory({ fixturesPath: args.fixturesPath })];
  if (args.category === 'fuzzy') return [await runFuzzyCategory({ fixturesPath: args.fixturesPath, k: args.k })];
  return [
    (await runRetrievalCategory({ corpusPath: args.corpusPath, k: args.k })).category,
    await runTemporalCategory({ fixturesPath: args.fixturesPath }),
    await runIdentityCategory({ fixturesPath: args.fixturesPath, k: args.k }),
    await runProvenanceCategory({ fixturesPath: args.fixturesPath, k: args.k }),
    await runContradictionsCategory({ fixturesPath: args.fixturesPath }),
    await runFuzzyCategory({ fixturesPath: args.fixturesPath, k: args.k })
  ];
}

function printMarkdown(scorecard: EvalScorecard) {
  console.log('# KB Eval Suite');
  console.log('');
  console.log(`Suite: \`${scorecard.suite}\``);
  console.log(`Provenance: \`${scorecard.provenance}\``);
  console.log(`Generated: ${scorecard.generatedAt}`);
  console.log(`Overall passed: ${scorecard.overall.passed ? 'yes' : 'no'}`);
  console.log('');
  console.log('| Category | Cases | Passed | Metrics |');
  console.log('| --- | ---: | :---: | --- |');
  for (const category of scorecard.categories) {
    const metrics = Object.entries(category.metrics)
      .map(([key, value]) => `${key}=${(value * 100).toFixed(1)}%`)
      .join(', ');
    console.log(`| ${category.category} | ${category.caseCount} | ${category.passed ? 'yes' : 'no'} | ${metrics} |`);
  }
  for (const category of scorecard.categories.filter((entry) => entry.failures.length > 0)) {
    console.log('');
    console.log(`## ${capitalize(category.category)} Failures`);
    console.log('');
    for (const failure of category.failures.slice(0, 5)) {
      console.log(`- \`${failure.caseId}\`: ${failure.summary}`);
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    json: false,
    k: 5,
    writeScorecard: true,
    gbrainWorldContract: 'github-benchmark'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--category') {
      parsed.category = argv[index + 1] as ParsedArgs['category'];
      index += 1;
    } else if (arg === '--k') {
      parsed.k = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg === '--corpus') {
      parsed.corpusPath = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--fixtures') {
      parsed.fixturesPath = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--gbrain-world') {
      parsed.gbrainWorldPath = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--gbrain-world-contract') {
      const value = argv[index + 1];
      if (value !== 'github-benchmark' && value !== 'corpus-linkable') {
        throw new Error(`Unsupported gbrain world contract: ${value}`);
      }
      parsed.gbrainWorldContract = value;
      index += 1;
    } else if (arg === '--repo-docs') {
      parsed.repoDocsPath = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--output-dir') {
      parsed.outputDir = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--no-write-scorecard') {
      parsed.writeScorecard = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function inferScorecardProvenance(categories: EvalCategoryResult[]): EvalScorecard['provenance'] {
  const values = [...new Set(categories.map((category) => category.provenance))];
  return values.length === 1 ? values[0] : 'mixed';
}

function buildScorecardPolicy(args: ParsedArgs): EvalScorecard['policy'] | undefined {
  if (args.gbrainWorldPath) {
    return {
      externalReference: [`gbrain-world:${args.gbrainWorldContract ?? 'github-benchmark'}`],
      notes: ['Use the exact GBrain GitHub benchmark contract as an external reference rail, not the primary optimize target.']
    };
  }
  if (args.repoDocsPath) {
    return {
      notes: ['Repo docs retrieval is first-party source-grounded validation and stays outside the hot optimization loop.']
    };
  }
  if (args.category) {
    return {
      regressionGuardrails: ['core-six'],
      notes: ['Single-category runs are deterministic regression checks, not release-readiness summaries.']
    };
  }
  return {
    optimizeOn: ['admin-world-v3 dev'],
    confirmOn: ['admin-world-v3 holdout'],
    regressionGuardrails: ['core-six dev', 'core-six holdout', 'relation-paraphrase-v1', 'relation-transfer-v1'],
    externalReference: ['gbrain-world:github-benchmark'],
    notes: [
      'Optimize on product-core admin-world retrieval quality.',
      'Use deterministic core-six categories as regression floors.',
      'Keep anti-cheat relation paraphrase and prose-only transfer rails green before making product-general relation-quality claims.',
      'Keep the exact GBrain GitHub benchmark contract as an external comparison rail rather than a direct ship target.'
    ]
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
