# Open Source Readiness Review: emmassist/kb

Date: `2026-06-11`

This review uses live repo truth from the staged public package set, CI workflows, public docs, and the current verification surface. The bundled `os_ready_audit.py` helper hung in this repo because the old default `npm test` path included the long-running benchmark harness. This branch fixes that by making `npm test` deterministic and keeping benchmark verification explicit.

## Overall Score Summary

| Principle | Score | Percentage | Status |
|-----------|-------|------------|--------|
| Licensing | 2/2 | 100% | ✅ |
| Docs & Onboarding | 3/3 | 100% | ✅ |
| Install & Test | 3/3 | 100% | ✅ |
| CI Automation | 2/2 | 100% | ✅ |
| Secret Hygiene | 2/2 | 100% | ✅ |
| Machine Independence | 2/2 | 100% | ✅ |
| Repo Hygiene | 2/3 | 67% | ⚠️ |
| Distribution Signals | 3/3 | 100% | ✅ |

**Overall Open Source Readiness Score: 95%**

## Top Recommendations By Impact

| Priority | Action | Principle | Effort |
|----------|--------|-----------|--------|
| P1 | Keep `npm test` fast and deterministic; keep benchmark rails explicit under `verify:kb:evals` and `test:bench` | Install & Test | low |
| P1 | Keep README quick-start and `docs/consumer-quickstart.md` aligned with the published packages | Docs & Onboarding | low |
| P2 | Keep public community docs (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`) current as maintainer processes evolve | Distribution Signals | low |
| P2 | Expect repo hygiene to return to green after these changes are committed | Repo Hygiene | low |

## Evidence

- `LICENSE` exists and package manifests declare `Apache-2.0`.
- `README.md` and `docs/consumer-quickstart.md` provide install, local, daemon, Cloudflare, MCP, and semantic-sync guidance.
- `.github/workflows/ci.yml` and `.github/workflows/publish.yml` exercise build, verification, typecheck, smoke, and eval rails.
- `.gitignore` excludes `.env*`, `.kb/`, `node_modules/`, and build artifacts.
- `package.json` exposes a public repository URL, homepage, bugs URL, deterministic `npm test`, and explicit benchmark verification commands.

## Remaining Caveats

- `tests/kb-benchmark.test.ts` remains valuable, but it is not the right default stranger smoke path. It now lives behind `npm run test:bench`, while the release bar for benchmark-sensitive changes remains `npm run verify:kb:evals`.
- The current worktree is intentionally dirty because this audit branch contains uncommitted readiness fixes. Once committed, the repo hygiene warning disappears.
