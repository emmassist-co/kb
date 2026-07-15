# KB Agent Improvement Recipes

Agents think. KB stores, validates, retrieves, relates, and exposes evidence.

These recipes are markdown playbooks for external agents. They do not define a scheduler, run state, machine-readable manifest, proposal executor, or KB-side reasoning workflow. The agent or runtime chooses when to run a recipe, reads any external inputs, makes the judgment call, prepares normal KB payloads, validates them, and applies only authorized writes.

## Choose A Recipe

| If the agent needs to... | Use this recipe | KB provides | Agent owns |
|---|---|---|---|
| Review KB quality broadly | [`agent-maintenance-review.md`](./agent-maintenance-review.md) | inventory, search, health, evidence reads, validated writes | deciding what looks stale, weak, duplicate-like, contradictory, or missing |
| Turn reviewed docs into durable KB state | [`agent-doc-review-to-kb.md`](./agent-doc-review-to-kb.md) | schemas, validation, entity/fact/relation storage | reading documents and deciding what matters |
| Propagate a user correction | [`agent-correction-sweep.md`](./agent-correction-sweep.md) | correction capture, canonical updates, relation writes, verification reads | interpreting the correction and affected records |
| Curate explicit graph edges | [`agent-relation-curation.md`](./agent-relation-curation.md) | relation validation/storage and graph traversal | inferring whether the relationship is true and supported |
| Review current truth against newer evidence | [`agent-stale-knowledge-review.md`](./agent-stale-knowledge-review.md) | current records, timelines, sources, events, and validation | deciding whether knowledge is stale and what update is warranted |
| Hand off proposed writes for approval | [`proposal-format.md`](./proposal-format.md) | existing per-command validation | proposal construction and approval routing |

## Manual Smoke-Test Checklist

Use this checklist when a human wants to clear the changelog's human-testing field for the recipe flow.

1. Install the package in a disposable workspace.

   ```bash
   npm install @emmassist-co/kb-cli --@emmassist-co:registry=https://npm.pkg.github.com
   ```

2. Install the agent-improvement skill from the package-local path.

   ```bash
   npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-agent-improvement
   ```

3. Open this recipe index and one specific recipe under the package path.

   ```text
   ./node_modules/@emmassist-co/kb-cli/recipes/README.md
   ./node_modules/@emmassist-co/kb-cli/recipes/agent-correction-sweep.md
   ```

4. Prepare one disposable proposed write from the recipe, such as a `remember` correction payload.

5. Validate the payload before any mutation.

   ```bash
   kb-local validate remember --json @payload.json
   ```

6. If using a disposable local KB and authorized to mutate, apply the payload and verify it through reads.

   ```bash
   export KB_ROOT_DIR="$PWD/.kb-smoke"
   kb-local remember --json @payload.json
   kb-local search --json '{"query":"correction"}'
   kb-local doctor
   ```

7. Report the exact package version, skill path, recipe path, validation command, optional write command, and verification command back into `CHANGELOG.md` before marking human testing passed.

## Non-Goals

- No machine-readable recipe manifest.
- No recipe state or checkpoints in KB.
- No KB-owned scheduler or background run.
- No proposal executor or generic apply command.
- No KB-side document ingestion, contradiction detection, duplicate detection, stale detection, relation suggestion, or truth regeneration.
- No MCP tools or runtime-skill copies.
