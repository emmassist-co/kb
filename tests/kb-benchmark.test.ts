import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadAdminWorldCorpus, loadCoreSixFixtures, loadFixtureCorpus, loadGbrainWorldCorpus, loadRepoDocsCorpus, normalizeSlug } from '../eval/runner/loaders.js';
import { ndcgAtK, precisionAtK, recallAtK, reciprocalRankAtK } from '../eval/runner/types.js';
import { buildComparisonModes, compareBenchmarkParity, runBenchmark } from '../eval/runner/kb-benchmark.js';
import { runSelectedCategories } from '../eval/runner/kb-eval.js';

test('ranking metrics match expected top-k behavior', () => {
  const docs = [
    { pageId: 'a', score: 0.9, rank: 1 },
    { pageId: 'b', score: 0.8, rank: 2 },
    { pageId: 'c', score: 0.7, rank: 3 }
  ];
  const relevant = new Set(['b', 'c']);

  assert.equal(precisionAtK(docs, relevant, 2), 0.5);
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
  const loaded = loadGbrainWorldCorpus(root);

  assert.ok(loaded.pages.length > 100);
  assert.equal(loaded.queries.length, 145);
  assert.equal(loaded.provenance, 'upstream-fictional-benchmark');
  assert.equal(normalizeSlug('companies/nimbus-5'), 'companies__nimbus-5');
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who works at ')));
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who invested in ')));
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who advises ')));
  assert.ok(loaded.queries.some((query) => query.text.startsWith('Who attended ')));
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

  assert.equal(loaded.temporal.length, 3);
  assert.equal(loaded.identity.length, 5);
  assert.equal(loaded.provenanceCases.length, 4);
  assert.equal(loaded.contradictions.length, 2);
  assert.equal(loaded.fuzzy.length, 4);
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
