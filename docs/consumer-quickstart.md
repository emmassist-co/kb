# KB Consumer Quickstart

This guide is for a local repo, agent workspace, or operator shell that wants to consume the published KB packages from `emmassist-co/kb`.

For the canonical Cloudflare production path, use [docs/cloudflare-agent-setup.md](./cloudflare-agent-setup.md).

## What You Need

- Node `22+`
- access to the public npm registry

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
npm install @emmassist-co/kb-cli
```

This gives you `kb-local`.

## 1.1. Flue Runtime Consumers

If your agent runtime already uses Flue and you want the KB command surface inside that runtime, install the adapter alongside your local Flue SDK:

```bash
npm install @emmassist-co/kb-flue-adapter @flue/sdk
```

The adapter no longer depends on legacy Flue subpath exports, so the same package works for Flue `0.3.x` and the root-export Flue `1.x` line. The returned command is structural, so consumers can assign it to their local Flue `Command` type.

## 2. Local In-Process Mode

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb-local inspect
npx kb-local help
npx kb-local schema record
```

## 3. Local Daemon Mode

Start the server:

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb-local serve --port 3001
```

Then use the same CLI as an HTTP client:

```bash
export KB_BASE_URL=http://127.0.0.1:3001

npx kb-local search --json '{"query":"billing"}'
```

## 4. Local R2 Mirror Mode

Use this when you want a local inspection or support workspace that mirrors canonical KB files from Cloudflare-backed storage:

```bash
export KB_BACKEND=r2-mirror
export KB_R2_MIRROR_ROOT="$PWD/.kb-sync"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb-local sync status
npx kb-local sync pull
npx kb-local validate-mirror
npx kb-local health
```

This is a support and debugging path, not a second production architecture. Canonical production writes still belong on the Cloudflare-hosted KB surface.

If humans want to edit the workspace mirror directly in Obsidian while canonical writes still go through KB semantics, use the semantic authoring workflow in `docs/operations/kb-obsidian-semantic-sync.md`. In that mode, `entities/*.md` and `sources/*.md` are the only supported authoring targets and the daemon translates those edits onto the canonical Cloudflare KB surface. Run `npx kb-local validate-mirror` before applying edits and `npx kb-local health --stats` when an agent or operator needs one readiness envelope across sync, daemon, validation, and conflict state.

## 5. Install Skills For Agents

KB write skill:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
```

KB local setup skill:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-local-setup
```

Use `kb-local-setup` when the agent should ask the user for the local setup variables and get the environment ready.

KB Cloudflare setup skill:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-cloudflare-setup
```

Use `kb-cloudflare-setup` when the agent should guide an operator through deploying the canonical Cloudflare KB surface, verifying `canonical-production`, and handing the agent a working `KB_BASE_URL`.

Protected remote KBs also require:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me-with-a-secret
```

If you want the CLI to scaffold and deploy the Cloudflare workspace directly:

```bash
npx kb-local cloudflare deploy --workspace-id my-workspace --workspace ./kb-cloudflare
```

If the host already exists and you just want to recheck it:

```bash
npx kb-local cloudflare verify --workspace-id my-workspace
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
npx kb-local inspect
npx kb-local schema relate
printf '%s\n' '{"query":"test"}' | npx kb-local search --json -
```

If you cloned the KB repo itself, you can also run:

```bash
npm run build:public
./node_modules/.bin/tsx scripts/kb-verify.ts --mode all
npm run smoke:kb-mcp -- --workspace-id my-workspace
```
