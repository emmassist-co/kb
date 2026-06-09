# `emmassist/kb`

Cloudflare-first compounding knowledge base for agents, operator runtimes, and tenant-scoped institutional memory.

`kb` is the source of truth for the packages and operating model behind a durable knowledge base that gets better over time:

- `kb-core` defines the backend-neutral knowledge model and service layer
- `kb-storage-cloudflare` persists canonical state in Cloudflare-native storage
- `kb-http` exposes the canonical JSON/HTTP contract for local and deployed hosts
- `kb-cli` gives operators and local agents a single command surface
- `kb-flue-adapter` plugs the KB into Flue runtimes
- `kb-autoresearch`, `kb-verify`, and `eval/` enforce compounding quality rather than one-off retrieval demos

## Public Package Set

The staged open-source package set is:

- `@emmassist-co/kb-core`
- `@emmassist-co/kb-storage-file`
- `@emmassist-co/kb-storage-cloudflare`
- `@emmassist-co/kb-http`
- `@emmassist-co/kb-cli`

These packages form the Cloudflare-first product spine for public consumers.

Not yet in the staged public package set:

- `@emmassist-co/kb-flue-adapter`
  Deferred until the remaining host-specific runtime coupling is removed.
- `@emmassist-co/kb-autoresearch`
  Still private while its product surface, packaging contract, and runtime assumptions are narrowed.

## Product Direction

The repo is optimized around one product claim:

> every useful interaction should make the tenant knowledge base better, and the deployed Cloudflare surface should be the primary production shape.

That means:

- durable truth lives outside the chat transcript
- evidence, corrections, and links are first-class writes
- local file-backed use is for development, testing, and portability
- deployed single-tenant Cloudflare runtimes are the default production target

See:

- [STRATEGY.md](./STRATEGY.md)
- [docs/product/knowledge-base.md](./docs/product/knowledge-base.md)
- [docs/product/cloudflare-first-compounding-kb.md](./docs/product/cloudflare-first-compounding-kb.md)

## Architecture

Current package boundaries already reflect the intended shape:

- `packages/kb-core`: knowledge types, markdown/source parsing, retrieval helpers, service orchestration
- `packages/kb-storage-file`: local file-backed store for development and local agent workspaces
- `packages/kb-storage-cloudflare`: canonical R2-backed state and Cloudflare runtime adapters
- `packages/kb-http`: canonical `GET`/`POST`/`PUT`/`DELETE` contract with both Node and Worker hosts
- `packages/kb-cli`: local operator CLI, daemon mode, HTTP client mode, and installable skills
- `packages/kb-flue-adapter`: deferred from the staged public package set until its remaining host-specific wiring is removed
- `packages/kb-autoresearch`: private package and repo-owned research tooling surface, not a staged public install target

## Cloudflare-First Deployment Shape

Production should bias toward:

- one deployment per tenant or customer boundary
- Worker-hosted `kb-http` surface
- canonical tenant state in Cloudflare-backed storage
- automated verification against the deployed HTTP contract

Local daemon and file-backed flows remain important, but they support the production architecture instead of defining it.

## Verification

Core repo checks:

```bash
npm run build:public
npm run typecheck
npm test
./node_modules/.bin/tsx scripts/kb-verify.ts --mode all
```

Open-source readiness:

```bash
python3 path/to/os_ready_audit.py --root "$PWD"
```

## Benchmark Standard

Benchmarks are a first-class release surface for `kb`, not optional supporting detail.

The public bar for `kb` is not "some tests pass." The eval stack has three distinct jobs:

- `admin-world-v3` is the product-core retrieval benchmark.
  We optimize on `admin-world-v3 dev` and confirm on `admin-world-v3 holdout`.
  The current corpus carries `288 retrieval queries`, including `72 holdout queries`, across `9 relation families`.
- `gbrain-world` is the external-reference retrieval benchmark.
  In this repo, that means the exact public GBrain GitHub benchmark contract: `145` queries across attendance, employment, investing, and advising, not a repo-local reinterpretation of the vendored corpus.
- `core-six` is the deterministic floor-raising suite.
  It covers retrieval, temporal behavior, identity, provenance, contradictions, and fuzzy recall without model-judge noise.

Current public benchmark posture:

| Rail | Role | Size | P@5 | R@5 | MRR@5 | nDCG@5 | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `core-six` | deterministic floor | `72 retrieval + 28 non-retrieval` | `30.0%` | `94.4%` | `93.1%` | `88.4%` | `pass` |
| `admin-world-v3 dev` | product-core optimize rail | `216 queries` | `41.5%` | `99.3%` | `98.7%` | `92.6%` | `floor reached` |
| `admin-world-v3 holdout` | product-core confirm rail | `72 queries` | `41.7%` | `99.3%` | `100.0%` | `93.6%` | `floor reached` |
| `gbrain-world` | exact public external rail | `145 queries` | `35.6%` | `99.3%` | `100.0%` | `99.5%` | `guardrails passed` |

External reference, kept separate from our measured score:

| Reference | P@5 | R@5 |
| --- | ---: | ---: |
| `GBrain` public headline used in the side-by-side runner | `49.1%` | `97.9%` |

- Latest deterministic scorecard: [`docs/benchmarks/kb-scorecard-latest.md`](./docs/benchmarks/kb-scorecard-latest.md)
  Current result: `core-six` passes `100%` of categories.
- Latest external-reference snapshot: `npm run eval:kb:gbrain-world`
  Current measured KB score on the exact public GBrain GitHub benchmark: `P@5 35.6%`, `R@5 99.3%`, `MRR 100.0%`, `nDCG 99.5%`.
  Current GBrain reference headline used in the side-by-side runner: `P@5 49.1%`, `R@5 97.9%`.

That means the repo is not claiming "we beat GBrain." It is claiming:

- the eval surface is explicit and public
- the product-core benchmark is separated from the external-reference benchmark
- the deterministic KB quality floor is visible and repeatable
- the external benchmark is the exact public GBrain GitHub benchmark contract rather than a KB-local reinterpretation
- the external-reference gap is measurable in the README instead of hidden in internal notes

Release policy:

- optimize on `admin-world-v3 dev`
- confirm on `admin-world-v3 holdout`
- block regressions on `core-six dev` and `core-six holdout`
- require both `admin-world-v3 dev` and `admin-world-v3 holdout` to run in CI verification
- run the exact `gbrain-world` GitHub benchmark contract as the public external reference rail, not a direct "ship only if it wins" target
- after any major KB change, rerun the benchmark rails and refresh the published benchmark snapshot in this README and `docs/benchmarks/kb-scorecard-latest.*`

Major changes that should trigger a benchmark refresh include:

- retrieval or ranking logic changes
- graph extraction or relation-model changes
- storage, indexing, or sync changes that affect KB answer quality
- benchmark corpus or benchmark runner changes
- major CLI or HTTP behavior changes that alter the KB contract

See:

- [docs/operations/kb-benchmark.md](./docs/operations/kb-benchmark.md)
- [docs/benchmarks/kb-scorecard-latest.md](./docs/benchmarks/kb-scorecard-latest.md)
