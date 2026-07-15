# Agent Stale Knowledge Review Recipe

## Goal

Help an external agent review whether KB current truth appears stale relative to newer evidence, without KB deciding staleness by itself.

## When To Use

Use when a human asks an agent to review old records, reconcile newer timeline notes, or check whether current truth still reflects available evidence.

## KB Read Commands

```bash
kb-local inspect
kb-local list
kb-local search --json '{"query":"..."}'
kb-local get <id>
kb-local links --id <id>
kb-local doctor
kb-local export
```

## Agent-Owned Thinking

The agent compares current truth, timeline/provenance, source dates, and user context. It decides whether knowledge is stale and what update is warranted. KB only exposes the records and accepts validated writes.

## Safe Write Policy

- Prefer proposal-only output for broad stale reviews.
- Use `annotate` when the right action is preserving newer provenance without rewriting canonical truth.
- Use `record` when evidence clearly supports a canonical current-truth update.
- Use `remember` for newly discovered evidence or corrections.
- Do not delete historical context just because it is old.

## Validation

```bash
kb-local validate annotate --json @annotation.json
kb-local validate record --json @record.json
kb-local validate remember --json @evidence.json
```

## Verification

```bash
kb-local get <id>
kb-local search --json '{"query":"updated current truth"}'
kb-local doctor
```

## Worked Example

### Situation

A human asks an agent to check whether the current truth for Acme support ownership still matches newer timeline notes.

### Inspect

```bash
kb-local inspect
kb-local search --json '{"query":"Acme support owner"}'
kb-local get company-acme
kb-local doctor
```

### Agent Judgment

The agent compares current truth with newer timeline evidence outside KB and decides that current truth should be updated only if the newer note is authoritative enough. KB does not decide staleness.

### Proposed Writes

```json
{
  "command": "annotate",
  "payload": {
    "entity_ids": ["company-acme"],
    "summary": "2026-07-15: Reviewed support ownership against newer timeline notes.",
    "provenance": "operator stale-review request"
  }
}
```

### Validate

```bash
kb-local validate annotate --json @annotation.json
```

### Verify

```bash
kb-local get company-acme
kb-local search --json '{"query":"Acme support ownership reviewed"}'
```

## Non-Goals

- No KB-side stale detector.
- No automatic truth regeneration.
- No scheduled refresh owned by KB.
- No recipe checkpoints in KB.
