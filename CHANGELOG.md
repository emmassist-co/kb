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
