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
      ? `gbrain-world-v1:${args.gbrainWorldPath}`
      : args.repoDocsPath
        ? `repo-docs-v1:${args.repoDocsPath}`
        : 'kb-core-six',
    provenance: inferScorecardProvenance(categories),
    generatedAt: new Date().toISOString(),
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
    return [(await runRetrievalCategory({ corpusPath: args.corpusPath, gbrainWorldPath: args.gbrainWorldPath, repoDocsPath: args.repoDocsPath, k: args.k })).category];
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
    writeScorecard: true
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
