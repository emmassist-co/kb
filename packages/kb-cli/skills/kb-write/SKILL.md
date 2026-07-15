---
name: kb-write
version: 2.0.0
description: "Safe KB write workflow for remember, record, relate, annotate, validate, and cleanup without fragile inline JSON."
---

# KB Write

Use this when the task is to store, correct, structure, or clean up durable knowledge through the KB CLI.

## Fast Path

```bash
kb help
kb help operator
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

Validate before mutating when the payload is non-trivial:

```bash
kb validate remember --json @payload.json
kb validate record --json @payload.json
kb validate relate --json @payload.json
kb validate annotate --json @payload.json
```

## Command Split

- Use `remember` for facts, sources, corrections, and narrative evidence capture.
- Use `record` for canonical structured entities.
- Use `relate` for explicit relation edges between existing entities.
- Use `annotate` for timeline or provenance updates on existing entities.
- Use `query-relations` for relation-shaped questions.
- Use `delete --id ...` to clean up bad test entities or accidental writes.

Treat these as the default agent verbs. Do not use low-level event, draft, source-capture, or relation-repair commands unless you are explicitly doing KB repair or operator cleanup.

In a deployed runtime, `kb help runtime` should be the compact contract for current workspace namespace, backend, canonicality, and write discipline.

## Minimal Patterns

Reference or fact capture:

```bash
printf '%s\n' '{"intent":"source_capture","summary":"Captured a reference source for the vendor handbook.","source":{"title":"Vendor handbook","url":"https://example.com/vendor-handbook","kind":"research"}}' | kb remember --json -
```

Structured entity write:

```bash
kb record --json @payload.json
```

Timeline update:

```bash
printf '%s\n' '{"entity_ids":["company-acme"],"summary":"2026-05-09: Confirmed founder edge.","effective_at":"2026-05-09T00:00:00.000Z"}' | kb annotate --json -
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

## Verification And Cleanup

- Run `schema <command>` if the shape is unclear.
- Run `validate <command>` before writes with nested arrays or batch files.
- Run `links --id ENTITY_ID` or `traverse --id ENTITY_ID --explicit-only` to verify explicit edges.
- Default to `relate` for explicit edges. Only use `record.relations[]` when you are already creating or rewriting the entity in the same payload.
- Do not use `annotate` to create relation edges.
- Use `record-batch` and `annotate-batch` for larger cleanups.
- If you truly need direct repair surfaces, discover them through `kb help operator` instead of treating them as part of the normal agent loop.

## Install

After installing `@emmassist-co/kb-cli`, prefer the package-local skill path:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-write
```

If the package is not installed yet, the GitHub source path is available as a fallback:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
```
