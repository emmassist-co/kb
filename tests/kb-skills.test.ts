import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

test('kb runtime and package skill text reflect the narrow write workflow', () => {
  const runtimeSkill = readFileSync(path.resolve(process.cwd(), '.flue/runtime-skills/kb-write/SKILL.md'), 'utf8');
  assert.match(runtimeSkill, /kb help runtime/);
  assert.match(runtimeSkill, /kb help operator/);
  assert.match(runtimeSkill, /kb schema remember/);
  assert.match(runtimeSkill, /kb schema relate/);
  assert.match(runtimeSkill, /kb delete --id/);
  assert.match(runtimeSkill, /Default to `kb relate` for explicit edges/);
  assert.match(runtimeSkill, /Use `kb help runtime` as the compact contract/);
  assert.doesNotMatch(runtimeSkill, /Use `kb record` for canonical structured entities and explicit relation edges/);
  assert.doesNotMatch(runtimeSkill, /kb capture-source/);
  assert.doesNotMatch(runtimeSkill, /kb create-entity/);

  const packageSkill = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-write/SKILL.md'), 'utf8');
  assert.match(packageSkill, /kb help operator/);
  assert.match(packageSkill, /kb validate record/);
  assert.match(packageSkill, /kb validate relate/);
  assert.match(packageSkill, /Default to `relate` for explicit edges/);
  assert.match(packageSkill, /kb help runtime/);
  assert.ok(existsSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-write/agents/openai.yaml')));
});
