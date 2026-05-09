# `@emmassist-co/kb-core`

Backend-neutral knowledge base semantics.

## Owns

- KB domain types
- document parsing/rendering
- BM25 and relation/query helpers
- `KnowledgeBaseService`
- store and snapshot interfaces

## Does not own

- Node filesystem APIs
- Flue runtime bindings
- Cloudflare request/runtime objects

## Main exports

- `@emmassist-co/kb-core`
- `@emmassist-co/kb-core/service`
- `@emmassist-co/kb-core/store`
- `@emmassist-co/kb-core/documents`
- `@emmassist-co/kb-core/bm25`
- `@emmassist-co/kb-core/relations`
- `@emmassist-co/kb-core/snapshot-store`

## Typical use

```ts
import { KnowledgeBaseService } from '@emmassist-co/kb-core';
```

Pair it with:

- `@emmassist-co/kb-storage-file` for local file-backed use
- `@emmassist-co/kb-storage-cloudflare` for deployed Cloudflare-backed use

