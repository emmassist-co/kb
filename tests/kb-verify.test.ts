import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKbVerifyFixture, parseArgs } from '../scripts/kb-verify.js';

test('kb verify parses local mode arguments', () => {
  const parsed = parseArgs([
    '--mode',
    'local',
    '--tenant-id',
    'kb-smoke'
  ]);

  assert.equal(parsed.mode, 'local');
  assert.equal(parsed.tenantId, 'kb-smoke');
});

test('kb verify builds a deterministic smoke fixture', () => {
  const fixture = buildKbVerifyFixture('kb-smoke');

  assert.equal(fixture.tenantId, 'kb-smoke');
  assert.equal(fixture.record.entity.id, 'vendor-stripe');
  assert.match(fixture.search.query, /invoice payments/i);
});

test('kb verify rejects removed deployed mode', () => {
  assert.throws(
    () => parseArgs(['--mode', 'deployed', '--base-url', 'https://agent.example.com']),
    /Invalid mode: deployed/
  );
});
