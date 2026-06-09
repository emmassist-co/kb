# KB Consumer Quickstart

This guide is for a local repo, agent workspace, or operator shell that wants to consume the published KB packages from `emmassist-co/kb`.

## What You Need

- Node `22+`
- access to the public npm registry

## Variables To Decide

Before setup, choose:

- `KB_TENANT_ID`: stable namespace for this agent or workspace
- `KB_ROOT_DIR`: local directory for the file-backed KB
- mode:
  - `in-process` for the simplest local CLI use
  - `daemon` if other local tools should talk to KB over HTTP
- if `daemon`, a port like `3001`

Recommended defaults:

- `KB_TENANT_ID`: repo name or agent name
- `KB_ROOT_DIR`: `$PWD/.kb`

## 1. Install The CLI

```bash
npm install @emmassist-co/kb-cli
```

This gives you `kb-local`.

## 2. Local In-Process Mode

```bash
export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

npx kb-local inspect
npx kb-local help
npx kb-local schema record
```

## 3. Local Daemon Mode

Start the server:

```bash
export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

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
export KB_TENANT_ID=my-agent
export KB_R2_MIRROR_ROOT="$PWD/.kb-sync"

npx kb-local sync status
npx kb-local sync pull
```

This is a support and debugging path, not a second production architecture. Canonical production writes still belong on the Cloudflare-hosted KB surface.

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
```
