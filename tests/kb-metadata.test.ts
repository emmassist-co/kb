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

test('kb search hydrates trust metadata without removing legacy result fields', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'vendor-stripe-legacy',
      kind: 'vendor',
      title: 'Stripe Legacy',
      currentTruth: 'Stripe handled billing before the migration.',
      freshnessStatus: 'stale'
    }
  });
  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe owns billing now.',
      sources: ['src_billing'],
      supersedes: ['vendor-stripe-legacy'],
      freshnessStatus: 'fresh',
      lastReviewedAt: '2026-07-15T00:00:00.000Z'
    },
    sources: [
      {
        id: 'src_billing',
        kind: 'note',
        title: 'Billing owner note',
        summary: 'Stripe owns billing now.',
        content: 'Finance confirmed Stripe owns billing now.'
      }
    ]
  });

  const search = await service.search({ query: 'Stripe billing', limit: 10 });
  const current = search.results.find((result) => result.id === 'vendor-stripe');
  const legacy = search.results.find((result) => result.id === 'vendor-stripe-legacy');

  assert.ok(current);
  assert.equal(current.kind, 'entity');
  assert.equal(current.trust?.currentness, 'current');
  assert.equal(current.trust?.freshnessStatus, 'fresh');
  assert.deepEqual(current.trust?.supersedes, ['vendor-stripe-legacy']);
  assert.ok(current.sourceIds.includes('src_billing'));

  assert.ok(legacy);
  assert.equal(legacy.trust?.currentness, 'superseded');
  assert.equal(legacy.trust?.freshnessStatus, 'stale');
  assert.deepEqual(legacy.trust?.supersededBy, ['vendor-stripe']);
  assert.ok(legacy.trust?.caveats.some((caveat) => caveat.code === 'superseded_record'));
});

test('kb search labels raw source records as unpromoted evidence', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.recordSource({
    source: {
      id: 'src_raw_note',
      kind: 'research',
      title: 'Raw billing note',
      summary: 'Billing ownership note.',
      content: 'Finance said ownership needs review.',
      rawSourceRef: 'raw://drive/billing-note.md',
      freshnessStatus: 'needs_review'
    }
  });

  const search = await service.search({ query: 'billing ownership note', limit: 5 });
  const source = search.results.find((result) => result.id === 'src_raw_note');

  assert.ok(source);
  assert.equal(source.kind, 'source');
  assert.equal(source.trust?.currentness, 'raw');
  assert.equal(source.trust?.evidenceRole, 'raw_evidence');
  assert.ok(source.trust?.caveats.some((caveat) => caveat.code === 'raw_unpromoted_evidence'));
});

test('kb search supports explicit temporal and evidence-only retrieval intent', async () => {
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
      currentTruth: 'Stripe owns billing.',
      sources: ['src_billing']
    },
    sources: [
      {
        id: 'src_billing',
        kind: 'note',
        title: 'Billing note',
        summary: 'Stripe billing evidence.',
        content: 'Finance confirmed Stripe owns billing.'
      }
    ]
  });

  const mixed = await service.search({ query: 'Stripe billing', temporalFocus: 'mixed' });
  const current = await service.search({ query: 'Stripe billing', temporalFocus: 'current' });
  const historical = await service.search({ query: 'Stripe billing', temporalFocus: 'historical' });
  const evidenceOnly = await service.search({ query: 'Stripe billing', evidenceOnly: true });

  assert.ok(mixed.results.some((result) => result.id === 'vendor-stripe'));
  assert.ok(mixed.results.some((result) => result.id === 'src_billing'));
  assert.deepEqual(current.results.map((result) => result.id), ['vendor-stripe']);
  assert.ok(historical.results.every((result) => result.trust?.currentness === 'historical'));
  assert.ok(evidenceOnly.results.every((result) => result.kind === 'source'));
});

test('kb evidence view separates claims, sources, raw evidence, and decision rationale', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'decision-billing-owner',
      kind: 'decision',
      title: 'Billing owner decision',
      status: 'accepted',
      currentTruth: [
        'Decision: Stripe owns billing.',
        'Rationale: Finance already reconciles Stripe invoices.',
        'Alternative: Build a custom billing workflow.'
      ].join('\n'),
      sources: ['src_decision'],
      freshnessStatus: 'fresh',
      lastReviewedAt: '2026-07-15T00:00:00.000Z'
    },
    sources: [
      {
        id: 'src_decision',
        kind: 'note',
        title: 'Decision note',
        summary: 'Billing owner decision.',
        content: 'Finance accepted Stripe as billing owner.'
      },
      {
        id: 'src_raw_decision',
        kind: 'chat',
        title: 'Raw decision chat',
        summary: 'Raw billing chat.',
        content: 'Raw notes before promotion.',
        rawSourceRef: 'raw://chat/billing-owner',
        freshnessStatus: 'needs_review'
      }
    ]
  });

  const view = await service.evidence('decision-billing-owner');

  assert.equal(view.id, 'decision-billing-owner');
  assert.equal(view.trust.currentness, 'current');
  assert.equal(view.currentTruth.claims.length, 3);
  assert.equal(view.sources[0]?.id, 'src_decision');
  assert.equal(view.rawEvidence[0]?.id, 'src_raw_decision');
  assert.equal(view.decision?.status, 'accepted');
  assert.equal(view.decision?.rationale, 'Finance already reconciles Stripe invoices.');
  assert.deepEqual(view.decision?.alternatives, ['Build a custom billing workflow.']);
});

test('kb evidence view flags unsupported current truth claims', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.record({
    entity: {
      id: 'project-unsupported',
      kind: 'project',
      title: 'Unsupported Project',
      currentTruth: 'This claim has no source.'
    }
  });

  const view = await service.evidence('project-unsupported');

  assert.equal(view.currentTruth.claims[0]?.text, 'This claim has no source.');
  assert.ok(view.currentTruth.claims[0]?.trust.caveats.some((caveat) => caveat.code === 'unsupported_current_truth'));
});

test('kb evidence view flags unsupported claims independently from supported claims', async () => {
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
      currentTruth: ['Stripe owns billing.', 'Stripe handles invoice reconciliation.'].join('\n'),
      sources: ['src_billing']
    },
    sources: [
      {
        id: 'src_billing',
        kind: 'note',
        title: 'Billing note',
        summary: 'Finance confirmed Stripe owns billing.',
        content: 'Finance confirmed Stripe owns billing.'
      }
    ]
  });

  const view = await service.evidence('vendor-stripe');

  assert.deepEqual(view.currentTruth.claims.map((claim) => claim.sourceIds), [['src_billing'], []]);
  assert.ok(!view.currentTruth.claims[0]?.trust.caveats.some((caveat) => caveat.code === 'unsupported_current_truth'));
  assert.ok(view.currentTruth.claims[1]?.trust.caveats.some((caveat) => caveat.code === 'unsupported_current_truth'));
});

test('kb recall returns read-only cited trust-aware bundles', async () => {
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
      currentTruth: ['Stripe owns billing.', 'Stripe handles invoice reconciliation.'].join('\n'),
      sources: ['src_billing']
    },
    sources: [
      {
        id: 'src_billing',
        kind: 'note',
        title: 'Billing note',
        summary: 'Stripe billing evidence.',
        content: 'Finance confirmed Stripe owns billing.'
      }
    ]
  });

  const bundle = await service.recall({
    query: 'Stripe billing',
    purpose: 'pre-answer context',
    maxTokens: 1200
  });

  assert.equal(bundle.query, 'Stripe billing');
  assert.equal(bundle.purpose, 'pre-answer context');
  assert.equal(bundle.temporalFocus, 'current');
  assert.ok(bundle.claims.length >= 1);
  assert.ok(bundle.claims.some((claim) => claim.sourceIds.includes('src_billing')));
  assert.ok(bundle.claims.some((claim) => claim.trust.caveats.some((caveat) => caveat.code === 'unsupported_current_truth')));
  assert.equal(bundle.citations[0]?.id, 'src_billing');
  assert.ok(bundle.estimatedTokens <= bundle.maxTokens);
  assert.ok(Array.isArray(bundle.omitted));

  const after = await service.search({ query: 'Stripe billing' });
  assert.equal(after.results[0]?.id, 'vendor-stripe');
});

test('kb recall accounts for citations when enforcing token budget', async () => {
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
      currentTruth: 'Stripe owns billing.',
      sources: ['src_billing']
    },
    sources: [
      {
        id: 'src_billing',
        kind: 'note',
        title: 'Billing note',
        summary: `Finance confirmed Stripe owns billing. ${'Long citation context. '.repeat(80)}`,
        content: `Finance confirmed Stripe owns billing. ${'Long citation context. '.repeat(80)}`
      }
    ]
  });

  const bundle = await service.recall({
    query: 'Stripe billing',
    purpose: 'small context window',
    maxTokens: 64
  });

  assert.ok(bundle.estimatedTokens <= bundle.maxTokens);
  assert.equal(bundle.claims.length, 0);
  assert.ok(bundle.omitted.some((entry) => entry.reason === 'max_tokens'));
});

test('promotion proposals require review before applying canonical writes', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  const proposal = await service.submitPromotionProposal({
    id: 'proposal_billing_owner',
    operation: 'record',
    title: 'Promote billing owner',
    payload: {
      entity: {
        id: 'vendor-stripe',
        kind: 'vendor',
        title: 'Stripe',
        currentTruth: 'Stripe owns billing.'
      }
    }
  });

  assert.equal(proposal.status, 'review_pending');
  assert.deepEqual((await service.listReviewItems()).map((item) => item.proposalId), ['proposal_billing_owner']);
  await assert.rejects(
    service.applyPromotionProposal({ proposalId: 'proposal_billing_owner' }),
    /must be approved/i
  );

  const reviewed = await service.reviewPromotionProposal({
    proposalId: 'proposal_billing_owner',
    status: 'approved',
    reviewer: 'operator'
  });
  assert.equal(reviewed.status, 'approved');

  const applied = await service.applyPromotionProposal({
    proposalId: 'proposal_billing_owner',
    appliedBy: 'operator'
  });
  assert.equal(applied.proposal.status, 'applied');
  assert.deepEqual(applied.mutation.entityIds, ['vendor-stripe']);
  assert.equal((await service.get('vendor-stripe')).kind, 'entity');
});

test('memory debt derives doctor findings and links review items', async () => {
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
      sources: ['src_missing']
    }
  });
  await service.createReviewItem({
    id: 'review_missing_source',
    type: 'provenance',
    title: 'Restore missing source',
    summary: 'Source reference is missing.',
    targetIds: ['vendor-stripe'],
    sourceIds: ['src_missing']
  });

  const debt = await service.memoryDebt();
  const item = debt.items.find((entry) => entry.summary.includes('missing source reference'));

  assert.equal(debt.ok, false);
  assert.ok(item);
  assert.equal(item?.status, 'linked_to_review');
  assert.equal(item?.reviewItemId, 'review_missing_source');
});
