#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_TARGETS = [
  {
    label: 'kb-core runtime',
    root: 'packages/kb-core/src',
    patterns: [
      { name: 'gbrain marker', regex: /gbrain/i },
      { name: 'world-v1 marker', regex: /world-v1/i },
      { name: 'github benchmark marker', regex: /github-benchmark/i },
      { name: 'benchmark facts marker', regex: /_facts\b/ },
      { name: 'query id shortcut', regex: /query\.id\b/ },
      { name: 'gold label shortcut', regex: /\bgold\b/ },
      { name: 'relevant label shortcut', regex: /\brelevant\b/ }
    ]
  },
  {
    label: 'gbrain adapter scoring surface',
    root: 'eval/adapters/gbrain-evals/kb-adapter.ts',
    patterns: [
      { name: 'benchmark facts marker', regex: /_facts\b/ },
      { name: 'gold label shortcut', regex: /\bgold\b/ },
      { name: 'relevant label shortcut', regex: /\brelevant\b/ },
      { name: 'github benchmark marker', regex: /github-benchmark/i },
      { name: 'world-v1 marker', regex: /world-v1/i }
    ]
  }
];

export function checkKbBenchmarkShortcuts(rootDir = repoRoot) {
  const findings = [];
  for (const target of SCAN_TARGETS) {
    const absolute = path.join(rootDir, target.root);
    for (const file of listFiles(absolute)) {
      if (!/\.(ts|json|js|mjs)$/.test(file)) continue;
      const relative = path.relative(rootDir, file);
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const [index, line] of lines.entries()) {
        for (const pattern of target.patterns) {
          if (pattern.regex.test(line)) {
            findings.push({
              target: target.label,
              file: relative,
              line: index + 1,
              pattern: pattern.name,
              text: line.trim()
            });
          }
        }
      }
    }
  }
  return findings;
}

function listFiles(target) {
  if (!existsSync(target)) return [];
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  return readdirSync(target).flatMap((entry) => listFiles(path.join(target, entry)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkKbBenchmarkShortcuts();
  if (findings.length > 0) {
    console.error('Benchmark shortcut guard failed:');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} [${finding.target}] ${finding.pattern}: ${finding.text}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Benchmark shortcut guard passed.');
  }
}
