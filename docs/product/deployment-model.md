# KB Deployment Model

## Production Contract

`kb` is agent-first: the durable memory contract is designed for coding agents, remote workers, MCP clients, and supervised operator workflows to share the same workspace-scoped knowledge base instead of each agent carrying its own transcript-local memory.

`kb` owns one production deployment story:

- one workspace-scoped deployment boundary
- one canonical `kb-http` surface
- one adjacent `kb-mcp` surface over the same runtime
- one canonical Cloudflare-backed knowledge store
- one operator-visible capability envelope that states workspace identity, backend, transport, canonicality, and workspace role

The production claim is narrow on purpose. This repo does not own chat bridges, OAuth callbacks, or customer-specific webhook flows unless they are explicitly rehomed here.

## Workspace Roles

The repo supports three workspace roles:

- `canonical-production`: deployed `kb-http` backed by Cloudflare-owned canonical state
- `local-development`: file-backed local workspaces for development and testing
- `mirror-support`: local `r2-mirror` workspaces used for sync, debugging, and migration support

Local and mirror roles are useful, but they are not peer production backends.

## Expected Production Shape

Production should bias toward:

- Worker-hosted `kb-http`
- Worker-hosted `kb-mcp` on the same workspace boundary
- canonical workspace state in `kb-storage-cloudflare`
- agent and operator writes going through the same HTTP contract
- shared auth and scope enforcement across `/v1` and `/mcp`
- verification against the deployed contract, not just local file mode

## Agent Connection Map

| Agent shape | Supported connection | Canonicality |
| --- | --- | --- |
| Plain local Codex / Claude / Pi / Cursor / shell agent | `kb` in-process against `KB_ROOT_DIR` | `local-development` |
| Multiple local tools or agents | local `kb serve` Node daemon plus `KB_BASE_URL=http://127.0.0.1:<port>` | `local-development` |
| Remote/serverless agent | deployed Worker `/v1` with `KB_BASE_URL` and `KB_API_TOKEN` | `canonical-production` |
| MCP-aware client | deployed Worker `/mcp` with the same bearer token | `canonical-production` |
| Human-edited support mirror | `r2-mirror` plus semantic sync for `entities/*.md` and `sources/*.md` | `mirror-support` until synced |

This repo owns the durable memory contract and the CLI/HTTP/MCP package surfaces. It does not claim to own every chat bridge, IDE extension, OAuth callback app, or customer-specific webhook flow unless that surface is explicitly moved into this repo.

## Support Surfaces

Local file mode and mirror mode remain supported for:

- local development
- operator debugging
- migration and recovery workflows
- contract verification in a non-deployed environment

Those surfaces should advertise themselves as non-canonical through `GET /v1/capabilities` and `kb inspect`.

## Verification

Deployment verification should confirm:

- the workspace identity and backend are the expected ones
- the surface reports `canonical-production` before production writes
- the deployed route table matches the documented `kb-http` contract
- secondary KB state such as events, drafts, and relations remains reachable through the same public surface
