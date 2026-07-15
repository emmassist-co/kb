---
name: kb-cloudflare-setup
description: Use when an operator or agent needs to deploy the canonical KB surface on Cloudflare, verify it reports canonical production capabilities, and connect one or more agents or MCP clients to it over HTTP.
---

# KB Cloudflare Setup

Use this when the task is to stand up the canonical Cloudflare-hosted KB surface and make it usable by agents.

## Ask First

Before writing commands, ask the user for:

- deploy workspace path
- Worker name
- `KB_WORKSPACE_ID`
- `KB_ROOT_DIR`
- R2 bucket name
- route or custom domain, if they want one now
- whether this is a fresh deployment or an existing Worker update
- which agent or repo should connect to the deployed KB after setup

If the user does not care about `KB_ROOT_DIR`, default to `.kb`.
If the user does not care about the worker name, default to `<workspace>-kb`.

## Goal

Do not stop at "the Worker deployed." The setup is only complete when:

- the Worker is reachable
- `GET /v1/capabilities` reports the expected workspace namespace
- `backend` is `cloudflare`
- `canonical` is `true`
- `workspaceRole` is `canonical-production`
- the target agent can connect with `KB_BASE_URL` and `KB_API_TOKEN`
- the same secret can reach `/mcp`

## Preferred Guide

Use the repo guide as the canonical walkthrough:

- [`docs/cloudflare-agent-setup.md`](../../../../docs/cloudflare-agent-setup.md)

## Recommended Setup Flow

1. Ensure Cloudflare auth is ready.

```bash
npx wrangler login
```

Or confirm `CLOUDFLARE_API_TOKEN` is already available.

2. In the deploy workspace, install the published packages:

```bash
npm install @emmassist-co/kb-core @emmassist-co/kb-http @emmassist-co/kb-mcp @emmassist-co/kb-storage-cloudflare @emmassist-co/kb-cli
npm install -D typescript wrangler
```

3. Prefer the CLI bootstrap command from the guide:

```bash
npx kb-local cloudflare deploy --workspace-id <workspace-id> --workspace <deploy-workspace>
```

If the operator does not want the CLI to write files, fall back to the manual Worker wrapper and `wrangler.jsonc` path from the guide.

4. Create the canonical R2 bucket and deploy:

```bash
npx wrangler r2 bucket create <bucket-name>
npx wrangler deploy
```

5. Verify the canonical capability envelope:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret

curl -s -H "Authorization: Bearer $KB_API_TOKEN" "$KB_BASE_URL/v1/capabilities" | jq
curl -s -H "Authorization: Bearer $KB_API_TOKEN" "$KB_BASE_URL/v1/inspect" | jq
curl -s -H "Authorization: Bearer $KB_API_TOKEN" "$KB_BASE_URL/v1/doctor" | jq
npx kb-local cloudflare verify --workspace-id <workspace-id>
```

6. Connect the agent over HTTP:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret
npx kb-local inspect
```

7. Install KB write tooling for the agent if needed:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
```

## Connect An Agent

For remote agent use, prefer the existing HTTP mode rather than inventing a second client:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret
npx kb-local search --json '{"query":"billing"}'
```

That gives the agent one stable contract regardless of whether the backing store is local or canonical Cloudflare.

For external MCP clients, configure the same host on `/mcp` with the same bearer token. Do not invent a separate auth flow for v1.

## Optional Mirror Support

If the user also wants a local support mirror of canonical R2 state, guide them to `kb-local sync` after the canonical Worker is healthy. Do not present the mirror path as a peer production deployment.

## Install This Skill

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-cloudflare-setup
```
