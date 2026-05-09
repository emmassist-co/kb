---
name: kb-write
version: 2.0.0
description: "Safe KB write workflow for remember, record, relate, annotate, validate, and cleanup without fragile inline JSON."
metadata:
  openclaw:
    category: "company"
    cliHelp: "kb help"
---

# KB Write

Use this when the task is to store, correct, structure, or clean up durable company knowledge through `kb`.

## Fast Path

```bash
kb help
kb schema remember
kb schema record
kb schema relate
kb schema annotate
```

## Preferred Write Pattern

Prefer file-backed or stdin JSON:

```bash
printf '%s\n' '{"intent":"fact_update","summary":"..."}' | kb remember --json -
kb record --json @payload.json
kb relate --json @payload.json
kb annotate --json @payload.json
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

- Use `kb remember` for facts, sources, corrections, and narrative evidence capture.
- Use `kb record` for canonical structured entities.
- Use `kb relate` for explicit relation edges between existing entities.
- Use `kb annotate` for timeline or provenance updates on existing entities.
- Use `kb query-relations` for relation-shaped questions.
- Use `kb delete --id ...` to clean up bad test entities or accidental writes.

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
- Run `kb links --id ENTITY_ID` or `kb traverse --id ENTITY_ID --explicit-only` to verify explicit edges.
- Default to `kb relate` for explicit edges. Only use `record.relations[]` when you are already creating or rewriting the entity in the same payload.
- Do not use `kb annotate` to create relation edges.
- Use `kb delete --id ENTITY_ID` for cleanup of test entities.
- Use `kb record-batch` and `kb annotate-batch` when applying many structured changes.

## Working Pattern

1. Search or inspect first if the fact may already exist.
2. Use `kb schema <command>` if the payload shape is unclear.
3. Validate before writing when using files, batches, or nested arrays.
4. Prefer `record` for structured entities and `remember` for evidence or corrections.
5. Verify explicit edges after writing instead of assuming they surfaced correctly.
