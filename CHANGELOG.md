# Changelog

Use this file as the merged-work ledger for `kb/`.

- Add newest entries at the top of `## Entries`.
- Every merged feature or fix must have an entry.
- `Human testing` means real manual interaction by a person. Automated tests do not count by themselves.

## Entry Template

```md
## YYYY-MM-DD - Short Title

- Area: package, CLI command, HTTP surface, adapter, or subsystem
- Merged to `main`: yes
- Commit / PR: <sha or PR reference>
- Feature summary: what changed
- Customer-visible impact: what users/operators notice, or `none`
- Deployment status: pending | deployed
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending | passed
- Human tester:
- Human test date:
- Human test environment:
- Human test flow:
- Automated coverage: tests, typecheck, CI, or `not run`
- Needs iteration: no | yes
- Follow-up:
```

## Entries

## 2026-07-15 - Stop Persisting Noisy Mention Links

- Area: kb-core, cli
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: stopped the heuristic relation extractor from materializing lexical co-mentions as durable `mentioned_in` graph edges, made `related`/traversal ignore legacy `mentioned_in` links by default, added an explicit `kb traverse --include-mentions` escape hatch, and prepared coordinated package metadata bumps (`kb-core` 0.4.4, `kb-cli` 1.8.0, dependent packages patch bumps).
- Customer-visible impact: KB graph traversal no longer implies relationships between entities that only appeared in the same source text; operators can still inspect legacy mention edges intentionally with `--include-mentions`.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: rebuild a workspace with co-mentioned entities, verify no new `mentioned_in` link files are created, then compare `kb traverse` with and without `--include-mentions`.
- Automated coverage: `node --import tsx/esm --test tests/kb-relations.test.ts`; `node --import tsx/esm --test tests/kb-cli.test.ts`; `npm run typecheck`; `npm test`
- Needs iteration: no
- Follow-up: none

## 2026-07-15 - Add External-Agent KB Improvement Recipes

- Area: package, docs, skills
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: added an agent-improvement support doctrine, packaged `kb-agent-improvement` skill, external-agent recipe pack with an index and worked examples, proposal-format guidance, a manual smoke-test checklist, and static CLI help for agents that improve KB state while keeping all thinking, scheduling, ingestion, contradiction review, and run state outside KB.
- Customer-visible impact: agents and operators can install recipe guidance for KB maintenance, correction sweeps, document-review-to-KB capture, relation curation, and stale knowledge review, choose the right recipe from one index, and follow concrete examples without expecting KB to run autonomous workflows.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: install `@emmassist-co/kb-cli`, add `./node_modules/@emmassist-co/kb-cli/skills/kb-agent-improvement`, read one recipe from `./node_modules/@emmassist-co/kb-cli/recipes/`, and manually validate a proposed `remember` / `record` / `relate` / `annotate` payload flow.
- Automated coverage: `node --import tsx/esm --test tests/kb-skills.test.ts tests/kb-cli-docs.test.ts tests/kb-cli.test.ts`; `npm run typecheck`; `npm test`; `npm pack --workspace packages/kb-cli --dry-run --json` recipe/skill inclusion check
- Needs iteration: no
- Follow-up: none

## 2026-07-15 - Make KB Frictionless For Agent Adoption

- Area: cli, docs, package
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: added the preferred `kb` binary alias while preserving `kb-local`, switched default skill install docs to package-local `node_modules` paths, added a deterministic fresh-folder agent readiness smoke, clarified CLI skills versus MCP client adoption, tightened packaged skill standards, and prepared patch docs release metadata for `@emmassist-co/kb-mcp`.
- Customer-visible impact: command-running agents can install the package in a clean folder, add KB skills without cloning the repository, inspect/write/search memory with `kb`, and still use existing `kb-local` scripts.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: install `@emmassist-co/kb-cli@1.7.0` in a clean folder, run `npx kb inspect`, install packaged skills from `./node_modules/@emmassist-co/kb-cli/skills`, write with `kb remember --json -`, and search the written memory.
- Automated coverage: `npm run smoke:kb-agent-readiness -- --local-pack`; `node --import tsx/esm --test tests/kb-cli-docs.test.ts tests/kb-skills.test.ts`; `npm run check:kb:anti-cheat`; `npm run typecheck`; `npm test`
- Needs iteration: no
- Follow-up: none

## 2026-07-15 - Fix GitHub Packages Install Examples

- Area: docs, package
- Merged to `main`: yes
- Commit / PR: `8f2c449`
- Feature summary: corrected install examples to use a scoped `@emmassist-co` GitHub Packages registry override so public npm dependencies continue resolving from the default npm registry, and prepared a `@emmassist-co/kb-cli` patch release with the corrected README and skills.
- Customer-visible impact: first-time operators can install `@emmassist-co/kb-cli` into a clean local folder without the registry override breaking public dependencies like `@aws-sdk/client-s3`.
- Deployment status: released
- Deployment date: 2026-07-15
- Deployment environment: GitHub Packages
- Deployment evidence: published `@emmassist-co/kb-cli@1.6.1`; clean temp-folder install smoke passed with `@emmassist-co/kb-cli@1.6.1`
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: clean temp folder install using `npm install @emmassist-co/kb-cli --@emmassist-co:registry=https://npm.pkg.github.com`, then `kb-local inspect`, `remember`, and `search` with `KB_ROOT_DIR` pointed at a local folder.
- Automated coverage: clean temp-folder install smoke with `--@emmassist-co:registry=https://npm.pkg.github.com`, `kb-local inspect`, `kb-local remember --json`, and `kb-local search --json`; `node --import tsx/esm --test tests/kb-cli-docs.test.ts`; `npm run typecheck`; `npm test`; `npm run check:kb:anti-cheat`
- Needs iteration: no
- Follow-up: none

## 2026-07-15 - Add Agent Adoption And Storage Adapter Docs

- Area: docs
- Merged to `main`: yes
- Commit / PR: PR #9, merge `43aa354`
- Feature summary: added README decision guidance for agents evaluating KB as shared memory, documented the human-plus-multi-agent operating loop, trust/recovery boundaries, local-to-remote lifecycle, and a storage adapter guide covering the `KnowledgeStore` seam plus S3-style adapter requirements.
- Customer-visible impact: agents and operators can decide when to use KB, understand how to use it safely with humans and other agents, and see what is required to add another storage backend.
- Deployment status: released
- Deployment date: 2026-07-15
- Deployment environment: GitHub Packages
- Deployment evidence: merged PR #9 to `main`; published `@emmassist-co/kb-core@0.4.3`, `@emmassist-co/kb-cli@1.6.0`, `@emmassist-co/kb-mcp@0.1.2`, `@emmassist-co/kb-storage-file@0.2.2`, and `@emmassist-co/kb-storage-cloudflare@0.2.2`
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: read the README as a first-time agent/operator, follow one local setup path, and review `docs/architecture/kb-storage-adapters.md` for enough detail to scope an S3-style adapter.
- Automated coverage: `node --import tsx/esm --test tests/kb-cli-docs.test.ts`; `npm run check:kb:anti-cheat`; `npm run typecheck`; `npm test`
- Needs iteration: no
- Follow-up: none

## 2026-07-15 - Use Workspace Language For KB Architecture Docs

- Area: docs, package
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: replaced product-facing tenant language in the README and deployment model with workspace/folder/namespace language, added `KB_WORKSPACE_ID` and `--workspace-id` aliases for KB CLI setup paths, and kept legacy names as backward-compatible implementation aliases only.
- Customer-visible impact: operators see KB as a workspace-scoped memory rooted in a folder or namespace, not as an Administrativo-style tenancy system; new setup docs can use workspace wording without relying on legacy tenant-named flags.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: read the README architecture map and setup snippets to confirm they describe folders/workspaces/namespaces rather than product tenants.
- Automated coverage: `node --import tsx/esm --test tests/kb-cli-docs.test.ts`; `npm run check:kb:anti-cheat`; `npm run typecheck`
- Needs iteration: no
- Follow-up: publish `@emmassist-co/kb-cli@1.6.0` after release approval; consider a future deeper API rename for internal `tenantId` fields while preserving backward compatibility.

## 2026-07-15 - Document Agent-First KB Architecture Map

- Area: docs
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: added a README architecture map explaining KB's agent-first principles, local and remote agent connection paths, CLI/HTTP/MCP surfaces, Cloudflare serverless production shape, support mirrors, and repo ownership boundaries.
- Customer-visible impact: operators and agent authors can understand how plain Codex, Claude, Pi, Cursor, shell scripts, MCP clients, local daemons, and serverless agents connect to the same durable KB contract.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: read the README architecture map and docs/product/deployment-model.md, then verify one local CLI command and one remote/MCP setup path against a real KB environment.
- Automated coverage: `node --import tsx/esm --test tests/kb-cli-docs.test.ts`; `npm run check:kb:anti-cheat`; `npm run typecheck`
- Needs iteration: no
- Follow-up: none

## 2026-07-14 - Add GBrain Metric Parity, Relation Precision, And Anti-Cheat Guardrails

- Area: benchmark, package, subsystem
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: added fixed-vs-returned precision reporting, fixed precision ceilings, returned-count and false-positive diagnostics, schema-safe relation fallback/answer-kind behavior for advisor/investor/member-style queries, runtime anti-shortcut/template-coupling guards, and paraphrase/prose-only transfer relation rails.
- Customer-visible impact: maintainers and operators can compare KB to GBrain using matching scorer semantics while keeping product-core fixed P@5 gates; relation search is less likely to pad sparse graph answers with anchor or wrong-kind lexical results; benchmark claims now carry explicit anti-cheat/generalization coverage.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: review the updated benchmark markdown/JSON output and manually exercise relation searches for advisor and organization-investor queries through the CLI or package surface.
- Automated coverage: `npm run check:kb:anti-cheat`; `node --import tsx/esm --test tests/kb-eval-cli-guard.test.ts tests/kb-benchmark.test.ts tests/kb-cli-docs.test.ts tests/kb-relations.test.ts`; `npm run typecheck`; `npm test`; `npm run eval:kb:all -- --json`; `npm run eval:kb:admin-world -- --split dev --json`; `npm run eval:kb:admin-world -- --split holdout --json`; `npm run eval:kb:relation-paraphrase -- --json`; `npm run eval:kb:relation-transfer -- --json`; `npm run eval:kb:gbrain-world -- --json`; `npm run eval:kb:gbrain-evals-upstream`; `KB_GBRAIN_QUERY_SET=synthetic KB_GBRAIN_COMPACT=true node --import tsx/esm scripts/run-gbrain-evals-kb-adapter.ts`
- Needs iteration: no
- Follow-up: publish `@emmassist-co/kb-core@0.4.3` after release approval and update downstream consumers to the released package.

## 2026-06-23 - Add KB Mirror Operator Reliability Commands

- Area: CLI command, package
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: added local-only `kb validate-mirror`, `kb health`, and `kb conflicts list|show|resolve` surfaces for R2 mirror operators, plus structured `kb doctor.details` issue metadata while preserving existing string issues.
- Customer-visible impact: AI operators and humans using tenant mirrors can validate editable markdown, see one health envelope, and repair conflict artifacts without manually inspecting `.kb-sync-*` sidecar directories.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: install the published `@emmassist-co/kb-cli@1.5.0` and `@emmassist-co/kb-core@0.4.1` in a real tenant mirror consumer, run `inspect`, `sync status`, `validate-mirror`, `health --stats`, and one `conflicts list/show` flow against a mirror with known conflict artifacts.
- Automated coverage: `npm run typecheck`; `node --import tsx/esm --test tests/kb-cli.test.ts tests/kb-cli-docs.test.ts tests/kb-r2-sync.test.ts tests/kb-obsidian-sync.test.ts`; `npm run build:public`; `npm test`
- Needs iteration: no
- Follow-up: publish `@emmassist-co/kb-cli@1.5.0` and `@emmassist-co/kb-core@0.4.1`, update `administrativo`, and update the `marketeer` agent wrapper that reported the daemon/status issue.

## 2026-06-19 - Release Flue v1-Compatible KB Adapter Contract

- Area: adapter, package
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: removed the adapter's dependency on legacy `@flue/sdk` subpath types, widened the peer compatibility range to cover the Flue v1 root-export line, and updated the package and consumer docs so downstream runtimes can consume the upstream adapter contract directly.
- Customer-visible impact: Flue runtime consumers can install one published `@emmassist-co/kb-flue-adapter` package across the old `0.3.x` and new `1.x` SDK lines without carrying repo-local type patches.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: install the published adapter in one Flue `0.3.x` consumer and one Flue `1.x` consumer, mount the `kb` command, and confirm basic `help`, `inspect`, and `search` flows still work through the runtime boundary.
- Automated coverage: pending local rerun after branch changes
- Needs iteration: no
- Follow-up: publish `@emmassist-co/kb-flue-adapter@0.6.0` and cut downstream consumers over to the released package.

## 2026-06-11 - Add Obsidian Semantic Sync For Canonical KB Mirrors

- Area: package, CLI command, HTTP surface, adapter
- Merged to `main`: no
- Commit / PR: PR `#3`
- Feature summary: added a semantic sync lane for `entities/*.md` and `sources/*.md` mirror edits so the daemon can diff human markdown changes, compile safe edits into canonical KB mutations, push source round-trips through a new `/v1/record-source` path, and then refresh the mirror from canonical state.
- Customer-visible impact: operators can use Obsidian or another file editor on top of a mirrored canonical KB without falling back to raw file overwrite for supported entity and source edits.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: point a real tenant mirror at a protected Cloudflare KB, edit one entity markdown file and one source markdown file in Obsidian, run the daemon semantic pass, and confirm the canonical KB reflects the compiled mutations after refresh.
- Automated coverage: `npm run build:public`; `npm run typecheck`; `node --import tsx/esm --test tests/kb-autoresearch.test.ts tests/kb-cli-docs.test.ts tests/kb-cli.test.ts tests/kb-eval-cli-guard.test.ts tests/kb-flue-adapter.test.ts tests/kb-http.test.ts tests/kb-mcp.test.ts tests/kb-metadata.test.ts tests/kb-obsidian-sync.test.ts tests/kb-r2-sync.test.ts tests/kb-skills.test.ts tests/kb-storage-cloudflare.test.ts tests/kb-verify.test.ts`; `npm run eval:kb:all -- --json`; `npm run eval:kb:admin-world -- --split dev -- --json`; `npm run eval:kb:admin-world -- --split holdout -- --json`; `npm run eval:kb:gbrain-world -- --json`
- Needs iteration: yes
- Follow-up: resolve the `tests/kb-benchmark.test.ts` graph-first stall in the generic `npm test` path and record one real human semantic-sync run against a deployed canonical KB.

## 2026-06-10 - Make KB Publish Idempotent Across Mixed Package Versions

- Area: package
- Merged to `main`: yes
- Commit / PR: pending
- Feature summary: replaced the one-shot multi-workspace publish command with a selective publish script that checks the registry first, skips already-published package versions, and only publishes the KB packages whose versions are still unreleased.
- Customer-visible impact: operators can rerun the KB publish workflow after partial or staggered releases without hitting `409 Conflict` on unchanged package versions.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: trigger the `publish` workflow on `main`, confirm already-published packages log as skipped, and confirm the unreleased package versions are published successfully to GitHub Packages.
- Automated coverage: `node scripts/publish-public-packages.mjs --dry-run`
- Needs iteration: no
- Follow-up: rerun the KB publish workflow and then update downstream consumers to the newly published versions.

## 2026-06-10 - Restore KB Publish Gate For MCP Package

- Area: package
- Merged to `main`: yes
- Commit / PR: pending
- Feature summary: added the missing `publishConfig.access` metadata to `@emmassist-co/kb-mcp` so the public-package verification gate accepts the package and the shared publish workflow can release the new KB surface.
- Customer-visible impact: none
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: run the `publish` workflow on `main`, confirm `@emmassist-co/kb-mcp` packs and publishes successfully alongside the other KB packages, then install the published package in a clean consumer and verify the MCP exports load.
- Automated coverage: `npm run verify:public-packages`; `npm run typecheck`
- Needs iteration: no
- Follow-up: publish the unreleased KB package set and then update downstream consumers to the new versions.

## 2026-06-10 - Protected Cloudflare KB HTTP And MCP Surface

- Area: package, CLI command, HTTP surface
- Merged to `main`: yes
- Commit / PR: `33cef43`
- Feature summary: added shared bearer-token auth and scope enforcement to `kb-http`, introduced the new `@emmassist-co/kb-mcp` package, taught `kb-cli` to authenticate remote HTTP calls, added `kb cloudflare deploy` to scaffold and protect a Cloudflare-native KB host, added `kb cloudflare verify` for post-deploy rechecks, and upgraded the MCP smoke path to use the Worker-shaped HTTP transport by default.
- Customer-visible impact: operators can now stand up a protected Cloudflare KB with one auth model across `/v1` and `/mcp`, re-verify the deployed host without redeploying it, and hand outside MCP consumers a documented Streamable HTTP configuration with the same API key.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: run `kb-local cloudflare deploy` against a real Cloudflare workspace, run `kb-local cloudflare verify` against the deployed host, confirm the generated token works for both `/v1/capabilities` and `/mcp`, then connect one external MCP client to `https://HOST/mcp` with `Authorization: Bearer ...`.
- Automated coverage: `npx tsc -p packages/kb-http/tsconfig.json --noEmit false`; `npx tsc -p packages/kb-mcp/tsconfig.json --noEmit false`; `npx tsc -p packages/kb-cli/tsconfig.json --noEmit false`; `node --import tsx/esm --test tests/kb-cli.test.ts tests/kb-mcp.test.ts tests/kb-http.test.ts tests/kb-cli-docs.test.ts`; `npm run smoke:kb-mcp -- --tenant-id kb-mcp-proof`
- Needs iteration: yes
- Follow-up: run one live Cloudflare deploy smoke, confirm one real external MCP client configuration against `/mcp`, and publish the widened packages once human verification is recorded.

## 2026-05-13 - Runtime Query Telemetry

- Area: adapter
- Merged to `main`: yes
- Commit / PR: `0115b4d`
- Feature summary: the Flue adapter now emits structured runtime telemetry for KB search and relation-query executions, including result ids, payload size, estimated token count, and duration.
- Customer-visible impact: none
- Deployment status: deployed
- Deployment date: 2026-05-13
- Deployment environment: GitHub Packages
- Deployment evidence: release tag `v1.0.1`; GitHub Actions publish run `25809920094`; published `@emmassist-co/kb-flue-adapter@0.3.0`.
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: run one downstream Flue KB search and one relation query with runtime telemetry capture enabled and confirm telemetry records the expected query shape and result ids.
- Automated coverage: `npm test`; `npm run typecheck`
- Needs iteration: no
- Follow-up: verify one downstream runtime consumer records and routes the telemetry fields as expected.

## 2026-05-13 - Provenance Freshness And Supersession Metadata

- Area: package, CLI command, adapter, subsystem
- Merged to `main`: yes
- Commit / PR: `0bb31c1`
- Feature summary: added raw source provenance, supersession links, freshness metadata, and review timestamps across `kb-core`, CLI validation, and the Flue adapter; doctor checks now flag missing supersession targets, supersession cycles, and `fresh` records that lack a review timestamp.
- Customer-visible impact: operators and downstream agents can track which records supersede older facts, preserve source provenance, and enforce freshness hygiene through the existing write and doctor surfaces.
- Deployment status: deployed
- Deployment date: 2026-05-13
- Deployment environment: GitHub Packages
- Deployment evidence: release tag `v1.0.1`; GitHub Actions publish run `25809920094`; published `@emmassist-co/kb-core@0.2.0`, `@emmassist-co/kb-storage-file@0.1.2`, `@emmassist-co/kb-storage-cloudflare@0.1.2`, and `@emmassist-co/kb-http@0.1.2`.
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow: write one entity and one source with freshness metadata and supersession targets, then run the doctor flow and confirm valid metadata passes while broken references or missing review timestamps are reported.
- Automated coverage: `npm test`; `npm run typecheck`
- Needs iteration: no
- Follow-up: bump and publish the affected KB packages, then verify one real metadata round-trip from a downstream consumer.

## 2026-05-13 - Compact Sync And Daemon Output

- Area: CLI command
- Merged to `main`: yes
- Commit / PR: `0e38c44`
- Feature summary: `kb sync` and `kb daemon` now default to compact JSON envelopes for agents, with opt-in detail via `--verbose`, `--changes`, `--conflicts`, `--stats`, and `--logs`; subcommand flags are forwarded correctly to sync/daemon handlers.
- Customer-visible impact: operators and agents get lower-token default output and explicit progressive-disclosure flags; consumers relying on the previous raw default payload must switch to `--verbose`.
- Deployment status: deployed
- Deployment date: 2026-05-13
- Deployment environment: GitHub Packages
- Deployment evidence: release tag `v1.0.1`; GitHub Actions publish run `25809920094`; published `@emmassist-co/kb-cli@1.0.1`.
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow:
- Automated coverage: `npx tsx --test tests/kb-cli.test.ts`, `npx tsx --test tests/kb-r2-sync.test.ts`, `npm run typecheck`
- Needs iteration: no
- Follow-up: publish `@emmassist-co/kb-cli@1.0.0` and manually verify one real `kb:sync` / `kb:daemon status` flow from `administrative`.
