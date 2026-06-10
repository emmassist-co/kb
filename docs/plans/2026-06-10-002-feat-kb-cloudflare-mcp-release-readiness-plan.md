---
title: "feat: Close release-readiness gaps for the Cloudflare KB MCP surface"
type: feat
status: completed
date: 2026-06-10
---

# feat: Close release-readiness gaps for the Cloudflare KB MCP surface

## Summary

The shared-secret Cloudflare KB MCP surface is implemented and locally proven, but the release bar is not met yet. The missing work is to make the deployed `/mcp` path provable, repeatable, and legible to outside consumers without reopening the auth model or changing the product shape established in `docs/plans/2026-06-10-001-feat-kb-cloudflare-mcp-surface-plan.md`.

---

## Problem Frame

The repo now has the important first-pass pieces:

- one shared bearer-token model across `/v1` and `/mcp`
- a Worker-facing `kb-mcp` package
- a Cloudflare deploy path in `kb-cli`
- a real local MCP smoke that proves KB functions work over stdio

What is still missing is the confidence layer around the deployed story:

- no reusable transport-level proof for the Worker-hosted `/mcp` surface
- no first-class post-deploy verification flow separate from deployment
- no external-client-oriented usage example for authenticated HTTP MCP
- no explicit package-release/readiness checklist tailored to `kb-mcp`

That means the current state is "implemented and locally verified" rather than "ready to ship and support."

---

## Requirements

### Deployed Verification

- R1. The repo must be able to verify the Cloudflare-style `/mcp` HTTP surface through a real MCP client path, not only through local stdio transport.
- R2. Post-deploy verification must be runnable independently of `kb cloudflare deploy`, so operators can recheck a host without redeploying it.
- R3. Verification must prove both auth and behavior: the same API key reaches `/v1` and `/mcp`, and real KB MCP tools still function over the deployed transport shape.

### Operator Surface

- R4. `kb-cli` must expose a clear verification surface for deployed Cloudflare KB hosts instead of hiding all checks inside the deploy command.
- R5. The operator flow must stay shared-secret only in v1. Do not widen scope into OAuth, user login, or control-plane brokering.

### Consumer Clarity

- R6. Public docs must show one concrete external MCP consumer setup against a protected `/mcp` endpoint using an API key.
- R7. The docs must distinguish local stdio proof, deployed HTTP proof, and Codex-specific debugging so future agents and users do not confuse them.

### Package Readiness

- R8. `packages/kb-mcp` must meet the same public-package bar as the other KB packages: clear README, explicit export story, versioning discipline, and consumer-oriented verification notes.
- R9. Release artifacts must make the remaining human step explicit: one real Cloudflare deploy and one real external-client check before public release communication.

---

## Assumptions

- Shared-secret bearer auth is the intended v1 production model.
- The canonical production runtime remains one Cloudflare Worker exposing both `/v1` and `/mcp`.
- Human testing is still required before release even if automated transport smokes are added.

---

## Scope Boundaries

### In Scope

- deployed `/mcp` transport verification
- standalone post-deploy verification in `kb-cli`
- external-client docs for API-key-protected MCP
- package and release-readiness polish for `kb-mcp`

### Deferred

- OAuth or protected-resource metadata as a supported production auth mode
- richer CLI remote profile management
- multi-tenant broker or hosted control plane features

---

## Key Technical Decisions

- KTD1. Treat the missing work as release-readiness hardening, not another protocol redesign.
  The architecture is already chosen. The gap is reusable proof and supportability.

- KTD2. Add a standalone verification surface to `kb-cli` instead of forcing operators to redeploy for every check.
  Deployment and verification are related but distinct operational actions.

- KTD3. Prove deployed MCP through the real HTTP transport shape.
  The existing stdio smoke is necessary but insufficient for the Cloudflare-hosted claim.

- KTD4. Document one outside-consumer path explicitly.
  "MCP available at `/mcp`" is not enough for adoption unless a user can copy a known-good authenticated example.

---

## Risks And Dependencies

- MCP HTTP transport details are less stable than the local stdio story, so tests should target the narrowest standards-compliant behavior rather than overfit to one client.
- If verification only checks `tools/list`, the repo can still miss regressions in tool execution over `/mcp`.
- If the only external proof remains a one-off manual deploy, supportability will drift again after the next refactor.

---

## Implementation Units

### U1. Add standalone deployed-host verification to `kb-cli`

- **Goal:** Let operators verify an existing Cloudflare KB host without redeploying it.
- **Requirements:** R2, R3, R4, R9
- **Dependencies:** none
- **Files:** `packages/kb-cli/src/index.ts`, `packages/kb-cli/src/cloudflare-deploy.ts`, `packages/kb-cli/README.md`, `tests/kb-cli.test.ts`
- **Approach:** Extract the existing `/v1/capabilities` and `/mcp` verification logic behind a reusable helper, then expose it as a dedicated command such as `kb cloudflare verify`. The command should accept `KB_BASE_URL` and `KB_API_TOKEN` or explicit flags, and should report both capability metadata and MCP verification results.
- **Patterns to follow:** existing deploy verification path in `packages/kb-cli/src/cloudflare-deploy.ts`; existing env-driven remote auth in `packages/kb-cli/src/remote-auth.ts`
- **Test scenarios:**
  - `kb cloudflare verify` succeeds against a mock protected host when `/v1/capabilities` and MCP tool listing both succeed.
  - verification fails cleanly on missing token with an operator-readable error.
  - verification fails cleanly when `/v1` succeeds but `/mcp` rejects auth or returns a non-OK status.
  - verification output includes tenant/backend/canonical/workspace-role fields plus MCP status.
- **Verification:** An operator can check a deployed host repeatedly without re-running `wrangler deploy`.

### U2. Add a real HTTP MCP smoke for the Worker-hosted surface

- **Goal:** Prove that KB MCP tools work over the Cloudflare-style HTTP boundary, not just stdio.
- **Requirements:** R1, R3, R7
- **Dependencies:** U1 is not required but shares verification helpers if useful
- **Files:** `packages/kb-mcp/src/cloudflare-worker.ts`, `tests/kb-mcp.test.ts`, `scripts/kb-mcp-smoke.ts`, `package.json`
- **Approach:** Stand up the Worker fetch adapter in-process in tests or a smoke helper and drive it through a real MCP HTTP client path. The proof should execute at least one read and one write KB tool through `/mcp`, not only `tools/list`.
- **Patterns to follow:** current stdio smoke in `scripts/kb-mcp-smoke.ts`; protected `/mcp` test coverage already started in `tests/kb-mcp.test.ts`
- **Test scenarios:**
  - authenticated HTTP MCP client can connect, list tools, call `record`, and then call `search` successfully.
  - missing or invalid bearer token yields the expected auth failure on `/mcp`.
  - read-only scope cannot execute write tools over MCP.
  - HTTP smoke uses the same capability and storage behavior already proven by the stdio smoke.
- **Verification:** The repo has an automated proof that the Worker-hosted MCP transport actually executes KB tools over HTTP.

### U3. Document one external MCP client setup against the protected endpoint

- **Goal:** Make the public story copyable for users who want to connect to the deployed KB over MCP.
- **Requirements:** R6, R7, R8
- **Dependencies:** U1, because docs should point to the standalone verify path
- **Files:** `packages/kb-mcp/README.md`, `docs/cloudflare-agent-setup.md`, `docs/consumer-quickstart.md`, `packages/kb-cli/skills/kb-cloudflare-setup/SKILL.md`, `tests/kb-cli-docs.test.ts`
- **Approach:** Add one concrete example showing base URL, API key placement, and a quick verification sequence. Keep it client-agnostic unless one specific client is already a repo standard.
- **Patterns to follow:** current Cloudflare setup guide and consumer quickstart structure
- **Test scenarios:**
  - docs mention the standalone verify command and the local HTTP-vs-stdio distinction.
  - docs include `KB_BASE_URL`, `KB_API_TOKEN`, and `/mcp` in the same consumer path.
  - skill text and README stay aligned with the public docs.
- **Verification:** A new user can configure a protected deployed KB MCP endpoint without reading source code.

### U4. Finish package and release-readiness posture for `kb-mcp`

- **Goal:** Make `packages/kb-mcp` meet the same supportable release bar as the other public KB packages.
- **Requirements:** R8, R9
- **Dependencies:** U2 and U3
- **Files:** `packages/kb-mcp/package.json`, `packages/kb-mcp/README.md`, `CHANGELOG.md`, `README.md`
- **Approach:** Confirm semver intent, ensure package exports and docs match the shipped surface, and add release notes that explicitly separate automated verification from required human Cloudflare testing.
- **Patterns to follow:** repo release discipline in `AGENTS.md`; public package posture in other `packages/*/README.md`
- **Test scenarios:**
  - docs/tests assert the final exported surfaces and verification guidance.
  - changelog entry records deployment status and human testing status explicitly.
  - package metadata does not imply OAuth or unsupported hosted behavior.
- **Verification:** The package can be released without leaving hidden verification or support assumptions behind.

---

## Sequencing

1. U1 gives the repo a reusable deployed-host verification surface.
2. U2 upgrades protocol proof from local stdio only to real HTTP MCP execution.
3. U3 turns that verification story into copyable user guidance.
4. U4 closes release discipline and package-posture gaps before publish.

---

## Acceptance Bar

This follow-up is complete when all of the following are true:

- the repo has an automated HTTP MCP smoke, not just stdio proof
- `kb-cli` can verify an existing protected Cloudflare KB host without redeploying it
- docs show one concrete authenticated external MCP connection path
- `kb-mcp` release notes and package docs match the actual supported v1 story
- one real Cloudflare deploy and one real external-client human check remain the only release-gating manual steps
