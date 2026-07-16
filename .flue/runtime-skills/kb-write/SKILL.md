---
name: kb-write
version: 2.1.0
description: "Safe trust-aware KB workflow for evidence reads, recall, proposals, remember, record, relate, annotate, validate, and cleanup without fragile inline JSON."
metadata:
  openclaw:
    category: "company"
    cliHelp: "kb help"
---

# KB Write

Use this when the task is to store, correct, structure, review, or clean up durable company knowledge through `kb` in a Flue runtime.

## Fast Path

```bash
kb help
kb help runtime
kb help operator
kb schema search
kb schema query-relations
kb schema remember
kb schema record
kb schema relate
kb schema annotate
```

## Trust-Aware Read Before Write

```bash
kb inspect
kb search --json '{"query":"billing owner","temporalFocus":"current"}'
kb query-relations --json '{"query":"owner of Stripe","mode":"graph-first-hybrid"}'
kb evidence --id vendor-stripe
kb recall --json '{"query":"billing owner","purpose":"pre-answer context"}'
kb debt
```

Search and relation results include `trust` envelopes. Treat caveats, unsupported current truth, stale/superseded status, and raw-evidence labels as part of the answer. `recall` is read-only; the Flue runtime decides if and when to inject it.

## Preferred Write Pattern

Prefer file-backed or stdin JSON:

```bash
printf '%s\n' '{"intent":"fact_update","summary":"..."}' | kb remember --json -
kb record --json @payload.json
kb relate --json @payload.json
kb annotate --json @payload.json
kb submit-proposal --json @proposal.json
```

For larger writes, validate before mutating:

```bash
kb validate remember --json @payload.json
kb validate record --json @payload.json
kb validate relate --json @payload.json
kb validate annotate --json @payload.json
```

Avoid large fragile inline JSON blobs when a file is practical.

## When To Use Which Command

- Use `kb search` before answering tenant-specific factual questions; inspect returned `trust` caveats.
- Use `kb query-relations` for relation-shaped questions.
- Use `kb evidence --id` when source support, decisions, supersession, or caveats matter.
- Use `kb recall` only for caller-triggered read-only trust-aware context bundles.
- Use `kb remember` for facts, sources, corrections, and raw/narrative evidence capture.
- Use `kb submit-proposal` when evidence suggests canonical truth should change but review is required.
- Use `kb record` for canonical structured entities when evidence and authorization are enough.
- Use `kb relate` for explicit relation edges between existing entities.
- Use `kb annotate` for timeline or provenance updates on existing entities.
- Use `kb delete --id ...` to clean up bad test entities or accidental writes.

Treat these as the default agent verbs. Do not use low-level event, draft, source-capture, relation-repair, review approval, proposal apply, or conflict commands unless you are explicitly doing KB repair or operator cleanup.

Use `kb help runtime` as the compact contract for the current tenant, backend, canonicality, trust substrate version, and write discipline.

## Proposal Discipline

Raw notes and proposals are not canonical truth. If the agent lacks authority or evidence is ambiguous:

```bash
kb submit-proposal --json @proposal.json
kb proposals
kb get-proposal --id proposal_123
```

Only an explicit operator/review flow should approve and apply:

```bash
kb review-proposal --id proposal_123 --json '{"status":"approved","reviewer":"operator"}'
kb apply-proposal --id proposal_123 --applied-by operator
```

## Minimal Patterns

Fact or source capture:

```bash
printf '%s\n' '{"intent":"source_capture","summary":"Captured a reference source for the vendor handbook.","source":{"title":"Vendor handbook","url":"https://example.com/vendor-handbook","kind":"research"}}' | kb remember --json -
```

Canonical entity write:

```bash
kb record --json @payload.json
```

With a payload like:

```json
{
  "entity": {
    "id": "company-acme",
    "kind": "company",
    "title": "Acme",
    "currentTruth": "Acme runs billing operations."
  },
  "relatedEntities": [
    {
      "id": "person-alex",
      "kind": "person",
      "title": "Alex"
    }
  ]
}
```

Standalone explicit edge:

```bash
kb relate --json @relation.json
```

With a payload like:

```json
{
  "type": "founder_of",
  "fromId": "person-alex",
  "toId": "company-acme"
}
```

Timeline update:

```bash
printf '%s\n' '{"entity_ids":["company-acme"],"summary":"2026-05-09: Confirmed founder edge.","effective_at":"2026-05-09T00:00:00.000Z"}' | kb annotate --json -
```

## Verification And Cleanup

- Run `kb validate ...` before a write when the payload is non-trivial.
- Run `kb evidence --id ENTITY_ID` to verify source support and current-truth caveats.
- Run `kb links --id ENTITY_ID` or `kb traverse --id ENTITY_ID --explicit-only` to verify explicit edges.
- Run `kb debt` or `kb doctor` to inspect unsupported, stale, dangling, or review-needed state.
- Default to `kb relate` for explicit edges. Only use `record.relations[]` when you are already creating or rewriting the entity in the same payload.
- Do not use `kb annotate` to create relation edges.
- Use `kb delete --id ENTITY_ID` for cleanup of test entities.
- Use `kb record-batch` and `kb annotate-batch` when applying many structured changes.

## Working Pattern

1. Inspect/search/read first if the fact may already exist.
2. Use `kb evidence` when current truth needs source support.
3. Use `kb schema <command>` if the payload shape is unclear.
4. Validate before writing when using files, batches, or nested arrays.
5. Prefer `remember` for evidence/corrections, `submit-proposal` for review-needed changes, and `record` only for authorized canonical structure.
6. Verify explicit edges and trust caveats after writing instead of assuming they surfaced correctly.
