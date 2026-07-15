# Agent Relation Curation Recipe

## Goal

Help an external agent add or repair explicit relation edges when evidence supports the relationship.

## When To Use

Use when an agent has reviewed KB records or external evidence and needs to make relationship-shaped knowledge traversable.

## KB Read Commands

```bash
kb-local inspect
kb-local search --json '{"query":"..."}'
kb-local query-relations --json '{"query":"...","mode":"graph-first-hybrid"}'
kb-local get <id>
kb-local links --id <id>
kb-local traverse --id <id> --depth 1
kb-local schema relate
```

## Agent-Owned Thinking

The agent infers whether a relationship is true, current, historical, ambiguous, or unsupported. KB stores explicit edges and exposes graph reads; it does not suggest or decide edges by itself.

## Safe Write Policy

- Confirm both endpoint entities exist before `relate`.
- Use source-backed evidence when available.
- Use `remember` or `annotate` to preserve supporting evidence if it is not already present.
- Use `relate` for the explicit edge.
- Avoid writing inferred edges when evidence is weak; emit a proposal instead.

## Validation

```bash
kb-local validate relate --json @relation.json
kb-local validate remember --json @evidence.json
kb-local validate annotate --json @annotation.json
```

## Verification

```bash
kb-local links --id <from-id>
kb-local traverse --id <from-id> --type <relation-type> --explicit-only
kb-local query-relations --json '{"query":"relationship question","mode":"graph-first-hybrid"}'
```

## Non-Goals

- No KB-side relation suggestion engine.
- No automatic graph refinement.
- No relation writes through `annotate`.
- No operator-only relation replacement unless doing explicit repair.
