#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceBin = path.join(here, '..', 'src', 'bin.ts');
const result = spawnSync(process.execPath, ['--import', 'tsx', sourceBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
