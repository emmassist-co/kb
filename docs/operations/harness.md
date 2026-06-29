# Harness Guide

## Purpose

The harness is the structured execution layer around the agent.

In this product, the harness exists so the agent can run like software, not like a loose chatbot prompt.

It provides or shapes:

- session and task identity
- role and skill loading
- command and tool boundaries
- typed inputs and outputs
- structured traces
- local, CI, and deployed execution paths
- per-tenant runtime identity

It is also the main way we exercise the admin agent as an operator would use it:

- through the Flue webhook runtime
- with the real workspace context
- with the real `gws` command surface
- with tenant config and policy applied

This is not a toy demo path. It is the runtime contract and the shortest path to verify that the product contract still holds after a code change.

For deployed verification, the harness now also includes a protected KB parity operator surface used only by repo-side verification scripts. That surface exists to seed isolated KB fixtures, compare deployed retrieval against the local baseline, and prove the deployed worker can answer with seeded KB facts without widening the public runtime API.

## What The Harness Is

In this repository, the harness is Flue plus the runtime context we mount around it.

That combination currently includes:

- the Flue admin agent at `.flue/agents/admin.ts`
- the generated runtime workspace context from tenant runtime instructions and `.flue/runtime-skills/`
- the local webhook runtime from `flue dev --target cloudflare`
- the optional chat bridge that forwards Slack, Teams, Discord, Telegram, or WhatsApp messages into the same agent
- the mounted runtime commands such as `gws` and `kb`
- the session, usage, and persistence wiring around the runtime

Think of Flue here as the agent harness, not the full business operating system.

The harness is not the same thing as:

- the business workflow engine
- the approval system
- the canonical tenant database
- billing
- the full audit and operator product surface

Those remain product responsibilities outside the agent harness.

## Core Philosophy

The core split is:

> Code owns the process. The agent handles ambiguity.

The harness is the layer that lets us enforce that split.

The intended shape is:

```text
event or workflow
  -> agent skill or task
  -> structured output
  -> policy check
  -> deterministic action
  -> audit log
```

We do not want:

```text
prompt + tools + hope
```

## What Belongs In The Harness

The harness should own the mechanics that make agent execution operable and testable:

- sessions
- skills
- roles
- child tasks
- typed outputs
- tool boundaries
- structured traces
- local and CI execution
- production deployment path
- eval execution
- per-customer agent identities

The harness should expose deterministic tool and command surfaces, but it should not replace the rest of the product.

## What Does Not Belong In The Harness

The harness is not the whole product.

The product still needs:

- tenants
- connectors
- workflow engine
- approval system
- policy engine
- audit persistence
- billing
- canonical database
- document storage
- operator dashboard

When possible, keep product primitives independent from Flue-specific types so the harness can be replaced later without redefining the business model.

## Why We Use It

We want the shipped agent surface to run at the same layer customers actually buy:

- agent behavior, not only library behavior
- policy and skill selection, not only prompt snippets
- tenant-aware execution, not only local mocks
- command-driven actions, not hand-waved agent plans

If a feature only works in a unit test but breaks once the Flue runtime, skills, session state, or tenant overlay are involved, it is not done.

## Harness As Verification Surface

The harness is also the verification surface for this repository.

When we say "run it through the harness", we mean:

- run it through the real Flue runtime path
- inspect traces and structured behavior, not only prose
- verify that code, policy, and agent reasoning compose correctly

## Local Loop

Start the main runtime:

```bash
npm run dev
```

This runs `flue dev --target cloudflare` and exposes the admin agent on port `3583`.

Send a prompt through the harness:

```bash
curl -X POST http://localhost:3583/agents/admin/test-1 \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Use the gws-gmail skill to summarize unread email."}'
```

Trigger a skill directly when you want a narrower check:

```bash
curl -X POST http://localhost:3583/agents/admin/test-1 \
  -H 'Content-Type: application/json' \
  -d '{"skill":"gws-gmail-triage"}'
```

Start the chat bridge when you need transport coverage:

```bash
npm run chat:dev
```

## What Good Harness Use Looks Like

- Test through the webhook agent before assuming a change is correct.
- Prefer the smallest realistic prompt that proves the behavior.
- Use the real `gws` command and live `--help` output as the contract.
- Keep tenant selection explicit with `WORKSPACE_TENANT_ID` or `WORKSPACE_TENANT_CONFIG_JSON`.
- For risky flows, inspect first and prefer `--dry-run` where supported.

## Eval Philosophy

The harness is an eval surface, not just a manual demo surface.

We care most about:

- whether the agent chooses the right skill or command path
- whether policy and tenant config constrain behavior correctly
- whether the runtime preserves session and task state correctly
- whether the answer is operationally useful and auditable
- whether traces are good enough for review, replay, and regression checks

We care less about synthetic benchmark-style wins that bypass the real runtime contract.

For KB autoresearch specifically, do not treat every benchmark as an equal optimization target.

The staged benchmark policy is:

- optimize on `admin-world-v3 dev`
- confirm on `admin-world-v3 holdout`
- block regressions on `core-six`
- block external benchmark regressions on the real `gbrain-evals-upstream` rail
  The public command must compare `kb-upstream` against real `gbrain`; machine-only `kb-upstream` output is for autoresearch and scoring code.

`repo-docs` stays outside the hot autoresearch loop until the KB retrieval baseline is healthy enough to justify broader coverage again.

## What To Verify

For most product changes, verify some combination of:

- skill discovery and progressive disclosure still work
- `gws` raw methods and helpers still expose the expected interface
- new runtime command surfaces such as `docs` are reachable and return structured outputs
- typed command outputs and traces remain stable enough for evals
- tenant-specific instructions are present in runtime behavior
- session continuity works across follow-up turns
- chat ingress reaches the same agent behavior as direct webhook calls
- usage and state tracking still behave correctly in the active runtime

For `docs extract` specifically:

- stage a sample PDF in `/workspace`
- exercise a direct command path or prompt path that triggers `docs extract`
- verify the command returns structured JSON
- verify original and extracted artifacts are persisted under `/workspace/.artifacts/docs/`

## When Local Harness Checks Are Not Enough

Local checks are necessary but not always sufficient.

After changes to chat routing, Telegram behavior, session memory, webhooks, Cloudflare runtime state, or deploy config, run live deployment verification too:

```bash
npm run verify:deployment -- --base-url <https://public-host> --exec-base-url <https://exec-host> --worker <worker-name> --send-telegram-probe
npm run wrangler:auth -- tail <worker-name> --format pretty
```

For Telegram deployments, require one real human-driven round trip before calling the deploy verified:

- `/new`
- one short follow-up message
- one memory/session follow-up message

## Failure Modes The Harness Should Catch

- a skill exists in the repo but is not exposed correctly at runtime
- a helper is documented but not actually implemented
- a workflow step depends on free-form narration instead of structured outputs
- tenant config is missing, ignored, or overridden incorrectly
- chat transport reaches a different code path than direct webhook use
- state persistence differs between local Node and Cloudflare-backed execution
- the agent gives plausible text without executing the right command path

## Rule Of Thumb

If a change affects how the agent thinks, routes, executes, persists state, or obeys policy, run it through the harness.
