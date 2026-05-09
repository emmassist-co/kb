# `@emmassist-co/kb-storage-cloudflare`

Cloudflare-specific KB persistence and runtime adapters.

## Owns

- canonical R2 store helpers
- Durable Object state bindings
- Cloudflare runtime detection helpers

## Expected bindings

- `KB_STATE`
- `KB_CANONICAL_R2`

## Notes

- This package is deployment-specific by design.
- Protected deployed verification now covers the canonical `kb-http` contract through `/operators/kb-http/...`.

