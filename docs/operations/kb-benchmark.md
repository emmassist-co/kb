# KB Benchmark

Use the KB benchmark to measure retrieval quality independently from the admin agent. For the full multi-category suite, run the KB eval suite.

Important corpus note:

- `gbrain-evals-upstream` is the gold external benchmark and should be treated as the public comparison rail
- the synthetic `gbrain-evals` adapter slice is the held-out anti-overfitting rail used to catch benchmark-shaped wins that do not generalize
- `gbrain-world` is the exact public GitHub benchmark contract currently presented by `gbrain-evals`: 145 relational queries across attendance, employment, investing, and advising
- the vendored `world-v1` corpus is richer than that public contract; broader linkable-relation exploration exists separately and is not the public gold rail
- `core-six` is our deterministic local fixture suite for temporal, identity, provenance, contradictions, and fuzzy behavior
- `repo-docs-v1` is a first-party retrieval corpus built from the real markdown docs in this repository

Do not treat these as the same thing.

For a real GBrain comparison, the contract is strict:

- same upstream runner
- same corpus
- same query set
- same metric definitions
- same top-k cutoff

If any of those differ, treat the result as diagnostic rather than comparative.

Config note:

- workspace-shaped extraction assumptions should live in `packages/kb-core/src/relation-rules.json`
- page priors now declare page families and activation surfaces in rule data
- benchmark wins are more trustworthy when they come from config plus generic core behavior, not imperative benchmark-only guards

## Commands

Run the local fixture benchmark:

```bash
npm run eval:kb
```

Emit machine-readable output:

```bash
npm run eval:kb -- --json
```

Run the full six-category suite and write the latest scorecard artifacts:

```bash
npm run eval:kb:all
```

Run a single category:

```bash
npm run eval:kb:cat -- --category temporal --json
```

Run retrieval against the real local repo docs corpus:

```bash
npm run eval:kb:repo-docs
```

Run against the exact public GBrain GitHub benchmark:

```bash
npm run eval:kb:gbrain-world
```

Run the default literal upstream `gbrain-evals` side-by-side comparison:

```bash
npm run eval:kb:gbrain-evals-upstream
```

Run the KB-only machine-readable version used by autoresearch:

```bash
npm run eval:kb:gbrain-evals-upstream:kb
```

Run the held-out synthetic adapter rail directly:

```bash
KB_GBRAIN_QUERY_SET=synthetic KB_GBRAIN_COMPACT=true node --import tsx/esm scripts/run-gbrain-evals-kb-adapter.ts
```

Run the broader internal linkable-corpus exploration surface:

```bash
npm run eval:kb:gbrain-world-corpus-links
```

Or point at any other checked-out `world-v1` path for the exact GitHub benchmark contract:

```bash
npm run eval:kb -- --gbrain-world /path/to/gbrain-evals/eval/data/world-v1 --gbrain-world-contract github-benchmark
```

## What It Measures

The metric contract matches the core BrainBench retrieval metrics:

- `P@k`
- `Recall@k`
- `MRR@k`
- `nDCG@k`

Important precision note:

- local KB benchmark reporting now matches the real upstream `gbrain-evals` semantics
- `P@k` is `hits / returned_docs`
- it is not `hits / k`
- this means a conservative retriever can show high precision while still losing badly on recall
- the authoritative apples-to-apples command is `npm run eval:kb:gbrain-evals-upstream`

When you run with `--gbrain-world --gbrain-world-contract github-benchmark`, the benchmark uses the same primary relational retrieval case families GBrain uses in its public side-by-side runner:

- `Who attended <meeting>?`
- `Who works at <company>?`
- `Who invested in <company>?`
- `Who advises <company>?`

On the current vendored `world-v1` corpus that is 145 queries total.

## Corpus Provenance

The runner now labels the corpus provenance explicitly:

- `upstream-fictional-benchmark`
- `first-party-repo-docs`
- `deterministic-synthetic-fixtures`

This is deliberate. A strong KB eval stack should include:

- external benchmark comparability
- first-party source-grounded retrieval
- deterministic targeted fixtures for narrow failure modes

The goal of the public external rail is not to invent our own interpretation of GBrain. The gold-standard path is the literal upstream `gbrain-evals` runner with real `gbrain` and `kb-upstream` scored in the same process. The vendored `gbrain-world` benchmark remains useful as a faster local diagnostic rail on the same corpus family, but it is not the final public comparison:

- pinned vendored corpus
- explicit benchmark contract identity
- deterministic runner
- adapter-independent metrics

The synthetic held-out adapter rail is not a replacement for the upstream benchmark. It exists so evaluation and autoresearch can reject narrow `world-v1` wins that fail on alternate phrasings and answer-surface shapes.

The broader vendored corpus may still support internal exploratory benchmarks, but those should not be confused with the public external rail.

## Current Snapshot

- real upstream side-by-side:
  - `gbrain`: `P@5 49.1%`, `R@5 97.9%`
  - `kb-upstream`: `P@5 76.6%`, `R@5 99.5%`, `259/261`
- held-out synthetic adapter rail:
  - `kb-upstream`: `P@5 32.1%`, `R@5 88.3%`, `MRR 76.1%`, `nDCG 77.4%`

Recent note:

- the latest kept change fixed the isolated `relationship-depth` held-out miss by improving advisory-renewal extraction in `kb-core`, not by adding more ranking-only heuristics

## Current Scope

Today this benchmark evaluates the KB subsystem directly:

- markdown/frontmatter entity ingestion
- deterministic `kb search`
- corpus/query scoring without agent involvement

It does not yet benchmark:

- agent routing
- multimodal ingest
- end-to-end harness workflows
- MCP/tool contracts
- model-as-judge categories

## KB Eval Suite

The eval suite expands beyond Cat 1 retrieval and covers the current Core 6 knowledge-base categories:

- retrieval
- temporal
- identity
- provenance
- contradictions
- fuzzy recall

The suite stays deterministic and local-first:

- no API keys
- no model-as-judge
- no agent prompt coupling

Latest scorecards are written to:

- `docs/benchmarks/kb-scorecard-latest.md`
- `docs/benchmarks/kb-scorecard-latest.json`
