# `@emmassist-co/kb-http`

Canonical HTTP/JSON contract for the KB.

## Owns

- route dispatch for `/v1/...`
- Node host adapter
- Cloudflare fetch adapter
- shared bearer auth and scope enforcement for deployed hosts

## Main routes

- `GET /v1/capabilities`
  Returns tenant, backend, canonicality, transport, and workspace role so callers can verify whether they are on the canonical production surface or a support-only workspace.
- `GET /v1/inspect`
  Returns the same workspace metadata plus a compact KB summary with current entity, source, and link counts/listings.
- `GET /v1/doctor`
- `GET /v1/entities`
- `GET /v1/entities/:id`
- `GET /v1/entities/:id/related`
- `GET /v1/entities/:id/links`
- `GET /v1/entities/:id/relations`
- `DELETE /v1/entities/:id`
- `POST /v1/search`
- `POST /v1/query-relations`
- `POST /v1/record`
- `POST /v1/remember`
- `POST /v1/relate`
- `POST /v1/annotate`
- `POST /v1/capture-source`
- `GET /v1/events`
- `GET /v1/events/:id`
- `POST /v1/events`
- `DELETE /v1/events/:id`
- `GET /v1/drafts`
- `GET /v1/drafts/:entityId`
- `PUT /v1/drafts/:entityId`
- `DELETE /v1/drafts/:entityId`
- `GET /v1/relations`
- `PUT /v1/relations`
- `DELETE /v1/relations?originKind=...&originId=...`
- `POST /v1/traverse`
- `GET /v1/export`
- `POST /v1/rebuild`

## Hosts

- local Node daemon via `@emmassist-co/kb-http/node-server`
- Cloudflare fetch adapter via `@emmassist-co/kb-http/cloudflare-worker`

## Auth

- deployed hosts can enforce one bearer-token model across read, write, and operator scopes
- route checks are centralized instead of duplicated per caller
- `kb-mcp` reuses this auth substrate rather than defining a second deployment contract

## Verification

- local daemon contract: `npm run verify:kb -- --mode daemon`
- protected deployed smoke: `npm run verify:deployment -- --kb-http-smoke --base-url <https://host>`
