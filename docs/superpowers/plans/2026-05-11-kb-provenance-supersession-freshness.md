# KB Provenance, Supersession, and Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add narrowly-scoped metadata for source provenance, correction chains, and freshness state to `kb`, with behavior enforced by tests and `doctor`, without making common agent writes harder.

**Architecture:** Extend the existing typed entity/source document model instead of introducing a generic metadata system. Keep the first pass limited to fields that improve current KB correctness: immutable raw source pointers, one canonical supersession field, and lightweight freshness metadata that `doctor` can validate. All additions remain optional. Do not change retrieval behavior in this pass unless a failing test proves a clear benefit.

**Tech Stack:** TypeScript, Node test runner (`tsx --test`), markdown/YAML document rendering in `kb-core`, file/http/cli surfaces in the KB monorepo

---

## File Map

**Primary implementation files**
- Modify: `packages/kb-core/src/types.ts`
- Modify: `packages/kb-core/src/documents.ts`
- Modify: `packages/kb-core/src/service.ts`

**Potentially touched surface-validation files**
- Modify: `packages/kb-cli/src/index.ts`
- Modify: `packages/kb-http/src/server.ts`

**Primary tests**
- Modify: `tests/kb.test.ts`
- Modify: `tests/kb-cli.test.ts`
- Modify: `tests/kb-http.test.ts`

**Plan assumptions**
- Keep old markdown documents readable without requiring migration.
- Do not add generic future-wiki metadata such as `research_gaps` or `coverage_scope`.
- Do not change search ranking in this plan.

## Agent Ergonomics Constraints

- New metadata must be optional.
- Existing minimal `remember`, `record`, `annotate`, and `relate` payloads must keep working unchanged.
- Avoid fields that require agents to maintain mirrored state manually.
- Prefer one canonical write field over pairs of fields that can drift.
- No new retrieval-time obligations for agents in this pass.
- If a field cannot be added without increasing common write complexity, cut it from this pass.

## Proposed Schema

**Source-level additions**
- `meta.rawSourceRef?: string`
- `meta.supersedes?: string[]`
- `meta.freshnessStatus?: 'fresh' | 'needs_review' | 'stale'`
- `meta.lastReviewedAt?: string`

**Entity-level additions**
- `meta.supersedes?: string[]`
- `meta.freshnessStatus?: 'fresh' | 'needs_review' | 'stale'`
- `meta.lastReviewedAt?: string`

**Behavior rules for this pass**
- `rawSourceRef` is an immutable pointer to the original raw artifact or canonical raw URL.
- `supersedes` is the only canonical write-facing supersession field in this pass.
- `freshnessStatus='fresh'` requires `lastReviewedAt`.
- `doctor` should flag:
  - `supersedes` target missing
  - simple supersession cycles
  - `fresh` without `lastReviewedAt`
- `doctor` should not invent staleness heuristics beyond what the tests define.

### Task 1: Add Document Round-Trip Coverage First

**Files:**
- Modify: `tests/kb.test.ts`
- Modify: `packages/kb-core/src/types.ts`
- Modify: `packages/kb-core/src/documents.ts`

- [ ] **Step 1: Write the failing entity round-trip test**

Add a new test near the existing markdown round-trip tests in `tests/kb.test.ts`:

```ts
test('entity markdown round-trips supersession and freshness metadata', () => {
  const entity = createEmptyEntity({
    id: 'vendor-stripe',
    tenantId: 'acme',
    kind: 'vendor',
    title: 'Stripe',
    currentTruth: 'Stripe handles payments.',
    supersedes: ['vendor-stripe-legacy'],
    freshnessStatus: 'fresh',
    lastReviewedAt: '2026-05-10T00:00:00.000Z'
  });

  const markdown = renderEntityDocument(entity);
  const parsed = parseEntityDocument(markdown);

  assert.deepEqual(parsed.meta.supersedes, ['vendor-stripe-legacy']);
  assert.equal(parsed.meta.freshnessStatus, 'fresh');
  assert.equal(parsed.meta.lastReviewedAt, '2026-05-10T00:00:00.000Z');
});
```

- [ ] **Step 2: Write the failing source round-trip test**

Add a second test in `tests/kb.test.ts`:

```ts
test('source markdown round-trips raw source provenance and review metadata', () => {
  const source = createSourceDocument({
    id: 'src_1',
    tenantId: 'acme',
    kind: 'research',
    title: 'Vendor note',
    rawSourceRef: 'raw://drive/vendors/stripe-note.pdf',
    supersedes: ['src_legacy'],
    freshnessStatus: 'needs_review',
    lastReviewedAt: '2026-05-09T00:00:00.000Z',
    summary: 'Billing note',
    content: 'Finance confirmed billing@stripe.com.'
  });

  const markdown = renderSourceDocument(source);
  const parsed = parseSourceDocument(markdown);

  assert.equal(parsed.meta.rawSourceRef, 'raw://drive/vendors/stripe-note.pdf');
  assert.deepEqual(parsed.meta.supersedes, ['src_legacy']);
  assert.equal(parsed.meta.freshnessStatus, 'needs_review');
  assert.equal(parsed.meta.lastReviewedAt, '2026-05-09T00:00:00.000Z');
});
```

- [ ] **Step 3: Run the targeted tests and confirm failure**

Run:

```bash
cd kb && npx tsx --test tests/kb.test.ts
```

Expected:
- FAIL with TypeScript/runtime complaints about unknown properties such as `supersedes`, `freshnessStatus`, or `rawSourceRef`

- [ ] **Step 4: Add the new type fields**

Update `packages/kb-core/src/types.ts`:
- extend `EntityFrontmatter`
- extend `SourceFrontmatter`
- add `KnowledgeFreshnessStatus` union type if helpful

Keep the additions optional.

- [ ] **Step 5: Implement minimal document create/render/parse support**

Update `packages/kb-core/src/documents.ts`:
- accept the new fields in `createEmptyEntity`
- accept the new fields in `createSourceDocument`
- include them in YAML frontmatter output
- parse them back in `normalizeEntityFrontmatter` / `normalizeSourceFrontmatter`

Do not add validation logic yet beyond parse/render support.

- [ ] **Step 6: Run the targeted tests and confirm pass**

Run:

```bash
cd kb && npx tsx --test tests/kb.test.ts
```

Expected:
- PASS for the new round-trip tests

- [ ] **Step 7: Commit**

```bash
git add kb/tests/kb.test.ts kb/packages/kb-core/src/types.ts kb/packages/kb-core/src/documents.ts
git commit -m "feat: add kb provenance and freshness document fields"
```

### Task 2: Add Write-Path Tests for Service Persistence

**Files:**
- Modify: `tests/kb.test.ts`
- Modify: `packages/kb-core/src/service.ts`
- Modify: `packages/kb-core/src/documents.ts`

- [ ] **Step 1: Write the failing `remember` persistence test**

Add a new test in `tests/kb.test.ts` using the local temp-root service pattern already used for `doctor` tests:

```ts
test('kb remember persists raw source ref and source freshness metadata', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-remember-metadata-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.remember({
      intent: 'source_capture',
      summary: 'Captured vendor note.',
      content: 'Finance confirmed billing ownership.',
      source: {
        id: 'src_1',
        kind: 'research',
        title: 'Vendor note',
        rawSourceRef: 'raw://drive/vendors/stripe-note.pdf'
      },
      freshnessStatus: 'needs_review',
      lastReviewedAt: '2026-05-10T00:00:00.000Z'
    });

    const source = await service.get('src_1');
    assert.equal(source.kind, 'source');
    assert.equal(source.parsed.meta.rawSourceRef, 'raw://drive/vendors/stripe-note.pdf');
    assert.equal(source.parsed.meta.freshnessStatus, 'needs_review');
    assert.equal(source.parsed.meta.lastReviewedAt, '2026-05-10T00:00:00.000Z');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
```

If current command/service input shapes make this exact test awkward, adjust the payload shape, but keep the behavior target the same.

- [ ] **Step 2: Write the failing `record` persistence test**

Add a test:

```ts
test('kb record persists entity supersession and freshness metadata', async () => {
  const store = new SnapshotKnowledgeStore(createEmptyPersistedKnowledgeState('basic'));
  const service = new KnowledgeBaseService(
    'acme',
    {
      enabled: true,
      mode: 'basic',
      writePolicy: 'mixed',
      persistence: { backend: 'file', cacheRefreshPolicy: 'none', rootDir: '.kb' },
      ingest: {
        agentTurns: false,
        userCorrections: false,
        workspaceSignals: false,
        externalResearch: false
      }
    },
    store
  );

  await service.record({
    entity: {
      id: 'vendor-stripe',
      kind: 'vendor',
      title: 'Stripe',
      currentTruth: 'Stripe handles billing.',
      supersedes: ['vendor-stripe-legacy'],
      freshnessStatus: 'fresh',
      lastReviewedAt: '2026-05-10T00:00:00.000Z'
    }
  });

  const record = await service.get('vendor-stripe');
  assert.equal(record.kind, 'entity');
  assert.deepEqual(record.parsed.meta.supersedes, ['vendor-stripe-legacy']);
  assert.equal(record.parsed.meta.freshnessStatus, 'fresh');
  assert.equal(record.parsed.meta.lastReviewedAt, '2026-05-10T00:00:00.000Z');
});
```

- [ ] **Step 3: Run the targeted tests and confirm failure**

Run:

```bash
cd kb && npx tsx --test tests/kb.test.ts
```

Expected:
- FAIL because the service input types and write paths do not yet persist the new fields

- [ ] **Step 4: Extend service input types and write paths minimally**

Update `packages/kb-core/src/service.ts`:
- extend `remember` input shape for source metadata and, if needed, source-level freshness
- extend `record` input shape for entity/source metadata
- propagate the new fields through:
  - `upsertEntityDocument`
  - `upsertSourceDocument`
  - any direct create helpers that bypass them

Rules:
- only add fields the tests require
- preserve merge semantics for existing arrays
- do not add mirrored supersession fields in this pass

- [ ] **Step 5: Run the targeted tests and confirm pass**

Run:

```bash
cd kb && npx tsx --test tests/kb.test.ts
```

Expected:
- PASS for the new persistence tests

- [ ] **Step 6: Commit**

```bash
git add kb/tests/kb.test.ts kb/packages/kb-core/src/service.ts
git commit -m "feat: persist kb provenance and supersession metadata"
```

### Task 3: Add `doctor` Enforcement Tests Before Logic

**Files:**
- Modify: `tests/kb.test.ts`
- Modify: `packages/kb-core/src/service.ts`

- [ ] **Step 1: Write the failing missing-supersession-target test**

Add:

```ts
test('kb doctor reports missing supersession targets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-doctor-supersedes-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.record({
      entity: {
        id: 'vendor-stripe',
        kind: 'vendor',
        title: 'Stripe',
        supersedes: ['vendor-stripe-legacy']
      }
    });

    const doctor = await service.doctor();
    assert.equal(doctor.ok, false);
    assert.match(doctor.issues.join('\n'), /missing supersession target/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
```

- [ ] **Step 2: Write the failing supersession-cycle test**

Add:

```ts
test('kb doctor reports supersession cycles', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-doctor-supersession-cycle-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.record({
      entity: {
        id: 'vendor-a',
        kind: 'vendor',
        title: 'Vendor A',
        supersedes: ['vendor-b']
      }
    });
    await service.record({
      entity: {
        id: 'vendor-b',
        kind: 'vendor',
        title: 'Vendor B',
        supersedes: ['vendor-a']
      }
    });

    const doctor = await service.doctor();
    assert.equal(doctor.ok, false);
    assert.match(doctor.issues.join('\n'), /supersession cycle/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
```

- [ ] **Step 3: Write the failing freshness validation test**

Add:

```ts
test('kb doctor reports fresh records without review timestamp', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-doctor-freshness-'));
  const env = {
    KB_ROOT_DIR: root,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const service = createKnowledgeBaseService(env, 'workspace-template', resolveProductConfig(env).knowledgeBase);

  try {
    await service.record({
      entity: {
        id: 'vendor-stripe',
        kind: 'vendor',
        title: 'Stripe',
        freshnessStatus: 'fresh'
      }
    });

    const doctor = await service.doctor();
    assert.equal(doctor.ok, false);
    assert.match(doctor.issues.join('\n'), /fresh.*lastReviewedAt/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
```

- [ ] **Step 4: Run the targeted tests and confirm failure**

Run:

```bash
cd kb && npx tsx --test tests/kb.test.ts
```

Expected:
- FAIL because `doctor` does not yet inspect the new metadata

- [ ] **Step 5: Implement narrow `doctor` enforcement**

Update `packages/kb-core/src/service.ts`:
- add helper logic inside `doctor()` or small private helpers for:
  - missing supersession targets across entities and sources
  - one-hop and simple graph cycle detection
  - `freshnessStatus === 'fresh'` without `lastReviewedAt`

Keep the checks deterministic and low-complexity.

- [ ] **Step 6: Run the targeted tests and confirm pass**

Run:

```bash
cd kb && npx tsx --test tests/kb.test.ts
```

Expected:
- PASS for all new `doctor` validations

- [ ] **Step 7: Commit**

```bash
git add kb/tests/kb.test.ts kb/packages/kb-core/src/service.ts
git commit -m "feat: validate kb supersession and freshness metadata"
```

### Task 4: Update CLI Validation Surface Only If Needed

**Files:**
- Modify: `tests/kb-cli.test.ts`
- Modify: `packages/kb-cli/src/index.ts`

- [ ] **Step 1: Check whether current CLI coercion/validation rejects the new fields**

Run:

```bash
cd kb && npx tsx --test tests/kb-cli.test.ts
```

If all tests pass and manual schema inspection shows the new optional fields are accepted already, skip to Task 5.

- [ ] **Step 2: Write the failing CLI schema/validate test**

If needed, add a test like:

```ts
test('kb cli validate accepts provenance and freshness metadata on record payloads', async () => {
  const result = await runKnowledgeBaseCli([
    'validate',
    'record',
    '--json',
    '{"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe","rawSourceRef":"raw://ignored","supersedes":["vendor-stripe-legacy"],"freshnessStatus":"fresh","lastReviewedAt":"2026-05-10T00:00:00.000Z"}}'
  ]);

  assert.equal(result.exitCode, 0);
});
```

Adapt the exact payload to the final accepted schema. Do not add `rawSourceRef` to entities if the design limits it to sources.

- [ ] **Step 3: Implement minimal CLI schema changes**

Update `packages/kb-cli/src/index.ts`:
- schema output
- payload validation
- coercion helpers

Only expose fields that the service now accepts.

- [ ] **Step 4: Run the targeted CLI tests**

Run:

```bash
cd kb && npx tsx --test tests/kb-cli.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add kb/tests/kb-cli.test.ts kb/packages/kb-cli/src/index.ts
git commit -m "feat: expose kb provenance metadata in cli validation"
```

### Task 5: Update HTTP Contract Tests Only If Needed

**Files:**
- Modify: `tests/kb-http.test.ts`
- Modify: `packages/kb-http/src/server.ts`

- [ ] **Step 1: Confirm whether HTTP route delegation needs changes**

Because the HTTP layer mostly passes request bodies through unchanged, this task may be a no-op.

Run:

```bash
cd kb && npx tsx --test tests/kb-http.test.ts
```

- [ ] **Step 2: Add or update a pass-through delegation test only if required**

If the body typing or route coverage blocks the new fields, add a test asserting `record` or `remember` passes the metadata through unchanged.

- [ ] **Step 3: Apply the minimal HTTP typing update**

Only change `packages/kb-http/src/server.ts` if type signatures require it.

- [ ] **Step 4: Re-run HTTP tests**

Run:

```bash
cd kb && npx tsx --test tests/kb-http.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add kb/tests/kb-http.test.ts kb/packages/kb-http/src/server.ts
git commit -m "chore: keep kb http contract aligned with metadata fields"
```

### Task 6: Full Verification and Trim Pass

**Files:**
- No required file changes

- [ ] **Step 1: Run focused KB tests**

```bash
cd kb && npx tsx --test tests/kb.test.ts tests/kb-cli.test.ts tests/kb-http.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run repo typecheck**

```bash
cd kb && npm run typecheck
```

Expected:
- PASS

- [ ] **Step 3: Run full test suite**

```bash
cd kb && npm test
```

Expected:
- PASS

- [ ] **Step 4: Reassess field usefulness before merge**

If any field exists but has no enforced behavior or no meaningful test value, remove it before finalizing.

- [ ] **Step 5: Final commit**

```bash
git add kb
git commit -m "feat: add kb provenance, supersession, and freshness safeguards"
```

## Notes for the Implementer

- Prefer source-level `rawSourceRef`; do not spread it to entities unless a concrete requirement appears.
- Keep `supersedes` as the only supersession write field in this pass.
- Do not invent age-based freshness thresholds in this plan. Add only the validations explicitly covered by tests.
- Backward compatibility means old docs with none of these fields must still parse cleanly.
- If CLI schema changes become noisy, keep the first pass at the service/document level and defer CLI richness to a follow-up.
- If a change makes typical agent payloads meaningfully longer, revert or defer it.
