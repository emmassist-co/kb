import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { extractRelationProposalsFromText, defaultRelationRules, classifyRelationQuery, inferQueryIntent } from '../packages/kb-core/src/relations.js';
import { SnapshotKnowledgeStore, createEmptyPersistedKnowledgeState } from '../packages/kb-core/src/snapshot-store.js';
import { createEmptyEntity } from '../packages/kb-core/src/documents.js';
import { assistQuery, buildQueryRetrievalPlan } from '../packages/kb-core/src/service-helpers.js';
import type { EntityDocument, KnowledgeBaseConfig, KnowledgeLinkRule } from '../packages/kb-core/src/types.js';

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

test('heuristic extractor emits evidence-bearing relation proposals', () => {
  const entities: EntityDocument[] = [
    createEmptyEntity({
      id: 'person-carol-wilson',
      tenantId: 'acme',
      kind: 'person',
      title: 'Carol Wilson'
    }),
    createEmptyEntity({
      id: 'company-anchor',
      tenantId: 'acme',
      kind: 'company',
      title: 'Anchor'
    })
  ];

  const text = 'Carol Wilson works at Anchor and joined the weekly finance sync.';
  const proposals = extractRelationProposalsFromText(
    { tenantId: 'acme', entities, sources: [] },
    defaultRelationRules(),
    {
      originKind: 'entity',
      originId: 'person-carol-wilson',
      text,
      sourceIds: [],
      evidenceKind: 'direct',
      sourceSurface: 'current-truth',
      primaryEntityId: 'person-carol-wilson'
    }
  );

  const membership = proposals.find((proposal) => proposal.type === 'member_of' && proposal.toId === 'company-anchor');
  assert.ok(membership);
  assert.equal(membership?.extractorId, 'heuristic-rules');
  assert.match(membership?.evidenceText ?? '', /works at Anchor/i);
  assert.ok(membership?.evidenceSpan);
  assert.match(membership?.evidenceSpan?.text ?? '', /works at Anchor/i);
});

test('service persists extractor metadata without changing member queries', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'company-anchor',
    kind: 'company',
    title: 'Anchor'
  });
  await service.createEntity({
    id: 'person-carol-wilson',
    kind: 'person',
    title: 'Carol Wilson',
    currentTruth: 'Carol Wilson works at Anchor and leads finance systems reviews.'
  });

  const links = await service.links('person-carol-wilson');
  const membership = links.outgoing.find((link) => link.type === 'member_of' && link.toId === 'company-anchor');
  assert.ok(membership);
  assert.equal(membership?.extractorId, 'heuristic-rules');
  assert.match(membership?.evidenceText ?? '', /works at Anchor/i);
  assert.ok(membership?.evidenceSpan);

  const result = await service.queryRelations({
    query: 'Who works at Anchor?',
    limit: 5,
    mode: 'graph-first-hybrid'
  });
  assert.equal(result.results[0]?.id, 'person-carol-wilson');
});

test('page prior activation surfaces are enforced by rule config', () => {
  const entities: EntityDocument[] = [
    createEmptyEntity({
      id: 'person-rosa-jackson',
      tenantId: 'acme',
      kind: 'person',
      title: 'Rosa Jackson'
    }),
    createEmptyEntity({
      id: 'person-david-wang',
      tenantId: 'acme',
      kind: 'person',
      title: 'David Wang'
    }),
    createEmptyEntity({
      id: 'meeting-one-on-one',
      tenantId: 'acme',
      kind: 'meeting',
      title: '1:1 Rosa Jackson + David Wang'
    })
  ];

  const rules = structuredClone(defaultRelationRules()) as KnowledgeLinkRule[];
  const proposals = extractRelationProposalsFromText(
    { tenantId: 'acme', entities, sources: [] },
    rules,
    {
      originKind: 'entity',
      originId: 'meeting-one-on-one',
      text: 'Rosa Jackson walked through the rollout plan and David Wang raised concerns.',
      sourceIds: [],
      evidenceKind: 'timeline',
      sourceSurface: 'timeline',
      primaryEntityId: 'meeting-one-on-one'
    }
  );

  assert.equal(proposals.some((proposal) => proposal.type === 'attends'), false);
});

test('graph relation results expose evidence-aware reasons and matched fields', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'company-anchor',
    kind: 'company',
    title: 'Anchor'
  });
  await service.createEntity({
    id: 'person-carol-wilson',
    kind: 'person',
    title: 'Carol Wilson',
    currentTruth: 'Carol Wilson works at Anchor and leads finance systems reviews.'
  });
  await service.captureSource({
    id: 'src-anchor-roster',
    title: 'Anchor roster',
    summary: 'Anchor roster confirms Carol Wilson works at Anchor.',
    content: 'Carol Wilson works at Anchor and coordinates the quarterly planning review.'
  });
  await service.importStructuredLinks({
    origin: { kind: 'seed', id: 'seed-anchor-roster' },
    links: [
      {
        type: 'member_of',
        fromId: 'person-carol-wilson',
        toId: 'company-anchor',
        sourceIds: ['src-anchor-roster'],
        confidence: 0.93,
        evidenceKind: 'structured'
      }
    ]
  });

  const result = await service.queryRelations({
    query: 'Who works at Anchor?',
    limit: 5,
    mode: 'graph-first-hybrid'
  });

  assert.equal(result.results[0]?.id, 'person-carol-wilson');
  assert.ok(result.results[0]?.reason.includes('current-truth'));
  assert.ok(result.results[0]?.reason.some((reason) => reason.startsWith('surfaces:')));
  assert.ok(result.results[0]?.reason.some((reason) => reason.startsWith('evidence-spans:')));
  assert.ok(result.results[0]?.matchedFields.includes('graph:evidence-span'));
  assert.ok(result.results[0]?.matchedFields.includes('graph:evidence-kind:structured'));
  assert.ok(result.results[0]?.matchedFields.some((field) => field.startsWith('graph:surface:')));
});

test('classifyRelationQuery recognizes fuzzy advisor follow-ups', () => {
  const classification = classifyRelationQuery('And who else advises Orbit Labs?');
  assert.equal(classification.relationType, 'advises');
  assert.match(classification.anchorQuery ?? '', /orbit labs/);
});

test('inferQueryIntent recognizes plural anchored topic queries', () => {
  const intent = inferQueryIntent('Who focuses on synthetic biology at Delta?');
  assert.equal(intent.anchorQuery, 'delta');
  assert.equal(intent.expectedKinds[0], 'person');
  assert.equal(intent.expectsMultiple, true);
  assert.ok(intent.attributeTerms.includes('synthetic'));
  assert.ok(intent.attributeTerms.includes('biology'));
  assert.ok(intent.modes.includes('entity-set'));
});

test('inferQueryIntent recognizes historical background queries', () => {
  const intent = inferQueryIntent('Prior experience of Delta senior engineers before joining');
  assert.equal(intent.temporalFocus, 'historical');
  assert.ok(intent.modes.includes('background'));
  assert.ok(intent.modes.includes('entity-set'));
  assert.equal(intent.expectedKinds[0], 'person');
  assert.equal(intent.anchorQuery, 'delta');
  assert.equal(intent.relationType, 'member_of');
});

test('buildQueryRetrievalPlan activates planner for aggregation queries', () => {
  const plan = buildQueryRetrievalPlan('List all advisors in our corpus');
  assert.equal(plan.activation, 'degraded-non-relation-set');
  assert.deepEqual(plan.activationReason, ['aggregation']);
  assert.deepEqual(plan.expectedKinds, ['person']);
  assert.equal(plan.requireExpectedKind, true);
  assert.equal(plan.requireRoleEvidence, true);
  assert.deepEqual(plan.roleTerms, ['advisors']);
  assert.equal(plan.anchorQuery, 'our corpus');
});

test('buildQueryRetrievalPlan captures attribute-intersection constraints', () => {
  const plan = buildQueryRetrievalPlan('People we know who are associated with both biotech and software infrastructure');
  assert.equal(plan.activation, 'degraded-non-relation-set');
  assert.ok(plan.activationReason.includes('attribute-intersection'));
  assert.deepEqual(plan.expectedKinds, ['person']);
  assert.equal(plan.minimumAttributeMatches, 2);
  assert.ok(plan.attributeTerms.includes('biotech'));
  assert.ok(plan.attributeTerms.includes('software'));
  assert.ok(plan.attributeTerms.includes('infrastructure'));
});

test('buildQueryRetrievalPlan captures relationship-depth constraints', () => {
  const plan = buildQueryRetrievalPlan('Companies where our advisors have multi-year ongoing relationships');
  assert.equal(plan.activation, 'degraded-non-relation-set');
  assert.ok(plan.activationReason.includes('relationship-depth'));
  assert.deepEqual(plan.expectedKinds, ['company']);
  assert.equal(plan.requireRelationshipDepthEvidence, true);
  assert.deepEqual(plan.roleTerms, ['advisors']);
});

test('buildQueryRetrievalPlan stays inactive for ordinary profile queries', () => {
  const plan = buildQueryRetrievalPlan('Who works at Anchor?');
  assert.equal(plan.activation, 'none');
  assert.deepEqual(plan.activationReason, []);
  assert.equal(plan.requireExpectedKind, true);
});

test('assistQuery strips conversational filler from fuzzy profile lookups', () => {
  const assisted = assistQuery('Can you pull up what we have on the founder who left a Layer 1 project over tokenomics?');
  assert.doesNotMatch(assisted, /\b(can|you|pull|what|have)\b/);
  assert.match(assisted, /\bfounder\b/);
  assert.match(assisted, /\blayer\b/);
  assert.match(assisted, /\bproject\b/);
  assert.match(assisted, /\btokenomic/);
});

test('search prefers the matching person for fuzzy profile queries', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'company-anchor',
    kind: 'company',
    title: 'Anchor'
  });
  await service.createEntity({
    id: 'person-carol-wilson',
    kind: 'person',
    title: 'Carol Wilson',
    timeline: [
      '2024-01-10: Joined Anchor as senior engineer.',
      '2024-08-22: Cut pipeline runtime by 40%.'
    ]
  });

  const result = await service.search({
    query: 'I need the background on the Anchor senior engineer who cut pipeline runtime',
    limit: 5,
    mode: 'search-only',
    assistQuery: true
  });

  assert.equal(result.results[0]?.id, 'person-carol-wilson');
});

test('search prefers people over companies for fuzzy role-set queries', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'company-delta',
    kind: 'company',
    title: 'Delta',
    currentTruth: 'Delta builds synthetic biology infrastructure.'
  });
  await service.createEntity({
    id: 'person-ana-silva',
    kind: 'person',
    title: 'Ana Silva',
    currentTruth: 'Ana Silva is a senior infrastructure engineer at Delta.'
  });

  const result = await service.search({
    query: 'All senior engineers',
    limit: 5,
    mode: 'search-only',
    assistQuery: true
  });

  assert.equal(result.results[0]?.id, 'person-ana-silva');
  assert.ok(result.results[0]?.reason.includes('intent-kind-match'));
});

test('search ignores question glue and finds the right person for topic-at-company queries', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'company-delta',
    kind: 'company',
    title: 'Delta',
    currentTruth: 'Delta is a biotech company focused on synthetic biology platforms.'
  });
  await service.createEntity({
    id: 'person-adam-lopez',
    kind: 'person',
    title: 'Adam Lopez',
    currentTruth: 'Adam Lopez is a senior engineer at Delta focused on synthetic biology infrastructure.'
  });
  await service.createEntity({
    id: 'person-fiona-moore',
    kind: 'person',
    title: 'Fiona Moore',
    currentTruth: 'Fiona Moore invested in a biotech company and advises on go-to-market planning.'
  });

  const result = await service.search({
    query: 'Who focuses on synthetic biology at Delta?',
    limit: 5,
    mode: 'search-only',
    assistQuery: true
  });

  assert.equal(result.results[0]?.id, 'person-adam-lopez');
});

test('planner narrows cross-domain set queries toward multi-attribute people', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'company-delta',
    kind: 'company',
    title: 'Delta',
    currentTruth: 'Delta builds software infrastructure for biotech and synthetic biology teams.'
  });
  await service.createEntity({
    id: 'person-adam-lopez',
    kind: 'person',
    title: 'Adam Lopez',
    currentTruth: 'Adam Lopez is a senior engineer at Delta focused on platform reliability.'
  });
  await service.createEntity({
    id: 'person-linda-taylor',
    kind: 'person',
    title: 'Linda Taylor',
    currentTruth: 'Linda Taylor is a biotech founder and advisor.'
  });
  await service.createEntity({
    id: 'person-beth-williams',
    kind: 'person',
    title: 'Beth Williams',
    currentTruth: 'Beth Williams leads software infrastructure partnerships.'
  });

  const result = await service.search({
    query: 'People we know who are associated with both biotech and software infrastructure',
    limit: 5,
    mode: 'search-only',
    assistQuery: true,
    lexicalBackend: 'bm25-lexical'
  });

  assert.equal(result.results[0]?.id, 'person-adam-lopez');
  assert.ok(result.results[0]?.reason.some((reason) => reason.startsWith('planner-attributes:')));
});

test('planner projects relationship-depth company candidates from advisor evidence', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'companies-prism',
    kind: 'company',
    title: 'Prism',
    currentTruth: 'Prism builds developer infrastructure for product teams.'
  });
  await service.createEntity({
    id: 'companies-northstar',
    kind: 'company',
    title: 'Northstar',
    currentTruth: 'Northstar invests in analytics software.'
  });
  await service.createEntity({
    id: 'companies-apex',
    kind: 'company',
    title: 'Apex',
    currentTruth: 'Apex builds infrastructure software.'
  });
  await service.createEntity({
    id: 'people-alice-davis',
    kind: 'person',
    title: 'Alice Davis',
    currentTruth: 'Alice Davis currently advises Prism and renewed a multi-year advisory agreement in 2025.',
    timeline: ['2021-04-10: Began advising Prism on platform strategy.', '2025-03-22: Renewed multi-year advisory contract with Prism.']
  });
  await service.createEntity({
    id: 'people-bob-stone',
    kind: 'person',
    title: 'Bob Stone',
    currentTruth: 'Bob Stone is a founder and investor.'
  });
  await service.createEntity({
    id: 'people-tara-kapoor',
    kind: 'person',
    title: 'Tara Kapoor',
    currentTruth: 'Tara Kapoor maintains an advisory relationship with Apex on security architecture.',
    timeline: ['2023-06-15: Formalized advisory role with Apex for security architecture reviews.']
  });
  await service.importStructuredLinks({
    origin: { kind: 'seed', id: 'seed-prism-advisors' },
    links: [
      {
        type: 'advises',
        fromId: 'people-alice-davis',
        toId: 'companies-prism',
        sourceIds: ['src-prism-2021', 'src-prism-2024'],
        confidence: 0.95,
        evidenceKind: 'structured'
      },
      {
        type: 'invested_in',
        fromId: 'people-bob-stone',
        toId: 'companies-northstar',
        sourceIds: ['src-northstar-2022'],
        confidence: 0.88,
        evidenceKind: 'structured'
      },
      {
        type: 'advises',
        fromId: 'people-tara-kapoor',
        toId: 'companies-apex',
        sourceIds: ['src-apex-2023'],
        confidence: 0.91,
        evidenceKind: 'structured'
      }
    ]
  });

  const result = await service.search({
    query: 'Companies where our advisors have multi-year ongoing relationships',
    limit: 5,
    mode: 'search-only',
    assistQuery: true,
    lexicalBackend: 'bm25-lexical'
  });

  assert.equal(result.results[0]?.id, 'companies-prism');
  assert.ok(result.results[0]?.reason.some((reason) => reason.startsWith('planner-depth-support:')));
  assert.ok(result.results[0]?.reason.some((reason) => reason.startsWith('planner-depth-continuation:')));
  assert.ok(result.results[0]?.matchedFields.includes('planner:continuation'));
});

test('relationship-depth planner ignores unrelated membership links without advisor cues', async () => {
  const service = new KnowledgeBaseService(
    'acme',
    TEST_CONFIG,
    new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'))
  );

  await service.createEntity({
    id: 'companies-prism',
    kind: 'company',
    title: 'Prism',
    currentTruth: 'Prism works with a small advisory group.'
  });
  await service.createEntity({
    id: 'companies-anchor',
    kind: 'company',
    title: 'Anchor',
    currentTruth: 'Anchor is a data infrastructure company.'
  });
  await service.createEntity({
    id: 'people-alice-davis',
    kind: 'person',
    title: 'Alice Davis',
    currentTruth: 'Alice Davis is a trusted advisor for infrastructure companies.',
    timeline: ['2021-03-15: Joined Prism as security advisor after an introduction from a former portfolio founder.']
  });
  await service.createEntity({
    id: 'people-bob-stone',
    kind: 'person',
    title: 'Bob Stone',
    currentTruth: 'Bob Stone is a founder and operator.',
    timeline: ['2021-06-10: Joined Anchor as founding engineer.']
  });
  await service.importStructuredLinks({
    origin: { kind: 'seed', id: 'seed-prism-depth' },
    links: [
      {
        type: 'advises',
        fromId: 'people-alice-davis',
        toId: 'companies-prism',
        sourceIds: ['src-prism-2021'],
        confidence: 0.94,
        evidenceKind: 'structured'
      }
    ]
  });

  const result = await service.search({
    query: 'Companies where our advisors have multi-year ongoing relationships',
    limit: 5,
    mode: 'search-only',
    assistQuery: true,
    lexicalBackend: 'bm25-lexical'
  });

  assert.equal(result.results[0]?.id, 'companies-prism');
  assert.notEqual(result.results[0]?.id, 'companies-anchor');
});
