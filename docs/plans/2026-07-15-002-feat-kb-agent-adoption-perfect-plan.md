---
title: "feat: make KB frictionless for agent adoption"
type: feat
status: completed
date: 2026-07-15
---

# feat: make KB frictionless for agent adoption

## Summary

Make the published KB stack feel first-class for coding agents in a fresh folder: a clean install, an obvious `kb` command, reliable skill installation from the installed package, copy/paste local and remote setup, and automated smoke tests that prove an agent can inspect, write, search, and load the KB skills without reading repo internals.

---

## Problem Frame

The current release works, but the adoption surface still carries friction:

- the executable is named `kb-local` even though it can target local folders, local daemons, remote HTTP, Cloudflare, and support mirrors
- skill docs point primarily at GitHub tree URLs, which can be slow or clone-timeout-prone for `npx skills add`
- clean-folder validation is manual rather than encoded as a repo smoke rail
- docs do not yet present a single agent bootstrap recipe that proves both CLI and skill readiness
- MCP/client setup exists, but it is not packaged as an agent-readiness checklist alongside local CLI skills

The goal is not to add a new memory system. It is to remove naming, install, skill, and verification friction so an agent can confidently use KB from a fresh project folder.

---

## Requirements

**CLI and naming**

- R1. The published CLI must expose `kb` as the preferred binary name while preserving `kb-local` as a backward-compatible alias.
- R2. Help, README, package docs, and skills must prefer `kb` in new examples without breaking existing `kb-local` commands.
- R3. Tests must prove both `kb` and `kb-local` execute the same core local inspect/write/search path.

**Agent skill installation**

- R4. Docs must prefer installing KB skills from the already-installed package path under `node_modules/@emmassist-co/kb-cli/skills/...`, avoiding full repository clones for normal consumers.
- R5. GitHub URL skill installation must remain documented as a source install fallback, but not as the default path for fresh folder setup.
- R6. Skills must satisfy the expected shape: `SKILL.md`, frontmatter name/description, optional agent metadata under `agents/openai.yaml`, and `npx skills use` renders usable prompt text.
- R7. The normal agent skill set must include local setup, write discipline, and Cloudflare setup; each skill must describe when to search, record, remember, relate, annotate, validate, and inspect.

**Fresh-folder agent readiness**

- R8. The repo must include a clean-folder smoke script that installs the published package or local packed tarball, configures `KB_ROOT_DIR`, runs `kb inspect`, writes a memory, searches it, installs skills, and verifies skill discovery.
- R9. The smoke must be runnable locally and in CI without contacting real Cloudflare services or needing a live agent model.
- R10. The smoke must catch the registry regression already observed: `--registry=https://npm.pkg.github.com` globally breaks public dependencies, while `--@emmassist-co:registry=https://npm.pkg.github.com` works.

**MCP and remote agent clarity**

- R11. Docs must include a concise decision table: use CLI skills for command-running agents, `/mcp` for MCP-aware clients, and `KB_BASE_URL` + `KB_API_TOKEN` for deployed/serverless agents.
- R12. MCP docs must include an agent-facing readiness check that proves tool listing and at least one read/write round trip through existing smoke helpers.
- R13. Docs must avoid implying that skills auto-configure every IDE/MCP host; they should state what KB owns and what client-specific setup remains manual.

**Release and supportability**

- R14. Any public package changed by the work must receive an intentional semver bump and changelog entry before release.
- R15. README and package docs must keep workspace/folder/namespace wording and avoid public-facing tenant language.
- R16. The final release must publish the updated package(s) and record verification evidence in `CHANGELOG.md`.

---

## Key Technical Decisions

- KTD1. Prefer `kb`, keep `kb-local` forever-compatible for now. The binary name should match the product and all transports, but removing `kb-local` would break existing users and docs. Add a `kb` bin alias first, then migrate examples.
- KTD2. Use package-local skill installation as the default. After `npm install @emmassist-co/kb-cli`, consumers already have the skills under `node_modules`; `npx skills add ./node_modules/...` avoids cloning the full repo and is more reliable for agents in constrained environments.
- KTD3. Keep skills as plain OpenClaw-style folders, not a custom KB-only installer. Standards compliance matters more than inventing a special agent bootstrap protocol. A CLI helper can print commands later, but the skill artifacts should remain ordinary `SKILL.md` folders.
- KTD4. Prove agent readiness with deterministic smokes, not a live model. A real agent session is useful human evidence, but CI should verify the command surfaces and skill packaging without depending on model auth, provider latency, or tool-call behavior.
- KTD5. Keep MCP adjacent to skills. Skills teach command-running agents how to use `kb`; MCP is the transport for MCP-aware clients. The docs should explain both, but not conflate skill installation with MCP registration.

---

## High-Level Technical Design

```mermaid
flowchart TB
  Fresh[Fresh project folder] --> Install[npm install @emmassist-co/kb-cli with scoped registry]
  Install --> Bin[kb and kb-local bins]
  Install --> SkillFiles[node_modules/@emmassist-co/kb-cli/skills]
  Bin --> Local[KB_ROOT_DIR local file workspace]
  Bin --> Remote[KB_BASE_URL + KB_API_TOKEN remote HTTP]
  Bin --> Cloudflare[kb cloudflare deploy / verify]
  SkillFiles --> Skills[npx skills add ./node_modules/...]
  Skills --> Agent[Codex / Claude / Pi / Cursor / other command-running agent]
  Agent --> Bin
  McpClient[MCP-aware client] --> MCP[/mcp endpoint]
  MCP --> Core[shared KB service]
  Bin --> Core
```

The implementation should produce two adoption paths that are both first-class:

1. **Command-running agent path:** install `@emmassist-co/kb-cli`, install the KB skills from `node_modules`, set `KB_ROOT_DIR` or `KB_BASE_URL`, then use `kb` commands.
2. **MCP-aware client path:** configure `/mcp` with the same bearer token as `/v1`, then verify with existing MCP smoke helpers.

---

## Scope Boundaries

- Do not remove `kb-local`.
- Do not implement a new storage backend.
- Do not add full OAuth or per-client MCP installers.
- Do not claim that every agent runtime auto-loads skills the same way; document supported `npx skills` installation and leave runtime-specific activation to the user/host.
- Do not rely on a live Codex/Claude/Pi model call for CI pass/fail.
- Do not rebrand internal compatibility names like `tenantId` unless a unit explicitly touches public docs/help.

---

## Implementation Units

### U1. Add the `kb` binary alias and migrate examples

- **Goal:** Make `kb` the preferred command while keeping `kb-local` working.
- **Files:** `packages/kb-cli/package.json`, `packages/kb-cli/bin/kb-local.mjs`, `packages/kb-cli/README.md`, `README.md`, `docs/consumer-quickstart.md`, `docs/cloudflare-agent-setup.md`, `docs/product/deployment-model.md`, `packages/kb-cli/skills/kb-local-setup/SKILL.md`, `packages/kb-cli/skills/kb-write/SKILL.md`, `packages/kb-cli/skills/kb-cloudflare-setup/SKILL.md`, `tests/kb-cli.test.ts`, `tests/kb-cli-docs.test.ts`, `CHANGELOG.md`
- **Approach:** Add a second `bin` entry named `kb` that points to the same executable as `kb-local`, then update new user-facing examples to prefer `kb`. Keep compatibility notes and a few explicit `kb-local` references where needed for migration.
- **Patterns to follow:** current `kb-local` bin behavior in `packages/kb-cli/bin/kb-local.mjs`; CLI invocation tests in `tests/kb-cli.test.ts`; public docs assertions in `tests/kb-cli-docs.test.ts`.
- **Test scenarios:**
  - `npx kb inspect` works with `KB_ROOT_DIR` in a temp folder.
  - `npx kb-local inspect` still works with the same folder.
  - `kb` and `kb-local` write/search commands return equivalent results for the same payload.
  - Docs tests assert README/package docs prefer `kb` while preserving a compatibility mention for `kb-local`.
- **Verification:** Local CLI tests pass and published package contents include both bin names.

### U2. Make package-local skill installation the default path

- **Goal:** Make skills reliable to install after package installation without cloning the full GitHub repo.
- **Files:** `README.md`, `docs/consumer-quickstart.md`, `packages/kb-cli/README.md`, `packages/kb-cli/skills/kb-local-setup/SKILL.md`, `packages/kb-cli/skills/kb-write/SKILL.md`, `packages/kb-cli/skills/kb-cloudflare-setup/SKILL.md`, `tests/kb-cli-docs.test.ts`
- **Approach:** Change the default skill install examples to use local package paths such as `npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-write`. Keep GitHub tree URLs as a source-install fallback for contributors or no-package contexts.
- **Patterns to follow:** current skill install docs in `docs/consumer-quickstart.md`; package `files` list already includes `skills` in `packages/kb-cli/package.json`.
- **Test scenarios:**
  - Docs include package-local `npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-write`.
  - Docs include all three normal skills: `kb-local-setup`, `kb-write`, `kb-cloudflare-setup`.
  - Docs still mention GitHub URL install only as a fallback/source path.
  - Docs do not tell users to globally set `--registry=https://npm.pkg.github.com`.
- **Verification:** Docs test protects the default skill install path.

### U3. Add an agent-readiness smoke script

- **Goal:** Encode the fresh-folder manual test as a repeatable smoke.
- **Files:** `scripts/kb-agent-readiness-smoke.ts`, `package.json`, `tests/kb-cli-docs.test.ts`, `README.md`, `docs/consumer-quickstart.md`
- **Approach:** Create a script that builds/packs or installs the current `@emmassist-co/kb-cli`, creates a temp project, installs the package with a scoped registry override, sets `KB_ROOT_DIR`, runs `kb inspect`, writes with `remember --json -`, searches with `search --json`, installs skills from `node_modules` using `npx skills add`, and checks `npx skills list --json` for expected skill names. Provide flags for `--published` versus `--local-pack` so release validation can test the published package while CI can test the working tree.
- **Patterns to follow:** existing smoke helpers in `scripts/kb-mcp-smoke.ts` and `scripts/kb-verify.ts`; node test command wiring in `package.json`; temp workspace patterns in `tests/kb-cli.test.ts`.
- **Test scenarios:**
  - Local-pack mode passes without network access to GitHub skill URLs.
  - Published mode can be run manually against `@emmassist-co/kb-cli@latest` or an explicit version.
  - The script fails if `kb` bin is missing, if package-local skills are missing, or if search cannot retrieve the written memory.
  - The script fails fast with a clear message if `npx skills` is unavailable or cannot install local skill paths.
- **Verification:** `npm run smoke:kb-agent-readiness -- --local-pack` passes locally and in CI.

### U4. Tighten skill standards and agent operating content

- **Goal:** Make the packaged skills maximally model-friendly and standards-compliant.
- **Files:** `packages/kb-cli/skills/kb-local-setup/SKILL.md`, `packages/kb-cli/skills/kb-write/SKILL.md`, `packages/kb-cli/skills/kb-cloudflare-setup/SKILL.md`, `packages/kb-cli/skills/*/agents/openai.yaml`, `tests/kb-cli-docs.test.ts`
- **Approach:** Audit each skill for concise trigger language, required ask-first inputs, safe command patterns, JSON payload handling, local/remote distinction, and compatibility with `kb` plus `kb-local`. Keep `agents/openai.yaml` minimal and consistent. Add a docs/standards test that verifies every packaged skill has frontmatter, a name, description, and no stale install commands.
- **Patterns to follow:** current three skill folders under `packages/kb-cli/skills`; prior docs tests in `tests/kb-cli-docs.test.ts`.
- **Test scenarios:**
  - Each skill has `SKILL.md` with `name` and `description` frontmatter.
  - Each skill has `agents/openai.yaml` with display metadata.
  - `kb-write` includes the default write split: `remember`, `record`, `relate`, `annotate`, `validate`, `query-relations`.
  - `kb-local-setup` includes install, `KB_ROOT_DIR`, `KB_WORKSPACE_ID`, inspect, and daemon mode.
  - `kb-cloudflare-setup` includes `KB_BASE_URL`, `KB_API_TOKEN`, `/mcp`, and Cloudflare verify.
- **Verification:** Docs tests fail on missing or drifted skill standards.

### U5. Document and verify MCP/client adoption separately from skills

- **Goal:** Make it clear when an agent should use CLI skills versus MCP, and how to verify each path.
- **Files:** `README.md`, `docs/consumer-quickstart.md`, `packages/kb-mcp/README.md`, `docs/cloudflare-agent-setup.md`, `packages/kb-cli/skills/kb-cloudflare-setup/SKILL.md`, `tests/kb-cli-docs.test.ts`
- **Approach:** Add a short matrix for command-running agents, MCP-aware clients, and deployed/serverless callers. Keep MCP setup focused on `/mcp`, bearer token, and the existing smoke helpers. Avoid claiming automatic IDE config for every host.
- **Patterns to follow:** existing architecture map in `README.md`; MCP package README; smoke commands `npm run smoke:kb-mcp` and `npm run smoke:codex-mcp`.
- **Test scenarios:**
  - Docs state CLI skills are for command-running agents.
  - Docs state `/mcp` is for MCP-aware clients.
  - Docs state `KB_BASE_URL` + `KB_API_TOKEN` is for remote HTTP/deployed agents.
  - Docs include the MCP smoke commands using `--workspace-id`.
  - Docs do not imply skills auto-configure every MCP host.
- **Verification:** Docs tests pass and public docs present one coherent adoption matrix.

### U6. Release the agent-adoption polish

- **Goal:** Publish the corrected CLI and docs as a package release with explicit evidence.
- **Files:** `packages/kb-cli/package.json`, `package-lock.json`, `CHANGELOG.md`, optionally affected package READMEs if U5 changes `kb-mcp` docs materially.
- **Approach:** Bump `@emmassist-co/kb-cli` at least patch for the new `kb` bin and packaged skill docs. If `packages/kb-mcp/README.md` changes only docs, decide whether a patch release is warranted; if package contents change, bump intentionally. Record release note fields required by `AGENTS.md`.
- **Patterns to follow:** recent release evidence entries in `CHANGELOG.md`; package version discipline in `AGENTS.md`.
- **Test scenarios:**
  - `npm run typecheck` passes.
  - `npm test` passes.
  - `npm run check:kb:anti-cheat` passes.
  - `npm run smoke:kb-agent-readiness -- --local-pack` passes.
  - After publish, `npm run smoke:kb-agent-readiness -- --published @emmassist-co/kb-cli@<version>` passes.
- **Verification:** Published package version is visible from GitHub Packages, changelog records deployment evidence, and main CI is green.

---

## Acceptance Examples

- AE1. Given a fresh folder with no repo state, when an operator runs the documented install command, then public npm dependencies resolve from npm and `@emmassist-co/*` packages resolve from GitHub Packages.
- AE2. Given that same folder, when the operator sets `KB_ROOT_DIR` and runs `npx kb inspect`, then the CLI reports a file-backed `local-development` workspace.
- AE3. Given a command-running agent with the KB skills installed from `node_modules`, when it needs to store a durable fact, then the `kb-write` skill tells it to validate or pipe JSON into `kb remember --json -` rather than inventing fragile inline flags.
- AE4. Given an existing user still running `npx kb-local inspect`, when they upgrade, then their command still works.
- AE5. Given an MCP-aware client, when the operator reads the docs, then they can distinguish MCP endpoint configuration from CLI skill installation and run the correct smoke for each.

---

## Risks & Dependencies

- **Binary name conflict:** `kb` may conflict with another executable in a consumer environment. Keeping `kb-local` as an alias mitigates this, and docs can say `kb-local` remains available if `kb` is occupied.
- **Skills CLI behavior:** `npx skills` behavior is external and may change. The smoke should pin only the behavior KB relies on: local path install, `skills list --json`, and `skills use` prompt rendering.
- **Published package registry:** GitHub Packages requires auth for some consumers. Docs should be honest that `@emmassist-co` packages come from GitHub Packages and public dependencies still come from npm.
- **Model behavior not guaranteed:** Skills improve agent usage but cannot force every model to search/write correctly. The docs should claim installability and guidance, not perfect autonomous compliance.

---

## System-Wide Impact

This change widens the CLI's public command surface by adding `kb` as a bin alias and changes the recommended agent installation path. It does not change `kb-core` retrieval semantics, storage formats, HTTP routes, MCP tools, or Cloudflare runtime behavior. The main release impact is package metadata, docs, skill packaging, and smoke verification.

---

## Documentation / Operational Notes

- Update examples to prefer `kb`, but include a compatibility note for `kb-local`.
- Make the fresh-folder command block easy to copy:

```bash
npm install @emmassist-co/kb-cli --@emmassist-co:registry=https://npm.pkg.github.com
export KB_ROOT_DIR="$PWD/.kb"
npx kb inspect
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-local-setup
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-write
```

- Keep Cloudflare/MCP setup visibly separate from local CLI skill setup.

---

## Sources / Research

- `packages/kb-cli/package.json` currently publishes only the `kb-local` bin and includes `skills` in package files.
- `packages/kb-cli/skills/kb-local-setup/SKILL.md`, `packages/kb-cli/skills/kb-write/SKILL.md`, and `packages/kb-cli/skills/kb-cloudflare-setup/SKILL.md` are already installable skill folders with `agents/openai.yaml` metadata.
- Fresh-folder manual smoke proved `@emmassist-co/kb-cli@1.6.1` can inspect, remember, and search with `KB_ROOT_DIR` after install using `--@emmassist-co:registry=https://npm.pkg.github.com`.
- Manual `npx skills add` testing proved package/repo skill folders can install into project agent skill directories and `npx skills use` can render the `kb-write` prompt.
- `docs/consumer-quickstart.md`, `README.md`, and `packages/kb-cli/README.md` are the primary public adoption surfaces.
