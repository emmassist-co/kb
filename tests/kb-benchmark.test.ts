import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadAdminWorldCorpus, loadCoreSixFixtures, loadFixtureCorpus, loadGbrainWorldCorpus, loadRelationParaphraseCorpus, loadRelationTransferCorpus, loadRepoDocsCorpus, normalizeSlug } from '../eval/runner/loaders.js';
import { fixedPrecisionCeilingAtK, ndcgAtK, precisionAtK, recallAtK, reciprocalRankAtK, returnedPrecisionAtK } from '../eval/runner/types.js';
import { buildComparisonModes, compareBenchmarkParity, runBenchmark } from '../eval/runner/kb-benchmark.js';
import { runSelectedCategories } from '../eval/runner/kb-eval.js';
import { KbAdapter } from '../eval/adapters/gbrain-evals/kb-adapter.js';

test('ranking metrics match expected top-k behavior', () => {
  const docs = [
    { pageId: 'a', score: 0.9, rank: 1 },
    { pageId: 'b', score: 0.8, rank: 2 },
    { pageId: 'c', score: 0.7, rank: 3 }
  ];
  const relevant = new Set(['b', 'c']);

  assert.equal(precisionAtK(docs, relevant, 2), 0.5);
  assert.equal(precisionAtK(docs.slice(0, 2), new Set(['a']), 5), 0.2);
  assert.equal(returnedPrecisionAtK(docs.slice(0, 2), new Set(['a']), 5), 0.5);
  assert.equal(returnedPrecisionAtK([], relevant, 5), 0);
  assert.equal(fixedPrecisionCeilingAtK(new Set(['a', 'b', 'c']), 5), 0.6);
  assert.equal(recallAtK(docs, relevant, 2), 0.5);
  assert.equal(reciprocalRankAtK(docs, relevant, 3), 0.5);
  assert.equal(Number(ndcgAtK(docs, new Map([['b', 2], ['c', 1]]), 3).toFixed(4)), 0.6697);
});

test('fixture corpus benchmark runs and returns aggregate metrics', async () => {
  const root = path.resolve(process.cwd(), 'eval/data/kb-world-v0');
  const loaded = loadFixtureCorpus(root);
  const result = await runBenchmark({
    corpusName: loaded.corpusName,
    pages: loaded.pages,
    queries: loaded.queries,
    k: 3
  });

  assert.equal(result.queryCount, loaded.queries.length);
  assert.ok(result.precisionAtK > 0);
  assert.ok(result.recallAtK > 0);
  assert.equal(result.perQuery.length, loaded.queries.length);
  assert.ok(result.perQuery.some((query) => query.id === 'q-stripe-alias'));
});

test('gbrain world loader builds normalized ids and relational queries', () => {
  const root = path.resolve(process.cwd(), 'eval/data/gbrain-world-v1');
  const loaded = loadGbrainWorldCorpus(root, 'github-benchmark');
  const corpusLinks = loadGbrainWorldCorpus(root, 'corpus-linkable');

  assert.ok(loaded.pages.length > 100);
  assert.equal(loaded.queries.length, 145);
  assert.equal(loaded.provenance, 'upstream-fictional-benchmark');
  assert.equal(loaded.metadata?.benchmarkContractId, 'github-benchmark');
  assert.equal(loaded.metadata?.benchmarkContractLabel, 'Exact GBrain GitHub benchmark contract');
  assert.equal(normalizeSlug('companies/nimbus-5'), 'companies__nimbus-5');
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who works at ')));
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who invested in ')));
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who advises ')));
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who attended ')));
  assert.ok(corpusLinks.queries.length > loaded.queries.length);
  assert.equal(corpusLinks.metadata?.benchmarkContractId, 'corpus-linkable');
  assert.ok(corpusLinks.queries.some((query) => query.family === 'related_companies'));
  assert.ok(corpusLinks.queries.some((query) => query.family === 'related_people'));
  assert.ok(corpusLinks.queries.some((query) => query.family === 'secondary_affiliations'));
});

test('gbrain adapter query path ignores benchmark metadata', async () => {
  const adapter = new KbAdapter('kb-metadata-guard');
  const pages = [
    {
      slug: 'companies/orbit-labs',
      type: 'company' as const,
      title: 'Orbit Labs',
      compiled_truth: 'Orbit Labs builds orbital analytics.',
      timeline: ''
    },
    {
      slug: 'people/ada-patel',
      type: 'person' as const,
      title: 'Ada Patel',
      compiled_truth: 'Ada Patel serves as an advisor to Orbit Labs on go-to-market strategy.',
      timeline: ''
    }
  ];
  const state = await adapter.init(pages, {
    name: adapter.name,
    k: 5,
    mode: 'graph-first-hybrid',
    resultBudgetMode: 'adaptive'
  });

  try {
    const plain = await adapter.query(
      {
        id: 'plain-query',
        tier: 'medium',
        text: 'Who advises Orbit Labs?',
        expected_output_type: 'canonical-entity-id'
      },
      state
    );
    const polluted = await adapter.query(
      {
        id: 'totally-different-id',
        tier: 'externally-authored',
        text: 'Who advises Orbit Labs?',
        expected_output_type: 'canonical-entity-id',
        tags: ['wrong-family', 'benchmark-only-tag'],
        author: 'metadata-should-not-score',
        known_failure_modes: ['pretend this belongs to another benchmark family']
      },
      state
    );

    assert.deepEqual(
      polluted.map((doc) => doc.page_id),
      plain.map((doc) => doc.page_id)
    );
  } finally {
    await adapter.teardown?.(state);
  }
});

test('relation guardrail corpora load paraphrase and prose-only transfer rails', () => {
  const paraphrase = loadRelationParaphraseCorpus(path.resolve(process.cwd(), 'eval/data/relation-paraphrase-v1'));
  const transfer = loadRelationTransferCorpus(path.resolve(process.cwd(), 'eval/data/relation-transfer-v1'));

  assert.equal(paraphrase.metadata?.benchmarkTier, 'regression-guardrail');
  assert.equal(paraphrase.queries.length, 4);
  assert.equal(paraphrase.queries.every((query) => query.indirectPhrasing), true);
  assert.equal(paraphrase.queries.some((query) => /^Who (attended|works at|invested in|advises)\b/i.test(query.text)), false);
  assert.equal(transfer.metadata?.benchmarkTier, 'regression-guardrail');
  assert.equal(transfer.queries.length, 4);
  assert.equal(transfer.pages.some((page) => page.relations?.length), false);
});

test('blind paraphrase relation rail passes guardrail floors', async () => {
  const corpus = loadRelationParaphraseCorpus(path.resolve(process.cwd(), 'eval/data/relation-paraphrase-v1'));
  const result = await runBenchmark({
    corpusName: corpus.corpusName,
    pages: corpus.pages,
    queries: corpus.queries,
    metadata: corpus.metadata,
    k: 5,
    mode: 'graph-first-hybrid'
  });

  assert.equal(result.gates?.passed, true);
  assert.equal(result.recallAtK, 1);
  assert.ok((result.returnedPrecisionAtK ?? 0) >= 0.5);
  assert.ok((result.fixedPrecisionAtKCeiling ?? 0) > 0);
});

test('prose-only non-gbrain transfer rail extracts relations without structured seeds', async () => {
  const corpus = loadRelationTransferCorpus(path.resolve(process.cwd(), 'eval/data/relation-transfer-v1'));
  const result = await runBenchmark({
    corpusName: corpus.corpusName,
    pages: corpus.pages,
    queries: corpus.queries,
    metadata: corpus.metadata,
    k: 5,
    mode: 'graph-first-hybrid'
  });

  assert.equal(result.gates?.passed, true);
  assert.equal(result.recallAtK, 1);
  assert.equal(result.extractionQuality?.structuredSupportRate, 0);
  assert.equal(result.extractionQuality?.proseSupportRate, 1);
  assert.equal(result.diagnostics?.historicalOverCurrentCount, 0);
});

test('repo docs loader builds retrieval corpus from real local docs', () => {
  const root = path.resolve(process.cwd(), 'eval/data/repo-docs-v1');
  const loaded = loadRepoDocsCorpus(root);

  assert.equal(loaded.provenance, 'first-party-repo-docs');
  assert.equal(loaded.queries.length, 6);
  assert.ok(loaded.pages.some((page) => page.id === 'product-knowledge-base'));
  assert.ok(loaded.pages.some((page) => page.compiledTruth.includes('Make KB the durable memory layer for company-scoped agent work')));
});

test('admin world loader exposes relation-rich corpus and derived queries', () => {
  const root = path.resolve(process.cwd(), 'eval/data/admin-world-v3');
  const loaded = loadAdminWorldCorpus(root);

  assert.equal(loaded.provenance, 'deterministic-synthetic-fixtures');
  assert.ok(loaded.pages.length >= 120);
  assert.ok(loaded.queries.length >= 120);
  assert.ok(loaded.pages.some((page) => page.relations?.some((relation) => relation.type === 'owns')));
  assert.ok(loaded.queries.some((query) => query.relationType === 'owns'));
  assert.ok(loaded.queries.some((query) => query.relationType === 'approves'));
  assert.equal(loaded.metadata?.benchmarkTier, 'product-core');
  assert.ok((loaded.metadata?.ambiguityRate ?? 0) >= 0.35);
  assert.ok((loaded.metadata?.aliasQueryRate ?? 0) >= 0.35);
});

test('core six fixtures load deterministic category cases', () => {
  const root = path.resolve(process.cwd(), 'eval/data/core-six');
  const loaded = loadCoreSixFixtures(root);

  assert.equal(loaded.temporal.length, 5);
  assert.equal(loaded.identity.length, 8);
  assert.equal(loaded.provenanceCases.length, 6);
  assert.equal(loaded.contradictions.length, 3);
  assert.equal(loaded.fuzzy.length, 6);
});

test('kb eval suite runs all six categories and emits category results', async () => {
  const categories = await runSelectedCategories({
    json: true,
    k: 5,
    writeScorecard: false
  });

  assert.equal(categories.length, 6);
  assert.deepEqual(
    categories.map((category) => category.category),
    ['retrieval', 'temporal', 'identity', 'provenance', 'contradictions', 'fuzzy']
  );
  assert.ok(categories.every((category) => category.caseCount > 0));
});

test('graph-first hybrid retrieval improves ranking quality over search-only on admin-world', async () => {
  const root = path.resolve(process.cwd(), 'eval/data/admin-world-v3');
  const corpus = loadAdminWorldCorpus(root);
  const searchOnly = await runBenchmark({
    corpusName: corpus.corpusName,
    pages: corpus.pages,
    queries: corpus.queries,
    k: 5,
    mode: 'search-only'
  });
  const graphHybrid = await runBenchmark({
    corpusName: corpus.corpusName,
    pages: corpus.pages,
    queries: corpus.queries,
    k: 5,
    mode: 'graph-first-hybrid'
  });

  assert.ok(graphHybrid.precisionAtK >= searchOnly.precisionAtK);
  assert.ok(graphHybrid.mrrAtK >= searchOnly.mrrAtK);
  assert.ok((graphHybrid.extractionQuality?.graphLinkCoverageRate ?? 0) > 0);
});

test('benchmark runner supports bm25 lexical backend selection', async () => {
  const root = path.resolve(process.cwd(), 'eval/data/kb-world-v0');
  const corpus = loadFixtureCorpus(root);
  const legacy = await runBenchmark({
    corpusName: corpus.corpusName,
    pages: corpus.pages,
    queries: corpus.queries,
    k: 5,
    mode: 'search-only',
    lexicalBackend: 'legacy-lexical'
  });
  const bm25 = await runBenchmark({
    corpusName: corpus.corpusName,
    pages: corpus.pages,
    queries: corpus.queries,
    k: 5,
    mode: 'search-only',
    lexicalBackend: 'bm25-lexical'
  });

  assert.equal(legacy.lexicalBackend, 'legacy-lexical');
  assert.equal(bm25.lexicalBackend, 'bm25-lexical');
  assert.ok(bm25.queryCount > 0);
});

test('admin-world split loading is deterministic and non-empty', () => {
  const root = path.resolve(process.cwd(), 'eval/data/admin-world-v3');
  const dev = loadAdminWorldCorpus(root, 'dev');
  const holdout = loadAdminWorldCorpus(root, 'holdout');

  assert.ok(dev.queries.length > 0);
  assert.ok(holdout.queries.length > 0);
  assert.ok(dev.queries.every((query) => query.split === 'dev'));
  assert.ok(holdout.queries.every((query) => query.split === 'holdout'));
  assert.equal(new Set([...dev.queries, ...holdout.queries].map((query) => query.id)).size, dev.queries.length + holdout.queries.length);
});

test('admin-world benchmark keeps dense dev and holdout coverage', () => {
  const root = path.resolve(process.cwd(), 'eval/data/admin-world-v3');
  const dev = loadAdminWorldCorpus(root, 'dev');
  const holdout = loadAdminWorldCorpus(root, 'holdout');

  assert.ok(dev.queries.length >= 200);
  assert.ok(holdout.queries.length >= 70);

  for (const count of Object.values(dev.metadata?.familyCounts ?? {})) {
    assert.ok(count >= 20);
  }
  for (const count of Object.values(holdout.metadata?.familyCounts ?? {})) {
    assert.ok(count >= 8);
  }

  assert.ok((holdout.metadata?.ambiguityRate ?? 0) >= 0.3);
  assert.ok((holdout.metadata?.indirectPhrasingRate ?? 0) >= 0.45);
  assert.ok((holdout.metadata?.wrongTypeDistractorRate ?? 0) >= 0.95);
});

test('benchmark comparison modes use minimal hardness matrix by default and full matrix for side-by-side', () => {
  assert.deepEqual(
    buildComparisonModes('legacy-lexical', false),
    [{ mode: 'search-only', lexicalBackend: 'legacy-lexical' }]
  );
  assert.equal(buildComparisonModes('legacy-lexical', true).length, 5);
});

test('benchmark runner can score a non-local adapter', async () => {
  const result = await runBenchmark({
    corpusName: 'adapter-fixture',
    pages: [
      {
        id: 'vendor-stripe',
        type: 'vendor',
        title: 'Stripe',
        compiledTruth: 'Stripe handles invoice payments.',
        timeline: ''
      }
    ],
    queries: [
      {
        id: 'q-1',
        text: 'Who handles invoice payments?',
        relevant: ['vendor-stripe']
      }
    ],
    k: 3,
    adapter: {
      async search() {
        return {
          query: 'Who handles invoice payments?',
          mode: 'search-only',
          results: [
            {
              id: 'vendor-stripe',
              title: 'Stripe',
              kind: 'vendor',
              score: 0.99,
              reason: ['contains:invoice payments'],
              matchedFields: ['currentTruth'],
              sourceIds: [],
              confidence: 'high',
              ambiguous: false
            }
          ]
        };
      },
      async queryRelations() {
        return {
          query: 'Who handles invoice payments?',
          classification: {},
          results: []
        };
      },
      async exportSnapshot() {
        return {
          mode: 'basic',
          entities: [
            {
              id: 'vendor-stripe',
              title: 'Stripe',
              kind: 'vendor',
              markdown: '# Stripe'
            }
          ],
          sources: [],
          events: [],
          links: [],
          drafts: []
        };
      }
    }
  });

  assert.equal(result.queryCount, 1);
  assert.equal(result.precisionAtK, 1);
  assert.equal(result.recallAtK, 1);
});

test('benchmark runner exposes scorer parity metrics and false-positive buckets', async () => {
  const result = await runBenchmark({
    corpusName: 'metric-parity-fixture',
    pages: [
      {
        id: 'person-ada',
        type: 'person',
        title: 'Ada',
        compiledTruth: 'Ada advises Orbit.',
        timeline: ''
      },
      {
        id: 'company-orbit',
        type: 'company',
        title: 'Orbit',
        compiledTruth: 'Orbit is advised by Ada.',
        timeline: ''
      },
      {
        id: 'project-orbit-plan',
        type: 'project',
        title: 'Orbit plan',
        compiledTruth: 'Orbit plan mentions Ada.',
        timeline: ''
      },
      {
        id: 'person-ben',
        type: 'person',
        title: 'Ben',
        compiledTruth: 'Ben works elsewhere.',
        timeline: ''
      },
      {
        id: 'person-cora',
        type: 'person',
        title: 'Cora',
        compiledTruth: 'Cora works elsewhere.',
        timeline: ''
      }
    ],
    queries: [
      {
        id: 'q-1',
        text: 'Who advises Orbit?',
        relevant: ['person-ada'],
        expectedTargetTypes: ['person'],
        distractorGroups: {
          wrongType: ['project-orbit-plan']
        }
      }
    ],
    k: 5,
    adapter: {
      async search() {
        return {
          query: 'Who advises Orbit?',
          mode: 'search-only',
          results: [
            {
              id: 'person-ada',
              title: 'Ada',
              kind: 'entity',
              entityKind: 'person',
              score: 10,
              reason: ['fixture'],
              matchedFields: ['fixture'],
              sourceIds: [],
              confidence: 'high',
              ambiguous: false
            },
            {
              id: 'project-orbit-plan',
              title: 'Orbit plan',
              kind: 'entity',
              entityKind: 'project',
              score: 9,
              reason: ['fixture'],
              matchedFields: ['fixture'],
              sourceIds: [],
              confidence: 'medium',
              ambiguous: false
            }
          ]
        };
      },
      async queryRelations() {
        return {
          query: 'Who advises Orbit?',
          classification: {},
          results: []
        };
      },
      async exportSnapshot() {
        return {
          mode: 'basic',
          entities: [],
          sources: [],
          events: [],
          links: [],
          drafts: []
        };
      }
    }
  });

  assert.equal(result.precisionAtK, 0.2);
  assert.equal(result.returnedPrecisionAtK, 0.5);
  assert.equal(result.fixedPrecisionAtKCeiling, 0.2);
  assert.equal(result.totalRelevantHitsAtK, 1);
  assert.equal(result.totalReturnedAtK, 2);
  assert.equal(result.topKSlotDenominator, 5);
  assert.deepEqual(result.returnedCountStats, { min: 2, max: 2, mean: 2, histogram: { '0': 0, '1': 0, '2': 1, '3': 0, '4': 0, '5': 0 } });
  assert.equal(result.diagnostics?.falsePositiveCount, 1);
  assert.equal(result.diagnostics?.falsePositiveBuckets?.wrongType, 1);
});

test('benchmark relation extraction covers prose-only fixtures without structured relations', async () => {
  const result = await runBenchmark({
    corpusName: 'prose-only-relation-fixture',
    pages: [
      {
        id: 'company-orbit',
        type: 'company',
        title: 'Orbit Labs',
        compiledTruth: 'Orbit Labs builds orbital analytics.',
        timeline: ''
      },
      {
        id: 'person-ada',
        type: 'person',
        title: 'Ada Patel',
        compiledTruth: 'Ada Patel serves as an advisor to Orbit Labs on go-to-market strategy.',
        timeline: ''
      }
    ],
    queries: [
      {
        id: 'q-advises-orbit',
        text: 'Who advises Orbit Labs?',
        relevant: ['person-ada'],
        relationType: 'advises',
        anchorId: 'company-orbit',
        expectedTargetTypes: ['person']
      }
    ],
    k: 2,
    mode: 'graph-first-hybrid'
  });

  assert.equal(result.perQuery[0].returned[0]?.pageId, 'person-ada');
  assert.equal(result.recallAtK, 1);
  assert.ok((result.extractionQuality?.proseSupportRate ?? 0) > 0);
});

test('benchmark parity comparator fails metrics beyond the drift threshold', () => {
  const local = {
    precisionAtK: 0.8,
    recallAtK: 0.7,
    mrrAtK: 0.75,
    ndcgAtK: 0.78
  };
  const deployed = {
    precisionAtK: 0.72,
    recallAtK: 0.69,
    mrrAtK: 0.7,
    ndcgAtK: 0.8
  };

  const comparison = compareBenchmarkParity(local, deployed, 0.05);

  assert.equal(comparison.passed, false);
  assert.equal(comparison.metrics.precisionAtK.passed, false);
  assert.equal(comparison.metrics.recallAtK.passed, true);
  assert.ok(comparison.metrics.precisionAtK.relativeDrift < -0.05);
});

test('core-six dev targeted baseline categories stay green', async () => {
  const fixturesPath = path.resolve(process.cwd(), 'eval/data/core-six-dev');
  const [temporal] = await runSelectedCategories({
    category: 'temporal',
    json: true,
    k: 5,
    fixturesPath,
    writeScorecard: false
  });
  const [provenance] = await runSelectedCategories({
    category: 'provenance',
    json: true,
    k: 5,
    fixturesPath,
    writeScorecard: false
  });
  const [fuzzy] = await runSelectedCategories({
    category: 'fuzzy',
    json: true,
    k: 5,
    fixturesPath,
    writeScorecard: false
  });

  assert.equal(temporal.passed, true);
  assert.equal(provenance.passed, true);
  assert.equal(fuzzy.passed, true);
});
