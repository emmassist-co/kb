import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { startKnowledgeBaseCliDaemon } from '../packages/kb-cli/src/daemon.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/file-store.js';
import { startKnowledgeBaseNodeServer } from '../packages/kb-http/src/node-server.js';
import { buildSubcommandArgv, runKnowledgeBaseCli } from '../packages/kb-cli/src/index.js';
import { summarizeKnowledgeBaseSyncResult } from '../packages/kb-cli/src/sync.js';
import { summarizeKnowledgeBaseSyncDaemonResult } from '../packages/kb-cli/src/sync-daemon.js';

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
    const recordPayload = JSON.parse(record.stdout) as {
      entityIds: string[];
      eventIds: string[];
      hydrated: {
        entities: Array<{ meta: { id: string; title: string } }>;
        sources: unknown[];
        events: unknown[];
        links: unknown[];
      };
    };
    assert.deepEqual(recordPayload.entityIds, ['vendor-stripe']);
    assert.deepEqual(recordPayload.eventIds, []);
    assert.equal(recordPayload.hydrated.entities[0]?.meta.id, 'vendor-stripe');
    assert.equal(recordPayload.hydrated.entities[0]?.meta.title, 'Stripe');
    assert.deepEqual(recordPayload.hydrated.sources, []);
    assert.deepEqual(recordPayload.hydrated.events, []);
    assert.deepEqual(recordPayload.hydrated.links, []);

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

test('kb cli write responses expose hydrated links and event writeback', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-writeback-'));

  try {
    const setup = await runKnowledgeBaseCli(
      [
        'record-batch',
        '--json',
        '[{"entity":{"id":"person-alex","kind":"person","title":"Alex"}},{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme runs billing."}}]'
      ],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(setup.exitCode, 0);

    const relate = await runKnowledgeBaseCli(
      ['relate', '--json', '{"type":"founder_of","fromId":"person-alex","toId":"company-acme"}'],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(relate.exitCode, 0);
    const relatePayload = JSON.parse(relate.stdout) as {
      hydrated: {
        entities: Array<{ meta: { id: string } }>;
        links: Array<{ type: string; fromId: string; toId: string }>;
      };
    };
    assert.deepEqual(
      relatePayload.hydrated.entities.map((entity) => entity.meta.id),
      ['company-acme', 'person-alex']
    );
    assert.deepEqual(relatePayload.hydrated.links.map((link) => ({
      type: link.type,
      fromId: link.fromId,
      toId: link.toId
    })), [
      {
        type: 'founder_of',
        fromId: 'person-alex',
        toId: 'company-acme'
      }
    ]);

    const annotate = await runKnowledgeBaseCli(
      [
        'annotate',
        '--json',
        '{"entity_ids":["company-acme"],"summary":"2026-06-08: Confirmed founder edge.","effective_at":"2026-06-08T00:00:00.000Z"}'
      ],
      {
        transport: {
          mode: 'local',
          tenantId: 'acme',
          rootDir
        }
      }
    );
    assert.equal(annotate.exitCode, 0);
    const annotatePayload = JSON.parse(annotate.stdout) as {
      eventIds: string[];
      hydrated: {
        entities: Array<{ timeline: string[] }>;
        events: Array<{ summary: string }>;
      };
    };
    assert.equal(annotatePayload.eventIds.length, 1);
    assert.match(annotatePayload.hydrated.entities[0]?.timeline[0] ?? '', /2026-06-08: Confirmed founder edge\./);
    assert.match(annotatePayload.hydrated.events[0]?.summary ?? '', /2026-06-08: Confirmed founder edge\./);
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
    const payload = await response.json() as { capabilities: { backend: string; canonical: boolean; workspaceRole: string } };
    assert.equal(payload.capabilities.backend, 'file');
    assert.equal(payload.capabilities.canonical, false);
    assert.equal(payload.capabilities.workspaceRole, 'local-development');
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
    capabilities: {
      backend: 'file',
      canonical: false,
      mode: 'local',
      tenantId: 'acme',
      transport: 'http',
      workspaceRole: 'local-development'
    }
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
  assert.match(result.stdout, /tenant, backend, canonicality/);
  assert.match(result.stdout, /kb help operator/);
  assert.doesNotMatch(result.stdout, /kb capture-source --json @payload\.json/);
  assert.doesNotMatch(result.stdout, /kb events/);
  assert.doesNotMatch(result.stdout, /kb drafts/);
  assert.doesNotMatch(result.stdout, /kb relations \[--entity-id/);
  assert.match(result.stdout, /kb sync <pull\|status\|push> \[--verbose] \[--changes] \[--conflicts] \[--stats]/);
  assert.match(result.stdout, /kb daemon <start\|stop\|restart\|status\|logs\|once> \[--verbose] \[--logs] \[--stats]/);
});

test('kb cli operator help exposes repair-only commands explicitly', async () => {
  const result = await runKnowledgeBaseCli(['help', 'operator']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /kb capture-source --json @payload\.json/);
  assert.match(result.stdout, /kb events/);
  assert.match(result.stdout, /kb drafts/);
  assert.match(result.stdout, /kb relations \[--entity-id/);
  assert.match(result.stdout, /repair, cleanup, or inspection/i);
  assert.match(result.stdout, /Default agent work should stay on `search`, `query-relations`, `remember`, `record`, `relate`, and `annotate`/);
});

test('kb cli inspect exposes tenant and workspace role for local mode', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-inspect-'));

  try {
    await runKnowledgeBaseCli(
      ['record', '--json', '{"entity":{"id":"company-acme","kind":"company","title":"Acme","currentTruth":"Acme runs billing."}}'],
      {
        transport: { mode: 'local', tenantId: 'acme', rootDir }
      }
    );
    const result = await runKnowledgeBaseCli(['inspect'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });

    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      tenantId: string;
      backend: string;
      canonical: boolean;
      workspaceRole: string;
      rootDir: string;
      summary: {
        entities: Array<{ id: string }>;
        mode: string;
      };
    };
    assert.equal(parsed.tenantId, 'acme');
    assert.equal(parsed.backend, 'file');
    assert.equal(parsed.canonical, false);
    assert.equal(parsed.workspaceRole, 'local-development');
    assert.equal(parsed.rootDir, rootDir);
    assert.equal(parsed.summary.mode, 'basic');
    assert.deepEqual(parsed.summary.entities.map((entity) => entity.id), ['company-acme']);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('kb cli rejects canonical-style backends without an http target', async () => {
  const cloudflare = await runKnowledgeBaseCli(['inspect'], {
    env: {
      KB_BACKEND: 'cloudflare',
      KB_TENANT_ID: 'acme'
    }
  });
  assert.equal(cloudflare.exitCode, 1);
  assert.match(cloudflare.stderr, /KB_BACKEND=cloudflare is not a direct local CLI workspace/i);
  assert.match(cloudflare.stderr, /Use KB_BASE_URL to target the canonical deployed kb-http surface/i);

  const r2 = await runKnowledgeBaseCli(['inspect'], {
    env: {
      KB_BACKEND: 'r2',
      KB_TENANT_ID: 'acme'
    }
  });
  assert.equal(r2.exitCode, 1);
  assert.match(r2.stderr, /KB_BACKEND=r2 is not a direct local CLI workspace/i);
});

test('kb cli sync commands are rejected outside r2-mirror mode', async () => {
  const result = await runKnowledgeBaseCli(['sync', 'status'], {
    env: {
      KB_BACKEND: 'file',
      KB_TENANT_ID: 'acme'
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /only supported with KB_BACKEND=r2-mirror/i);
});

test('kb cli daemon commands are rejected outside r2-mirror mode', async () => {
  const result = await runKnowledgeBaseCli(['daemon', 'status'], {
    env: {
      KB_BACKEND: 'http',
      KB_BASE_URL: 'http://127.0.0.1:3001'
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /only supported with KB_BACKEND=r2-mirror/i);
});

test('kb cli rebuilds subcommand argv with trailing flags intact', () => {
  assert.deepEqual(
    buildSubcommandArgv({
      positionals: ['sync', 'status'],
      flags: { changes: true, verbose: true, lines: '20' }
    }, 1),
    ['status', '--changes', '--verbose', '--lines', '20']
  );
});

test('kb sync status defaults to a compact aggregate-only envelope', () => {
  const summary = summarizeKnowledgeBaseSyncResult({
    ok: true,
    command: 'status',
    tenantId: 'acme',
    mirrorRoot: '/tmp/acme',
    prefix: '.kb/acme/',
    entries: [
      { path: 'entities/vendor-acme.md', state: 'unchanged' },
      { path: 'entities/vendor-globex.md', state: 'modified-local' },
      { path: 'entities/vendor-initech.md', state: 'added-remote' }
    ]
  });

  assert.deepEqual(summary, {
    ok: true,
    command: 'sync',
    action: 'status',
    state: 'drift',
    counts: {
      changed: 2,
      conflicts: 0
    },
    hints: ['has_local_changes', 'needs_pull']
  });
});

test('kb sync status can disclose changed paths on demand', () => {
  const summary = summarizeKnowledgeBaseSyncResult({
    ok: true,
    command: 'status',
    tenantId: 'acme',
    mirrorRoot: '/tmp/acme',
    prefix: '.kb/acme/',
    entries: [
      { path: 'entities/vendor-globex.md', state: 'modified-local' },
      { path: 'entities/vendor-initech.md', state: 'added-remote' }
    ]
  }, { changes: true });

  assert.deepEqual(summary, {
    ok: true,
    command: 'sync',
    action: 'status',
    state: 'drift',
    counts: {
      changed: 2,
      conflicts: 0
    },
    hints: ['has_local_changes', 'needs_pull'],
    changes: {
      modifiedLocal: ['entities/vendor-globex.md'],
      addedRemote: ['entities/vendor-initech.md']
    }
  });
});

test('kb daemon status defaults to a compact health envelope', () => {
  const summary = summarizeKnowledgeBaseSyncDaemonResult({
    stdout: 'kb daemon running (pid 123)\n{"state":"idle","action":"pull","detail":"ok","updatedAt":"2026-05-13T10:00:00.000Z"}',
    stderr: '',
    exitCode: 0
  });

  assert.deepEqual(summary, {
    ok: true,
    command: 'daemon',
    action: 'status',
    state: 'idle',
    counts: {},
    hints: ['running']
  });
});

test('kb daemon logs remain opt-in and compact by default', () => {
  const summary = summarizeKnowledgeBaseSyncDaemonResult({
    stdout: '[2026-05-13T10:00:00.000Z] kb sync pull\n[2026-05-13T10:00:05.000Z] {"ok":true}',
    stderr: '',
    exitCode: 0
  }, { action: 'logs' });

  assert.deepEqual(summary, {
    ok: true,
    command: 'daemon',
    action: 'logs',
    state: 'ok',
    counts: {
      lines: 2
    },
    hints: ['use_verbose_for_log_lines']
  });
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

test('kb cli remember rejects bare json file paths with an @file hint', async () => {
  const result = await runKnowledgeBaseCli(['remember', '--json', '/workspace/kb_payload.json']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /@file\.json/);
  assert.match(result.stderr, /looks like a file path/i);
});

test('kb cli remember rejects structured content objects with a validation error', async () => {
  const result = await runKnowledgeBaseCli([
    'remember',
    '--json',
    '{"intent":"source_capture","summary":"Cloudflare invoice","content":{"type":"expense","vendor":"Cloudflare"}}'
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /content/i);
  assert.match(result.stderr, /string/i);
});

test('kb cli remember rejects field flags without --json payload transport', async () => {
  const result = await runKnowledgeBaseCli([
    'remember',
    '--intent',
    'source_capture',
    '--summary',
    'Cloudflare invoice',
    '--source',
    'gmail'
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /remember accepts payloads only through --json/i);
  assert.match(result.stderr, /--json @payload\.json/);
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

test('kb cli exposes direct event, draft, relation, and source-capture surfaces', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-cli-secondary-state-'));

  try {
    const captured = await runKnowledgeBaseCli(
      [
        'capture-source',
        '--json',
        '{"id":"src_note","title":"Operator note","content":"Stripe billing owner is Alex.","linkedEntities":["vendor-stripe"],"extractEntities":false}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(captured.exitCode, 0);

    const draft = await runKnowledgeBaseCli(
      [
        'put-draft',
        '--json',
        '{"entityId":"vendor-stripe","title":"Stripe","summary":"Needs cleanup","openQuestions":["Who owns support?"],"sourceIds":["src_note"]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(draft.exitCode, 0);

    const event = await runKnowledgeBaseCli(
      [
        'record',
        '--json',
        '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe handles billing."},"events":[{"summary":"2026-06-07: Billing owner captured.","sourceIds":["src_note"]}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(event.exitCode, 0);

    const relations = await runKnowledgeBaseCli(
      [
        'replace-relations',
        '--json',
        '{"origin":{"kind":"seed","id":"seed:test"},"links":[{"type":"vendor_for","fromId":"vendor-stripe","toId":"vendor-stripe"}]}'
      ],
      { transport: { mode: 'local', tenantId: 'acme', rootDir } }
    );
    assert.equal(relations.exitCode, 0);

    const listedEvents = await runKnowledgeBaseCli(['events'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    const listedDrafts = await runKnowledgeBaseCli(['drafts'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });
    const listedRelations = await runKnowledgeBaseCli(['relations', '--origin-kind', 'seed', '--origin-id', 'seed:test'], {
      transport: { mode: 'local', tenantId: 'acme', rootDir }
    });

    assert.equal(listedEvents.exitCode, 0);
    assert.equal(listedDrafts.exitCode, 0);
    assert.equal(listedRelations.exitCode, 0);
    assert.match(listedEvents.stdout, /Billing owner captured/);
    assert.match(listedDrafts.stdout, /Needs cleanup/);
    assert.match(listedRelations.stdout, /vendor_for/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
