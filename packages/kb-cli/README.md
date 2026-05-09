# `@emmassist-co/kb-cli`

Standalone KB CLI for local agents and HTTP-backed KB hosts.

## Consumer Quickstart

Full setup guide: [docs/consumer-quickstart.md](../../docs/consumer-quickstart.md)

Minimal install for a local agent host:

```bash
cat > .npmrc <<'EOF'
@emmassist-co:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
EOF

npm install @emmassist-co/kb-cli
```

Then run:

```bash
export GITHUB_PACKAGES_TOKEN=...
export KB_TENANT_ID=my-agent
export KB_ROOT_DIR="$PWD/.kb"

npx kb-local inspect
```

## Modes

- local in-process file-backed mode
- local daemon mode
- remote HTTP mode

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

Daemon:

```bash
KB_TENANT_ID=workspace-template KB_ROOT_DIR=/tmp/kb npx kb-local serve --port 3001
```

HTTP mode:

```bash
KB_BASE_URL=http://127.0.0.1:3001 npx kb-local search --json '{"query":"billing"}'
```

## Verification

- local CLI + daemon smoke: `npm run verify:kb -- --mode all`
