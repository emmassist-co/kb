# `@emmassist-co/kb-cli`

Standalone KB CLI for local agents and HTTP-backed KB hosts.

## Consumer Quickstart

Full setup guide: [docs/consumer-quickstart.md](../../docs/consumer-quickstart.md)

Minimal install for a local agent host:

```bash
npm install @emmassist-co/kb-cli
```

Then run:

```bash
export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

npx kb-local inspect
```

## Modes

- local in-process file-backed mode for development
- local R2 mirror mode for sync, debugging, and migration support
- local daemon mode
- remote HTTP mode

`kb inspect` should always tell the caller which tenant they are targeting, which backend is active, whether the surface is canonical, and whether the current workspace is production or support-only.

## Binary

- `kb-local`

## Installable Skill

This package ships an installable KB write skill at [skills/kb-write](./skills/kb-write).
It also ships a local setup skill at [skills/kb-local-setup](./skills/kb-local-setup).

Example install:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-local-setup
```

## Examples

In-process local:

```bash
KB_TENANT_ID=workspace-template KB_ROOT_DIR=/tmp/kb npx kb-local inspect
```

R2 mirror local:

```bash
KB_BACKEND=r2-mirror \
KB_TENANT_ID=workspace-template \
KB_R2_MIRROR_ROOT=/tmp/kb-mirror \
npx kb-local search --json '{"query":"billing"}'
```

Mirror operations:

```bash
KB_BACKEND=r2-mirror npx kb-local sync status
KB_BACKEND=r2-mirror npx kb-local sync pull
KB_BACKEND=r2-mirror npx kb-local sync status --changes
KB_BACKEND=r2-mirror npx kb-local sync pull --verbose
KB_BACKEND=r2-mirror npx kb-local daemon start
KB_BACKEND=r2-mirror npx kb-local daemon status --stats
```

Daemon:

```bash
KB_TENANT_ID=workspace-template KB_ROOT_DIR=/tmp/kb npx kb-local serve --port 3001
```

HTTP mode:

```bash
KB_BASE_URL=http://127.0.0.1:3001 npx kb-local search --json '{"query":"billing"}'
```

Operator-only repair surfaces:

```bash
npx kb-local help operator
npx kb-local capture-source --json @source.json
npx kb-local events
npx kb-local drafts
npx kb-local relations --entity-id vendor-stripe
```

## Verification

- local CLI + daemon smoke: `npm run verify:kb -- --mode all`
