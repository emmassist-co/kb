#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const builtBin = path.join(here, '..', 'dist', 'bin.js');
const sourceBin = path.join(here, '..', 'src', 'bin.ts');
const command = existsSync(builtBin)
  ? [builtBin, ...process.argv.slice(2)]
  : ['--import', 'tsx', sourceBin, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, command, {
  stdio: 'inherit',
  env: process.env
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
