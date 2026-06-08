import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runWithCloudflareContext } from '@flue/sdk/cloudflare';
import { InMemoryFs } from 'just-bash';
import { createKbCommand } from '../src/lib/kb/command.js';
import { getAgentModelForRole } from '../src/lib/env.js';
import { buildBm25Index, scoreBm25Index } from '../packages/kb-core/src/bm25.js';
import { createEmptyEntity, createSourceDocument, parseEntityDocument, parseSourceDocument, renderEntityDocument, renderSourceDocument } from '../packages/kb-core/src/documents.js';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { SnapshotKnowledgeStore, createEmptyPersistedKnowledgeState } from '../packages/kb-core/src/snapshot-store.js';
import { R2CanonicalKbStore } from '../packages/kb-storage-cloudflare/src/r2-store.js';
import { createKnowledgeBaseRuntime, createKnowledgeBaseService, resetKnowledgeBaseRuntime } from '../src/lib/kb/service.js';
import { KnowledgeBaseStateMethods } from '../src/lib/kb/state-cloudflare-do.js';
import { renderKbGateRoleDescription, resolveProductConfig } from '../src/lib/product-config.js';
import { createWorkspaceRuntime } from '../src/lib/workspace.js';

test('entity markdown round-trips through frontmatter and sections', () => {
  const entity = createEmptyEntity({
    id: 'vendor-stripe',
    tenantId: 'acme',
    kind: 'vendor',
    title: 'Stripe',
    aliases: ['Stripe Inc.'],
    tags: ['payments'],
    owners: ['finance'],
    sources: ['src_1'],
    currentTruth: 'Stripe handles invoice payments.',
    openQuestions: ['Confirm current account owner.'],
    timeline: ['2026-05-05: Added billing contact.']
  });

  const markdown = renderEntityDocument(entity);
  const parsed = parseEntityDocument(markdown);

  assert.equal(parsed.meta.id, 'vendor-stripe');
  assert.equal(parsed.meta.kind, 'vendor');
  assert.equal(parsed.currentTruth, 'Stripe handles invoice payments.');
  assert.deepEqual(parsed.openQuestions, ['Confirm current account owner.']);
  assert.deepEqual(parsed.timeline, ['2026-05-05: Added billing contact.']);
  assert.deepEqual(parsed.sources, ['src_1']);
});

test('source markdown round-trips through frontmatter and sections', () => {
  const source = createSourceDocument({
    id: 'src_1',
    tenantId: 'acme',
    kind: 'research',
    title: 'Vendor note',
    linkedEntities: ['vendor-stripe'],
    summary: 'Billing note',
    content: 'Finance confirmed billing@stripe.com.',
    citations: ['https://example.com']
  });

  const markdown = renderSourceDocument(source);
  const parsed = parseSourceDocument(markdown);

  assert.equal(parsed.meta.id, 'src_1');
  assert.equal(parsed.meta.kind, 'research');
  assert.equal(parsed.summary, 'Billing note');
  assert.equal(parsed.content, 'Finance confirmed billing@stripe.com.');
  assert.deepEqual(parsed.citations, ['https://example.com']);
});

test('snapshot knowledge store does not mark no-op mutations as dirty', async () => {
  const store = new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'));
  const entity = renderEntityDocument(createEmptyEntity({
    id: 'vendor-stripe',
    tenantId: 'workspace-template',
    kind: 'vendor',
    title: 'Stripe',
    currentTruth: 'Stripe handles invoice payments.'
  }));

  await store.putEntityMarkdown('vendor-stripe', entity);
  assert.equal(store.isDirty(), true);

  const snapshot = store.snapshot();
  const reloaded = new SnapshotKnowledgeStore(snapshot);
  await reloaded.putEntityMarkdown('vendor-stripe', entity);
  assert.equal(reloaded.isDirty(), false);
  await reloaded.deleteDraft('missing-draft');
  assert.equal(reloaded.isDirty(), false);
  await reloaded.replaceLinksForOrigin({ kind: 'entity', id: 'vendor-stripe' }, []);
  assert.equal(reloaded.isDirty(), false);
  assert.deepEqual(reloaded.changes(), {
    upsertedEntityIds: [],
    upsertedSourceIds: [],
    upsertedRegistryIds: [],
    appendedEventIds: [],
    upsertedDraftIds: [],
    deletedDraftIds: [],
    replacedLinkOrigins: [],
    requiresFullRebuild: false,
    requiresFullReset: false
  });
});

test('kb command creates searchable human-readable files in basic mode through record', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-basic-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    let result = await command.execute([
      'record',
      '--json',
      '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","tags":["payments"],"currentTruth":"Stripe handles invoice payments."}}'
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"ok": true/);

    result = await command.execute([
      'remember',
      '--json',
      '{"intent":"source_capture","summary":"Billing contact","content":"Finance confirmed billing@stripe.com for Stripe.","source":{"id":"src_1","kind":"research","title":"Finance note"},"entities":[{"id":"vendor-stripe","kind":"vendor","title":"Stripe"}]}'
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"ok": true/);

    result = await command.execute([
      'search',
      '--json',
      '{"query":"billing stripe","limit":5}'
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /vendor-stripe/);

    const entityDir = path.join(root, 'entities');
    const sourceDir = path.join(root, 'sources');
    assert.deepEqual(readdirSync(entityDir), ['vendor-stripe.md']);
    assert.deepEqual(readdirSync(sourceDir), ['src_1.md']);
    assert.match(readFileSync(path.join(entityDir, 'vendor-stripe.md'), 'utf8'), /## Current Truth/);
    assert.match(readFileSync(path.join(sourceDir, 'src_1.md'), 'utf8'), /## Summary/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('getAgentModelForRole resolves kb-researcher override', () => {
  assert.equal(
    getAgentModelForRole({ FLUE_MODEL_KB_RESEARCHER: 'openai/gpt-5.4-mini' }, 'kb-researcher'),
    'openai/gpt-5.4-mini'
  );
});

test('getAgentModelForRole defaults KB roles to the main agent model', () => {
  assert.equal(
    getAgentModelForRole({ FLUE_MODEL: 'openrouter/anthropic/claude-sonnet-4' }, 'kb-researcher'),
    'openrouter/anthropic/claude-sonnet-4'
  );
  assert.equal(
    getAgentModelForRole({ FLUE_MODEL: 'openrouter/anthropic/claude-sonnet-4' }, 'kb-gate'),
    'openrouter/anthropic/claude-sonnet-4'
  );
  assert.equal(
    getAgentModelForRole({ FLUE_MODEL: 'openrouter/anthropic/claude-sonnet-4' }, 'kb-ingestor'),
    'openrouter/anthropic/claude-sonnet-4'
  );
});

test('kb gate role description allows explicit operator ingest surfaces', () => {
  const description = renderKbGateRoleDescription(resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }));

  assert.match(description, /operator-ingest-url/);
  assert.match(description, /operator-ingest-text/);
});

test('kb remember can persist a failed-fetch reference source plus summary', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-extract-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    const result = await command.execute([
      'remember',
      '--json',
      '{"intent":"source_capture","summary":"Reference captured before fetch succeeded.","source":{"id":"src_1","kind":"research","url":"https://example.com/who-we-are","title":"Who We Are"},"confidence":"high"}'
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"ok": true/);

    const [sourceFile] = readdirSync(path.join(root, 'sources'));
    const sourceMarkdown = readFileSync(path.join(root, 'sources', sourceFile), 'utf8');
    assert.match(sourceMarkdown, /kind: research/);
    assert.match(sourceMarkdown, /title: Who We Are/);
    assert.match(sourceMarkdown, /Reference captured before fetch succeeded\./);
    assert.match(sourceMarkdown, /Reference URL: https:\/\/example\.com\/who-we-are/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb remember can create a company with ownership relations from one payload', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-reference-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    const result = await command.execute([
      'remember',
      '--json',
      '{"intent":"company_profile","summary":"Ownership structure for Alexandre Portela dos Santos, Limitada.","confidence":"high","entities":[{"id":"alexandre-portela-dos-santos-limitada","kind":"company","title":"Alexandre Portela dos Santos, Limitada","facts":["Ownership: Alexandre Portela dos Santos 74%, Catarina Lisboa do Mar 25%, Fátima Portela dos Santos 1%."]},{"id":"alexandre-portela-dos-santos","kind":"person","title":"Alexandre Portela dos Santos"},{"id":"catarina-lisboa-do-mar","kind":"person","title":"Catarina Lisboa do Mar"},{"id":"fatima-portela-dos-santos","kind":"person","title":"Fátima Portela dos Santos"}],"relations":[{"type":"owns","fromId":"alexandre-portela-dos-santos","toId":"alexandre-portela-dos-santos-limitada"},{"type":"owns","fromId":"catarina-lisboa-do-mar","toId":"alexandre-portela-dos-santos-limitada"},{"type":"owns","fromId":"fatima-portela-dos-santos","toId":"alexandre-portela-dos-santos-limitada"}]}'
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"ok": true/);

    const entityMarkdown = readFileSync(path.join(root, 'entities', 'alexandre-portela-dos-santos-limitada.md'), 'utf8');
    assert.match(entityMarkdown, /Ownership: Alexandre Portela dos Santos 74%, Catarina Lisboa do Mar 25%, Fátima Portela dos Santos 1%/);

    const linksResult = await command.execute(['links', '--id', 'alexandre-portela-dos-santos-limitada']);
    assert.equal(linksResult.exitCode, 0);
    assert.match(linksResult.stdout, /owns/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb record can upsert a canonical entity and structured relations in one call', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-entity-aliases-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    let result = await command.execute([
      'record',
      '--json',
      '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe handles invoice payments."},"relations":[{"type":"vendor_for","fromId":"vendor-stripe","toId":"team-finance"}],"relatedEntities":[{"id":"team-finance","kind":"team","title":"Finance"}]}'
    ]);
    assert.equal(result.exitCode, 0);

    result = await command.execute([
      'record',
      '--json',
      '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe now handles invoice payments and payouts."}}'
    ]);
    assert.equal(result.exitCode, 0);

    const entityMarkdown = readFileSync(path.join(root, 'entities', 'vendor-stripe.md'), 'utf8');
    assert.match(entityMarkdown, /Stripe now handles invoice payments and payouts\./);

    const linksResult = await command.execute(['links', '--id', 'vendor-stripe']);
    assert.equal(linksResult.exitCode, 0);
    assert.match(linksResult.stdout, /vendor_for/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb annotate can add historical timeline updates cleanly', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-annotate-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    let result = await command.execute([
      'record',
      '--json',
      '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","currentTruth":"Stripe handles invoice payments."}}'
    ]);
    assert.equal(result.exitCode, 0);

    result = await command.execute([
      'annotate',
      '--json',
      '{"entity_ids":["vendor-stripe"],"summary":"2026-05-06: Added new billing owner.","effective_at":"2026-05-06T00:00:00.000Z"}'
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"ok": true/);

    const entityMarkdown = readFileSync(path.join(root, 'entities', 'vendor-stripe.md'), 'utf8');
    assert.match(entityMarkdown, /2026-05-06: Added new billing owner\./);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb help shows only the new public write surface', async () => {
  const command = createKbCommand(new InMemoryFs(), {
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  const help = await command.execute(['help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /kb remember --json/);
  assert.match(help.stdout, /kb record --json/);
  assert.match(help.stdout, /kb relate --json/);
  assert.match(help.stdout, /kb annotate --json/);
  assert.match(help.stdout, /kb help runtime/);
  assert.match(help.stdout, /kb help operator/);
  assert.doesNotMatch(help.stdout, /kb capture-source --json/);
  assert.doesNotMatch(help.stdout, /kb create-entity --json/);
  assert.doesNotMatch(help.stdout, /kb update-entity-draft --json/);
  assert.doesNotMatch(help.stdout, /kb append-event --json/);
  assert.doesNotMatch(help.stdout, /kb consolidate --id/);
});

test('kb flue command exposes schema help and delete for operator cleanup', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-flue-schema-delete-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    const schema = await command.execute(['schema', 'remember']);
    assert.equal(schema.exitCode, 0);
    assert.match(schema.stdout, /company_profile/);

    const record = await command.execute([
      'record',
      '--json',
      '{"entity":{"id":"test-mixed-org","kind":"company","title":"Test Mixed Org","currentTruth":"Cleanup me."}}'
    ]);
    assert.equal(record.exitCode, 0);

    const deleted = await command.execute(['delete', '--id', 'test-mixed-org']);
    assert.equal(deleted.exitCode, 0);

    const list = await command.execute(['list', '--format', 'json']);
    assert.equal(list.exitCode, 0);
    assert.doesNotMatch(list.stdout, /test-mixed-org/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb flue command exposes relate for explicit edge writes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-flue-relate-'));
  const command = createKbCommand(new InMemoryFs(), {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  try {
    const setup = await command.execute([
      'record-batch',
      '--json',
      '[{"entity":{"id":"person-alex","kind":"person","title":"Alex"}},{"entity":{"id":"company-ki-group","kind":"company","title":"KI Group"}}]'
    ]);
    assert.equal(setup.exitCode, 0);

    const relate = await command.execute([
      'relate',
      '--json',
      '{"type":"colleague_at","fromId":"person-alex","toId":"company-ki-group"}'
    ]);
    assert.equal(relate.exitCode, 0);

    const traversed = await command.execute([
      'traverse',
      '--id',
      'person-alex',
      '--type',
      'colleague_at',
      '--explicit-only'
    ]);
    assert.equal(traversed.exitCode, 0);
    assert.match(traversed.stdout, /colleague_at/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb runtime and package skill text reflect the new write workflow', () => {
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
  assert.match(packageSkill, /kb-local validate record/);
  assert.match(packageSkill, /kb-local validate relate/);
  assert.match(packageSkill, /Default to `relate` for explicit edges/);
  assert.match(packageSkill, /kb help runtime/);
  assert.ok(existsSync(path.resolve(process.cwd(), 'packages/kb-cli/skills/kb-write/agents/openai.yaml')));
});

test('kb json mode returns envelopes and typed validation failures', async () => {
  const command = createKbCommand(new InMemoryFs(), {
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  const success = await command.execute([
    'inspect',
    '--format',
    'json'
  ]);
  assert.equal(success.exitCode, 0);
  assert.match(success.stdout, /"ok": true/);
  assert.match(success.stdout, /"meta"/);

  const failure = await command.execute([
    'remember',
    '--format',
    'json',
    '--json',
    '{"intent":"source_capture"}'
  ]);
  assert.equal(failure.exitCode, 2);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /"ok": false/);
  assert.match(failure.stderr, /"code": "VALIDATION_ERROR"/);
});

test('kb rebuild delegates to the runtime rebuild path', async () => {
  const command = createKbCommand(
    new InMemoryFs(),
    {
      WORKSPACE_TENANT_ID: 'workspace-template'
    },
    {
      runtime: {
        async getService() {
          throw new Error('rebuild should not instantiate the KB service');
        },
        async flush() {
          return null;
        },
        async rebuild() {
          return {
            ok: true,
            version: 'version-2',
            rebuiltAt: '2026-05-06T00:00:00.000Z',
            counts: {
              entities: 1,
              sources: 2,
              events: 3,
              links: 4,
              drafts: 5,
              registry: 6
            }
          };
        }
      }
    }
  );

  const result = await command.execute(['rebuild', '--format', 'json']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /"version": "version-2"/);
  assert.match(result.stdout, /"entities": 1/);
});

test('kb relation links and traversal are persisted separately from markdown', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-links-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jane-smith', kind: 'person', title: 'Jane Smith' });
    await service.createEntity({ id: 'process-invoice-reconciliation', kind: 'process', title: 'Invoice Reconciliation', currentTruth: 'Invoice Reconciliation is owned by Jane Smith.' });

    const links = await service.links('process-invoice-reconciliation');
    assert.ok(links.outgoing.some((entry) => entry.type === 'owns' && entry.toId === 'person-jane-smith'));

    const traversed = await service.traverse({ id: 'process-invoice-reconciliation', type: 'owns', direction: 'out' });
    assert.deepEqual(traversed.entityIds, ['person-jane-smith']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb relation queries prefer graph hits for relation-shaped prompts', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-graph-query-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jane-smith', kind: 'person', title: 'Jane Smith' });
    await service.createEntity({ id: 'process-invoice-reconciliation', kind: 'process', title: 'Invoice Reconciliation', currentTruth: 'Invoice Reconciliation is owned by Jane Smith and uses NetSuite.' });

    const result = await service.queryRelations({
      query: 'Who owns Invoice Reconciliation?',
      mode: 'graph-first-hybrid',
      limit: 5
    });

    assert.equal(result.classification.relationType, 'owns');
    assert.equal(result.results[0]?.id, 'person-jane-smith');
    assert.equal(result.results[0]?.retrievalMode, 'graph-first-hybrid');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb extraction ignores code blocks and inline code for links', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-code-hygiene-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jane-smith', kind: 'person', title: 'Jane Smith' });
    await service.createEntity({ id: 'process-access-escalation', kind: 'process', title: 'Access Escalation' });
    await service.captureSource({
      id: 'src-code',
      title: 'Noisy note',
      content: [
        '```md',
        'Access Escalation is owned by Jane Smith',
        '```',
        'The operational note says `Access Escalation is owned by Jane Smith`.',
        'Status: no confirmed owner yet.'
      ].join('\n')
    });

    const links = await service.links('process-access-escalation');
    assert.equal(links.outgoing.filter((entry) => entry.type === 'owns').length, 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb relation ranking prefers current truth over historical timeline-only owners', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-current-over-historical-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jane-smith', kind: 'person', title: 'Jane Smith' });
    await service.createEntity({ id: 'person-ava-reed', kind: 'person', title: 'Ava Reed' });
    await service.createEntity({
      id: 'process-vendor-renewal',
      kind: 'process',
      title: 'Vendor Renewal',
      currentTruth: 'Vendor Renewal is owned by Jane Smith.',
      timeline: ['2025-01-04: Ava Reed owned Vendor Renewal before the handoff.']
    });

    const result = await service.queryRelations({
      query: 'Who owns Vendor Renewal?',
      mode: 'graph-first-hybrid',
      limit: 5
    });

    assert.equal(result.results[0]?.id, 'person-jane-smith');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb query-relations handles natural phrasing for current approver queries', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-natural-approver-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-leo-porter', kind: 'person', title: 'Leo Porter' });
    await service.createEntity({ id: 'person-leo-portela', kind: 'person', title: 'Leo Portela' });
    await service.createEntity({
      id: 'process-travel-approval-core-lane',
      kind: 'process',
      title: 'Travel Approval Core Lane',
      aliases: ['Travel Approval workflow'],
      currentTruth: 'Travel Approval Core Lane is currently approved by Leo Porter.',
      timeline: ['2025-01-12: Travel Approval Core Lane was approved by Leo Portela.']
    });

    const result = await service.queryRelations({
      query: 'Who currently approves travel approval exceptions?',
      mode: 'graph-only',
      limit: 5
    });

    assert.equal(result.classification.relationType, 'approves');
    assert.equal(result.classification.anchorId, 'process-travel-approval-core-lane');
    assert.equal(result.results[0]?.id, 'person-leo-porter');
    assert.ok(result.results.every((entry) => entry.id !== 'person-leo-portela'));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb query-relations returns only matching typed edge targets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-strict-typed-edges-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jon-mora', kind: 'person', title: 'Jon Mora' });
    await service.createEntity({ id: 'person-iris-chen', kind: 'person', title: 'Iris Chen' });
    await service.createEntity({ id: 'person-marta-rocha', kind: 'person', title: 'Marta Rocha' });
    await service.createEntity({
      id: 'process-executive-inbox-triage-core-lane',
      kind: 'process',
      title: 'Executive Inbox Triage Core Lane',
      currentTruth: 'Executive Inbox Triage Core Lane is approved by Jon Mora, reviewed by Iris Chen, and owned by Marta Rocha.'
    });

    const result = await service.queryRelations({
      query: 'Who approves Executive Inbox Triage Core Lane?',
      mode: 'graph-only',
      limit: 5
    });

    assert.equal(result.classification.relationType, 'approves');
    assert.deepEqual(
      result.results.map((entry) => entry.id),
      ['person-jon-mora']
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb query-relations prefers canonical process anchors over sibling workflow pages', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-canonical-process-anchor-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-liam-gomez', kind: 'person', title: 'Liam Gomez' });
    await service.createEntity({ id: 'team-people-operations', kind: 'team', title: 'People Operations' });
    await service.createEntity({ id: 'person-clara-patel', kind: 'person', title: 'Clara Patel' });
    await service.createEntity({ id: 'team-revenue-systems', kind: 'team', title: 'Revenue Systems' });
    await service.createEntity({
      id: 'process-vendor-renewal-core-lane',
      kind: 'process',
      title: 'Vendor Renewal Core Lane',
      currentTruth: 'Vendor Renewal Core Lane is owned by Liam Gomez and People Operations.'
    });
    await service.createEntity({
      id: 'process-vendor-renewal-priority-desk',
      kind: 'process',
      title: 'Vendor Renewal Priority Desk',
      currentTruth: 'Vendor Renewal Priority Desk is owned by Clara Patel and Revenue Systems.'
    });

    const result = await service.queryRelations({
      query: 'Who owns vendor renewals and which team carries it?',
      mode: 'graph-only',
      limit: 5
    });

    assert.equal(result.classification.anchorId, 'process-vendor-renewal-core-lane');
    assert.deepEqual(
      result.results.map((entry) => entry.id),
      ['person-liam-gomez', 'team-people-operations']
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb query-relations marks unresolved relation intent as degraded exploratory output', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-degraded-fallback-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({
      id: 'policy-travel-approval-policy',
      kind: 'policy',
      title: 'Travel Approval Policy',
      currentTruth: 'Travel Approval Policy defines the control set for travel approval workflows.'
    });

    const result = await service.queryRelations({
      query: 'What is the travel approval situation?',
      mode: 'graph-first-hybrid',
      limit: 5
    });

    assert.equal(result.classification.relationType, null);
    assert.equal(result.classification.anchorId, null);
    assert.ok(result.results.length > 0);
    assert.ok(result.results.every((entry) => entry.retrievalMode === 'search-only'));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb query-relations supports historical asOf lookups without leaking deprecated results into current mode', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-as-of-history-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-leo-porter', kind: 'person', title: 'Leo Porter' });
    await service.createEntity({ id: 'person-leo-portela', kind: 'person', title: 'Leo Portela' });
    await service.createEntity({
      id: 'process-travel-approval-core-lane',
      kind: 'process',
      title: 'Travel Approval Core Lane',
      currentTruth: 'Travel Approval Core Lane is currently approved by Leo Porter.',
      timeline: ['2025-01-12: Travel Approval Core Lane was approved by Leo Portela.']
    });

    const current = await service.queryRelations({
      query: 'Who approves Travel Approval Core Lane?',
      mode: 'graph-only',
      limit: 5
    });
    const historical = await service.queryRelations({
      query: 'Who approves Travel Approval Core Lane?',
      mode: 'graph-only',
      limit: 5,
      asOf: '2025-01-12T12:00:00.000Z',
      currentOnly: false
    });

    assert.deepEqual(current.results.map((entry) => entry.id), ['person-leo-porter']);
    assert.deepEqual(historical.results.map((entry) => entry.id), ['person-leo-portela']);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb relation ranking demotes wrong-type distractors when answer type is clear', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-answer-type-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jane-smith', kind: 'person', title: 'Jane Smith' });
    await service.createEntity({ id: 'project-invoice-cleanup', kind: 'project', title: 'Invoice Cleanup' });
    await service.createEntity({
      id: 'process-invoice-reconciliation',
      kind: 'process',
      title: 'Invoice Reconciliation',
      currentTruth: 'Invoice Reconciliation is owned by Jane Smith and the nearby Invoice Cleanup project mentions the same workflow nouns.'
    });

    const result = await service.queryRelations({
      query: 'Who owns Invoice Reconciliation?',
      mode: 'graph-first-hybrid',
      limit: 5
    });

    assert.equal(result.results[0]?.id, 'person-jane-smith');
    assert.notEqual(result.results[0]?.entityKind, 'project');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb page-role priors infer relation links from person pages when local phrasing is weak', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-page-prior-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({
      id: 'process-finance-access',
      kind: 'process',
      title: 'Finance Access'
    });
    await service.createEntity({
      id: 'person-jane-smith',
      kind: 'person',
      title: 'Jane Smith',
      tags: ['approver'],
      currentTruth: 'Jane Smith is the approval owner for Finance Access.'
    });

    const links = await service.links('process-finance-access');
    assert.ok(links.outgoing.some((entry) => entry.type === 'approves' && entry.toId === 'person-jane-smith'));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('bm25 lexical prefers an exact title match over repeated long-body mentions', () => {
  const index = buildBm25Index({
    entities: [
      createEmptyEntity({
        id: 'meeting-board-q1',
        tenantId: 'workspace-template',
        kind: 'meeting',
        title: 'Board Q1'
      }),
      createEmptyEntity({
        id: 'process-finance-notes',
        tenantId: 'workspace-template',
        kind: 'process',
        title: 'Finance Notes',
        currentTruth: 'board q1 board q1 board q1 board q1 board q1'
      })
    ],
    sources: []
  });

  const results = scoreBm25Index({
    index,
    query: 'board q1',
    limit: 5
  });

  assert.equal(results[0]?.id, 'meeting-board-q1');
  assert.ok(results[0]?.matchedFields.includes('title'));
});

test('kb search supports bm25 lexical backend and improves alias-heavy sparse matching', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-bm25-lexical-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({
      id: 'policy-access-escalation',
      kind: 'policy',
      title: 'Access Escalation Policy',
      aliases: ['AEP'],
      tags: ['access', 'escalation'],
      currentTruth: 'This control set governs privileged access escalation and admin exception handling.'
    });
    await service.createEntity({
      id: 'process-access-review',
      kind: 'process',
      title: 'Access Review Process',
      tags: ['access', 'review'],
      currentTruth: 'This process reviews privileged access requests and exceptions.'
    });

    const legacy = await service.search({
      query: 'AEP privileged admin exceptions',
      limit: 5,
      mode: 'search-only',
      lexicalBackend: 'legacy-lexical'
    });
    const bm25 = await service.search({
      query: 'AEP privileged admin exceptions',
      limit: 5,
      mode: 'search-only',
      lexicalBackend: 'bm25-lexical'
    });

    assert.equal(bm25.results[0]?.id, 'policy-access-escalation');
    assert.equal(legacy.results[0]?.id, 'policy-access-escalation');
    assert.ok(bm25.results[0]?.reason.some((reason) => reason.startsWith('bm25:')));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('bm25 lexical search suppresses anchor documents for relation-shaped queries', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-bm25-anchor-suppress-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-chris-jackson', kind: 'person', title: 'Chris Jackson' });
    await service.createEntity({
      id: 'companies__acme-0',
      kind: 'company',
      title: 'Acme',
      currentTruth: 'Acme is a software company. Chris Jackson invested in Acme.'
    });
    await service.importStructuredLinks({
      origin: { kind: 'seed', id: 'companies__acme-0' },
      links: [{ type: 'invested_in', fromId: 'companies__acme-0', toId: 'person-chris-jackson', confidence: 0.97, evidenceKind: 'structured' }]
    });

    const result = await service.search({
      query: 'Who invested in Acme?',
      limit: 5,
      mode: 'search-only',
      lexicalBackend: 'bm25-lexical'
    });

    assert.equal(result.results[0]?.id, 'person-chris-jackson');
    assert.notEqual(result.results[0]?.id, 'companies__acme-0');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb replay export and replay run are deterministic', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-replay-'));
  const env = {
    KB_ROOT_DIR: root,
    KB_REPLAY_CAPTURE: 'true',
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({ id: 'person-jane-smith', kind: 'person', title: 'Jane Smith' });
    await service.createEntity({
      id: 'process-vendor-renewal',
      kind: 'process',
      title: 'Vendor Renewal',
      currentTruth: 'Vendor Renewal is owned by Jane Smith.'
    });

    await service.search({ query: 'Who owns Vendor Renewal?', mode: 'graph-first-hybrid', limit: 5 });
    const exported = await service.exportReplay();
    assert.match(exported, /Who owns Vendor Renewal\?/);

    const summary = await service.replayQueries();
    assert.equal(summary.recordCount, 1);
    assert.equal(summary.top1Stability, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb diff and consolidate preserve timeline and clear drafts', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-consolidate-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Old truth.'
    });
    await service.appendEvent({
      entityId: 'vendor-stripe',
      summary: 'Finance confirmed billing@stripe.com.',
      sourceIds: ['src_1']
    });
    await service.updateEntityDraft({
      entityId: 'vendor-stripe',
      summary: 'Stripe handles invoice payments. Billing goes to billing@stripe.com.',
      sourceIds: ['src_1'],
      timelineNotes: ['2026-05-05: Added billing contact.']
    });

    const diff = await service.diff('vendor-stripe');
    assert.equal(diff.changed, true);
    assert.match(diff.proposedMarkdown, /billing@stripe.com/);

    const consolidated = await service.consolidate('vendor-stripe');
    assert.equal(consolidated.changed, true);
    assert.match(consolidated.markdown, /## Timeline/);
    assert.equal(consolidated.clearedDraft, true);

    const snapshot = await service.export();
    assert.equal(snapshot.drafts.length, 0);
    assert.ok(Array.isArray(snapshot.links));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb doctor reports missing source references', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-doctor-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      sources: ['src_missing']
    });
    const doctor = await service.doctor();
    assert.equal(doctor.ok, false);
    assert.match(doctor.issues.join('\n'), /missing source reference src_missing/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('kb doctor reports duplicate aliases and contradictory active facts', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-doctor-registry-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.createEntity({
      id: 'person-jon-mora',
      kind: 'person',
      title: 'Jon Mora',
      aliases: ['Jon']
    });
    await service.createEntity({
      id: 'person-jon-moura',
      kind: 'person',
      title: 'Jon Moura',
      aliases: ['Jon']
    });
    await service.createEntity({
      id: 'person-iris-chen',
      kind: 'person',
      title: 'Iris Chen'
    });
    await service.createEntity({
      id: 'person-iris-chan',
      kind: 'person',
      title: 'Iris Chan'
    });
    await service.createEntity({
      id: 'process-executive-inbox-triage-core-lane',
      kind: 'process',
      title: 'Executive Inbox Triage Core Lane',
      currentTruth: 'Executive Inbox Triage Core Lane is approved by Jon Mora and Jon Moura.'
    });

    const doctor = await service.doctor();
    const text = doctor.issues.join('\n');

    assert.equal(doctor.ok, false);
    assert.match(text, /duplicate alias/i);
    assert.match(text, /contradictory active facts/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('tenant config defaults knowledge base settings', () => {
  const config = resolveProductConfig({
    WORKSPACE_TENANT_CONFIG_JSON: JSON.stringify({
      schemaVersion: '1.0',
      tenant: {
        id: 'acme',
        displayName: 'Acme',
        locale: 'en-US',
        timezone: 'UTC',
        defaultLanguage: 'English',
        operatorAudience: 'ops-heavy-smb'
      },
      product: {
        id: 'workspace-admin-agent',
        displayName: 'Workspace Admin Agent',
        launchStage: 'single-tenant-beta',
        enabledDomainPacks: ['ops'],
        enabledIntegrations: ['google-workspace']
      },
      policy: {
        confirmationPrefix: 'CONFIRM:',
        requireConfirmationFor: [],
        allowDestructiveActions: [],
        maxQueuedMessages: 10,
        sessionRetentionDays: 30,
        auditLogRetentionDays: 30,
        derivedArtifactRetentionDays: 30
      },
      support: {}
    })
  });

  assert.equal(config.knowledgeBase.enabled, true);
  assert.equal(config.knowledgeBase.mode, 'basic');
  assert.equal(config.knowledgeBase.ingest.workspaceSignals, false);
  assert.equal(config.knowledgeBase.persistence.backend, 'auto');
  assert.equal(config.knowledgeBase.persistence.rootDir, '.kb');
  assert.equal(config.knowledgeBase.persistence.cacheRefreshPolicy, 'per-run');
});

test('built-in tenant defaults deployed kb persistence to r2', () => {
  const config = resolveProductConfig({
    WORKSPACE_TENANT_ID: 'alexandre-portela-dos-santos-limitada'
  });

  assert.equal(config.knowledgeBase.persistence.backend, 'r2');
  assert.equal(config.knowledgeBase.persistence.rootDir, '.kb');
});

test('workspace runtime exposes kb command', async () => {
  const runtime = await createWorkspaceRuntime({
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  assert.ok(runtime.commands.some((command) => command.name === 'kb'));
});

test('workspace runtime filters provider skills for a google-only tenant', async () => {
  const runtime = await createWorkspaceRuntime({
    WORKSPACE_TENANT_ID: 'workspace-template'
  });

  assert.ok(runtime.commands.some((command) => command.name === 'gws'));
  assert.ok(!runtime.commands.some((command) => command.name === 'm365'));
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/gws-gmail/SKILL.md'), true);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/m365-mail/SKILL.md'), false);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/company-accounting-email-intake/SKILL.md'), true);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/web-research/SKILL.md'), true);
});

test('workspace runtime filters provider skills for a microsoft-only tenant', async () => {
  const runtime = await createWorkspaceRuntime({
    WORKSPACE_TENANT_CONFIG_JSON: JSON.stringify({
      schemaVersion: '1.0',
      tenant: {
        id: 'msft-tenant',
        displayName: 'MSFT Tenant',
        locale: 'en-US',
        timezone: 'UTC',
        defaultLanguage: 'English',
        operatorAudience: 'ops-heavy-smb'
      },
      product: {
        id: 'workspace-admin-agent',
        displayName: 'Workspace Admin Agent',
        launchStage: 'single-tenant-beta',
        enabledDomainPacks: ['ops', 'inbox', 'scheduling'],
        enabledIntegrations: ['microsoft-365', 'telegram'],
        workspaceProviders: {
          mail: 'microsoft-365',
          calendar: 'microsoft-365',
          files: 'microsoft-365',
          documents: 'microsoft-365',
          contacts: 'microsoft-365',
          tasks: 'microsoft-365',
          spreadsheets: 'microsoft-365'
        }
      },
      policy: {
        confirmationPrefix: 'CONFIRM:',
        requireConfirmationFor: [],
        allowDestructiveActions: [],
        maxQueuedMessages: 10,
        sessionRetentionDays: 30,
        auditLogRetentionDays: 30,
        derivedArtifactRetentionDays: 30
      },
      support: {},
      knowledgeBase: {
        enabled: true,
        mode: 'basic',
        writePolicy: 'mixed',
        ingest: {
          agentTurns: true,
          userCorrections: true,
          workspaceSignals: false,
          externalResearch: false
        }
      }
    })
  });

  assert.ok(runtime.commands.some((command) => command.name === 'm365'));
  assert.ok(!runtime.commands.some((command) => command.name === 'gws'));
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/m365-mail/SKILL.md'), true);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/gws-gmail/SKILL.md'), false);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/admin-google-workspace/SKILL.md'), false);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/company-accounting-email-intake/SKILL.md'), false);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/company-accounting-document-extraction/SKILL.md'), true);
  assert.equal(await runtime.fs.exists('/workspace/.agents/skills/web-research/SKILL.md'), true);
});

test('knowledge runtime reuses one service instance and no-ops flush for direct backends', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-runtime-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const config = resolveProductConfig(env).knowledgeBase;
  const runtime = createKnowledgeBaseRuntime(env, 'workspace-template', config);

  const first = await runtime.getService();
  const second = await runtime.getService();

  assert.equal(first, second);

  await first.createEntity({
    id: 'vendor-stripe',
    kind: 'vendor',
    title: 'Stripe',
    currentTruth: 'Stripe handles invoice payments.'
  });

  const result = await runtime.flush();

  assert.equal(result, null);
  assert.match(readFileSync(path.join(root, 'entities', 'vendor-stripe.md'), 'utf8'), /Stripe handles invoice payments/);
});

test('r2 canonical store round-trips entity, source, draft, and sidecar files', async () => {
  const bucket = new FakeR2Bucket();
  const store = new R2CanonicalKbStore(bucket, '.kb', 'workspace-template', 'basic');

  await store.save({
    mode: 'basic',
    entities: {
      'vendor-stripe': renderEntityDocument(createEmptyEntity({
        id: 'vendor-stripe',
        tenantId: 'workspace-template',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe handles invoice payments.'
      }))
    },
    registry: {},
    sources: {
      'src_1': renderSourceDocument(createSourceDocument({
        id: 'src_1',
        tenantId: 'workspace-template',
        kind: 'note',
        title: 'Finance note',
        summary: 'Billing contact',
        content: 'billing@stripe.com'
      }))
    },
    events: [{ id: 'evt_1', tenantId: 'workspace-template', entityIds: ['vendor-stripe'], summary: 'Touched vendor file.', sourceIds: ['src_1'], createdAt: '2026-05-06T00:00:00.000Z' }],
    links: [],
    drafts: {
      'vendor-stripe': {
        entityId: 'vendor-stripe',
        tenantId: 'workspace-template',
        openQuestions: ['Confirm owner'],
        sourceIds: ['src_1'],
        timelineNotes: [],
        updatedAt: '2026-05-06T00:00:00.000Z'
      }
    }
  }, 'version-1');

  const loaded = await store.load();

  assert.equal(loaded.version, 'version-1');
  assert.match(loaded.state.entities['vendor-stripe'] ?? '', /Stripe handles invoice payments/);
  assert.match(loaded.state.sources['src_1'] ?? '', /billing@stripe\.com/);
  assert.equal(loaded.state.events.length, 1);
  assert.equal(loaded.state.drafts['vendor-stripe']?.openQuestions[0], 'Confirm owner');
});

test('r2 canonical store reads cloudflare-style object bodies via object.text()', async () => {
  const bucket = new FakeCloudflareStyleR2Bucket();
  const store = new R2CanonicalKbStore(bucket, '.kb', 'workspace-template', 'basic');

  await store.save({
    mode: 'basic',
    entities: {
      'vendor-stripe': renderEntityDocument(createEmptyEntity({
        id: 'vendor-stripe',
        tenantId: 'workspace-template',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe handles invoice payments.'
      }))
    },
    registry: {},
    sources: {},
    events: [],
    links: [],
    drafts: {}
  }, 'version-1');

  const loaded = await store.load();

  assert.equal(loaded.version, 'version-1');
  assert.match(loaded.state.entities['vendor-stripe'] ?? '', /Stripe handles invoice payments/);
});

test('knowledge base durable object queues async canonical sync and keeps sql authoritative', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });

  const searchBeforeAlarm = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'search',
    args: [{ query: 'stripe invoice', limit: 5 }]
  }) as { results: Array<{ id: string }> };

  assert.equal(searchBeforeAlarm.results[0]?.id, 'vendor-stripe');
  assert.equal(bucket.objects.size, 0);
  assert.equal(storage.rowCount('kb_entities'), 1);
  assert.equal(storage.rowCount('kb_meta'), 5);
  assert.equal(storage.alarmSetCount, 1);

  await methods.alarm();
  await methods.alarm();
  await methods.alarm();

  assert.ok([...bucket.objects.keys()].some((key) => key.endsWith('meta/version.json')));
  assert.ok([...bucket.objects.keys()].some((key) => key.endsWith('entities/vendor-stripe.md')));
  assert.ok([...bucket.objects.keys()].some((key) => key.endsWith('registry/vendor-stripe.json')));
});

test('knowledge base durable object rebuild regenerates canonical r2 from sql authority', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });
  await methods.alarm();
  await methods.alarm();
  bucket.objects.clear();

  const rebuild = await methods.rebuildSnapshot({
    tenantId: 'workspace-template',
    config
  });

  assert.equal(rebuild.counts.entities, 1);
  assert.ok([...bucket.objects.keys()].some((key) => key.endsWith('entities/vendor-stripe.md')));
});

test('knowledge base durable object doctor reports canonical sync health', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });

  const pendingDoctor = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'doctor',
    args: []
  }) as {
    persistence?: {
      pendingSyncCount?: number;
      lastSyncStatus?: string;
      canonicalSchemaVersion?: string;
    };
  };

  assert.equal(pendingDoctor.persistence?.pendingSyncCount, 2);
  assert.equal(pendingDoctor.persistence?.lastSyncStatus, 'pending');
  assert.equal(pendingDoctor.persistence?.canonicalSchemaVersion, 'v2');

  await methods.alarm();

  const settledDoctor = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'doctor',
    args: []
  }) as {
    persistence?: {
      pendingSyncCount?: number;
      lastSyncStatus?: string;
      lastSuccessfulSyncAt?: string | null;
    };
  };

  assert.equal(settledDoctor.persistence?.pendingSyncCount, 0);
  assert.equal(settledDoctor.persistence?.lastSyncStatus, 'idle');
  assert.equal(typeof settledDoctor.persistence?.lastSuccessfulSyncAt, 'string');
});

test('knowledge base durable object migrates legacy kb_links schema before writes and reports migration status', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS kb_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_entities (
      id TEXT PRIMARY KEY,
      markdown TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_sources (
      id TEXT PRIMARY KEY,
      markdown TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_registry (
      entity_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_events (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_links (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_drafts (
      entity_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `);
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });

  assert.deepEqual(storage.sql.tableColumns('kb_links'), ['id', 'origin_kind', 'origin_id', 'payload']);

  const doctor = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'doctor',
    args: []
  }) as {
    persistence?: {
      sqlSchemaVersion?: string | null;
      schemaMigrationStatus?: string | null;
    };
  };

  assert.equal(doctor.persistence?.sqlSchemaVersion, 'v3');
  assert.equal(doctor.persistence?.schemaMigrationStatus, 'ok');
});

test('compound tenant config enables workspace signals and compound mode', () => {
  const config = resolveProductConfig({
    WORKSPACE_TENANT_ID: 'alexandre-portela-dos-santos-limitada'
  });

  assert.equal(config.knowledgeBase.mode, 'compound');
  assert.equal(config.knowledgeBase.ingest.workspaceSignals, true);
});

test('compound knowledge search defaults to graph-first hybrid with bm25 behavior', async () => {
  const store = new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('compound'));
  const config = {
    ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
    mode: 'compound' as const
  };
  const service = new KnowledgeBaseService('workspace-template', config, store);
  await service.createEntity({
    id: 'vendor-stripe',
    kind: 'vendor',
    title: 'Stripe',
    currentTruth: 'Stripe handles invoice payments.'
  });

  const result = await service.search({ query: 'stripe' });

  assert.equal(result.mode, 'graph-first-hybrid');
  assert.equal(result.results[0]?.id, 'vendor-stripe');
});

test('basic knowledge search remains search-only by default', async () => {
  const store = new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'));
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;
  const service = new KnowledgeBaseService('workspace-template', config, store);
  await service.createEntity({
    id: 'vendor-stripe',
    kind: 'vendor',
    title: 'Stripe',
    currentTruth: 'Stripe handles invoice payments.'
  });

  const result = await service.search({ query: 'stripe' });

  assert.equal(result.mode, 'search-only');
});

test('knowledge base durable object queues workspace ingest candidates and advances them through gating', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new TestKnowledgeBaseStateMethods(
    { storage },
    { KB_CANONICAL_R2: bucket },
    {
      gateDecision: {
        ingest: 'yes',
        surface: 'workspace-signal',
        reason: 'Strong workspace update',
        confidence: 0.9
      },
      ingestPayload: {
        entities: [{
          id: 'maria-stripe-owner',
          kind: 'person',
          title: 'Maria Stripe Owner',
          currentTruth: 'Maria owns the Stripe relationship.',
          sources: ['src_workspace_1']
        }],
        sources: [],
        events: [],
        drafts: [],
        structuredLinks: []
      }
    }
  );
  const config = {
    ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
    mode: 'compound' as const,
    ingest: {
      agentTurns: false,
      userCorrections: true,
      workspaceSignals: true,
      externalResearch: false
    }
  };

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'createEntity',
    args: [{
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    }]
  });

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'captureSource',
    args: [{
      id: 'src_workspace_1',
      kind: 'workspace',
      title: 'Ops workspace note',
      summary: 'Stripe owner updated',
      content: 'Finance Ops says Stripe owner is now Maria.',
      linkedEntities: ['vendor-stripe']
    }]
  });

  const queued = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as { queueDepth: number };

  assert.equal(queued.queueDepth, 1);

  await methods.alarm();

  const ingestState = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as { gatedCount: number; lastGateStatus: string };

  assert.equal(ingestState.gatedCount, 1);
  assert.equal(ingestState.lastGateStatus, 'applied');
});

test('knowledge base durable object advances operator ingest through research before gating', async () => {
  const methods = new TestKnowledgeBaseStateMethods(
    { storage: new FakeDurableStorage() },
    { KB_CANONICAL_R2: new FakeR2Bucket() },
    {
      researchArtifact: {
        tenantId: 'workspace-template',
        surface: 'operator-ingest-url',
        sourceObjectId: 'telegram:thread-1:message-1',
        summary: 'Article summary',
        content: 'Extracted article body',
        referencedEntityIds: [],
        createdAt: '2026-05-08T00:00:00.000Z'
      },
      gateDecision: {
        ingest: 'yes',
        surface: 'operator-ingest-url',
        reason: 'High-signal operator ingest',
        confidence: 0.95
      },
      ingestPayload: {
        entities: [],
        sources: [],
        events: [],
        drafts: [],
        structuredLinks: []
      }
    }
  );
  const config = {
    ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
    mode: 'compound' as const,
    ingest: {
      agentTurns: false,
      userCorrections: true,
      workspaceSignals: true,
      externalResearch: true
    }
  };

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'enqueueIngestArtifact',
    args: [{
      tenantId: 'workspace-template',
      surface: 'operator-ingest-url',
      sourceObjectId: 'telegram:thread-1:message-1',
      summary: 'Queued operator ingest',
      content: 'https://example.com/article',
      referencedEntityIds: [],
      createdAt: '2026-05-08T00:00:00.000Z'
    }]
  });

  const queued = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as {
    pendingJobs: Array<{ status: string }>;
    researcherModel: string;
  };

  assert.equal(queued.pendingJobs[0]?.status, 'pending-research');
  assert.equal(queued.researcherModel, 'openai/gpt-5.5');

  await methods.alarm();

  const afterResearch = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as { pendingJobs: Array<{ status: string }>; queueDepth: number };

  assert.equal(afterResearch.queueDepth, 1);
  assert.equal(afterResearch.pendingJobs[0]?.status, 'pending-gate');

  await methods.alarm();

  const afterGate = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as { pendingJobs: Array<{ status: string }>; queueDepth: number; gatedCount: number };

  assert.equal(afterGate.queueDepth, 1);
  assert.equal(afterGate.gatedCount, 1);
  assert.equal(afterGate.pendingJobs[0]?.status, 'pending-ingest');

  await methods.alarm();

  const drained = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as {
    queueDepth: number;
    appliedCount: number;
    gatedCount: number;
    lastJobResult: {
      jobId: string;
      status: string;
      writes?: { sources: number; entities: number; events: number };
    } | null;
  };

  assert.equal(drained.queueDepth, 0);
  assert.equal(drained.gatedCount, 1);
  assert.equal(drained.appliedCount, 1);
  assert.equal(drained.lastJobResult?.status, 'applied');
  assert.deepEqual(drained.lastJobResult?.writes, {
    sources: 0,
    entities: 0,
    events: 0
  });
});

test('knowledge base durable object drops gate-rejected ingest candidates', async () => {
  const storage = new FakeDurableStorage();
  const methods = new TestKnowledgeBaseStateMethods(
    { storage },
    { KB_CANONICAL_R2: new FakeR2Bucket() },
    {
      gateDecision: {
        ingest: 'no',
        surface: 'workspace-signal',
        reason: 'Low signal',
        confidence: 0.2
      }
    }
  );
  const config = {
    ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
    mode: 'compound' as const,
    ingest: {
      agentTurns: false,
      userCorrections: true,
      workspaceSignals: true,
      externalResearch: false
    }
  };

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'enqueueIngestArtifact',
    args: [{
      tenantId: 'workspace-template',
      surface: 'workspace-signal',
      sourceObjectId: 'workspace-1',
      summary: 'Signal',
      content: 'Signal content',
      referencedEntityIds: [],
      createdAt: '2026-05-08T00:00:00.000Z'
    }]
  });

  await methods.alarm();

  const state = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as { queueDepth: number; gatedCount: number };

  assert.equal(state.queueDepth, 0);
  assert.equal(state.gatedCount, 1);
  assert.equal(storage.alarmSetCount, 1);
});

test('knowledge base durable object quarantines repeated ingest failures', async () => {
  const methods = new TestKnowledgeBaseStateMethods(
    { storage: new FakeDurableStorage() },
    { KB_CANONICAL_R2: new FakeR2Bucket() },
    {
      gateDecision: {
        ingest: 'yes',
        surface: 'workspace-signal',
        reason: 'Strong signal',
        confidence: 0.9
      },
      ingestError: 'invalid payload'
    }
  );
  const config = {
    ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
    mode: 'compound' as const,
    ingest: {
      agentTurns: false,
      userCorrections: true,
      workspaceSignals: true,
      externalResearch: false
    }
  };

  await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'enqueueIngestArtifact',
    args: [{
      tenantId: 'workspace-template',
      surface: 'workspace-signal',
      sourceObjectId: 'workspace-1',
      summary: 'Signal',
      content: 'Signal content',
      referencedEntityIds: [],
      createdAt: '2026-05-08T00:00:00.000Z'
    }]
  });

  await methods.alarm();
  await methods.alarm();
  await methods.alarm();
  await methods.alarm();
  await methods.alarm();

  const state = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'inspectIngestQueue',
    args: []
  }) as {
    pendingJobs: Array<{ status: string }>;
    queueDepth: number;
    quarantinedCount: number;
    lastJobResult: { status: string; error?: string } | null;
  };

  assert.equal(state.queueDepth, 0);
  assert.deepEqual(state.pendingJobs, []);
  assert.equal(state.quarantinedCount, 1);
  assert.equal(state.lastJobResult?.status, 'ingest-failed');
  assert.equal(state.lastJobResult?.error, 'invalid payload');
});

test('knowledge base durable object logs snapshot persist telemetry for mutating calls', async () => {
  const bucket = new FakeR2Bucket();
  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;
  const originalConsoleLog = console.log;
  const seen: string[] = [];

  console.log = (value?: unknown, ...rest: unknown[]) => {
    seen.push([value, ...rest].map((entry) => String(entry)).join(' '));
  };

  try {
    await methods.invoke({
      tenantId: 'workspace-template',
      config,
      method: 'createEntity',
      args: [{
        id: 'vendor-stripe',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe handles invoice payments.'
      }]
    });
  } finally {
    console.log = originalConsoleLog;
  }

  const persistLog = seen
    .map((line) => {
      try {
        return JSON.parse(line) as { event?: string; method?: string; bytes?: number; counts?: { entities?: number } };
      } catch {
        return null;
      }
    })
    .find((entry) => entry?.event === 'kb_snapshot_persist');

  assert.ok(persistLog);
  assert.equal(persistLog?.method, 'createEntity');
  assert.equal(persistLog?.counts?.entities, 1);
  assert.equal(typeof persistLog?.bytes, 'number');
  assert.ok((persistLog?.bytes ?? 0) > 0);
});

test('knowledge runtime chooses durable-object backed proxy when r2 bindings exist', async () => {
  const calls: Array<{ method: string; tenantId: string }> = [];
  const runtime = createKnowledgeBaseRuntime(
    {
      KB_CANONICAL_R2: new FakeR2Bucket(),
      KB_STATE: {
        idFromName(name: string) {
          return name;
        },
        get(id: string) {
          return {
            async invoke(payload: { method: string; tenantId: string }) {
              calls.push({ method: payload.method, tenantId: payload.tenantId });
              if (payload.method === 'list') {
                return {
                  mode: 'basic',
                  entities: [{ id: id, title: 'Workspace Template Customer', kind: 'company' }],
                  sources: [],
                  links: []
                };
              }
              throw new Error(`unexpected method ${payload.method}`);
            }
          };
        }
      }
    },
    'workspace-template',
    {
      ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
      persistence: {
        backend: 'r2',
        cacheRefreshPolicy: 'per-run',
        rootDir: '.kb'
      }
    }
  );

  const service = await runtime.getService();
  const listed = await service.list();

  assert.equal(listed.entities[0]?.id, 'workspace-template');
  assert.deepEqual(calls, [{ method: 'list', tenantId: 'workspace-template' }]);
});

test('knowledge base durable object reset clears canonical and snapshot state', async () => {
  const bucket = new FakeR2Bucket();
  const canonical = new R2CanonicalKbStore(bucket, '.kb', 'workspace-template', 'basic');
  await canonical.save({
    mode: 'basic',
    entities: {
      'vendor-stripe': renderEntityDocument(createEmptyEntity({
        id: 'vendor-stripe',
        tenantId: 'workspace-template',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe handles invoice payments.'
      }))
    },
    registry: {},
    sources: {},
    events: [],
    links: [],
    drafts: {}
  }, 'seed-version');

  const storage = new FakeDurableStorage();
  const methods = new KnowledgeBaseStateMethods({ storage }, { KB_CANONICAL_R2: bucket });
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;

  await methods.resetSnapshot({
    tenantId: 'workspace-template',
    config
  });

  const exported = await methods.invoke({
    tenantId: 'workspace-template',
    config,
    method: 'export',
    args: []
  }) as { entities: unknown[]; links: unknown[] };

  assert.equal(exported.entities.length, 0);
  assert.equal(exported.links.length, 0);
});

test('knowledge base runtime reset clears file-backed tenant data', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-runtime-reset-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const config = resolveProductConfig(env).knowledgeBase;
  const service = createKnowledgeBaseService(env, 'workspace-template', config);

  try {
    await service.createEntity({
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles invoice payments.'
    });

    const beforeReset = await service.export();
    assert.equal(beforeReset.entities.length, 1);

    await resetKnowledgeBaseRuntime(env, 'workspace-template', config);

    const afterReset = await createKnowledgeBaseService(env, 'workspace-template', config).export();
    assert.equal(afterReset.entities.length, 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('knowledge runtime fails fast when r2 backend is missing the durable object binding', async () => {
  const config = {
    ...resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase,
    persistence: {
      backend: 'r2' as const,
      cacheRefreshPolicy: 'per-run' as const,
      rootDir: '.kb'
    }
  };

  assert.throws(
    () => createKnowledgeBaseRuntime({ KB_CANONICAL_R2: new FakeR2Bucket() }, 'workspace-template', config),
    /KB_STATE binding is required/i
  );
});

test('knowledge runtime fails fast in cloudflare context without KB durable-object bindings', async () => {
  const config = resolveProductConfig({ WORKSPACE_TENANT_ID: 'workspace-template' }).knowledgeBase;

  await assert.rejects(
    runWithCloudflareContext({ agentInstance: { state: {}, setState() {} } }, async () => {
      createKnowledgeBaseRuntime({}, 'workspace-template', config);
    }),
    /Cloudflare runtime requires KB_STATE \+ KB_CANONICAL_R2/i
  );
});

test('knowledge service rejects the removed cloudflare root-state backend explicitly', () => {
  const config = resolveProductConfig({
    WORKSPACE_TENANT_ID: 'workspace-template',
    KB_BACKEND: 'cloudflare'
  }).knowledgeBase;

  assert.throws(
    () => createKnowledgeBaseService({ KB_BACKEND: 'cloudflare' }, 'workspace-template', config),
    /Legacy Cloudflare root-state KB backend has been removed/i
  );
});

class FakeR2Bucket {
  objects = new Map<string, string>();
  getCount = 0;

  async get(key: string): Promise<{ body: { text(): Promise<string> } } | null> {
    this.getCount += 1;
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      body: {
        async text() {
          return value;
        }
      }
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }> {
    const prefix = options.prefix ?? '';
    return {
      objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })),
      truncated: false,
      cursor: undefined
    };
  }
}

class FakeCloudflareStyleR2Bucket {
  objects = new Map<string, string>();

  async get(key: string): Promise<{ body: ReadableStream<Uint8Array>; text(): Promise<string> } | null> {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      body: new ReadableStream<Uint8Array>(),
      async text() {
        return value;
      }
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }> {
    const prefix = options.prefix ?? '';
    return {
      objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })),
      truncated: false,
      cursor: undefined
    };
  }
}

class FakeDurableStorage {
  private readonly map = new Map<string, unknown>();
  readonly sql = new FakeSqlStorage();
  alarmSetCount = 0;
  alarmAt: number | null = null;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmSetCount += 1;
    this.alarmAt = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
  }

  rowCount(table: string): number {
    return this.sql.rowCount(table);
  }
}

class TestKnowledgeBaseStateMethods extends KnowledgeBaseStateMethods {
  constructor(
    ctx: { storage: FakeDurableStorage },
    env: { KB_CANONICAL_R2: FakeR2Bucket },
    private readonly behavior: {
      researchArtifact?: {
        tenantId: string;
        surface: 'user-correction' | 'workspace-signal' | 'operator-ingest-url' | 'operator-ingest-text';
        sourceObjectId: string;
        summary: string;
        content: string;
        referencedEntityIds: string[];
        provenance?: string;
        createdAt: string;
      };
      gateDecision?: {
        ingest: 'yes' | 'no';
        surface: 'user-correction' | 'workspace-signal' | 'operator-ingest-url' | 'operator-ingest-text';
        reason: string;
        confidence: number;
      };
      ingestPayload?: {
        entities: unknown[];
        sources: unknown[];
        events: unknown[];
        drafts: unknown[];
        structuredLinks: unknown[];
      };
      ingestError?: string;
    } = {}
  ) {
    super(ctx, env);
  }

  protected override async runResearcherRole(artifact: { tenantId: string; surface: 'user-correction' | 'workspace-signal' | 'operator-ingest-url' | 'operator-ingest-text'; sourceObjectId: string; summary: string; content: string; referencedEntityIds: string[]; provenance?: string; createdAt: string }) {
    return this.behavior.researchArtifact ?? artifact;
  }

  protected override async runGateRole() {
    return this.behavior.gateDecision ?? {
      ingest: 'no' as const,
      surface: 'workspace-signal' as const,
      reason: 'default reject',
      confidence: 0
    };
  }

  protected override async runIngestorRole() {
    if (this.behavior.ingestError) {
      throw new Error(this.behavior.ingestError);
    }
    return this.behavior.ingestPayload ?? {
      entities: [],
      sources: [],
      events: [],
      drafts: [],
      structuredLinks: []
    };
  }
}

class FakeSqlStorage {
  private readonly tables = new Map<string, Array<Record<string, string>>>();
  private readonly schemas = new Map<string, string[]>();

  exec(query: string): { toArray(): Array<Record<string, string>> } {
    const statements = query
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    let rows: Array<Record<string, string>> = [];
    for (const statement of statements) {
      rows = this.apply(statement);
    }
    return {
      toArray: () => rows
    };
  }

  rowCount(table: string): number {
    return this.tables.get(table)?.length ?? 0;
  }

  tableColumns(table: string): string[] {
    return [...(this.schemas.get(table) ?? [])];
  }

  private apply(statement: string): Array<Record<string, string>> {
    const create = statement.match(/^CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*) \(([\s\S]+)\)$/i);
    if (create) {
      const table = create[1];
      this.tables.set(table, this.tables.get(table) ?? []);
      this.schemas.set(table, parseCreateTableColumns(create[2]));
      return [];
    }
    const pragma = statement.match(/^PRAGMA table_info\(([a-z_][a-z0-9_]*)\)$/i);
    if (pragma) {
      return (this.schemas.get(pragma[1]) ?? []).map((name) => ({ name }));
    }
    const alterRename = statement.match(/^ALTER TABLE ([a-z_][a-z0-9_]*) RENAME TO ([a-z_][a-z0-9_]*)$/i);
    if (alterRename) {
      const [, from, to] = alterRename;
      this.tables.set(to, [...(this.tables.get(from) ?? [])]);
      this.schemas.set(to, [...(this.schemas.get(from) ?? [])]);
      this.tables.delete(from);
      this.schemas.delete(from);
      return [];
    }
    const dropTable = statement.match(/^DROP TABLE ([a-z_][a-z0-9_]*)$/i);
    if (dropTable) {
      this.tables.delete(dropTable[1]);
      this.schemas.delete(dropTable[1]);
      return [];
    }
    const deleteWhereAnd = statement.match(/^DELETE FROM ([a-z_][a-z0-9_]*) WHERE ([a-z_][a-z0-9_]*) = ('(?:[^']|'')*') AND ([a-z_][a-z0-9_]*) = ('(?:[^']|'')*')$/i);
    if (deleteWhereAnd) {
      const table = deleteWhereAnd[1];
      const leftColumn = deleteWhereAnd[2];
      const leftValue = unquoteSqlValue(deleteWhereAnd[3]);
      const rightColumn = deleteWhereAnd[4];
      const rightValue = unquoteSqlValue(deleteWhereAnd[5]);
      this.tables.set(
        table,
        (this.tables.get(table) ?? []).filter((row) => !(row[leftColumn] === leftValue && row[rightColumn] === rightValue))
      );
      return [];
    }
    const deleteWhere = statement.match(/^DELETE FROM ([a-z_][a-z0-9_]*) WHERE ([a-z_][a-z0-9_]*) = ('(?:[^']|'')*')$/i);
    if (deleteWhere) {
      const table = deleteWhere[1];
      const column = deleteWhere[2];
      const value = unquoteSqlValue(deleteWhere[3]);
      this.tables.set(
        table,
        (this.tables.get(table) ?? []).filter((row) => row[column] !== value)
      );
      return [];
    }
    const deleteMatch = statement.match(/^DELETE FROM ([a-z_][a-z0-9_]*)$/i);
    if (deleteMatch) {
      this.tables.set(deleteMatch[1], []);
      return [];
    }
    const insert = statement.match(/^INSERT INTO ([a-z_][a-z0-9_]*) \(([^)]+)\) VALUES \(([\s\S]+)\)$/i);
    if (insert) {
      const table = insert[1];
      const rows = this.tables.get(table) ?? [];
      const columns = insert[2].split(',').map((entry) => entry.trim());
      const values = splitSqlValues(insert[3]).map(unquoteSqlValue);
      rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ''])));
      this.tables.set(table, rows);
      return [];
    }
    const insertSelect = statement.match(/^INSERT INTO ([a-z_][a-z0-9_]*) \(([^)]+)\)\s+SELECT ([\s\S]+) FROM ([a-z_][a-z0-9_]*)$/i);
    if (insertSelect) {
      const [, table, columnList, selectList, fromTable] = insertSelect;
      const targetColumns = columnList.split(',').map((entry) => entry.trim());
      const selectors = splitSqlValues(selectList);
      const sourceRows = this.tables.get(fromTable) ?? [];
      const rows = this.tables.get(table) ?? [];
      for (const sourceRow of sourceRows) {
        const values = selectors.map((selector) => {
          const trimmed = selector.trim();
          if (/^'(?:[^']|'')*'$/.test(trimmed)) return unquoteSqlValue(trimmed);
          return sourceRow[trimmed] ?? '';
        });
        rows.push(Object.fromEntries(targetColumns.map((column, index) => [column, values[index] ?? ''])));
      }
      this.tables.set(table, rows);
      return [];
    }
    const selectWhere = statement.match(/^SELECT ([a-z0-9_, ]+) FROM ([a-z_][a-z0-9_]*) WHERE ([a-z_][a-z0-9_]*) = ('(?:[^']|'')*')$/i);
    if (selectWhere) {
      const columns = selectWhere[1].split(',').map((entry) => entry.trim());
      const table = selectWhere[2];
      const whereColumn = selectWhere[3];
      const whereValue = unquoteSqlValue(selectWhere[4]);
      return (this.tables.get(table) ?? [])
        .filter((row) => row[whereColumn] === whereValue)
        .map((row) => projectSqlRow(row, columns));
    }
    const select = statement.match(/^SELECT ([a-z0-9_, ]+) FROM ([a-z_][a-z0-9_]*)(?: ORDER BY [a-z_][a-z0-9_]*)?$/i);
    if (select) {
      const columns = select[1].split(',').map((entry) => entry.trim());
      const table = select[2];
      return (this.tables.get(table) ?? []).map((row) => projectSqlRow(row, columns));
    }
    return [];
  }
}

function parseCreateTableColumns(definition: string): string[] {
  return definition
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(/\s+/, 1)[0] ?? '')
    .filter(Boolean);
}

function splitSqlValues(input: string): string[] {
  const values: string[] = [];
  let current = '';
  let inString = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    current += char;
    if (char === '\'' && next === '\'' && inString) {
      current += next;
      index += 1;
      continue;
    }
    if (char === '\'') {
      inString = !inString;
      continue;
    }
    if (char === ',' && !inString) {
      values.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

function unquoteSqlValue(value: string): string {
  return value.replace(/^'/, '').replace(/'$/, '').replace(/''/g, '\'');
}

function projectSqlRow(row: Record<string, string>, columns: string[]): Record<string, string> {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? '']));
}
