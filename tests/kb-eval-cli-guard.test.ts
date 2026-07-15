import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSandboxTtyOrIpcError } from './helpers.js';

test('kb benchmark shortcut guard catches runtime-only benchmark markers', async () => {
  const { checkKbBenchmarkShortcuts } = await import('../scripts/check-kb-benchmark-shortcuts.mjs');

  assert.deepEqual(checkKbBenchmarkShortcuts(process.cwd()), []);

  const root = mkdtempSync(path.join(tmpdir(), 'kb-shortcut-guard-'));
  mkdirSync(path.join(root, 'packages/kb-core/src'), { recursive: true });
  mkdirSync(path.join(root, 'eval/runner'), { recursive: true });
  mkdirSync(path.join(root, 'eval/adapters/gbrain-evals'), { recursive: true });
  writeFileSync(path.join(root, 'packages/kb-core/src/bad.ts'), 'export const leaked = "_facts gbrain-world";\n');
  writeFileSync(path.join(root, 'eval/runner/loaders.ts'), 'const allowedEvalLoader = "_facts";\n');
  writeFileSync(path.join(root, 'eval/adapters/gbrain-evals/kb-adapter.ts'), 'export const adapter = "safe";\n');

  const findings = checkKbBenchmarkShortcuts(root);
  assert.ok(findings.some((finding: { file: string; pattern: string }) => finding.file === 'packages/kb-core/src/bad.ts' && finding.pattern === 'benchmark facts marker'));
  assert.ok(findings.some((finding: { file: string; pattern: string }) => finding.file === 'packages/kb-core/src/bad.ts' && finding.pattern === 'gbrain marker'));
  assert.equal(findings.some((finding: { file: string }) => finding.file === 'eval/runner/loaders.ts'), false);
});

test('relation template-coupling audit catches scoring-path family branches', async () => {
  const { auditRelationTemplateCoupling } = await import('../scripts/audit-relation-template-coupling.mjs');

  assert.equal(auditRelationTemplateCoupling(process.cwd()).failures.length, 0);

  const root = mkdtempSync(path.join(tmpdir(), 'kb-template-audit-'));
  mkdirSync(path.join(root, 'eval/adapters/gbrain-evals'), { recursive: true });
  mkdirSync(path.join(root, 'packages/kb-core/src'), { recursive: true });
  writeFileSync(path.join(root, 'eval/adapters/gbrain-evals/kb-adapter.ts'), 'if (queryFamily === "advises") return results.slice(0, 1);\n');
  writeFileSync(path.join(root, 'packages/kb-core/src/service.ts'), 'export const ok = true;\n');
  writeFileSync(path.join(root, 'packages/kb-core/src/service-helpers.ts'), 'export const ok = true;\n');
  writeFileSync(path.join(root, 'packages/kb-core/src/relations.ts'), 'const schema = /who\\s+advises/;\n');
  writeFileSync(path.join(root, 'packages/kb-core/src/relation-rules.json'), '[{"type":"advises"}]\n');

  const result = auditRelationTemplateCoupling(root);
  assert.ok(result.failures.some((finding: { pattern: string }) => finding.pattern === 'benchmark family scoring branch'));
  assert.ok(result.review.length > 0);
});

test('importing kb-eval as a module does not execute the CLI', async (t) => {
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

  if (exitCode !== 0 && isSandboxTtyOrIpcError(stderr)) {
    t.skip('sandbox blocks tsx IPC socket setup');
    return;
  }

  assert.equal(exitCode, 0, stderr);
  assert.equal(stdout.trim(), 'loaded');
  assert.equal(stderr.trim(), '');
  assert.doesNotMatch(stdout, /KB Eval Suite|KB Benchmark|Overall passed:/);
});
