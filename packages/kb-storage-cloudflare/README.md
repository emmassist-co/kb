# `@emmassist-co/kb-storage-cloudflare`

Cloudflare-specific KB persistence and runtime adapters.

Storage adapter architecture and authoring guidance: [../../docs/architecture/kb-storage-adapters.md](../../docs/architecture/kb-storage-adapters.md).

## Owns

- canonical R2 store helpers
- KB-owned Durable Object snapshot state core
- Cloudflare runtime detection helpers

## Expected bindings

- `KB_STATE`
- `KB_CANONICAL_R2`

## Notes

- This package is deployment-specific by design.
- Durable Object snapshot state is the write authority for deployed runtime calls.
- Canonical R2 state is the exported production snapshot, not a second mutable peer workspace.
- Protected deployed verification now covers the canonical `kb-http` contract through `/operators/kb-http/...`.
