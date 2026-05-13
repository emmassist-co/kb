import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { SnapshotKnowledgeStore, createEmptyPersistedKnowledgeState } from '../packages/kb-core/src/snapshot-store.js';
import { createEmptyEntity, createSourceDocument, parseEntityDocument, parseSourceDocument, renderEntityDocument, renderSourceDocument } from '../packages/kb-core/src/documents.js';
import type { KnowledgeBaseConfig } from '../packages/kb-core/src/types.js';

const TEST_CONFIG: KnowledgeBaseConfig = {
  enabled: true,
  mode: 'basic',
  writePolicy: 'mixed',
  persistence: {
    backend: 'file',
    cacheRefreshPolicy: 'none',
    rootDir: '.kb'
  },
  ingest: {
    agentTurns: false,
    userCorrections: false,
    workspaceSignals: false,
    externalResearch: false
  }
};

test('entity markdown round-trips supersession and freshness metadata', () => {
  const entity = createEmptyEntity({
    id: 'vendor-stripe',
    tenantId: 'acme',
    kind: 'vendor',
    title: 'Stripe',
    currentTruth: 'Stripe handles payments.',
    supersedes: ['vendor-stripe-legacy'],
    freshnessStatus: 'fresh',
    lastReviewedAt: '2026-05-10T00:00:00.000Z'
  });

  const markdown = renderEntityDocument(entity);
  const parsed = parseEntityDocument(markdown);

  assert.deepEqual(parsed.meta.supersedes, ['vendor-stripe-legacy']);
  assert.equal(parsed.meta.freshnessStatus, 'fresh');
  assert.equal(parsed.meta.lastReviewedAt, '2026-05-10T00:00:00.000Z');
});

test('source markdown round-trips raw source provenance and review metadata', () => {
  const source = createSourceDocument({
    id: 'src_1',
    tenantId: 'acme',
    kind: 'research',
    title: 'Vendor note',
    rawSourceRef: 'raw://drive/vendors/stripe-note.pdf',
    supersedes: ['src_legacy'],
    freshnessStatus: 'needs_review',
    lastReviewedAt: '2026-05-09T00:00:00.000Z',
    summary: 'Billing note',
    content: 'Finance confirmed billing@stripe.com.'
  });

  const markdown = renderSourceDocument(source);
  const parsed = parseSourceDocument(markdown);

  assert.equal(parsed.meta.rawSourceRef, 'raw://drive/vendors/stripe-note.pdf');
  assert.deepEqual(parsed.meta.supersedes, ['src_legacy']);
  assert.equal(parsed.meta.freshnessStatus, 'needs_review');
  assert.equal(parsed.meta.lastReviewedAt, '2026-05-09T00:00:00.000Z');
});

test('kb remember persists raw source ref and source freshness metadata', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.remember({
    intent: 'source_capture',
    summary: 'Captured vendor note.',
    content: 'Finance confirmed billing ownership.',
    source: {
      id: 'src_1',
      kind: 'research',
      title: 'Vendor note',
      rawSourceRef: 'raw://drive/vendors/stripe-note.pdf',
      freshnessStatus: 'needs_review',
      lastReviewedAt: '2026-05-10T00:00:00.000Z'
    }
  });

  const source = await service.get('src_1');
  assert.equal(source.kind, 'source');
  assert.equal(source.parsed.meta.rawSourceRef, 'raw://drive/vendors/stripe-note.pdf');
  assert.equal(source.parsed.meta.freshnessStatus, 'needs_review');
  assert.equal(source.parsed.meta.lastReviewedAt, '2026-05-10T00:00:00.000Z');
});

test('kb record persists entity supersession and freshness metadata', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles billing.',
      supersedes: ['vendor-stripe-legacy'],
      freshnessStatus: 'fresh',
      lastReviewedAt: '2026-05-10T00:00:00.000Z'
    }
  });

  const record = await service.get('vendor-stripe');
  assert.equal(record.kind, 'entity');
  assert.deepEqual(record.parsed.meta.supersedes, ['vendor-stripe-legacy']);
  assert.equal(record.parsed.meta.freshnessStatus, 'fresh');
  assert.equal(record.parsed.meta.lastReviewedAt, '2026-05-10T00:00:00.000Z');
});

test('kb doctor reports missing supersession targets', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      supersedes: ['vendor-stripe-legacy']
    }
  });

  const doctor = await service.doctor();
  assert.equal(doctor.ok, false);
  assert.match(doctor.issues.join('\n'), /missing supersession target/i);
});

test('kb doctor reports supersession cycles', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'vendor-a',
      kind: 'vendor',
      title: 'Vendor A',
      supersedes: ['vendor-b']
    }
  });
  await service.record({
    entity: {
      id: 'vendor-b',
      kind: 'vendor',
      title: 'Vendor B',
      supersedes: ['vendor-a']
    }
  });

  const doctor = await service.doctor();
  assert.equal(doctor.ok, false);
  assert.match(doctor.issues.join('\n'), /supersession cycle/i);
});

test('kb doctor reports fresh records without review timestamp', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      freshnessStatus: 'fresh'
    }
  });

  const doctor = await service.doctor();
  assert.equal(doctor.ok, false);
  assert.match(doctor.issues.join('\n'), /fresh.*lastReviewedAt/i);
});
