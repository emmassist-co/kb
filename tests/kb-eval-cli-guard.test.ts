import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('importing kb-eval as a module does not execute the CLI', async () => {
  const cwd = process.cwd();
  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), 'eval/runner/kb-eval.ts')).href;
  const child = spawn(
    'npx',
    [
      'tsx',
      '--eval',
      `import(${JSON.stringify(moduleUrl)}).then(() => process.stdout.write('loaded\\n'))`
    ],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? -1));
  });

  assert.equal(exitCode, 0, stderr);
  assert.equal(stdout.trim(), 'loaded');
  assert.equal(stderr.trim(), '');
  assert.doesNotMatch(stdout, /KB Eval Suite|KB Benchmark|Overall passed:/);
});
