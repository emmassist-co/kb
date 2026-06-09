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
