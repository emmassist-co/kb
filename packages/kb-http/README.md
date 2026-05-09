# `@emmassist/kb-http`

Canonical HTTP/JSON contract for the KB.

## Owns

- route dispatch for `/v1/...`
- Node host adapter
- Cloudflare fetch adapter

## Main routes

- `GET /v1/capabilities`
- `GET /v1/doctor`
- `GET /v1/entities`
- `GET /v1/entities/:id`
- `POST /v1/search`
- `POST /v1/query-relations`
- `POST /v1/record`
- `POST /v1/remember`
- `POST /v1/annotate`
- `POST /v1/traverse`
- `POST /v1/rebuild`

## Hosts

- local Node daemon via `@emmassist/kb-http/node-server`
- Cloudflare fetch adapter via `@emmassist/kb-http/cloudflare-worker`

## Verification

- local daemon contract: `npm run verify:kb -- --mode daemon`
- protected deployed smoke: `npm run verify:deployment -- --kb-http-smoke --base-url <https://host>`

