# KB Extraction Status

## Standalone Now

The following surfaces already work from the extracted `emmassist/kb` monorepo:

- `@emmassist-co/kb-core`
- `@emmassist-co/kb-storage-file`
- `@emmassist-co/kb-http`
- `@emmassist-co/kb-mcp`
- `@emmassist-co/kb-cli`
- `@emmassist-co/kb-flue-adapter`
- `@emmassist-co/kb-autoresearch` source tree copied into the repo

Verified locally:

- `npm run typecheck`
- `./node_modules/.bin/tsx --test tests/kb-cli.test.ts tests/kb-http.test.ts tests/kb-mcp.test.ts tests/kb-flue-adapter.test.ts`
- `./node_modules/.bin/tsx scripts/kb-verify.ts --mode all`

## Staged Public Package Set

The current staged public package set for open-source distribution is:

- `@emmassist-co/kb-core`
- `@emmassist-co/kb-storage-file`
- `@emmassist-co/kb-storage-cloudflare`
- `@emmassist-co/kb-http`
- `@emmassist-co/kb-mcp`
- `@emmassist-co/kb-cli`
- `@emmassist-co/kb-flue-adapter`

These packages define the public Cloudflare-first KB product spine, including the Flue runtime command boundary.

Deferred from the staged public package set:

- `@emmassist-co/kb-autoresearch`
  Remains private while its runtime, product, and packaging shape are narrowed.

## Remaining Coupling To `administrative`

### `kb-flue-adapter`

The package now owns the shared Flue-facing contract without importing repo-local host code or legacy Flue subpath exports. Consumers still provide host-specific runtime wiring, but the package boundary itself is now upstream-owned and publishable.

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

1. Keep downstream consumers on the published `kb-flue-adapter` contract instead of repo-local adapter forks.
2. Extract KB-owned DO state logic from `state-cloudflare-do.ts`.
3. Move KB sync logic into the KB repo and rewrite `kb-r2-sync`.
4. Separate package tests from host integration tests.
5. Publish the staged public package set under `@emmassist-co/*`.
6. Switch `administrative` to consume the published public packages where the consumer contract is now owned by `kb`.
