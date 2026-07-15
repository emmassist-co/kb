# Agent Maintenance Review Recipe

## Goal

Help an external agent review KB quality and produce safe proposals or authorized writes. KB supplies state and validation; the agent decides what needs attention.

## When To Use

Use when an operator asks an agent to review KB health, weak evidence, duplicate-looking entities, missing links, or stale-looking records.

## KB Read Commands

```bash
kb-local inspect
kb-local list
kb-local doctor
kb-local search --json '{"query":"..."}'
kb-local get <id>
kb-local links --id <id>
kb-local traverse --id <id> --depth 1
kb-local export
```

## Agent-Owned Thinking

The agent may inspect KB state and decide externally whether records appear stale, duplicated, contradictory, weakly sourced, or missing useful relation edges. KB does not make those judgments.

## Safe Write Policy

- Prefer proposal-only output for broad maintenance reviews.
- Use `remember` for review findings and corrections that have clear evidence.
- Use `record` only for well-supported canonical entity updates.
- Use `relate` only for explicit relation edges with evidence.
- Use `annotate` for timeline/provenance notes.
- Do not use operator repair commands unless the user explicitly requested repair.

## Validation

```bash
kb-local validate remember --json @remember.json
kb-local validate record --json @record.json
kb-local validate relate --json @relation.json
kb-local validate annotate --json @annotation.json
```

## Verification

After authorized writes, verify with targeted reads:

```bash
kb-local get <id>
kb-local search --json '{"query":"..."}'
kb-local query-relations --json '{"query":"...","mode":"graph-first-hybrid"}'
kb-local links --id <id>
kb-local doctor
```

## Non-Goals

- No autonomous schedule.
- No KB-owned maintenance worker.
- No KB-side duplicate detection, contradiction detection, truth regeneration, or recipe state.
