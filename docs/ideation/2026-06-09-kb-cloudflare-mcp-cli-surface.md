# KB Cloudflare MCP And CLI Surface

Date: 2026-06-09
Status: ideation
Scope: deployable MCP surface for the Cloudflare-native KB, with an operator/CLI path that can connect to the same deployed tenant KB

## Framing

Treating this as a topic in this codebase: how `kb` should expose a real remote MCP surface on Cloudflare without breaking the existing product spine of `kb-http` + `kb-storage-cloudflare` + `kb-cli`.

## Grounding Context

### Codebase context

- The repo already wants Cloudflare as the default production shape: one tenant-scoped Worker, one Durable Object namespace, one canonical R2 bucket, and a Worker-hosted `kb-http` surface.
- `kb-http` already owns the canonical `/v1/...` contract and `kb-cli` already has a remote HTTP mode via `KB_BASE_URL`.
- `kb-storage-cloudflare` already treats Durable Object state as write authority and canonical R2 as exported state.
- `kb-cli` already has Cloudflare auth helpers for temporary R2 credentials, but the remote `KB_BASE_URL` path currently does not have a first-class bearer/API-key contract.

### Past learnings

- Recent KB release work already converged on `inspect` and runtime parity as a cross-surface contract. New surfaces should preserve that pattern instead of inventing a separate “MCP-only” truth surface.
- The open-source direction is already “Cloudflare-first deployed KB with local support modes,” not “local CLI first, Cloudflare later.”

### External context

- Cloudflare Workers secrets can be provisioned directly with Wrangler, including bulk secret upload during deploy.
- Cloudflare’s MCP docs distinguish internal RPC transport from external Streamable HTTP. RPC is internal-only and does not support auth; Streamable HTTP is the external/auth-capable path.
- MCP authorization is now explicitly OAuth-shaped. Protected MCP servers should advertise authorization metadata and use standard discovery for auth servers.
- Cloudflare’s MCP guidance supports four auth paths: Access as OAuth provider, third-party OAuth, bring-your-own OAuth, or a Worker-handled OAuth flow.

Sources:

- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Agents MCP authorization: https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- Cloudflare Agents MCP transport: https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/
- MCP authorization spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

## Topic Axes

- deployment bootstrap
- auth and tenant access
- protocol and transport shape
- CLI/operator experience
- permission and safety model

## Strongest Ideas

### 1. Add a thin `kb-mcp` surface beside `kb-http`, not inside `kb-cli`

Summary:
Expose MCP as a new Worker-facing package or submodule that adapts the existing KB service methods into MCP tools, while keeping `kb-http` as the canonical data contract. The Worker would host both `/v1/...` and `/mcp`, backed by the same DO/R2 state and the same tenant capability metadata.

Axis:
protocol and transport shape

Basis:
- direct: `kb-http` already owns the Worker-hosted contract and `kb-cli` already treats remote access as “talk to deployed host via base URL”
- reasoned: MCP is a transport/tool protocol, not the storage or operator package. Folding it into `kb-cli` would invert the repo’s production story

Why it matters:
This preserves one deployed KB runtime with two client surfaces instead of creating a second product. It also keeps tests, auth, and capability reporting close to the canonical Worker host.

Meeting test:
Yes. This is the architecture decision that determines whether MCP strengthens the repo or fragments it.

### 2. Use a two-lane auth model: shared bearer secret first, OAuth-ready MCP contract second

Summary:
Do not force the first release to fully solve end-user OAuth for every consumer. Add a shared machine token contract first for the deployed KB surface, then layer MCP OAuth discovery and flows on top for external MCP clients that need spec-native auth. The same Worker should understand both: a simple bearer token for KB CLI and machine callers, and OAuth-issued bearer tokens for MCP clients.

Axis:
auth and tenant access

Basis:
- direct: the current remote CLI path has `KB_BASE_URL` but no built-in remote auth contract
- external: MCP auth guidance is OAuth-shaped, while Cloudflare supports simpler Worker-managed auth or Access-backed auth
- reasoned: the CLI needs a reliable machine-to-machine path even if the MCP OAuth story takes longer to harden

Why it matters:
If the first auth story is “MCP OAuth only,” the CLI becomes an awkward second-class consumer. If the first auth story is “shared secret only,” generic MCP clients lose standards-compliant auth discovery. Two lanes avoid blocking either surface on the other.

Meeting test:
Yes. This is the core product/security tradeoff.

### 3. Make secret bootstrap a deploy-time concern owned by `kb-cli`

Summary:
Create a `kb cloudflare deploy` or `kb deploy cloudflare` flow that scaffolds Worker config, creates or reuses the R2 bucket and DO bindings, and handles auth bootstrap. It should support two modes:

- generate a new secret locally, set it with `wrangler secret put`, then print it once
- accept an operator-provided secret and install it without generating one

Axis:
deployment bootstrap

Basis:
- direct: the repo already documents Cloudflare deploy steps manually and already uses Wrangler-based Cloudflare auth flows
- external: Workers secrets are designed to be provisioned at deploy time
- reasoned: “return secret from deployment” is safest when interpreted as “the deploy command generated it locally, stored it in Worker secrets, and printed it once,” not “the Worker later exposes it”

Why it matters:
This gives you the “secret returned on deployment or set as a secret” choice without inventing unsafe post-deploy retrieval behavior.

Meeting test:
Yes. This is the operator experience that decides whether outsiders can actually stand this up.

### 4. Introduce a shared auth middleware for both `/v1` and `/mcp`

Summary:
Add a small `kb-auth` layer in front of the Worker routes. It should validate bearer tokens, resolve tenant/scopes, and pass an auth context into both HTTP handlers and MCP tools. That auth context should also be exposed in `inspect`/capabilities so operators can tell whether the host is public-read, write-enabled, or support-only.

Axis:
permission and safety model

Basis:
- direct: `inspect` already acts as the repo’s cross-surface truth contract; `kb-http` currently has no auth middleware
- reasoned: keeping auth logic route-local would create drift between HTTP and MCP and make it harder to reason about permissions

Why it matters:
The real long-term asset is not “an API key.” It is one place where the deployed KB decides who can do what.

Meeting test:
Yes. This is a leverage move that reduces future auth drift.

### 5. Keep the CLI as the operator shell, but add named remote profiles and token commands

Summary:
Extend `kb-cli` with explicit remote profile support instead of relying on raw `KB_BASE_URL` only. Example shape:

- `kb auth connect --name acme --base-url https://kb.acme.example --token ...`
- `kb auth token rotate --profile acme`
- `kb inspect --profile acme`
- `kb mcp connect --profile acme` or `kb mcp url --profile acme`

Axis:
CLI/operator experience

Basis:
- direct: current remote access is environment-variable driven and thin
- reasoned: once auth exists, users need a stable way to manage multiple deployed tenant KBs without hand-editing shell env every time

Why it matters:
This turns the CLI from a dev helper into the operator-grade entry point the strategy document already implies.

Meeting test:
Yes. It changes how credible the public product feels.

### 6. Split permissions into read, write, and operator scopes from day one

Summary:
Do not ship one all-powerful token. Define at least three scopes:

- `kb.read`
- `kb.write`
- `kb.operator`

Map MCP tools and HTTP routes onto those scopes. `inspect`, `search`, and entity reads are `read`; normal knowledge mutations are `write`; rebuild/export/repair surfaces are `operator`.

Axis:
permission and safety model

Basis:
- direct: the repo already distinguishes normal surfaces from operator-only repair surfaces in CLI help and docs
- external: MCP auth guidance expects explicit permission mapping to tools

Why it matters:
This matches the codebase’s existing “narrow production surface, sharper repair surface” discipline and avoids a future breaking auth redesign.

Meeting test:
Yes. This is cheap early and painful late.

## Rejected Or Weaker Directions

### A. Make MCP the new canonical contract and de-emphasize `kb-http`

Why rejected:
The repo already has a working canonical JSON/HTTP contract and a product story built around it. Re-centering on MCP would create two migrations at once: transport and product identity.

### B. Put the whole deployable story inside `kb-cli` only

Why rejected:
`kb-cli` should help deploy and connect, but the deployed runtime should stay Worker-hosted and package-owned. A CLI-centric architecture would blur the production boundary the repo has been tightening.

### C. Use Cloudflare Access only and skip a KB-owned machine token

Why rejected:
Access is strong for browser/user identity and can be one OAuth path, but the KB CLI still needs a simple operator/machine path. Forcing everything through Access would overfit the first version to one auth model.

### D. Return secrets from the Worker after deployment

Why rejected:
That is the wrong trust model. If a secret is generated, it should be generated in the deploy command, stored immediately in Worker secrets, and shown once to the deployer.

## Ranked Survivors

1. Thin `kb-mcp` Worker surface beside `kb-http`
2. Two-lane auth: shared bearer secret first, OAuth-ready MCP second
3. Deploy-time secret bootstrap owned by `kb-cli`
4. Shared auth middleware for `/v1` and `/mcp`
5. Remote profiles and token management in `kb-cli`
6. Read/write/operator scopes from day one

## Strongest Combined Direction

The strongest path is a hybrid:

1. Keep `kb-http` as the canonical deployed data contract.
2. Add `kb-mcp` as a Worker-side adapter over the same service layer.
3. Introduce shared bearer auth for both `/v1` and `/mcp` immediately.
4. Make the deploy command either generate-and-print a secret once or accept an operator-provided secret.
5. Design the auth middleware so MCP OAuth can be added without replacing the CLI token path.

That gives the repo a fast path to “deploy KB to Cloudflare and connect to it with MCP” without betting the first version on a full OAuth rollout.

## Recommended Brainstorm Target

If we take one idea into deeper shaping, it should be:

`Design the shared deployed auth contract for kb-http + kb-mcp + kb-cli, including bootstrap, scope model, and how OAuth layers onto the same Worker later.`
