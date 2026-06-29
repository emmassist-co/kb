import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CandidateScore } from './types.js';

const CACHE_INPUT_FILES = [
  'packages/kb-core/src/service.ts',
  'packages/kb-core/src/relations.ts',
  'packages/kb-core/src/relation-rules.json',
  'eval/runner/cat1-retrieval.ts',
  'eval/runner/cat2-temporal.ts',
  'eval/runner/cat3-identity.ts',
  'eval/runner/cat4-provenance.ts',
  'eval/runner/cat5-contradictions.ts',
  'eval/runner/cat6-fuzzy.ts',
  'eval/runner/kb-eval.ts',
  'eval/runner/kb-benchmark.ts',
  'eval/runner/shared.ts',
  'eval/runner/types.ts',
  'packages/kb-autoresearch/src/evaluator.ts',
  'packages/kb-autoresearch/src/scorer.ts',
  'scripts/kb-autoresearch-inspect.ts',
  'packages/kb-autoresearch/src/cache.ts'
];

export function computeBaselineCacheKey(repoRoot: string, _headCommit: string): string {
  const hash = createHash('sha256');
  hash.update('baseline-cache-v2');
  for (const relativePath of CACHE_INPUT_FILES) {
    hash.update(relativePath);
    const absolutePath = path.join(repoRoot, relativePath);
    if (existsSync(absolutePath)) {
      hash.update(readFileSync(absolutePath, 'utf8'));
    }
  }
  return hash.digest('hex');
}

export function readBaselineCache(cacheRoot: string, cacheKey: string): CandidateScore | null {
  const cachePath = getBaselineCachePath(cacheRoot, cacheKey);
  if (!existsSync(cachePath)) return null;
  return JSON.parse(readFileSync(cachePath, 'utf8')) as CandidateScore;
}

export function writeBaselineCache(cacheRoot: string, cacheKey: string, score: CandidateScore): void {
  const cachePath = getBaselineCachePath(cacheRoot, cacheKey);
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(score, null, 2)}\n`, 'utf8');
}

function getBaselineCachePath(cacheRoot: string, cacheKey: string): string {
  return path.join(cacheRoot, `baseline-${cacheKey}.json`);
}
