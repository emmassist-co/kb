# `@emmassist/kb-storage-file`

Local filesystem storage adapter for the KB.

## Owns

- `FileKnowledgeStore`
- file-backed persistence layout for local agents and local CLI use

## Typical use

```ts
import { KnowledgeBaseService } from '@emmassist/kb-core';
import { FileKnowledgeStore } from '@emmassist/kb-storage-file';

const service = new KnowledgeBaseService(tenantId, config, new FileKnowledgeStore(rootDir, config.mode));
```

## Notes

- This is the default backend for `kb-local` in in-process mode.
- Local smoke verification uses this adapter through `npm run verify:kb -- --mode all`.

