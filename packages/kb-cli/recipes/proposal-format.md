# KB Agent Proposal Format

## Goal

Give external agents a reviewable handoff shape for proposed KB changes while preserving the trust-substrate boundary: agents prepare recommendations; KB stores proposal state, records review status, and applies only explicitly approved normal writes.

Use this from [`README.md`](./README.md) or any agent recipe when a change needs review before canonical mutation.

A proposal targets exactly one normal KB operation: `remember`, `record`, `relate`, or `annotate`. KB can store, review, and apply that approved operation, but it does not author proposals, decide truth, schedule review, or arbitrate disagreements by itself.

## Stored Proposal Shape

Use this shape with `kb submit-proposal --json @proposal.json`:

```json
{
  "id": "proposal_stripe_billing_owner",
  "operation": "record",
  "title": "Update Stripe billing owner",
  "summary": "Support handoff says Alex now owns the internal Stripe billing relationship.",
  "targetEntityIds": ["vendor-stripe"],
  "sourceIds": ["source-support-handoff-2026-07-16"],
  "submittedBy": "agent",
  "payload": {
    "entity": {
      "id": "vendor-stripe",
      "kind": "vendor",
      "title": "Stripe",
      "currentTruth": "Stripe handles billing. Alex owns the internal billing relationship."
    }
  }
}
```

Required fields:

- `operation`: `remember`, `record`, `relate`, or `annotate`
- `payload`: the exact payload that would be passed to the matching normal command

Strongly recommended fields:

- `id`: stable proposal ID for review threads and apply commands
- `title` and `summary`: concise reviewer context
- `targetEntityIds`: affected entity IDs
- `sourceIds`: cited source/evidence IDs
- `submittedBy`: agent, human, or system name

## Validate The Proposed Operation

Validate the inner operation before submission when possible:

```bash
kb validate remember --json @remember-payload.json
kb validate record --json @record-payload.json
kb validate relate --json @relation-payload.json
kb validate annotate --json @annotation-payload.json
```

Then submit the proposal record:

```bash
kb submit-proposal --json @proposal.json
kb proposals
kb get-proposal --id proposal_stripe_billing_owner
```

## Review And Apply

Review/apply is an explicit operator workflow. Do not run these unless the user/operator authorized approval and mutation:

```bash
kb review-proposal --id proposal_stripe_billing_owner --json '{"status":"approved","reviewer":"operator","notes":"Evidence checked."}'
kb apply-proposal --id proposal_stripe_billing_owner --applied-by operator
```

Other review statuses:

```bash
kb review-proposal --id proposal_stripe_billing_owner --json '{"status":"needs_more_evidence","reviewer":"operator","notes":"Missing source."}'
kb review-proposal --id proposal_stripe_billing_owner --json '{"status":"rejected","reviewer":"operator","notes":"Conflicts with newer evidence."}'
```

## Example Proposed Payloads

### Remember

```json
{
  "operation": "remember",
  "title": "Capture Stripe billing correction",
  "sourceIds": ["source-support-handoff-2026-07-16"],
  "payload": {
    "intent": "correction",
    "summary": "User corrected Stripe billing owner to Alex.",
    "content": "Correction came from the support handoff note.",
    "confidence": "high"
  }
}
```

### Record

```json
{
  "operation": "record",
  "targetEntityIds": ["vendor-stripe"],
  "payload": {
    "entity": {
      "id": "vendor-stripe",
      "kind": "vendor",
      "title": "Stripe",
      "currentTruth": "Stripe handles billing. Alex owns the internal billing relationship.",
      "tags": ["billing"]
    }
  }
}
```

### Relate

```json
{
  "operation": "relate",
  "targetEntityIds": ["person-alex", "vendor-stripe"],
  "payload": {
    "type": "owner_of",
    "fromId": "person-alex",
    "toId": "vendor-stripe",
    "confidence": 0.9
  }
}
```

### Annotate

```json
{
  "operation": "annotate",
  "targetEntityIds": ["vendor-stripe"],
  "payload": {
    "entity_ids": ["vendor-stripe"],
    "summary": "2026-07-15: Support handoff corrected billing owner to Alex.",
    "provenance": "support handoff"
  }
}
```

## Verification Examples

```bash
kb get vendor-stripe
kb search --json '{"query":"Stripe billing owner","temporalFocus":"current"}'
kb query-relations --json '{"query":"owner of Stripe","mode":"graph-first-hybrid"}'
kb evidence --id vendor-stripe
kb links --id vendor-stripe
kb traverse --id person-alex --type owner_of --explicit-only
kb debt
```

## Non-Goals

- No KB-authored proposals.
- No KB-owned approval policy or autonomous truth arbitration.
- No hidden auto-merge or auto-dedupe.
- No recipe state, run state, or scheduler state in KB.
- No recall bundle that mutates state or self-injects into prompts.
