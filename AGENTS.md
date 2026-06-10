# KB Monorepo Agent Guide

This repository is the source of truth for shared KB packages published under `@emmassist-co/*`.

## Working Rules

- Be terse and operational.
- Prefer clear, easy-to-reason code over backward-compatibility unless explicitly requested.
- Avoid touching generated artifacts unless the task requires it.
- Prefer read-first investigation before risky writes.
- Use test-first changes for behavior changes and bug fixes.

## Changelog Discipline

Keep [CHANGELOG.md](./CHANGELOG.md) current.

When work is merged to `main`, the responsible agent must append or update an entry immediately. Do not treat release follow-through as complete until the entry exists.

Each entry must record:

- feature summary
- customer-visible impact, or `none`
- deployment status
- human testing status
- iteration status

`Human testing` requires a real person to manually exercise the changed CLI flow, HTTP flow, adapter path, or operator workflow. Automated tests, CI, and typecheck do not satisfy that field by themselves.

Before deployment or release communication, review `CHANGELOG.md` for entries still marked:

- `Deployment status: pending`
- `Human testing status: pending`
- `Needs iteration: yes`

## Package Ownership

The packages in `packages/` are the canonical implementations. Do not land feature work only in downstream repos if the behavior belongs in one of these packages.

- `packages/kb-core`
- `packages/kb-storage-file`
- `packages/kb-storage-cloudflare`
- `packages/kb-http`
- `packages/kb-cli`
- `packages/kb-flue-adapter`
- `packages/kb-autoresearch`

If a downstream repo has copied package code, treat that copy as migration debt unless the downstream repo clearly documents a deliberate fork.

## Semver

Follow semantic versioning strictly for every published `@emmassist-co/*` package.

- `patch`: bug fixes, internal refactors with no public behavior change, docs-only changes, dependency updates with no public API impact
- `minor`: new backward-compatible commands, flags, exports, capabilities, skills, or behavior that existing consumers do not need to change for
- `major`: breaking CLI changes, removed commands/flags/exports, changed defaults that can alter existing behavior, changed response shapes, changed package names, or required migration steps

When unsure between `patch` and `minor`, prefer `minor`.
When unsure whether something is breaking, treat it as breaking until proven otherwise.

## Release Discipline

Before changing a package version:

1. Identify which package or packages changed.
2. State the intended semver bump and why.
3. Verify any dependent package ranges that also need updating.
4. Update package docs if the public surface changed.
5. Run the package-specific tests plus any affected integration tests.

For any change to a published package under `packages/`:

1. Treat the version bump as part of the implementation, not optional release cleanup.
2. Do not consider the work complete until the changed package version is updated in its `package.json`.
3. If local packages depend on the changed package, update their dependency ranges in the same work.
4. If downstream repos are part of the rollout, update them to the released version after publish. Do not leave them on `file:` links unless that is an explicit temporary local-dev choice.
5. If a public change lands without a version bump, fix that before any release communication or downstream upgrade.

For public-surface changes, include a short release note in the commit or PR description covering:

- what changed
- who is affected
- whether migration is required

## Publishing

Do not publish casually.

Before publishing a package:

1. Ensure the package version is bumped intentionally.
2. Ensure dependent local packages reference the correct new version range.
3. Ensure README / setup docs match the published behavior.
4. Run `npm test` and `npm run typecheck`.
5. Run targeted package tests for the changed surface.
6. Confirm the package is ready for GitHub Packages release.

If a downstream repo depends on a published package version, do not tell users a feature exists until the package has actually been released.

## Local Vs Runtime Surfaces

Be explicit about environment-specific command surfaces.

- Local operator commands may exist only in `kb-cli`.
- Runtime / worker-facing surfaces must stay narrower when appropriate.
- Do not leak local-only commands into runtime help or runtime skills unless that is an intentional product decision.

## Verification

At minimum for package changes:

- `npm test`
- `npm run typecheck`

Also run focused tests for touched packages, for example:

- `npx tsx --test tests/kb-cli.test.ts`
- `npx tsx --test tests/kb-cli-docs.test.ts`

For KB MCP changes, do not stop at package tests if the work affects registration, transport, or agent-consumption flow. Use the repo-local smoke helpers:

- `npm run serve:kb-mcp-stdio -- --tenant-id <tenant>` to expose the KB MCP surface over stdio against a local file-backed workspace
- `npm run smoke:kb-mcp -- --tenant-id <tenant>` to run a real MCP client against the Worker-shaped KB MCP HTTP surface and verify actual KB tool round-trips like `capabilities`, `record`, `search`, and `inspect`
- `npm run smoke:kb-mcp -- --transport stdio --tenant-id <tenant>` when you specifically need the local stdio registration path
- `npm run smoke:codex-mcp -- --tenant-id <tenant>` only when you specifically need to diagnose Codex-session MCP registration behavior on top of the protocol-level smoke

What these prove:

- `serve:kb-mcp-stdio` proves the MCP server boots and exposes the local KB tool surface
- `smoke:kb-mcp` proves the KB functions actually work over MCP through the Worker-shaped HTTP transport path
- `smoke:codex-mcp` proves a separate Codex session can see the registered KB MCP server and attempt to use it

If `smoke:codex-mcp` fails, distinguish:

- provider/network failures in the Codex session
- MCP registration visibility failures
- MCP tool-call cancellation or approval behavior inside Codex

Do not claim KB MCP end-to-end verification unless you state which of those layers actually passed.

## Benchmark Discipline

Benchmarks are a critical public surface in this repo.

For any major KB change, do not stop at tests and typecheck. Rerun the benchmark rails and refresh the published benchmark snapshot before calling the work done.

Major changes include:

- retrieval or ranking logic changes
- graph extraction or relation-model changes
- storage, indexing, sync, or migration changes that can alter answer quality
- benchmark corpus or benchmark runner changes
- major CLI or HTTP behavior changes that alter the KB contract

Required benchmark commands for those changes:

- `npm run eval:kb:all -- --json`
- `npm run eval:kb:admin-world -- --split dev --json`
- `npm run eval:kb:admin-world -- --split holdout --json`
- `npm run eval:kb:gbrain-world -- --json`

If the measured benchmark posture changes materially, update:

- `README.md`
- `docs/benchmarks/kb-scorecard-latest.md`
- `docs/benchmarks/kb-scorecard-latest.json`

Do not describe a major KB change as complete if the benchmark snapshot is stale relative to the code.
