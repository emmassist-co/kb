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
