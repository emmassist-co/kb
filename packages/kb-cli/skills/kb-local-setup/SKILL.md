---
name: kb-local-setup
description: Use when a user wants a local agent or local repo to install and configure the KB CLI, especially when the agent should ask for required paths, workspace namespaces, package auth, or local versus daemon mode.
---

# KB Local Setup

Use this when the task is to get a local agent ready to use `kb`.

## Ask First

Before writing commands, ask the user for:

- install directory: the local repo or workspace where the CLI should be installed
- `KB_ROOT_DIR`: where the file-backed KB should live
- `KB_WORKSPACE_ID`: optional stable namespace for this agent
- mode: `in-process` or `daemon`
- if `daemon`, the port to bind, usually `3001`

If the user does not care about the workspace namespace, omit it and let the CLI default apply.
If the user does not care about the root dir, default to `.kb` inside the current workspace.

## Install Pattern

Install the CLI:

```bash
npm install @emmassist-co/kb-cli --@emmassist-co:registry=https://npm.pkg.github.com
```

## In-Process Mode

Use this for the simplest local setup:

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb inspect
```

## Daemon Mode

Use this when other tools or agents should talk to KB over HTTP:

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb serve --port 3001
```

Then client commands can use:

```bash
export KB_BASE_URL=http://127.0.0.1:3001
npx kb search --json '{"query":"billing"}'
```

## Verify

After install, run:

```bash
npx kb help
npx kb inspect
npx kb schema record
```

## Install This Skill

After installing `@emmassist-co/kb-cli`, prefer the package-local skill path:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-local-setup
```

If the package is not installed yet, the GitHub source path is available as a fallback:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-local-setup
```
