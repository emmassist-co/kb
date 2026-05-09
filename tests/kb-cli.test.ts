import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { startKnowledgeBaseCliDaemon } from '../packages/kb-cli/src/daemon.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/file-store.js';
import { startKnowledgeBaseNodeServer } from '../packages/kb-http/src/node-server.js';
import { runKnowledgeBaseCli } from '../packages/kb-cli/src/index.js';

test('kb cli local mode can record and search in-process', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-local-'));

  try {
    const record = await runKnowledgeBaseCli(
      ['record', '--json', '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe owns billing."}}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(record.exitCode, 0);

    const search = await runKnowledgeBaseCli(
      ['search', '--json', '{"query":"billing stripe"}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(search.exitCode, 0);
    const parsed = JSON.parse(search.stdout) as { results: Array<{ id: string }> };
    assert.equal(parsed.results[0]?.id, 'vendor-stripe');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli daemon helper serves canonical endpoints over localhost', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-daemon-'));
  const daemon = await startKnowledgeBaseCliDaemon({
    tenantId: 'acme',
    rootDir
  });

  try {
    const response = await fetch(`${daemon.url}/v1/capabilities`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { capabilities: { backend: string } };
    assert.equal(payload.capabilities.backend, 'file');
  } finally {
    await daemon.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli http mode can search through the daemon contract', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-http-'));
  const service = new KnowledgeBaseService(
    'acme',
    {
      enabled: true,
      mode: 'basic',
      writePolicy: 'mixed',
      persistence: { backend: 'file', cacheRefreshPolicy: 'none', rootDir: '.kb' },
      ingest: {
        agentTurns: false,
        userCorrections: false,
        workspaceSignals: false,
        externalResearch: false
      }
    },
    new FileKnowledgeStore(rootDir, 'basic')
  );
  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe owns billing.'
    }
  });
  const server = await startKnowledgeBaseNodeServer({
    service,
    capabilities: { backend: 'file', mode: 'local' }
  });

  try {
    const result = await runKnowledgeBaseCli(
      ['search', '--json', '{"query":"billing stripe"}'],
      {
        transport: {
          mode: 'http',
          baseUrl: server.url
        }
      }
    );
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { results: Array<{ id: string }> };
    assert.equal(parsed.results[0]?.id, 'vendor-stripe');
  } finally {
    await server.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli schema documents required fields and valid enums for write commands', async () => {
  const result = await runKnowledgeBaseCli(['schema', 'remember']);

  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout) as {
    command: string;
    required: string[];
    enums: Record<string, string[]>;
    note: string;
  };
  assert.equal(parsed.command, 'remember');
  assert.deepEqual(parsed.required, ['intent', 'summary']);
  assert.deepEqual(parsed.enums.intent, ['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile']);
  assert.match(parsed.note, /Use `record` for structured entities/i);
  assert.match(parsed.note, /`relate` for explicit edges/i);
});

test('kb cli help makes the edge-writing split explicit', async () => {
  const result = await runKnowledgeBaseCli(['help']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Use `kb record` for structured entities/);
  assert.match(result.stdout, /Use `kb relate` for explicit relation edges between existing entities/);
  assert.match(result.stdout, /Do not use `kb annotate` for relation edges/);
  assert.match(result.stdout, /Only use `record\.relations\[\]` when you are already creating or rewriting the entity/);
});

test('kb cli validate reports all write payload issues before mutation', async () => {
  const remember = await runKnowledgeBaseCli(['validate', 'remember', '--json', '{"intent":"wrong"}']);
  assert.equal(remember.exitCode, 1);
  assert.match(remember.stderr, /summary/);
  assert.match(remember.stderr, /intent/);
  assert.match(remember.stderr, /source_capture/);

  const record = await runKnowledgeBaseCli(['validate', 'record', '--json', '{}']);
  assert.equal(record.exitCode, 1);
  assert.match(record.stderr, /entity/);

  const annotate = await runKnowledgeBaseCli(['validate', 'annotate', '--json', '{"entity_ids":["vendor-stripe"]}']);
  assert.equal(annotate.exitCode, 1);
  assert.match(annotate.stderr, /summary/);

  const nested = await runKnowledgeBaseCli([
    'validate',
    'record',
    '--json',
    '{"entity":{"id":"person-alex","kind":"person","title":"Alex","handles":[{"type":"telegram","value":"@alex"}]}}'
  ]);
  assert.equal(nested.exitCode, 1);
  assert.match(nested.stderr, /entity\.handles/);
});

test('kb cli delete removes test entities cleanly', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-delete-'));

  try {
    const record = await runKnowledgeBaseCli(
      ['record', '--json', '{"entity":{"id":"test-mixed-org","kind":"company","title":"Test Mixed Org","currentTruth":"Cleanup me."}}'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(record.exitCode, 0);

    const deleted = await runKnowledgeBaseCli(['delete', '--id', 'test-mixed-org'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    assert.equal(deleted.exitCode, 0);

    const listed = await runKnowledgeBaseCli(['list'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    const parsed = JSON.parse(listed.stdout) as { entities: Array<{ id: string }> };
    assert.deepEqual(parsed.entities, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli batch write commands apply multiple records and annotations', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-batch-'));

  try {
    const recordBatch = await runKnowledgeBaseCli(
      [
        'record-batch',
        '--json',
        '[{"entity":{"id":"person-alex","kind":"person","title":"Alex","currentTruth":"Alex founded Acme."}},{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme builds billing tooling."},"relations":[{"type":"founded","fromId":"person-alex","toId":"company-acme"}]}]'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(recordBatch.exitCode, 0);

    const annotateBatch = await runKnowledgeBaseCli(
      [
        'annotate-batch',
        '--json',
        '[{"entity_ids":["company-acme"],"summary":"2026-05-09: Validated founder edge.","effective_at":"2026-05-09T00:00:00.000Z"},{"entity_ids":["person-alex"],"summary":"2026-05-09: Confirmed canonical spelling."}]'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(annotateBatch.exitCode, 0);

    const company = await runKnowledgeBaseCli(['get', 'company-acme'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    assert.match(company.stdout, /Validated founder edge/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli traverse can filter for explicit structured edges', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-traverse-'));

  try {
    const record = await runKnowledgeBaseCli(
      [
        'record',
        '--json',
        '{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme works with billing systems."},"relatedEntities":[{"id":"person-alex","kind":"person","title":"Alex"}],"relations":[{"type":"founder_of","fromId":"person-alex","toId":"company-acme"}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(record.exitCode, 0);

    const traversed = await runKnowledgeBaseCli(
      ['traverse', '--id', 'company-acme', '--type', 'founder_of', '--explicit-only'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(traversed.exitCode, 0);
    const parsed = JSON.parse(traversed.stdout) as { edges: Array<{ type: string; explicitReference?: boolean }> };
    assert.equal(parsed.edges.length, 1);
    assert.equal(parsed.edges[0]?.type, 'founder_of');
    assert.equal(parsed.edges[0]?.explicitReference, true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli relate adds an explicit edge between existing entities', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-relate-'));

  try {
    const record = await runKnowledgeBaseCli(
      [
        'record-batch',
        '--json',
        '[{"entity":{"id":"person-alex","kind":"person","title":"Alex"}},{"entity":{"id":"company-ki-group","kind":"company","title":"KI Group"}}]'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(record.exitCode, 0);

    const relate = await runKnowledgeBaseCli(
      [
        'relate',
        '--json',
        '{"type":"colleague_at","fromId":"person-alex","toId":"company-ki-group","confidence":0.9}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(relate.exitCode, 0);

    const traversed = await runKnowledgeBaseCli(
      ['traverse', '--id', 'person-alex', '--type', 'colleague_at', '--explicit-only'],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(traversed.exitCode, 0);
    const parsed = JSON.parse(traversed.stdout) as { edges: Array<{ type: string }> };
    assert.equal(parsed.edges[0]?.type, 'colleague_at');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
