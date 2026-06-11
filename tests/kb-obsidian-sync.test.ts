import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSemanticMirrorRecord } from '../packages/kb-cli/src/semantic-sync/diff.js';
import { compileSemanticMirrorDiff } from '../packages/kb-cli/src/semantic-sync/compile.js';
import { applySemanticMutationPlan } from '../packages/kb-cli/src/semantic-sync/apply.js';
import { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { FileKnowledgeStore } from '../packages/kb-storage-file/src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('entity markdown edits produce structured field and timeline diffs', () => {
  const baseline = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
handles: []
tags:
  - billing
status:
owners:
  - finance
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing.

## Open Questions

- Who approves credits?

## Timeline

- 2026-06-01: Contract signed.

## Sources
`;

  const edited = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
  - Acme Corp
handles: []
tags:
  - billing
  - obsidian
status:
owners:
  - finance
  - ops
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing and vendor tooling.

## Open Questions

- Who approves credits?

## Timeline

- 2026-06-01: Contract signed.
- 2026-06-11: Human updated ownership notes.

## Sources
`;

  const result = diffSemanticMirrorRecord({
    path: 'entities/vendor-acme.md',
    baselineMarkdown: baseline,
    editedMarkdown: edited,
    canonicalMarkdown: baseline
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.recordKind, 'entity');
  assert.deepEqual(result.diff.changedMetaFields.sort(), ['aliases', 'owners', 'tags']);
  assert.equal(result.diff.currentTruthChanged, true);
  assert.deepEqual(result.diff.timeline, {
    state: 'additive',
    added: ['2026-06-11: Human updated ownership notes.'],
    removed: []
  });
});

test('source markdown edits classify summary content and citation changes', () => {
  const baseline = `---
id: src_vendor_note
tenantId: acme
kind: note
title: Vendor note
url:
authors: []
tags: []
linkedEntities: []
createdAt: 2026-06-10T10:00:00.000Z
rawSourceRef:
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Summary

Original summary.

## Content

Original content.

## Citations

- email-1
`;

  const edited = `---
id: src_vendor_note
tenantId: acme
kind: note
title: Vendor note
url:
authors: []
tags: []
linkedEntities:
  - vendor-acme
createdAt: 2026-06-10T10:00:00.000Z
rawSourceRef:
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Summary

Updated summary.

## Content

Updated content with more detail.

## Citations

- email-1
- slack-thread-2
`;

  const result = diffSemanticMirrorRecord({
    path: 'sources/src_vendor_note.md',
    baselineMarkdown: baseline,
    editedMarkdown: edited,
    canonicalMarkdown: baseline
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.recordKind, 'source');
  assert.deepEqual(result.diff.changedMetaFields, ['linkedEntities']);
  assert.equal(result.diff.summaryChanged, true);
  assert.equal(result.diff.contentChanged, true);
  assert.deepEqual(result.diff.citations, {
    state: 'additive',
    added: ['slack-thread-2'],
    removed: []
  });
});

test('semantic compiler maps safe entity edits onto record plus annotate commands', () => {
  const baseline = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
handles: []
tags:
  - billing
status:
owners:
  - finance
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing.

## Open Questions

- Who approves credits?

## Timeline

- 2026-06-01: Contract signed.

## Sources
`;
  const edited = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
  - Acme Corp
handles: []
tags:
  - billing
status:
owners:
  - finance
  - ops
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing and vendor tooling.

## Open Questions

- Who approves credits?

## Timeline

- 2026-06-01: Contract signed.
- 2026-06-11: Human updated ownership notes.

## Sources
`;

  const plan = compileSemanticMirrorDiff(diffSemanticMirrorRecord({
    path: 'entities/vendor-acme.md',
    baselineMarkdown: baseline,
    editedMarkdown: edited,
    canonicalMarkdown: baseline
  }));

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.commands, [
    {
      kind: 'record',
      payload: {
        entity: {
          id: 'vendor-acme',
          kind: 'vendor',
          title: 'Acme',
          aliases: ['Acme Corp'],
          owners: ['ops'],
          currentTruth: 'Acme owns billing and vendor tooling.'
        }
      }
    },
    {
      kind: 'annotate',
      payload: {
        entityIds: ['vendor-acme'],
        summary: 'Human updated ownership notes.',
        effectiveAt: '2026-06-11T00:00:00.000Z'
      }
    }
  ]);
});

test('semantic compiler uses exact source upsert for supported source markdown edits', () => {
  const baseline = `---
id: src_vendor_note
tenantId: acme
kind: note
title: Vendor note
url:
authors: []
tags: []
linkedEntities: []
createdAt: 2026-06-10T10:00:00.000Z
rawSourceRef:
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Summary

Original summary.

## Content

Original content.

## Citations

- email-1
`;
  const edited = `---
id: src_vendor_note
tenantId: acme
kind: note
title: Vendor note
url:
authors: []
tags:
  - vendor
linkedEntities:
  - vendor-acme
createdAt: 2026-06-10T10:00:00.000Z
rawSourceRef:
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Summary

Updated summary.

## Content

Updated content with more detail.

## Citations

- email-1
- slack-thread-2
`;

  const plan = compileSemanticMirrorDiff(diffSemanticMirrorRecord({
    path: 'sources/src_vendor_note.md',
    baselineMarkdown: baseline,
    editedMarkdown: edited,
    canonicalMarkdown: baseline
  }));

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.commands, [
    {
      kind: 'record-source',
      payload: {
        source: {
          id: 'src_vendor_note',
          kind: 'note',
          title: 'Vendor note',
          url: undefined,
          authors: [],
          tags: ['vendor'],
          linkedEntities: ['vendor-acme'],
          createdAt: '2026-06-10T10:00:00.000Z',
          summary: 'Updated summary.',
          content: 'Updated content with more detail.',
          citations: ['email-1', 'slack-thread-2'],
          rawSourceRef: undefined,
          supersedes: [],
          freshnessStatus: undefined,
          lastReviewedAt: undefined
        }
      }
    }
  ]);
});

test('semantic compiler rejects destructive entity rewrites before canonical mutation', () => {
  const baseline = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
  - Acme Corp
handles: []
tags: []
status:
owners: []
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing.

## Open Questions

## Timeline

## Sources
`;
  const edited = baseline.replace('  - Acme Corp\n', '');
  const plan = compileSemanticMirrorDiff(diffSemanticMirrorRecord({
    path: 'entities/vendor-acme.md',
    baselineMarkdown: baseline,
    editedMarkdown: edited,
    canonicalMarkdown: baseline
  }));

  assert.deepEqual(plan, {
    ok: false,
    path: 'entities/vendor-acme.md',
    code: 'destructive_edit',
    message: 'Entity edit requires exact rewrite semantics: entities/vendor-acme.md',
    issues: ['aliases removed or reordered existing entries']
  });
});

test('semantic apply executes compiled commands through canonical mutation semantics', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'kb-obsidian-semantic-'));
  try {
    const service = new KnowledgeBaseService(
      'acme',
      {
        enabled: true,
        mode: 'basic',
        writePolicy: 'mixed',
        persistence: {
          backend: 'file',
          cacheRefreshPolicy: 'none',
          rootDir
        },
        ingest: {
          agentTurns: false,
          userCorrections: false,
          workspaceSignals: false,
          externalResearch: false
        }
      },
      new FileKnowledgeStore(rootDir, 'basic')
    );

    await service.record({
      entity: {
        id: 'vendor-acme',
        kind: 'vendor',
        title: 'Acme',
        aliases: ['ACME'],
        owners: ['finance'],
        currentTruth: 'Acme owns billing.',
        timeline: ['2026-06-01: Contract signed.']
      }
    });

    const baseline = await service.get('vendor-acme');
    const edited = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases:
  - ACME
  - Acme Corp
handles: []
tags: []
status:
owners:
  - finance
  - ops
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing and vendor tooling.

## Open Questions

## Timeline

- 2026-06-01: Contract signed.
- 2026-06-11: Human updated ownership notes.

## Sources
`;
    const plan = compileSemanticMirrorDiff(diffSemanticMirrorRecord({
      path: 'entities/vendor-acme.md',
      baselineMarkdown: baseline.markdown,
      editedMarkdown: edited,
      canonicalMarkdown: baseline.markdown
    }));
    assert.equal(plan.ok, true);
    if (!plan.ok) return;

    const result = await applySemanticMutationPlan(service, plan);
    assert.deepEqual(result.entityIds, ['vendor-acme']);
    assert.equal(result.eventIds.length, 1);

    const next = await service.get('vendor-acme');
    assert.equal(next.kind, 'entity');
    if (next.kind !== 'entity') return;
    assert.equal(next.parsed.currentTruth, 'Acme owns billing and vendor tooling.');
    assert.deepEqual(next.parsed.meta.aliases, ['ACME', 'Acme Corp']);
    assert.deepEqual(next.parsed.meta.owners, ['finance', 'ops']);
    assert.deepEqual(next.parsed.timeline, [
      '2026-06-01: Contract signed.',
      '2026-06-11: Human updated ownership notes.'
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('semantic diff fails closed when required frontmatter is missing', () => {
  const result = diffSemanticMirrorRecord({
    path: 'entities/vendor-acme.md',
    baselineMarkdown: null,
    editedMarkdown: '## Current Truth\n\nBroken document.\n'
  });

  assert.deepEqual(result, {
    ok: false,
    path: 'entities/vendor-acme.md',
    code: 'parse_error',
    message: 'Markdown document is missing YAML frontmatter.'
  });
});

test('semantic diff rejects remote drift before parsing edits', () => {
  const baseline = `---
id: vendor-acme
tenantId: acme
kind: vendor
title: Acme
aliases: []
handles: []
tags: []
status:
owners: []
sources: []
updatedAt: 2026-06-11T10:00:00.000Z
confidence: medium
supersedes: []
freshnessStatus:
lastReviewedAt:
---

## Current Truth

Acme owns billing.

## Open Questions

## Timeline

## Sources
`;

  const canonical = baseline.replace('Acme owns billing.', 'Acme owns billing and invoicing.');
  const result = diffSemanticMirrorRecord({
    path: 'entities/vendor-acme.md',
    baselineMarkdown: baseline,
    editedMarkdown: baseline,
    canonicalMarkdown: canonical
  });

  assert.deepEqual(result, {
    ok: false,
    path: 'entities/vendor-acme.md',
    code: 'remote_drift',
    message: 'Canonical record changed since last sync: entities/vendor-acme.md'
  });
});
