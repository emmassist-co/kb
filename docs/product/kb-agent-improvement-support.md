# KB Agent Improvement Support

## Product Boundary

Agents think. KB stores, validates, retrieves, relates, and exposes evidence.

KB supports external-agent improvement workflows by providing durable primitives and inspectable state. It does not decide to improve itself, run schedules, ingest external documents as a reasoning workflow, detect contradictions, merge duplicates, regenerate truth, or maintain recipe run state.

The external agent or runtime owns:

- choosing when to run a review or recipe
- reading external documents, transcripts, tickets, or messages
- deciding what matters
- judging duplicate, stale, contradictory, or weakly sourced knowledge
- preparing proposed writes
- requesting human approval when needed
- applying authorized KB writes
- storing checkpoints or run state outside KB

KB owns:

- stable command surfaces for reading and writing durable knowledge
- payload schemas and validation
- canonical entity, source, event, and relation state
- provenance and timeline surfaces
- graph reads and relation traversal
- package-shipped skills and markdown recipes that teach agents safe workflows

## Support Matrix

| External-agent flow | Possible today | KB role | Agent-owned thinking | Recommended support | Complexity risk |
|---|---:|---|---|---|---:|
| Safe fact/source/correction capture | yes | validate and store `remember` payloads | decide what fact or correction matters | `kb-write`, `kb-agent-improvement`, proposal examples | low |
| Structured entity update | yes | validate and store `record` payloads | decide create vs update and entity meaning | resolver guidance | low |
| Explicit relation creation | yes | validate and store `relate` edges; expose graph reads | infer whether the relation is true | relation curation recipe | low |
| Timeline/provenance annotation | yes | append timeline/provenance evidence | decide what evidence should be preserved | evidence-first recipe language | low |
| External document review | partial | accept selected source, entity, fact, and relation writes | read documents and extract meaning | agent document-review recipe; no ingest command | low |
| Correction sweep | partial | store corrections and canonical updates | interpret corrections and propagation needs | agent correction-sweep recipe | low |
| Duplicate cleanup | partial | expose search, list, get, delete, and record | decide whether records are duplicates | guidance only; no auto-merge | low |
| Contradiction review | partial | expose evidence, entities, relations, and export | decide whether claims conflict | guidance only; no detector | low |
| Stale knowledge review | partial | expose timestamps, current truth, events, and sources | decide whether state is stale | agent stale-review recipe | low |
| Proposal handoff | partial | document payload shapes and existing validation | produce findings and choose proposed writes | proposal-format recipe | medium |
| Autonomous schedules | intentionally no | CLI can be invoked externally | own scheduler and checkpoints | explicit non-goal | avoided |
| Recipe run state | intentionally no | none | store state wherever the agent/runtime wants | explicit non-goal | avoided |
| KB-side thinking commands | intentionally no | none | all judgment lives outside KB | explicit non-goal | avoided |

## Command Resolver

Use the narrow command surface before reaching for operator repair tools:

1. Run `kb-local inspect` to confirm workspace, backend, and canonicality.
2. Search and read before writing: `kb-local search`, `kb-local query-relations`, `kb-local get`, `kb-local links`, and `kb-local traverse`.
3. Use `kb-local remember` for durable facts, source-backed notes, corrections, and narrative evidence.
4. Use `kb-local record` for canonical structured entities when the agent has enough evidence to create or update the entity.
5. Use `kb-local relate` for explicit relation edges between existing entities.
6. Use `kb-local annotate` for timeline or provenance updates on existing entities.
7. Use `kb-local validate <command>` before non-trivial writes or batches.
8. Avoid writing when evidence is ambiguous; emit a proposal or report instead.

Operator-only surfaces such as direct source capture, event deletion, draft repair, relation replacement, and conflict resolution are for repair and support workflows, not normal improvement recipes.

## Recipe Contract

A KB recipe is an agent playbook, not a KB workflow engine. Each recipe should name:

- the external-agent goal
- inputs the agent must gather
- KB read commands to inspect current state
- reasoning the agent performs outside KB
- allowed write commands
- validation commands
- verification commands
- non-goals and safety boundaries

Recipes may describe how an agent can produce a proposal for human review. They must not imply KB will execute the proposal, detect issues by itself, or maintain state between runs.
