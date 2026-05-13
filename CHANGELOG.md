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

## 2026-05-13 - Provenance Freshness And Supersession Metadata

- Area: package, CLI command, adapter, subsystem
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: added raw source provenance, supersession links, freshness metadata, and review timestamps across `kb-core`, CLI validation, and the Flue adapter; doctor checks now flag missing supersession targets, supersession cycles, and `fresh` records that lack a review timestamp.
- Customer-visible impact: operators and downstream agents can track which records supersede older facts, preserve source provenance, and enforce freshness hygiene through the existing write and doctor surfaces.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
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
- Merged to `main`: no
- Commit / PR: pending
- Feature summary: `kb sync` and `kb daemon` now default to compact JSON envelopes for agents, with opt-in detail via `--verbose`, `--changes`, `--conflicts`, `--stats`, and `--logs`; subcommand flags are forwarded correctly to sync/daemon handlers.
- Customer-visible impact: operators and agents get lower-token default output and explicit progressive-disclosure flags; consumers relying on the previous raw default payload must switch to `--verbose`.
- Deployment status: pending
- Deployment date:
- Deployment environment:
- Deployment evidence:
- Human testing status: pending
- Human tester:
- Human test date:
- Human test environment:
- Human test flow:
- Automated coverage: `npx tsx --test tests/kb-cli.test.ts`, `npx tsx --test tests/kb-r2-sync.test.ts`, `npm run typecheck`
- Needs iteration: no
- Follow-up: publish `@emmassist-co/kb-cli@1.0.0` and manually verify one real `kb:sync` / `kb:daemon status` flow from `administrative`.
