---
name: kb-agent-improvement
version: 1.1.0
description: "Guide an external agent through safe trust-substrate KB improvement workflows using KB as storage, validation, retrieval, evidence, review, relation, and provenance substrate."
---

# KB Agent Improvement

Use this when an external agent wants to review, refine, or curate KB state while keeping judgment, scheduling, approval, and run state outside KB.

## Boundary

Agents think. KB stores, validates, retrieves, relates, and exposes evidence.

The trust substrate gives agents evidence/status/history/review contracts. It does not make KB an autonomous memory brain. KB does not schedule reviews, ingest documents for you, decide truth, arbitrate contradictions, merge duplicates, regenerate current truth, or maintain recipe run state. The agent, runtime, human, or orchestrator owns those choices.

## Fast Path

Use `kb` for new setups. `kb-local` remains a backward-compatible alias for older agents and scripts.

```bash
kb inspect
kb help
kb help runtime
kb help operator
kb schema search
kb schema query-relations
kb schema remember
kb schema record
kb schema relate
kb schema annotate
kb debt
```

Read the recipe that matches the workflow:

```text
packages/kb-cli/recipes/README.md
packages/kb-cli/recipes/agent-maintenance-review.md
packages/kb-cli/recipes/agent-doc-review-to-kb.md
packages/kb-cli/recipes/agent-correction-sweep.md
packages/kb-cli/recipes/agent-relation-curation.md
packages/kb-cli/recipes/agent-stale-knowledge-review.md
packages/kb-cli/recipes/proposal-format.md
```

When installed from the package, resolve these under:

```text
./node_modules/@emmassist-co/kb-cli/recipes/
```

## Improvement Loop

1. **Inspect target state and trust posture**

   ```bash
   kb inspect
   kb list
   kb search --json '{"query":"...","temporalFocus":"mixed"}'
   kb query-relations --json '{"query":"...","mode":"graph-first-hybrid"}'
   kb get <id>
   kb evidence --id <id>
   kb links --id <id>
   kb traverse --id <id> --depth 1
   kb debt
   ```

2. **Reason outside KB**

   The agent decides what is stale, duplicated, contradictory, under-sourced, or worth preserving. KB supplies records, evidence views, trust caveats, review/debt ledgers, validation, and apply mechanics only.

3. **Prepare normal write payloads**

   - `remember` for facts, source-backed notes, corrections, and narrative/raw evidence.
   - `record` for canonical entity create/update when evidence and authorization are enough.
   - `relate` for explicit relation edges between existing entities.
   - `annotate` for timeline or provenance notes on existing entities.
   - `submit-proposal` when canonical truth should change but review is needed.

4. **Validate before mutating**

   ```bash
   kb validate remember --json @remember.json
   kb validate record --json @record.json
   kb validate relate --json @relation.json
   kb validate annotate --json @annotation.json
   ```

5. **Apply only when authorized**

   If human/operator review is required, submit a KB proposal or hand off `proposal-format.md` instead of writing canonical truth directly:

   ```bash
   kb submit-proposal --json @proposal.json
   kb proposals
   kb get-proposal --id proposal_123
   ```

   Operator/review actors may approve and apply later:

   ```bash
   kb review-proposal --id proposal_123 --json '{"status":"approved","reviewer":"operator"}'
   kb apply-proposal --id proposal_123 --applied-by operator
   ```

6. **Verify after writes or promotion**

   ```bash
   kb get <id>
   kb search --json '{"query":"...","temporalFocus":"current"}'
   kb query-relations --json '{"query":"...","mode":"graph-first-hybrid"}'
   kb evidence --id <id>
   kb recall --json '{"query":"...","purpose":"post-write verification"}'
   kb links --id <id>
   kb traverse --id <id> --explicit-only
   kb doctor
   kb debt
   ```

## Resolver

- Search/read first when knowledge might already exist.
- Inspect `trust` envelopes and evidence caveats before treating a result as current truth.
- Prefer evidence-first writes: capture the correction or source before rewriting canonical truth.
- Use `record` only when the agent has enough evidence and authority to create or update canonical entity state.
- Use `submit-proposal` when evidence is useful but authority, support, or confidence is insufficient for direct canonical mutation.
- Use `relate` for standalone explicit edges. Do not use `annotate` to create relation edges.
- Use `annotate` for provenance or timeline notes on existing entities.
- Avoid writing if the agent cannot cite evidence or confidence is too low.
- Use operator-only commands only for explicit repair, review, or support workflows discovered through `kb help operator`.

## Proposal Pattern

For non-trivial changes, produce a proposal before mutating. A KB proposal records one intended normal operation (`remember`, `record`, `relate`, or `annotate`) plus the payload and evidence links.

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

Submit it with:

```bash
kb submit-proposal --json @proposal.json
```

The proposal is a reviewable KB state object. KB stores status and can apply an approved proposal through normal mutation semantics, but KB does not author, approve, or arbitrate the proposal by itself.

## Non-Goals

Do not add or rely on:

- KB-owned schedules or background runs
- KB-owned recipe state
- KB-side document ingestion workflows
- KB-side autonomous contradiction arbitration
- hidden auto-merge or auto-dedupe
- truth regeneration commands
- generic improvement workflow engines
- recall bundles that mutate state or self-inject into prompts

## Install This Skill

After installing `@emmassist-co/kb-cli`, prefer the package-local skill path:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-agent-improvement
```

If the package is not installed yet, the GitHub source path is available as a fallback:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-agent-improvement
```
