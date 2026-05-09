import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('kb cli setup skill and docs describe published local-consumer install', () => {
  const packageSkill = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-write/SKILL.md'), 'utf8');
  assert.match(packageSkill, /github\.com\/emmassist-co\/kb/);

  const setupSkill = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-local-setup/SKILL.md'), 'utf8');
  assert.match(setupSkill, /GITHUB_PACKAGES_TOKEN/);
  assert.match(setupSkill, /KB_ROOT_DIR/);
  assert.match(setupSkill, /KB_TENANT_ID/);
  assert.match(setupSkill, /npx kb-local inspect/);
  assert.ok(existsSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-local-setup/agents/openai.yaml')));

  const readme = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/README.md'), 'utf8');
  assert.match(readme, /npm install @emmassist-co\/kb-cli/);
  assert.match(readme, /npx kb-local inspect/);
  assert.match(readme, /kb-local-setup/);

  const quickstart = readFileSync(path.resolve(process.cwd(), 'docs/consumer-quickstart.md'), 'utf8');
  assert.match(quickstart, /GITHUB_PACKAGES_TOKEN/);
  assert.match(quickstart, /KB_TENANT_ID/);
  assert.match(quickstart, /KB_ROOT_DIR/);
  assert.match(quickstart, /npm install @emmassist-co\/kb-cli/);
  assert.match(quickstart, /npx skills add https:\/\/github\.com\/emmassist-co\/kb\/tree\/main\/packages\/kb-cli\/skills\/kb-local-setup/);
});
