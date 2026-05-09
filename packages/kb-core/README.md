# `@emmassist/kb-core`

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

- `@emmassist/kb-core`
- `@emmassist/kb-core/service`
- `@emmassist/kb-core/store`
- `@emmassist/kb-core/documents`
- `@emmassist/kb-core/bm25`
- `@emmassist/kb-core/relations`
- `@emmassist/kb-core/snapshot-store`

## Typical use

```ts
import { KnowledgeBaseService } from '@emmassist/kb-core';
```

Pair it with:

- `@emmassist/kb-storage-file` for local file-backed use
- `@emmassist/kb-storage-cloudflare` for deployed Cloudflare-backed use

