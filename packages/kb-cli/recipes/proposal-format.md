# KB Agent Proposal Format

## Goal

Give external agents a reviewable handoff shape for proposed KB changes without creating a KB-owned proposal workflow engine.

Use this from [`README.md`](./README.md) or any agent recipe when a change needs review before mutation.

A proposal is a document or JSON object that an agent, human, or orchestrator can review. KB does not execute proposal objects. Every mutation in a proposal must compile down to a normal `kb-local remember`, `record`, `relate`, or `annotate` payload.

## Shape

```json
{
  "summary": "Short description of what the external agent found.",
  "findings": [
    {
      "kind": "correction|entity_update|relation_update|provenance_note|review_note",
      "entityIds": ["vendor-stripe"],
      "evidence": "Source, quote, or observation the agent used.",
      "recommendation": "What should change and why."
    }
  ],
  "proposedWrites": [
    {
      "command": "remember|record|relate|annotate",
      "payload": {},
      "validate": "kb-local validate <command> --json @payload.json",
      "apply": "kb-local <command> --json @payload.json"
    }
  ],
  "verification": [
    "kb-local get <id>",
    "kb-local search --json '{\"query\":\"...\"}'"
  ],
  "humanReview": "Why approval is needed, or 'not required' if the agent is authorized."
}
```

## Example Proposed Writes

### Remember

```json
{
  "command": "remember",
  "payload": {
    "intent": "correction",
    "summary": "User corrected Stripe billing owner to Alex.",
    "content": "Correction came from the support handoff note.",
    "confidence": "high"
  },
  "validate": "kb-local validate remember --json @payload.json",
  "apply": "kb-local remember --json @payload.json"
}
```

### Record

```json
{
  "command": "record",
  "payload": {
    "entity": {
      "id": "vendor-stripe",
      "kind": "vendor",
      "title": "Stripe",
      "currentTruth": "Stripe handles billing. Alex owns the internal billing relationship.",
      "tags": ["billing"]
    }
  },
  "validate": "kb-local validate record --json @payload.json",
  "apply": "kb-local record --json @payload.json"
}
```

### Relate

```json
{
  "command": "relate",
  "payload": {
    "type": "owner_of",
    "fromId": "person-alex",
    "toId": "vendor-stripe",
    "confidence": 0.9
  },
  "validate": "kb-local validate relate --json @payload.json",
  "apply": "kb-local relate --json @payload.json"
}
```

### Annotate

```json
{
  "command": "annotate",
  "payload": {
    "entity_ids": ["vendor-stripe"],
    "summary": "2026-07-15: Support handoff corrected billing owner to Alex.",
    "provenance": "support handoff"
  },
  "validate": "kb-local validate annotate --json @payload.json",
  "apply": "kb-local annotate --json @payload.json"
}
```

## Validation

Validate each proposed write separately with the command named in its `validate` field before applying anything:

```bash
kb-local validate remember --json @payload.json
kb-local validate record --json @payload.json
kb-local validate relate --json @payload.json
kb-local validate annotate --json @payload.json
```

## Verification Examples

```bash
kb-local get vendor-stripe
kb-local search --json '{"query":"Stripe billing owner"}'
kb-local query-relations --json '{"query":"owner of Stripe","mode":"graph-first-hybrid"}'
kb-local links --id vendor-stripe
kb-local traverse --id person-alex --type owner_of --explicit-only
```

## Non-Goals

- No `kb-local proposal` command.
- No generic apply command for proposals.
- No KB-owned approval workflow.
- No recipe state, run state, or scheduler state in KB.
