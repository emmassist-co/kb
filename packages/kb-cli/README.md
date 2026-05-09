# `@emmassist-co/kb-cli`

Standalone KB CLI for local agents and HTTP-backed KB hosts.

## Modes

- local in-process file-backed mode
- local daemon mode
- remote HTTP mode

## Binary

- `kb-local`

## Installable Skill

This package ships an installable KB write skill at [skills/kb-write](./skills/kb-write).

Example install:

```bash
npx skills add https://github.com/alexandrempsantos/administrative/tree/main/packages/kb-cli/skills/kb-write
```

## Examples

In-process local:

```bash
KB_TENANT_ID=workspace-template KB_ROOT_DIR=/tmp/kb ./node_modules/.bin/tsx packages/kb-cli/src/bin.ts inspect
```

Daemon:

```bash
KB_TENANT_ID=workspace-template KB_ROOT_DIR=/tmp/kb ./node_modules/.bin/tsx packages/kb-cli/src/bin.ts serve --port 3001
```

HTTP mode:

```bash
KB_BASE_URL=http://127.0.0.1:3001 ./node_modules/.bin/tsx packages/kb-cli/src/bin.ts search --json '{"query":"billing"}'
```

## Verification

- local CLI + daemon smoke: `npm run verify:kb -- --mode all`
