# KB Deployment Model

## Production Contract

`kb` owns one production deployment story:

- one tenant-scoped deployment boundary
- one canonical `kb-http` surface
- one adjacent `kb-mcp` surface over the same runtime
- one canonical Cloudflare-backed knowledge store
- one operator-visible capability envelope that states tenant, backend, transport, canonicality, and workspace role

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
- Worker-hosted `kb-mcp` on the same tenant boundary
- canonical tenant state in `kb-storage-cloudflare`
- agent and operator writes going through the same HTTP contract
- shared auth and scope enforcement across `/v1` and `/mcp`
- verification against the deployed contract, not just local file mode

## Support Surfaces

Local file mode and mirror mode remain supported for:

- local development
- operator debugging
- migration and recovery workflows
- contract verification in a non-deployed environment

Those surfaces should advertise themselves as non-canonical through `GET /v1/capabilities` and `kb inspect`.

## Verification

Deployment verification should confirm:

- the tenant and backend are the expected ones
- the surface reports `canonical-production` before production writes
- the deployed route table matches the documented `kb-http` contract
- secondary KB state such as events, drafts, and relations remains reachable through the same public surface
