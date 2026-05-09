# KB Extraction Status

## Standalone Now

The following surfaces already work from the extracted `emmassist/kb` monorepo:

- `@emmassist-co/kb-core`
- `@emmassist-co/kb-storage-file`
- `@emmassist-co/kb-http`
- `@emmassist-co/kb-cli`
- `@emmassist-co/kb-autoresearch` source tree copied into the repo

Verified locally:

- `npm run typecheck`
- `./node_modules/.bin/tsx --test tests/kb-cli.test.ts tests/kb-http.test.ts`
- `./node_modules/.bin/tsx scripts/kb-verify.ts --mode all`

## Remaining Coupling To `administrative`

### `kb-flue-adapter`

Still imports repo-local host code from `administrative`, including:

- product config resolution
- chat logging
- GWS formatting/parsing
- runtime KB service construction

This package needs a host adapter boundary so the KB repo owns the Flue-facing API but the consuming repo provides host-specific wiring.

### `kb-storage-cloudflare`

Still contains host-coupled state wiring via `state-cloudflare-do.ts`.

The Durable Object state implementation still depends on admin-agent-specific:

- direct admin-agent invocation
- env/model helpers
- ingest/runtime orchestration assumptions

This needs to be split into:

- KB-owned Durable Object state core
- host-provided agent/research/gate hooks

### KB Sync Tooling

`scripts/kb-r2-sync.ts` still depends on repo-local helpers from `administrative`.

The shared sync library should move into the KB repo and the script should be rewritten to depend only on KB-owned packages plus AWS/GitHub/Cloudflare auth inputs.

### Integration Tests

Some copied tests are actually host integration tests, not KB package tests. They still depend on:

- `src/lib/workspace.ts`
- `src/lib/product-config.ts`
- `src/lib/kb/service.ts`
- repo-local Cloudflare/runtime helpers

These should either:

- stay in `administrative`
- or be rewritten as true standalone package/integration tests

## Next Extraction Steps

1. Replace `kb-flue-adapter` direct imports with host-provided interfaces.
2. Extract KB-owned DO state logic from `state-cloudflare-do.ts`.
3. Move KB sync logic into the KB repo and rewrite `kb-r2-sync`.
4. Separate package tests from host integration tests.
5. Publish the standalone packages under `@emmassist-co/*`.
6. Switch `administrative` to consume the published packages.
