# GBrain Retrieval Precision Deep Dive

Date: 2026-07-14
Status: investigation complete; ready for planning
Scope: understand how GBrain achieves its public BrainBench/GBrain benchmark posture, compare it with this KB repo, and identify planning-worthy improvement tracks without benchmark gaming.

## Executive Takeaways

1. **The apparent GBrain precision gap is mostly a metric-comparability problem, not a pure retrieval problem.**
   - GBrain's public runner reports precision as `hits / returned top-k length`.
   - This repo currently reports precision as `hits / k` for the GBrain rail.
   - On the exact 145-query GBrain public contract, the fixed-denominator P@5 ceiling is **36.0%** because there are only 261 gold answers over 145 × 5 slots.
   - Current KB graph-first BM25 reaches **36.0% fixed P@5, 100.0% R@5**, i.e. the fixed-denominator ceiling.
   - The same returned lists score **94.2% precision over returned results** because KB returns ~1.91 docs/query on average.

2. **GBrain's production retrieval stack is much broader than our current stack.** It combines Postgres FTS, pgvector HNSW, weighted RRF, cosine rescoring, graph signals, alias hops, source priors, reranking, autocut, contextual embedding wrappers, relation recall, and retrieval-reflex context injection.

3. **For this public benchmark, our immediate gap is not “copy GBrain's hybrid/vector stack.”** Our public GBrain rail already has perfect recall and hits the fixed-denominator precision ceiling. The first plan should make score reporting honest, then improve false-positive diagnostics and product-general relation precision.

4. **The safest product improvement path is relation-quality work, not vector search first.** Schema/type-safe relation filtering, graph-completeness arbitration, advisor ambiguity fixtures, and prose-only holdouts are higher leverage and lower risk than adding vector/reranker infrastructure immediately.

## What GBrain Is Doing Technically

Primary codebase inspected: `garrytan/gbrain` at commit `5008b287e47bf791132eedfebf66bdef11e9398c`.
Benchmark/evals inspected: `garrytan/gbrain-evals` at commit `565b80754ffa6abb9afb041026f2fab048aa7553`.

### High-signal GBrain techniques

| Technique | Why it matters | Evidence |
| --- | --- | --- |
| Hybrid retrieval pipeline | Combines lexical, vector, relational, graph, rerank, and budget stages instead of trusting one scorer. | [`src/core/search/hybrid.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/hybrid.ts#L809-L1529) |
| Postgres FTS + pgvector HNSW | GBrain uses `ts_rank`/`websearch_to_tsquery` and vector distance over indexed embeddings. | [`src/schema.sql`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/schema.sql#L296-L343), [`postgres-engine.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/postgres-engine.ts#L1657-L2008) |
| Weighted RRF + cosine rescoring | Avoids uncalibrated score addition across retrieval arms. | [`hybrid.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/hybrid.ts#L1320-L1364), [`hybrid.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/hybrid.ts#L1855-L1997) |
| Per-page chunk max-pooling before user limit | Prevents one page's many chunks from consuming top-k and keeps page diversity. | [`postgres-engine.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/postgres-engine.ts#L1548-L1557), [`sql-ranking.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/sql-ranking.ts#L154-L212) |
| Source priors and hard excludes | Curated pages can be boosted; noisy source prefixes can be suppressed. | [`source-boost.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/source-boost.ts#L1-L72) |
| Deterministic query intent | Query class changes weights, recency/salience, detail level, and modality routing. | [`query-intent.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/query-intent.ts#L1-L305) |
| Graph post-fusion boosts | Uses backlinks, graph adjacency, source/session diversification, and salience after fusion. | [`graph-signals.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/graph-signals.ts#L1-L75), [`graph-signals.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/graph-signals.ts#L321-L419) |
| Cross-encoder reranking + autocut | Reranks candidate set and trims at score cliffs. | [`rerank.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/rerank.ts#L1-L139), [`mode.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/mode.ts#L321-L393) |
| Alias/exact-title/entity resolver | Improves entity precision via aliases, exact title, slug suffix, and canonicality. | [`hybrid.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/hybrid.ts#L594-L704), [`retrieval-reflex.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/context/retrieval-reflex.ts#L119-L244) |
| Retrieval reflex | Pushes compact pointers for recently mentioned entities into agent context. | [`reflex.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/context/reflex.ts#L1-L155) |
| Contextual embedding wrappers | Prepends title/synopsis to embedding input without changing stored chunk text. | [`embedding-context.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/embedding-context.ts#L1-L85), [`import-file.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/import-file.ts#L666-L713) |
| Typed relational recall arm | Parses “who invested/advises/works/attended” style questions and injects graph fanout as retrieval arm. | [`relational-recall.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/relational-recall.ts#L1-L239), [`relational-intent.ts`](https://github.com/garrytan/gbrain/blob/5008b287e47bf791132eedfebf66bdef11e9398c/src/core/search/relational-intent.ts#L1-L239) |

### Important caveat

GBrain's default `balanced` mode is not a simple baseline. It includes reranker, graph signals, contextual retrieval, autocut, and relational recall by default. Its reported posture should be read as a tuned pipeline result, not “plain vector search” or “plain BM25.”

## What The Public GBrain Benchmark Actually Measures

The public headline comes from `gbrain-evals` `world-v1`:

- 240 fictional pages.
- 145 relational queries.
- Four templates:
  - `Who attended <meeting>?`
  - `Who works at <company>?`
  - `Who invested in <company>?`
  - `Who advises <company>?`
- Gold answers derive from hidden `_facts` fields; `_facts` are stripped from adapter inputs.
- It scores ranked source pages, not generated answers.

Evidence:

- README public claim: [`README.md#L44-L50`](https://github.com/garrytan/gbrain-evals/blob/565b80754ffa6abb9afb041026f2fab048aa7553/README.md#L44-L50)
- Query generation: [`multi-adapter.ts#L64-L129`](https://github.com/garrytan/gbrain-evals/blob/565b80754ffa6abb9afb041026f2fab048aa7553/eval/runner/multi-adapter.ts#L64-L129)
- Scoring contract: [`types.ts#L257-L272`](https://github.com/garrytan/gbrain-evals/blob/565b80754ffa6abb9afb041026f2fab048aa7553/eval/runner/types.ts#L257-L272)
- Published scorecard: [`2026-04-23-brainbench-v0.20.0.md#L15-L22`](https://github.com/garrytan/gbrain-evals/blob/565b80754ffa6abb9afb041026f2fab048aa7553/docs/benchmarks/2026-04-23-brainbench-v0.20.0.md#L15-L22)

## Our Current Posture On That Same Corpus

Fresh checks from this investigation:

```json
{
  "queries": 145,
  "totalGold": 261,
  "fixedDenominatorCeiling": 0.36,
  "maxHits": 261,
  "denominator": 725,
  "familyCounts": {
    "works_at": 40,
    "invested_in": 39,
    "advises": 16,
    "attended": 50
  }
}
```

Current graph-first BM25 on `gbrain-world:github-benchmark`:

```json
{
  "fixedPrecisionAt5": 0.36,
  "recallAt5": 1.0,
  "mrrAt5": 0.9724,
  "ndcgAt5": 0.9810,
  "precisionAtReturnedK": 0.9422,
  "hits": 261,
  "returned": 277,
  "avgReturned": 1.91
}
```

Family view using precision over returned results:

| Family | Hits | Returned | Gold | Fixed P@5 | Precision over returned | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| works_at | 50 | 53 | 50 | 25.0% | 94.3% | 100.0% |
| invested_in | 60 | 66 | 60 | 30.8% | 90.9% | 100.0% |
| advises | 17 | 24 | 17 | 21.3% | 70.8% | 100.0% |
| attended | 134 | 134 | 134 | 53.6% | 100.0% | 100.0% |

Interpretation:

- The **fixed P@5 number cannot exceed 36.0%** on this query set because of gold cardinality.
- The most real precision weakness is **advisor false positives** and, secondarily, investor/works_at extras.
- GBrain comparison needs a side-by-side metric note before any product claim.

## What We Already Have

- Deterministic typed graph retrieval through `KnowledgeBaseService.search` / `queryRelations`.
- BM25 lexical backend with field weights and phrase/exact boosts.
- GBrain public corpus vendored and separated as external reference.
- Admin-world dev/holdout as product-core optimization rails.
- Core-six deterministic guardrails.
- Rich retrieval diagnostics in `eval/runner/cat1-retrieval.ts`.

## Promising Ideas Worth Planning

### 1. Metric parity and scorecard honesty

**Summary:** Add `precisionAtReturnedK` / `gbrainPrecisionAtK` and fixed-denominator ceiling to GBrain side-by-side reports without replacing existing internal `precisionAtK`.

**Basis:** Direct metric mismatch between upstream `hits / returned top-k length` and local `hits / k`; fresh calculation shows fixed P@5 ceiling is 36.0% and KB is already at that ceiling.

**Why it matters:** Prevents us from chasing an impossible precision target and makes launch/comparison language honest.

**Planning priority:** P0.

### 2. Returned-count and false-positive diagnostics

**Summary:** Add per-family returned-count histograms and false-positive categories: wrong type, anchor page, lexical distractor, sibling/company-name distractor, stale/historical relation, relation-direction mismatch.

**Basis:** Advisor family has 24 returned for 17 gold, only 70.8% precision over returned; aggregate metrics hide this.

**Why it matters:** Gives us a real target for precision work after metric parity.

**Planning priority:** P0/P1.

### 3. Schema/type-safe relation filtering

**Summary:** Relation definitions should carry allowed target types and fallback policy. For person-answer relations, filter or strongly demote wrong target types unless the relation schema allows org targets.

**Basis:** Current public families mostly expect people, but real product relations may allow organizations; blanket `Who => person` is unsafe.

**Why it matters:** Likely removes easy false positives without reducing recall when graph evidence is strong.

**Planning priority:** P1.

### 4. Graph-completeness arbitration

**Summary:** If anchor, relation type, target type, and high-confidence graph edges are present, return graph targets and suppress lexical fallback. If graph evidence is incomplete, fuse with lexical fallback.

**Basis:** Our graph-first public run reaches 100% recall. Precision losses are mostly extra targets, not missing targets.

**Why it matters:** Product users want concise, relation-complete answers rather than padded top-5 lists.

**Planning priority:** P1.

### 5. Advisor ambiguity fixtures and ranking improvements

**Summary:** Build admin-world/prose-only advisor cases covering advisor vs investor, advisor vs board member, current vs former, and parent/subsidiary ambiguity before changing ranking.

**Basis:** `advises` is the weakest family by precision-over-returned and fixed P@5.

**Why it matters:** Avoids overfitting the public GBrain advisor templates and improves product-general relation semantics.

**Planning priority:** P1.

### 6. Prose-only relation extraction holdout

**Summary:** Add a GBrain-shaped internal holdout where relations must be extracted from prose, not seeded from `_facts` as structured links.

**Basis:** Current public rail validates search over seeded structured links. It does not prove extraction from natural text.

**Why it matters:** Keeps us from declaring production-quality relation retrieval based only on benchmark-shaped structured inputs.

**Planning priority:** P1/P2.

### 7. Rank-fusion helper for graph + lexical candidates

**Summary:** Add a pure RRF-style fusion helper, first for graph + BM25/legacy lexical, later extensible to vector.

**Basis:** GBrain uses rank fusion; our current graph/lexical merge uses scaled score addition in some paths and graph-first relation success is effectively graph-only.

**Why it matters:** Useful outside this exact public rail, especially for partially classified or indirect product queries.

**Planning priority:** P2, after metrics/diagnostics.

### 8. Vector/reranker architecture spike

**Summary:** Design vector retrieval and optional reranker interfaces behind explicit storage/backend decisions, not as an immediate default.

**Basis:** GBrain's production stack benefits from vector/HNSW and reranking, but our current issue on the public rail is not recall.

**Why it matters:** This is likely needed for broader semantic memory quality, but it is higher-risk and has package/storage implications.

**Planning priority:** P2/P3.

## Ideas Rejected Or Deferred

| Idea | Decision | Reason |
| --- | --- | --- |
| Redefine existing `precisionAtK` silently | Reject | Breaks historical scorecards and hides metric drift. Add sidecar metric instead. |
| Optimize directly for GBrain P@5 headline | Reject | Current fixed-denominator metric makes that impossible; GBrain remains external reference, not optimize rail. |
| Hard-code relation caps like `advises => 1` | Reject | Benchmark-specific and wrong for multi-advisor product cases. |
| Add LLM query expansion to deterministic eval defaults | Reject for now | Violates local/no-key deterministic eval posture and can increase false positives. |
| Add vector search immediately | Defer | Valuable long-term, but not the first precision bottleneck on this rail and requires storage/package design. |
| Change the public GBrain contract to broader `corpus-linkable` | Reject | Would destroy external comparability. Keep broad corpus as exploratory only. |

## Recommended Plan Scope

The next plan should **not** start with “implement GBrain's hybrid/vector stack.” It should start with a smaller, safer sequence:

1. **Metric/reporting parity**
   - Add variable-denominator precision sidecar.
   - Add fixed P@5 ceiling.
   - Clarify README/scorecard language.

2. **Diagnostics**
   - Returned-count histogram.
   - False-positive taxonomy.
   - Per-family precision-over-returned.

3. **Relation quality changes**
   - Relation schema target-type metadata.
   - Type-safe candidate filtering/demotion.
   - Graph-completeness fallback arbitration.

4. **Transfer validation**
   - Advisor ambiguity fixtures.
   - Prose-only relation holdout.
   - Admin-world dev/holdout plus core-six gates.

5. **Later architecture spike**
   - RRF helper.
   - Optional vector/reranker design.

## Validation Contract For The Future Plan

Any retrieval/ranking implementation plan should require:

- `npm run typecheck`
- `npm test`
- `npm run eval:kb:all -- --json`
- `npm run eval:kb:admin-world -- --split dev --json`
- `npm run eval:kb:admin-world -- --split holdout --json`
- `npm run eval:kb:gbrain-world -- --json`

For retrieval changes, also require ablations:

- search-only legacy
- search-only BM25
- graph-only
- graph-first legacy
- graph-first BM25

And hard anti-gaming rules:

- no query IDs, benchmark slugs, file names, or public templates as special cases;
- no use of `_facts` at query time;
- no family-specific caps unless represented as product-general relation schema behavior;
- no claim against GBrain precision unless denominator semantics match.

## Ready-To-Plan Recommendation

Proceed to planning with this goal:

> Make the GBrain comparison metric-equivalent and improve product-general relation precision, starting with diagnostics and schema-safe graph arbitration, while preserving current 100% GBrain recall, admin-world holdout floors, and core-six guardrails.
