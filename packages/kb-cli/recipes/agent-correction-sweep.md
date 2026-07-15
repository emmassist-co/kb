# Agent Correction Sweep Recipe

## Goal

Help an external agent find user corrections or superseding evidence and ensure authorized KB state reflects them.

## When To Use

Use when a human says prior KB memory may be wrong, when an agent has a set of corrections to propagate, or when a review asks whether corrections were captured and reused.

## KB Read Commands

```bash
kb-local inspect
kb-local search --json '{"query":"correction"}'
kb-local search --json '{"query":"wrong OR corrected OR superseded"}'
kb-local get <id>
kb-local links --id <id>
kb-local traverse --id <id> --explicit-only
```

## Agent-Owned Thinking

The agent decides whether a correction supersedes current truth, which entities or relations are affected, and whether the evidence is strong enough to write. KB does not interpret or propagate corrections by itself.

## Safe Write Policy

- Capture the correction as evidence with `remember` when it is not already recorded.
- Use `record` to update canonical entity state only after reading the existing record.
- Use `relate` for corrected explicit edges.
- Use `annotate` to add provenance or timeline notes about the correction.
- Prefer proposal-only output if the correction conflicts with multiple records or needs human judgment.

## Validation

```bash
kb-local validate remember --json @correction.json
kb-local validate record --json @record.json
kb-local validate relate --json @relation.json
kb-local validate annotate --json @annotation.json
```

## Verification

```bash
kb-local get <id>
kb-local search --json '{"query":"corrected fact"}'
kb-local query-relations --json '{"query":"corrected relationship","mode":"graph-first-hybrid"}'
kb-local traverse --id <id> --explicit-only
```

## Worked Example

### Situation

A user says, "Stripe billing owner is Alex, not Sam," and asks the agent to make sure KB reflects the correction.

### Inspect

```bash
kb-local inspect
kb-local search --json '{"query":"Stripe billing owner"}'
kb-local get vendor-stripe
kb-local links --id vendor-stripe
```

### Agent Judgment

The agent decides outside KB that this is a direct user correction with high confidence and that the current owner edge should be superseded by an explicit Alex edge.

### Proposed Writes

```json
{
  "command": "remember",
  "payload": {
    "intent": "correction",
    "summary": "User corrected Stripe billing owner to Alex, not Sam.",
    "confidence": "high"
  }
}
```

```json
{
  "command": "relate",
  "payload": {
    "type": "owner_of",
    "fromId": "person-alex",
    "toId": "vendor-stripe",
    "confidence": 0.95
  }
}
```

### Validate

```bash
kb-local validate remember --json @correction.json
kb-local validate relate --json @relation.json
```

### Verify

```bash
kb-local query-relations --json '{"query":"owner of Stripe","mode":"graph-first-hybrid"}'
kb-local traverse --id person-alex --type owner_of --explicit-only
```

## Non-Goals

- No automatic correction propagation.
- No hidden overwrite of historical evidence.
- No KB-owned contradiction detection.
- No recipe run state in KB.
