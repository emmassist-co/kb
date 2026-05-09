import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildCompactBestScoreSummary } from '../packages/kb-autoresearch/src/inspect.js';
import type { CandidateScore } from '../packages/kb-autoresearch/src/types.js';

const repoRoot = findRepoRoot(process.cwd());
const currentRoot = path.join(repoRoot, 'artifacts/kb-autoresearch/current');
const summaryPath = path.join(currentRoot, 'best-score-summary.json');
const bestScorePath = path.join(currentRoot, 'best-score.json');

if (existsSync(summaryPath)) {
  process.stdout.write(readFileSync(summaryPath, 'utf8'));
  process.exit(0);
}

if (!existsSync(bestScorePath)) {
  throw new Error(`No KB autoresearch best-score artifact found at ${bestScorePath}`);
}

const bestScore = JSON.parse(readFileSync(bestScorePath, 'utf8')) as CandidateScore;
process.stdout.write(`${JSON.stringify(buildCompactBestScoreSummary(bestScore), null, 2)}\n`);

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find repo root from ${startDir}`);
    }
    current = parent;
  }
}
