# `@emmassist-co/kb-cli`

Standalone KB CLI for local agents and HTTP-backed KB hosts.

## Consumer Quickstart

Full setup guide: [docs/consumer-quickstart.md](../../docs/consumer-quickstart.md)
Canonical Cloudflare deployment guide: [docs/cloudflare-agent-setup.md](../../docs/cloudflare-agent-setup.md)

Minimal install for a local agent host:

```bash
npm install @emmassist-co/kb-cli --@emmassist-co:registry=https://npm.pkg.github.com
```

Then run:

```bash
export KB_ROOT_DIR="$PWD/.kb"
# Optional: export KB_WORKSPACE_ID=my-workspace

npx kb inspect
```

## Modes

- local in-process file-backed mode for development
- local R2 mirror mode for sync, debugging, and migration support
- local daemon mode
- remote HTTP mode
- Cloudflare deploy/bootstrap mode for protected remote hosts

`kb inspect` should always tell the caller which workspace namespace they are targeting, which backend is active, whether the surface is canonical, and whether the current workspace is production or support-only.

## Binary

- `kb` is the preferred command for local, daemon, remote HTTP, Cloudflare, and support workflows.
- `kb-local` remains a backward-compatible alias for existing agents and scripts.

## Installable Skill

This package ships an installable KB write skill at [skills/kb-write](./skills/kb-write).
It also ships a local setup skill at [skills/kb-local-setup](./skills/kb-local-setup).
It also ships an agent-improvement skill at [skills/kb-agent-improvement](./skills/kb-agent-improvement) for external-agent review and curation workflows.
It also ships a Cloudflare setup skill at [skills/kb-cloudflare-setup](./skills/kb-cloudflare-setup).

Agent-readable recipes live under [recipes](./recipes). They are playbooks for external agents, not KB-owned schedulers or workflow engines.

Example install after this package is installed:

```bash
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-write
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-local-setup
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-agent-improvement
npx skills add ./node_modules/@emmassist-co/kb-cli/skills/kb-cloudflare-setup
```

GitHub source installs remain available as a fallback when the package is not installed yet:

```bash
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-write
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-local-setup
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-agent-improvement
npx skills add https://github.com/emmassist-co/kb/tree/main/packages/kb-cli/skills/kb-cloudflare-setup
```

## Agent Improvement Recipes

After package install, external agents can read recipes from:

```text
./node_modules/@emmassist-co/kb-cli/recipes/
```

Use `kb-agent-improvement` when an agent is explicitly asked to review or improve KB state. The recipes keep judgment outside KB: the agent reads sources, reasons, prepares normal `remember` / `record` / `relate` / `annotate` payloads, validates them, and applies only authorized writes. KB does not schedule recipes, maintain recipe state, detect contradictions, or ingest documents by itself.

## Examples

In-process local:

```bash
KB_ROOT_DIR=/tmp/kb npx kb inspect
```

R2 mirror local:

```bash
KB_BACKEND=r2-mirror \
KB_R2_MIRROR_ROOT=/tmp/kb-mirror \
npx kb search --json '{"query":"billing"}'
```

Mirror operations:

```bash
KB_BACKEND=r2-mirror npx kb sync status
KB_BACKEND=r2-mirror npx kb sync pull
KB_BACKEND=r2-mirror npx kb sync status --changes
KB_BACKEND=r2-mirror npx kb sync pull --verbose
KB_BACKEND=r2-mirror npx kb daemon start
KB_BACKEND=r2-mirror npx kb daemon status --stats
KB_BACKEND=r2-mirror npx kb validate-mirror --changes
KB_BACKEND=r2-mirror npx kb health --stats
```

Daemon:

```bash
KB_ROOT_DIR=/tmp/kb npx kb serve --port 3001
```

HTTP mode:

```bash
KB_BASE_URL=http://127.0.0.1:3001 npx kb search --json '{"query":"billing"}'
```

Protected remote HTTP mode:

```bash
KB_BASE_URL=https://kb.example.com \
KB_API_TOKEN=replace-me \
npx kb inspect
```

Cloudflare deploy/bootstrap:

```bash
npx kb cloudflare deploy --workspace-id acme-workspace --workspace ./kb-cloudflare
```

Cloudflare host re-verification:

```bash
KB_BASE_URL=https://kb.example.com \
KB_API_TOKEN=replace-me \
npx kb cloudflare verify --workspace-id acme-workspace
```

Operator-only repair surfaces:

```bash
npx kb help operator
npx kb capture-source --json @source.json
npx kb events
npx kb drafts
npx kb relations --entity-id vendor-stripe
npx kb conflicts list
npx kb conflicts show --path entities/vendor-acme.md --contents
npx kb conflicts resolve --path entities/vendor-acme.md --from file --file ./resolved.md
```

## Verification

- local CLI + daemon smoke: `npm run verify:kb -- --mode all`
- deployed Cloudflare host recheck: `KB_BASE_URL=... KB_API_TOKEN=... npx kb cloudflare verify --workspace-id ...`
