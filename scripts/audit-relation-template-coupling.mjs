#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HARD_TARGETS = [
  'eval/adapters/gbrain-evals/kb-adapter.ts',
  'packages/kb-core/src/service.ts',
  'packages/kb-core/src/service-helpers.ts'
];

const INFO_TARGETS = [
  'packages/kb-core/src/relations.ts',
  'packages/kb-core/src/relation-rules.json'
];

const HARD_PATTERNS = [
  { name: 'public attended template literal', regex: /Who attended/i },
  { name: 'public works-at template literal', regex: /Who works at/i },
  { name: 'public invested-in template literal', regex: /Who invested in/i },
  { name: 'public advises template literal', regex: /Who advises/i },
  { name: 'benchmark family scoring branch', regex: /queryFamily\s*={0,2}=\s*['"](?:works_at|attended|invested_in|advises)['"]/ },
  { name: 'benchmark tag scoring branch', regex: /tags?\s*\.\s*(?:includes|some)\s*\([^)]*['"](?:works_at|attended|invested_in|advises)['"]/ }
];

const INFO_PATTERNS = [
  { name: 'relation template regex', regex: /who\\s\+|who\s+/i },
  { name: 'relation family name', regex: /\b(?:works_at|attended|invested_in|advises)\b/ }
];

export function auditRelationTemplateCoupling(rootDir = repoRoot) {
  return {
    failures: scanTargets(rootDir, HARD_TARGETS, HARD_PATTERNS),
    review: scanTargets(rootDir, INFO_TARGETS, INFO_PATTERNS)
  };
}

function scanTargets(rootDir, targets, patterns) {
  const findings = [];
  for (const target of targets) {
    const absolute = path.join(rootDir, target);
    for (const file of listFiles(absolute)) {
      if (!/\.(ts|json|js|mjs)$/.test(file)) continue;
      const relative = path.relative(rootDir, file);
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const [index, line] of lines.entries()) {
        for (const pattern of patterns) {
          if (pattern.regex.test(line)) {
            findings.push({ file: relative, line: index + 1, pattern: pattern.name, text: line.trim() });
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
  const result = auditRelationTemplateCoupling();
  if (result.failures.length > 0) {
    console.error('Relation template-coupling audit failed:');
    for (const finding of result.failures) {
      console.error(`- ${finding.file}:${finding.line} ${finding.pattern}: ${finding.text}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Relation template-coupling audit passed.');
    if (process.env.KB_AUDIT_VERBOSE === 'true' && result.review.length > 0) {
      console.log('Review-only relation schema matches:');
      for (const finding of result.review) {
        console.log(`- ${finding.file}:${finding.line} ${finding.pattern}: ${finding.text}`);
      }
    }
  }
}
