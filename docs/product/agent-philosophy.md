# Agent Philosophy

For the concrete repo-to-runtime assembly model, see [Runtime Workspace Architecture](./runtime-workspace-architecture.md).

## Product Position

This repository is not a generic chatbot starter.

It is a reusable base for a single-tenant commercial workspace agent:

- customer-agnostic at the repo level
- customer-specific at runtime through tenant config
- operational first, not conversational first
- built to execute auditable work across Google Workspace and supported chat integrations

## What We Are Building

The target agent behaves more like a finance or operations teammate than a general assistant.

That means:

- it works against real systems, not only text
- it uses commands and APIs as first-class tools
- it operates under policy
- it keeps customer boundaries strict
- it favors concrete output over broad advice

The quality bar is whether an operator could trust it with recurring work, not whether it sounds intelligent.

## Core Philosophy

### 1. Runtime over prompt theater

The product is the full runtime contract:

- generated runtime `/workspace/AGENTS.md`
- discovered runtime skills sourced from `.flue/runtime-skills/` and exposed in-sandbox at `.agents/skills/`
- tenant config
- Flue session and webhook runtime
- the `gws` command surface
- chat ingress and state handling

Do not treat the system prompt alone as the product.

### 2. Commands over descriptions

The agent should prefer doing work through `gws` and other runtime tools instead of narrating what a human should do.

Good output is:

- inspectable
- reproducible
- constrained by API contracts
- easy to audit after the fact

### 3. Policy over implication

High-risk behavior must be enforced by config, runtime rules, or command constraints.

Do not rely on the model merely “understanding” that a destructive action is risky.

### 4. Tenant isolation by design

Customer identity, locale, timezone, integrations, and action policy belong in the tenant layer.

The base repo should remain safe to:

- demo
- stage
- clone
- deploy for a new customer

without leaking another customer’s state or instructions.

### 5. Eval the shipped surface

We should evaluate the thing customers actually use:

- the Flue agent endpoint
- the generated workspace context
- the enabled skills
- the live command surface
- the deployed chat path when relevant

If we only test helpers in isolation, we miss the failures that matter.

## Using Flue Properly

Flue is the runtime substrate and agent harness, not just a build tool.

Use it properly by treating these as the primary path:

- define the real agent in `.flue/agents/admin.ts`
- run locally with `flue dev --target cloudflare`
- build and deploy with the same runtime assumptions
- rely on Flue session primitives instead of ad hoc memory glue
- keep workspace instructions and skills inside the generated context flow

What not to do:

- bypass Flue with a parallel agent architecture that becomes the real product
- hardcode local-only behavior that diverges from Cloudflare execution
- confuse repo-development guidance with the runtime agent contract
- depend on global user machine state for auth or command behavior

## Skill Philosophy

Skills should stay:

- discoverable
- short at the entrypoint
- detailed on demand
- tied to executable command paths

That matches the progressive-disclosure model already used in this repo. The agent should see enough to route correctly, then pull deeper instructions only when needed.

## Harness Philosophy

The harness is the structured execution layer that makes the philosophy above operable.

It should give us:

- sessions and task identity
- runtime roles and skills
- mounted commands and tool boundaries
- typed outputs
- traces
- local, CI, and production parity
- per-tenant agent identities

It is also how we verify the philosophy above in practice.

It exists to answer:

- does the agent route correctly?
- does it use the right command surface?
- does policy hold?
- does state persist correctly?
- does the deployed path behave like the local path?

If the harness says no, the feature is not ready.

## Definition Of “Good”

A good workspace agent in this repo:

- executes real tasks with minimal narration
- separates facts from assumptions
- prefers read-first investigation for risky actions
- keeps customer data and secrets contained
- behaves consistently across local and deployed runtime paths
- can be verified through concrete commands and traces

## Near-Term Product Shape

The current product shape is intentionally narrow:

- single-tenant beta
- operator-managed onboarding
- strong isolation per deployment
- Google Workspace plus supported chat ingress

That is a feature, not a temporary embarrassment. Simplicity keeps blast radius, support burden, and trust failure smaller while the product contract matures.
