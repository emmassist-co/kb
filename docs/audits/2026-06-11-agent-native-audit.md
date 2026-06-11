# Agent-Native Architecture Review: emmassist/kb

Date: `2026-06-11`

Scope: staged public KB package set, CLI/HTTP/MCP surfaces, semantic sync flow, and the published operator docs.

## Overall Score Summary

| Core Principle | Score | Percentage | Status |
|----------------|-------|------------|--------|
| Action Parity | 8/9 | 89% | ✅ |
| Tools as Primitives | 8/9 | 89% | ✅ |
| Context Injection | 4/6 | 67% | ⚠️ |
| Shared Workspace | 6/6 | 100% | ✅ |
| CRUD Completeness | 5/6 | 83% | ✅ |
| UI Integration | 3/5 | 60% | ⚠️ |
| Capability Discovery | 6/7 | 86% | ✅ |
| Prompt-Native Features | 4/6 | 67% | ⚠️ |

**Overall Agent-Native Score: 80%**

## Strengths

- The same canonical KB can be reached through CLI, HTTP, MCP, Cloudflare deployment, and semantic mirror workflows.
- Human and agent work converges on the same tenant-scoped KB rather than separate side stores.
- The write surface is largely primitive: `remember`, `record`, `recordSource`, `annotate`, `relate`, `delete*`, `search`, `queryRelations`, `export`.
- Capability discovery is strong in docs and packaged skills for local setup, KB writing, and Cloudflare deployment.
- Shared-workspace semantics are explicit in the semantic sync and Cloudflare-first docs.

## Principle Findings

### Action Parity — 8/9

Covered:

- inspect
- search
- relation query
- record entity data
- record source data
- annotate
- relate
- delete entity/event/draft
- export/sync via daemon and HTTP

Gap:

- direct human-facing UI actions are mostly documented workflows rather than a first-party app surface, so parity is strongest between CLI/HTTP/MCP rather than UI-to-agent.

### Tools As Primitives — 8/9

Good primitives dominate:

- `record`
- `recordSource`
- `remember`
- `annotate`
- `relate`
- `deleteRecord`
- `deleteEvent`
- `deleteDraft`
- `search`

Partial exception:

- semantic sync compilation is intentionally workflow-shaped because it translates authored markdown diffs into primitive mutations.

### Context Injection — 4/6

Strong:

- tenant ID
- workspace role
- backend mode
- sync and mirror state via CLI surfaces

Missing or partial:

- richer runtime injection of recent KB mutations
- first-class dynamic capability summaries exposed inside every runtime surface

### Shared Workspace — 6/6

Strong:

- file-backed local KB
- Cloudflare canonical state
- mirror workflows
- semantic sync between human-edited files and canonical writes
- MCP and HTTP share the same tenant runtime
- docs explicitly reject “second source of truth” architectures

### CRUD Completeness — 5/6

Strong coverage for:

- entities
- sources
- drafts
- relations
- events

Gap:

- relation deletion is present operationally through relation clearing flows, but not exposed as a simple, symmetric public “delete relation” command in the same way as entity/source writes.

### UI Integration — 3/5

Strong:

- daemon and mirror workflows make changes visible in files immediately
- semantic sync refreshes the mirror after canonical writes

Partial:

- there is no first-party UI with reactive live updates
- propagation is file/daemon/HTTP oriented rather than product-UI oriented

### Capability Discovery — 6/7

Strong:

- README quick start
- consumer quickstart
- package READMEs
- packaged setup skills
- Cloudflare setup docs
- MCP transport examples

Gap:

- no dedicated in-product help or slash-command discovery surface because there is no first-party UI shell

### Prompt-Native Features — 4/6

Strong:

- setup skills and operational skills define outcomes in prose
- semantic authoring workflow is framed as a behavioral contract around primitive writes

Partial:

- core KB behavior is still predominantly code-defined infrastructure, which is appropriate here but less “prompt-native” than an agent shell product
- discovery and runtime behavior are more doc-driven than prompt-injected inside an application loop

## Top Recommendations By Impact

| Priority | Action | Principle | Effort |
|----------|--------|-----------|--------|
| P1 | Add a lightweight capability-manifest endpoint or command that returns the current tenant/runtime write and read surfaces | Capability Discovery | medium |
| P1 | Expose richer runtime context snapshots for agents, including recent mutations and sync state summaries | Context Injection | medium |
| P2 | Add a symmetric public relation-delete command to complete CRUD ergonomics | CRUD Completeness | low |
| P2 | If a first-party UI is added later, wire agent writes to immediate reactive updates instead of file-refresh-only propagation | UI Integration | medium |
| P2 | Keep semantic sync translation at the daemon layer and avoid moving business logic into monolithic workflow tools | Tools as Primitives | low |
