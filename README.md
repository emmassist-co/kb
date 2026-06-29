# `emmassist/kb`

![KB hero diagram](./docs/assets/company-brain-kb-logo.png)

Cloudflare-first compounding knowledge base for agents, operator runtimes, and tenant-scoped institutional memory.

## Quick Start

If another coding agent wants a working KB in a fresh repo, this is the shortest supported path:

```bash
npm install @emmassist-co/kb-cli

export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

npx kb-local inspect
npx kb-local schema record
npx kb-local help
```

If that agent needs the canonical shared deployment instead of a local file-backed KB:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret

npx kb-local search --json '{"query":"billing"}'
```

For the full install and deployment path, see:

- [docs/consumer-quickstart.md](./docs/consumer-quickstart.md)
- [docs/cloudflare-agent-setup.md](./docs/cloudflare-agent-setup.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [docs/audits/2026-06-11-open-source-readiness.md](./docs/audits/2026-06-11-open-source-readiness.md)
- [docs/audits/2026-06-11-agent-native-audit.md](./docs/audits/2026-06-11-agent-native-audit.md)

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
- `@emmassist-co/kb-mcp`
- `@emmassist-co/kb-cli`
- `@emmassist-co/kb-flue-adapter`

These packages form the Cloudflare-first product spine for public consumers, including the Flue runtime command surface.

Not yet in the staged public package set:

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
- [docs/cloudflare-agent-setup.md](./docs/cloudflare-agent-setup.md)

## Architecture

Current package boundaries already reflect the intended shape:

- `packages/kb-core`: knowledge types, markdown/source parsing, retrieval helpers, service orchestration
- `packages/kb-storage-file`: local file-backed store for development and local agent workspaces
- `packages/kb-storage-cloudflare`: canonical R2-backed state and Cloudflare runtime adapters
- `packages/kb-http`: canonical `GET`/`POST`/`PUT`/`DELETE` contract with both Node and Worker hosts
- `packages/kb-mcp`: Streamable HTTP MCP adapter over the same tenant-scoped Worker runtime and auth model
- `packages/kb-cli`: local operator CLI, daemon mode, HTTP client mode, and installable skills
- `packages/kb-flue-adapter`: published Flue runtime adapter with a structural command contract that survives Flue SDK export changes
- `packages/kb-autoresearch`: private package and repo-owned research tooling surface, not a staged public install target

## Cloudflare-First Deployment Shape

Production should bias toward:

- one deployment per tenant or customer boundary
- Worker-hosted `kb-http` surface
- Worker-hosted `kb-mcp` surface on the same tenant runtime
- canonical tenant state in Cloudflare-backed storage
- one shared-secret auth model across `/v1` and `/mcp` in v1
- automated verification against the deployed HTTP contract

Local daemon and file-backed flows remain important, but they support the production architecture instead of defining it.

For human authoring on top of a canonical Cloudflare deployment, the supported path is a tenant mirror plus semantic sync: humans edit `entities/*.md` and `sources/*.md`, the daemon compiles those edits into canonical KB mutations, and the mirror refreshes from canonical state after success. See `docs/operations/kb-obsidian-semantic-sync.md`.

## Verification

Core repo checks:

```bash
npm run build:public
npm run typecheck
npm test
npm run test:bench
./node_modules/.bin/tsx scripts/kb-verify.ts --mode all
npm run smoke:kb-mcp -- --tenant-id demo-tenant
```

Protected Cloudflare host recheck:

```bash
KB_BASE_URL=https://YOUR-KB-HOST \
KB_API_TOKEN=replace-me-with-a-secret \
npx kb-local cloudflare verify --tenant-id demo-tenant
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
- `gbrain-evals-upstream` is the external-reference retrieval benchmark.
  In this repo, that means the literal upstream `gbrain-evals` harness run side-by-side against real `gbrain` and our KB on the public `world-v1` benchmark.
  Local reporting uses the same precision denominator as upstream GBrain: `hits / returned_docs`, not `hits / 5`.
  If the runner, corpus, query set, or metric semantics differ, it is not an apples-to-apples GBrain comparison.
- `gbrain-evals` synthetic heldout is the anti-overfitting diagnostic rail.
  It uses the local adapter snapshot runner on the vendored synthetic query set and exists to reject benchmark-shaped wins that do not survive wording or answer-surface variation.
- `gbrain-world` is a faster local diagnostic rail.
  It uses the vendored `world-v1` corpus and the public relational contract, but it is not the final external claim.
- relation extraction assumptions are being pushed into workspace-configurable rule data in `packages/kb-core/src/relation-rules.json`.
  Page priors now declare their page families and allowed source surfaces in config rather than relying only on imperative guards in core code.
- `core-six` is the deterministic floor-raising suite.
  It covers retrieval, temporal behavior, identity, provenance, contradictions, and fuzzy recall without model-judge noise.

Current public benchmark posture:

| Rail | Role | Size | P@5 | R@5 | MRR@5 | nDCG@5 | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `core-six` | deterministic floor | `72 retrieval + 28 non-retrieval` | `30.0%` | `94.4%` | `93.1%` | `88.4%` | `pass` |
| `admin-world-v3 dev` | product-core optimize rail | `216 queries` | `41.5%` | `99.3%` | `98.7%` | `92.6%` | `floor reached` |
| `admin-world-v3 holdout` | product-core confirm rail | `72 queries` | `41.7%` | `99.3%` | `100.0%` | `93.6%` | `floor reached` |
| `gbrain-evals-upstream` | strict public external rail | `145 queries` | `76.6%` | `99.5%` | `n/a` | `n/a` | `real gbrain side-by-side` |
| `gbrain-evals` synthetic heldout | anti-overfitting rail | `47 queries` | `32.1%` | `88.3%` | `76.1%` | `77.4%` | `held-out improving` |
| `gbrain-world` | local diagnostic rail | `145 queries` | `35.6%` | `99.3%` | `100.0%` | `99.5%` | `diagnostic only` |

External reference, kept separate from our measured score:

| System | P@5 | R@5 |
| --- | ---: | ---: |
| `GBrain` real upstream adapter on the same run | `49.1%` | `97.9%` |
| `kb-upstream` on the same real upstream run | `76.6%` | `99.5%` |

- Latest deterministic scorecard: [`docs/benchmarks/kb-scorecard-latest.md`](./docs/benchmarks/kb-scorecard-latest.md)
  Current result: `core-six` passes `100%` of categories.
- Latest external-reference snapshot: `npm run eval:kb:gbrain-evals-upstream`
  Default command compares both systems on the real upstream harness.
  Current real side-by-side result: `gbrain P@5 49.1%, R@5 97.9%` versus `kb-upstream P@5 76.6%, R@5 99.5%`.
  For machine-only KB scoring, use `npm run eval:kb:gbrain-evals-upstream:kb`.
  The same-harness result now shows KB ahead on recall and `correctInTopK`, while still keeping a higher precision score under the upstream `hits / returned_docs` definition.
- Latest held-out anti-overfitting snapshot: `KB_GBRAIN_QUERY_SET=synthetic KB_GBRAIN_COMPACT=true node --import tsx/esm scripts/run-gbrain-evals-kb-adapter.ts`
  Current measured held-out result: `P@5 32.1%, R@5 88.3%, MRR 76.1%, nDCG 77.4%`.
  The latest kept change fixed the previously isolated `relationship-depth` miss without moving the real upstream rail.
- Latest local diagnostic snapshot: `npm run eval:kb:gbrain-world`
  Current measured KB score on the repo-local diagnostic rail: `P@5 35.6%`, `R@5 99.3%`, `MRR 100.0%`, `nDCG 99.5%`.

That means the repo is not claiming "we beat GBrain." It is claiming:

- the eval surface is explicit and public
- the product-core benchmark is separated from the external-reference benchmark
- the deterministic KB quality floor is visible and repeatable
- the external benchmark is the literal upstream GBrain harness with real `gbrain` and `kb-upstream` scored in the same runner
- the external-reference gap is measurable in the README instead of hidden in internal notes

Release policy:

- optimize on `admin-world-v3 dev`
- confirm on `admin-world-v3 holdout`
- block regressions on `core-six dev` and `core-six holdout`
- require both `admin-world-v3 dev` and `admin-world-v3 holdout` to run in CI verification
- run the literal upstream `gbrain-evals` harness as the public external reference rail
- keep the synthetic held-out rail green enough to avoid accepting benchmark-shaped regressions
- keep `gbrain-world` as a faster local diagnostic rail, not the final external claim
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
