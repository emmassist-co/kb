# KB Consumer Quickstart

This guide is for a local repo, agent workspace, or operator shell that wants to consume the published KB packages from `emmassist-co/kb`.

For the canonical Cloudflare production path, use [docs/cloudflare-agent-setup.md](./cloudflare-agent-setup.md).

## What You Need

- Node `22+`
- access to npm plus GitHub Packages for the `@emmassist-co` scope

## Variables To Decide

Before setup, choose:

- `KB_WORKSPACE_ID`: optional stable namespace for this agent or workspace
- `KB_ROOT_DIR`: local directory for the file-backed KB
- mode:
  - `in-process` for the simplest local CLI use
  - `daemon` if other local tools should talk to KB over HTTP
- if `daemon`, a port like `3001`

Recommended defaults:

- workspace namespace: repo name or agent name
- `KB_ROOT_DIR`: `$PWD/.kb`

## 1. Install The CLI

```bash
npm install @emmassist-co/kb-cli --@emmassist-co:registry=https://npm.pkg.github.com
```

This gives you `kb`.

## 1.1. Flue Runtime Consumers

If your agent runtime already uses Flue and you want the KB command surface inside that runtime, install the adapter alongside your local Flue SDK:

```bash
npm install @emmassist-co/kb-flue-adapter @flue/sdk --@emmassist-co:registry=https://npm.pkg.github.com
```

The adapter no longer depends on legacy Flue subpath exports, so the same package works for Flue `0.3.x` and the root-export Flue `1.x` line. The returned command is structural, so consumers can assign it to their local Flue `Command` type.

## 2. Local In-Process Mode

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb inspect
npx kb help
npx kb schema record
```

## 3. Local Daemon Mode

Start the server:

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb serve --port 3001
```

Then use the same CLI as an HTTP client:

```bash
export KB_BASE_URL=http://127.0.0.1:3001

npx kb search --json '{"query":"billing"}'
npx kb evidence --id vendor-stripe
npx kb recall --json '{"query":"billing","purpose":"pre-answer context"}'
```

## 4. Local R2 Mirror Mode

Use this when you want a local inspection or support workspace that mirrors canonical KB files from Cloudflare-backed storage:

```bash
export KB_BACKEND=r2-mirror
export KB_R2_MIRROR_ROOT="$PWD/.kb-sync"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb sync status
npx kb sync pull
npx kb validate-mirror
npx kb health
```

This is a support and debugging path, not a second production architecture. Canonical production writes still belong on the Cloudflare-hosted KB surface.

If humans want to edit the workspace mirror directly in Obsidian while canonical writes still go through KB semantics, use the semantic authoring workflow in `docs/operations/kb-obsidian-semantic-sync.md`. In that mode, `entities/*.md` and `sources/*.md` are the only supported authoring targets and the daemon translates those edits onto the canonical Cloudflare KB surface. Run `npx kb validate-mirror` before applying edits and `npx kb health --stats` when an agent or operator needs one readiness envelope across sync, daemon, validation, and conflict state.

## 5. Install Skills For Agents

After installing `@emmassist-co/kb-cli`, install the packaged skills from `node_modules` so agents do not need to clone this repository:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-write
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-local-setup
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-cloudflare-setup
```

Use `kb-write` when the agent should search, validate payloads, and write durable facts, records, relations, or annotations.
Use `kb-local-setup` when the agent should ask the user for local setup variables and get the environment ready.
Use `kb-cloudflare-setup` when the agent should guide an operator through deploying the canonical Cloudflare KB surface, verifying `canonical-production`, and handing the agent a working `KB_BASE_URL`.

Choose the agent connection path by host capability:

| Agent or client | Use | Verification |
| --- | --- | --- |
| Command-running local agent | `kb` CLI plus package-local skills | `npm run smoke:kb-agent-readiness -- --local-pack` in this repo, or `npx kb inspect` in a consumer folder |
| Remote/serverless agent | `KB_BASE_URL` + `KB_API_TOKEN` over `/v1` | `npx kb cloudflare verify --workspace-id my-workspace` |
| MCP-aware client | `https://YOUR-KB-HOST/mcp` with bearer auth | `npm run smoke:kb-mcp -- --workspace-id my-workspace` |

Skills do not auto-configure every IDE or MCP host. They give command-running agents the KB operating protocol; MCP-aware clients still need their host-specific MCP server configuration.

If the package is not installed yet, the GitHub source install remains available as a fallback:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
```

KB local setup skill:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-local-setup
```

Use `kb-local-setup` when the agent should ask the user for the local setup variables and get the environment ready.

KB agent-improvement skill, for agents explicitly asked to review or improve KB state:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-agent-improvement
```

If the package is not installed yet, use the GitHub source fallback:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-agent-improvement
```

Use `kb-agent-improvement` with the recipe pack under `./node_modules/@emmassist-co/kb-cli/recipes/`. The recipes are external-agent playbooks: agents do the reading and reasoning, while KB provides storage, validation, retrieval, relation, and provenance primitives.

KB Cloudflare setup skill:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-cloudflare-setup
```

Use `kb-cloudflare-setup` when the agent should guide an operator through deploying the canonical Cloudflare KB surface, verifying `canonical-production`, and handing the agent a working `KB_BASE_URL`.

## Agent Operating Protocol

Agents should search before answering workspace-specific factual questions, inspect trust state with `evidence` when a canonical answer needs support, and use `recall` only when their runtime explicitly wants a read-only context bundle. Write durable decisions with `record` or `remember`, capture external evidence with source metadata, use `relate` for explicit entity edges, and reserve `annotate` for timeline/provenance notes. Do not dump raw chat logs into KB; summarize the durable fact, decision, correction, or source-backed claim.

If memory looks wrong, prefer a correction or superseding update over silent deletion. If a proposed write needs human approval, use proposal/review surfaces (`submit-proposal`, `review-proposal`, `apply-proposal`) instead of pretending raw notes are canonical truth. If an agent is running a maintenance, correction, relation, stale-review, or document-review workflow, it should use `kb-agent-improvement`; KB itself does not own schedules, recipe state, document ingestion, contradiction detection, or truth regeneration. Use `inspect`, `doctor`, `debt`, `validate-mirror`, `health`, and conflict commands to understand state before repairing it.

Protected remote KBs also require:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret
```

If you want the CLI to scaffold and deploy the Cloudflare workspace directly:

```bash
npx kb cloudflare deploy --workspace-id my-workspace --workspace ./kb-cloudflare
```

If the host already exists and you just want to recheck it:

```bash
npx kb cloudflare verify --workspace-id my-workspace
```

If you want an external MCP client to connect to that deployed KB, use the same base host and API key on `/mcp`:

```json
{
  "mcpServers": {
    "my-agent-kb": {
      "transport": {
        "type": "streamable-http",
        "url": "https://YOUR-KB-HOST/mcp",
        "headers": {
          "Authorization": "Bearer replace-me-with-a-secret"
        }
      }
    }
  }
}
```

## 6. Verification

Minimal smoke:

```bash
npx kb inspect
npx kb schema relate
printf '%s\n' '{"query":"test"}' | npx kb search --json -
```

If you cloned the KB repo itself, you can also run:

```bash
npm run build:public
./node_modules/.bin/tsx scripts/kb-verify.ts --mode all
npm run smoke:kb-mcp -- --workspace-id my-workspace
```
