---
name: kb-local-setup
description: Use when a user wants a local agent or local repo to install and configure the KB CLI, especially when the agent should ask for required paths, tenant ids, package auth, or local versus daemon mode.
---

# KB Local Setup

Use this when the task is to get a local agent ready to use `kb-local`.

## Ask First

Before writing commands, ask the user for:

- install directory: the local repo or workspace where the CLI should be installed
- `KB_ROOT_DIR`: where the file-backed KB should live
- `KB_TENANT_ID`: the tenant or namespace to use for this agent
- mode: `in-process` or `daemon`
- if `daemon`, the port to bind, usually `3001`

If the user does not care about the tenant, default to a stable short id like the repo name.
If the user does not care about the root dir, default to `.kb` inside the current workspace.

## Install Pattern

Install the CLI:

```bash
npm install @emmassist-co/kb-cli
```

## In-Process Mode

Use this for the simplest local setup:

```bash
export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

npx kb-local inspect
```

## Daemon Mode

Use this when other tools or agents should talk to KB over HTTP:

```bash
export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

npx kb-local serve --port 3001
```

Then client commands can use:

```bash
export KB_BASE_URL=http://127.0.0.1:3001
npx kb-local search --json '{"query":"billing"}'
```

## Verify

After install, run:

```bash
npx kb-local help
npx kb-local inspect
npx kb-local schema record
```

## Install This Skill

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-local-setup
```
