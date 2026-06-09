import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('kb docs describe the staged public package set and current consumer entry point', () => {
  const repoReadme = readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
  assert.match(repoReadme, /## Public Package Set/);
  assert.match(repoReadme, /@emmassist-co\/kb-core/);
  assert.match(repoReadme, /@emmassist-co\/kb-storage-file/);
  assert.match(repoReadme, /@emmassist-co\/kb-storage-cloudflare/);
  assert.match(repoReadme, /@emmassist-co\/kb-http/);
  assert.match(repoReadme, /@emmassist-co\/kb-cli/);
  assert.match(repoReadme, /Not yet in the staged public package set/);
  assert.match(repoReadme, /@emmassist-co\/kb-flue-adapter/);
  assert.match(repoReadme, /@emmassist-co\/kb-autoresearch/);

  const packageSkill = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-write/SKILL.md'), 'utf8');
  assert.match(packageSkill, /github\.com\/emmassist-co\/kb/);

  const setupSkill = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-local-setup/SKILL.md'), 'utf8');
  assert.doesNotMatch(setupSkill, /GITHUB_PACKAGES_TOKEN/);
  assert.match(setupSkill, /KB_ROOT_DIR/);
  assert.match(setupSkill, /KB_TENANT_ID/);
  assert.match(setupSkill, /npx kb-local inspect/);
  assert.ok(existsSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-local-setup/agents/openai.yaml')));

  const readme = readFileSync(path.resolve(process.cwd(), 'packages/kb-cli/README.md'), 'utf8');
  assert.match(readme, /npm install @emmassist-co\/kb-cli/);
  assert.match(readme, /npx kb-local inspect/);
  assert.match(readme, /kb-local-setup/);
  assert.doesNotMatch(readme, /npm\.pkg\.github\.com/);

  const quickstart = readFileSync(path.resolve(process.cwd(), 'docs/consumer-quickstart.md'), 'utf8');
  assert.match(quickstart, /public npm registry/);
  assert.match(quickstart, /KB_TENANT_ID/);
  assert.match(quickstart, /KB_ROOT_DIR/);
  assert.match(quickstart, /npm install @emmassist-co\/kb-cli/);
  assert.match(quickstart, /npx kb-local sync status/);
  assert.match(quickstart, /support and debugging path/);
  assert.match(quickstart, /npx skills add https:\/\/github\.com\/emmassist-co\/kb\/tree\/main\/packages\/kb-cli\/skills\/kb-local-setup/);
  assert.doesNotMatch(quickstart, /GITHUB_PACKAGES_TOKEN/);
  assert.doesNotMatch(quickstart, /npm\.pkg\.github\.com/);

  const migrationStatus = readFileSync(path.resolve(process.cwd(), 'docs/migration-status.md'), 'utf8');
  assert.match(migrationStatus, /## Staged Public Package Set/);
  assert.match(migrationStatus, /@emmassist-co\/kb-core/);
  assert.match(migrationStatus, /@emmassist-co\/kb-flue-adapter/);
  assert.match(migrationStatus, /@emmassist-co\/kb-autoresearch/);
});
