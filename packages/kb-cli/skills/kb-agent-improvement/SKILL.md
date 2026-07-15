---
name: kb-agent-improvement
version: 1.0.0
description: "Guide an external agent through safe KB improvement workflows using KB as storage, validation, retrieval, relation, and provenance substrate."
---

# KB Agent Improvement

Use this when an external agent wants to review, refine, or curate KB state while keeping all judgment outside KB.

## Boundary

Agents think. KB stores, validates, retrieves, relates, and exposes evidence.

Do not treat KB as an autonomous worker. KB does not schedule reviews, ingest documents for you, detect contradictions, merge duplicates, regenerate truth, or maintain recipe run state. The agent or runtime owns those choices and any checkpoints.

## Fast Path

```bash
kb-local inspect
kb-local help
kb-local help operator
kb-local schema remember
kb-local schema record
kb-local schema relate
kb-local schema annotate
```

Read the recipe that matches the workflow:

```text
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

1. **Inspect target state**

   ```bash
   kb-local inspect
   kb-local list
   kb-local search --json '{"query":"..."}'
   kb-local get <id>
   kb-local links --id <id>
   kb-local traverse --id <id> --depth 1
   ```

2. **Reason outside KB**

   The agent decides what is stale, duplicated, contradictory, under-sourced, or worth preserving. KB only supplies state and evidence.

3. **Prepare normal write payloads**

   - `remember` for facts, source-backed notes, corrections, and narrative evidence.
   - `record` for canonical entity create/update.
   - `relate` for explicit relation edges between existing entities.
   - `annotate` for timeline or provenance updates.

4. **Validate before mutating**

   ```bash
   kb-local validate remember --json @remember.json
   kb-local validate record --json @record.json
   kb-local validate relate --json @relation.json
   kb-local validate annotate --json @annotation.json
   ```

5. **Apply only when authorized**

   If human review is required, emit a proposal using `proposal-format.md` instead of writing.

6. **Verify after writes**

   ```bash
   kb-local get <id>
   kb-local search --json '{"query":"..."}'
   kb-local query-relations --json '{"query":"...","mode":"graph-first-hybrid"}'
   kb-local links --id <id>
   kb-local traverse --id <id> --explicit-only
   kb-local doctor
   ```

## Resolver

- Search/read first when knowledge might already exist.
- Prefer evidence-first writes: capture the correction or source before rewriting canonical truth.
- Use `record` only when the agent has enough evidence to create or update canonical entity state.
- Use `relate` for standalone explicit edges. Do not use `annotate` to create relation edges.
- Use `annotate` for provenance or timeline notes on existing entities.
- Avoid writing if the agent cannot cite evidence or confidence is too low.
- Use operator-only commands only for repair or support workflows discovered through `kb-local help operator`.

## Proposal Pattern

For non-trivial changes, produce a proposal before mutating:

```json
{
  "summary": "What the external agent found.",
  "findings": [
    {
      "kind": "correction",
      "entityIds": ["vendor-stripe"],
      "evidence": "User corrected the billing owner in the support thread.",
      "recommendation": "Record the correction and update the owner relation."
    }
  ],
  "proposedWrites": [
    {
      "command": "remember",
      "payload": {
        "intent": "correction",
        "summary": "Stripe billing owner corrected to Alex.",
        "confidence": "high"
      },
      "validate": "kb-local validate remember --json @payload.json"
    }
  ],
  "verification": [
    "kb-local search --json '{\"query\":\"Stripe billing owner\"}'"
  ]
}
```

The proposal is a handoff artifact for an agent, human, or orchestrator. KB does not execute proposal objects.

## Non-Goals

Do not add or rely on:

- KB-owned schedules or background runs
- KB-owned recipe state
- KB-side document ingestion workflows
- KB-side contradiction detection
- auto-merge or auto-dedupe
- truth regeneration commands
- generic improvement workflow engines

## Install This Skill

After installing `@emmassist-co/kb-cli`, prefer the package-local skill path:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-agent-improvement
```

If the package is not installed yet, the GitHub source path is available as a fallback:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-agent-improvement
```
