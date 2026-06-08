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

Now owns a KB-native Durable Object snapshot core in `packages/kb-storage-cloudflare/src/state-cloudflare-do.ts`.

What this package now owns:

- DO snapshot state as the write authority for deployed runtime calls
- async canonical export to tenant-scoped R2
- standalone rebuild / restore / reset behavior for canonical KB state
- persistence health reporting for the KB-owned Cloudflare contract

What remains intentionally outside this package:

- admin-agent-specific ingest, research, and gate orchestration
- host-specific env/model helpers
- consumer-specific runtime wiring on top of the KB state core

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
