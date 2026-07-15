---
title: "docs: Strengthen KB agent recipe examples"
type: docs
status: completed
date: 2026-07-15
---

# docs: Strengthen KB agent recipe examples

## Summary

Add the missing lightweight refinements to the external-agent KB improvement support surface: a recipe index, worked examples in each recipe, and a clear manual smoke-test checklist. Keep the work documentation-first and avoid adding new KB workflow logic, proposal execution, machine-readable recipe APIs, or state.

---

## Problem Frame

The first implementation shipped the right boundary: agents think; KB stores, validates, retrieves, relates, and exposes evidence. It added the `kb-agent-improvement` skill, recipes, proposal format, docs, static help, tests, and package inclusion.

What remains is mostly usability. Agents can follow the recipes, but they will do better with concrete examples and one recipe index that explains which playbook to choose. The changelog also still has human testing pending, which is correct until a real person manually exercises the flow.

---

## Requirements

### Recipe Usability

- R1. Add `packages/kb-cli/recipes/README.md` as a human- and agent-readable index that explains when to use each recipe.
- R2. Add one worked example to each existing recipe showing input situation, KB inspection, external-agent judgment, proposed writes, validation, and verification.
- R3. Keep examples grounded in existing `kb-local` commands and normal `remember`, `record`, `relate`, and `annotate` payloads.

### Product Boundary

- R4. Do not add machine-readable recipe manifests, recipe state, schedulers, proposal executors, or KB-side thinking commands.
- R5. Preserve the actor boundary in every example: the agent reads/reasons/decides; KB validates/stores/retrieves/relates/exposes evidence.
- R6. Keep proposal validation at the mutation-payload level through existing `kb-local validate <command>` examples, not through a new proposal schema.

### Verification And Release Hygiene

- R7. Add tests or doc assertions that the recipe index exists, each recipe has a worked example, and forbidden workflow-command names remain absent.
- R8. Add a manual smoke-test checklist to the docs or recipe index so a human tester can clear the changelog's human-testing field later.
- R9. Do not mark human testing as passed unless a real person manually exercises the installed skill/recipe flow.

---

## Key Technical Decisions

- KTD1. **Markdown index, not manifest:** Add `recipes/README.md` instead of JSON/YAML metadata. This improves discoverability without creating a recipe API or runtime contract.
- KTD2. **Examples over helpers:** Improve the recipes with concrete examples rather than adding read helpers like `sources --entity-id` or proposal-validation commands before there is evidence they are needed.
- KTD3. **Manual checklist stays manual:** Document the smoke-test flow but leave changelog human testing pending until someone actually runs it.
- KTD4. **No runtime expansion by default:** Keep this package-skill/recipe surface out of `.flue/runtime-skills` unless a later runtime-specific need appears.

---

## Scope Boundaries

### In Scope

- Recipe index markdown.
- Worked examples in all existing recipe files.
- Test/doc assertions for examples, index, and non-autonomous boundaries.
- Manual smoke-test checklist documentation.
- Changelog automated coverage update if tests change.

### Explicitly Out of Scope

- Machine-readable recipe manifest.
- Proposal schema validation command.
- `kb improve`, `kb recipe`, or any workflow executor.
- Recipe run state or checkpoints in KB.
- KB-side document ingestion, contradiction detection, duplicate detection, stale detection, relation suggestion, or truth regeneration.
- MCP tool additions or runtime-skill copies.
- Marking human testing as passed without a real manual test.

---

## Acceptance Examples

- AE1. Given an agent is unsure which recipe to use, when it reads `packages/kb-cli/recipes/README.md`, then it can choose the maintenance, document-review, correction, relation, stale-review, or proposal-format recipe without inferring a KB-owned workflow.
- AE2. Given an agent reads any recipe, then it sees a worked example with an input situation, KB inspection commands, an explicit external-agent judgment step, proposed normal KB writes, validation commands, and verification commands.
- AE3. Given a reader searches the recipe index and examples for forbidden workflow surfaces, then there is no `kb-local improve`, `kb-local ingest-docs`, `kb-local detect-contradictions`, proposal executor, scheduler, or recipe-state instruction.
- AE4. Given a human wants to clear human testing later, then the docs contain a checklist they can follow and report back against the changelog entry.

---

## Implementation Units

### U1. Add the recipe index and manual smoke checklist

- **Goal:** Create the missing recipe landing page and document the human smoke-test path.
- **Requirements:** R1, R4, R5, R8, R9
- **Dependencies:** None
- **Files:**
  - `packages/kb-cli/recipes/README.md`
  - `packages/kb-cli/README.md`
  - `tests/kb-cli-docs.test.ts`
- **Approach:** Add a concise index that lists every recipe, when to use it, what KB does, what the external agent does, and what is explicitly not part of the surface. Include a manual smoke checklist: install `@emmassist-co/kb-cli`, add `kb-agent-improvement`, open one recipe, prepare one proposed write, run `kb-local validate`, optionally apply to a disposable KB, and verify with reads.
- **Patterns to follow:** `docs/product/kb-agent-improvement-support.md`; `packages/kb-cli/skills/kb-agent-improvement/SKILL.md`; existing `tests/kb-cli-docs.test.ts` package-doc assertions.
- **Test scenarios:**
  - Assert `packages/kb-cli/recipes/README.md` exists.
  - Assert the index references every recipe file and includes the boundary phrase or equivalent.
  - Assert the index includes a manual smoke-test checklist while keeping human testing explicitly manual.
  - Assert the package README links to the recipe index.
- **Verification:** Agents and humans have a single starting point for recipe selection and manual smoke testing.

### U2. Add worked examples to each agent recipe

- **Goal:** Make each recipe concrete enough that an agent can execute it without inventing the workflow shape.
- **Requirements:** R2, R3, R5, R6
- **Dependencies:** U1
- **Files:**
  - `packages/kb-cli/recipes/agent-maintenance-review.md`
  - `packages/kb-cli/recipes/agent-doc-review-to-kb.md`
  - `packages/kb-cli/recipes/agent-correction-sweep.md`
  - `packages/kb-cli/recipes/agent-relation-curation.md`
  - `packages/kb-cli/recipes/agent-stale-knowledge-review.md`
  - `tests/kb-cli-docs.test.ts`
- **Approach:** Add a `## Worked Example` section to each recipe with the same shape: situation, inspect commands, agent judgment, proposed writes, validation, and verification. Keep examples short and reusable; avoid making them domain-specific beyond simple illustrative entities.
- **Patterns to follow:** Existing recipe command style; `packages/kb-cli/recipes/proposal-format.md` examples for payload formatting.
- **Test scenarios:**
  - Assert every agent recipe has a `## Worked Example` section.
  - Assert each worked example includes inspection, agent judgment, proposed write, validation, and verification language.
  - Assert examples use normal `kb-local remember`, `record`, `relate`, or `annotate` commands rather than new workflow commands.
- **Verification:** Each recipe can be followed by an external agent with less ambiguity and without adding KB-side thinking.

### U3. Strengthen proposal-format examples and cross-links

- **Goal:** Make the proposal format clearly reusable from all recipes and keep proposal execution external.
- **Requirements:** R3, R6, R8
- **Dependencies:** U1, U2
- **Files:**
  - `packages/kb-cli/recipes/proposal-format.md`
  - `packages/kb-cli/recipes/README.md`
  - `packages/kb-cli/skills/kb-agent-improvement/SKILL.md`
  - `tests/kb-cli-docs.test.ts`
- **Approach:** Add short cross-links from the skill and index to `proposal-format.md`. If needed, add a compact multi-write proposal example that includes `remember`, `record`, `relate`, and `annotate` together, but keep execution as human/orchestrator-owned and each payload validated individually.
- **Patterns to follow:** Current `proposal-format.md` command-plus-payload examples; `kb-agent-improvement` proposal pattern.
- **Test scenarios:**
  - Assert proposal docs say KB does not execute proposal objects.
  - Assert proposal docs include validation examples for all normal mutation commands.
  - Assert skill and recipe index point to proposal-format guidance.
- **Verification:** Agents can produce reviewable proposals without implying a KB-owned proposal engine.

### U4. Update changelog/test coverage and preserve release posture

- **Goal:** Keep release tracking and automated guardrails accurate after the documentation refinements.
- **Requirements:** R7, R9
- **Dependencies:** U1, U2, U3
- **Files:**
  - `CHANGELOG.md`
  - `tests/kb-cli-docs.test.ts`
  - `tests/kb-skills.test.ts` if skill text changes
- **Approach:** Update automated coverage in the existing changelog entry if tests change. Do not mark human testing passed. Keep `@emmassist-co/kb-cli` at the already-bumped minor version unless the refinement is split into a separate release after `1.7.0` ships.
- **Patterns to follow:** Existing changelog entry for external-agent KB improvement recipes; `AGENTS.md` changelog discipline.
- **Test scenarios:**
  - Changelog still has human testing status pending.
  - Changelog automated coverage mentions the focused docs/skills tests if they changed.
  - Package version is not bumped again unless release sequencing requires it.
- **Verification:** Release notes remain accurate and no manual testing is falsely claimed.

---

## Documentation And Operational Notes

This is a documentation and packaged-artifact refinement. It should not require benchmark rails because it must not touch retrieval, ranking, extraction, storage semantics, or runtime KB behavior. If implementation unexpectedly changes `packages/kb-core` or relation behavior, stop and re-scope.

---

## Risks And Mitigations

- **Risk: examples become too prescriptive or domain-specific.** Keep examples short and generic; the recipe teaches the workflow, not a fixed ontology.
- **Risk: recipe index looks like a manifest.** Keep it markdown-only and prose-oriented.
- **Risk: human testing is accidentally marked complete.** Leave changelog human testing pending until a person manually performs the smoke flow.
- **Risk: examples imply KB does thinking.** Use explicit “agent judgment” sections in every worked example.

---

## Execution Goal

Use this `/goal` after approving the plan:

```text
/goal Implement docs/plans/2026-07-15-005-docs-kb-agent-recipes-examples-plan.md in the feat/kb-agent-improvement-support worktree. Add packages/kb-cli/recipes/README.md with recipe selection guidance and a manual smoke-test checklist; add one concise worked example to each existing agent recipe; strengthen proposal-format cross-links if useful; update tests and changelog automated coverage. Preserve the philosophy: agents think, KB stores/validates/retrieves/relates/exposes evidence. Do not add machine-readable recipe manifests, recipe state, schedulers, proposal executors, KB-side ingestion, contradiction detection, duplicate detection, stale detection, relation suggestion, truth regeneration, MCP tools, or runtime-skill copies. Verify with targeted docs/skills tests and typecheck; run npm test if any non-doc runtime code changes.
```
