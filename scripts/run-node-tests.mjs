import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testsRoot = path.resolve(process.cwd(), 'tests');
const excluded = new Set(['kb-benchmark.test.ts']);

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(entryPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.test.ts')) continue;
    if (excluded.has(entry.name)) continue;
    files.push(entryPath);
  }
  return files;
}

if (!statSync(testsRoot).isDirectory()) {
  throw new Error(`Missing tests directory: ${testsRoot}`);
}

const files = walk(testsRoot).sort();
if (files.length === 0) {
  throw new Error('No test files found for default test suite.');
}

const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--test', ...files], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
