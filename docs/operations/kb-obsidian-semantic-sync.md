# KB Obsidian Semantic Sync

Use this workflow when humans edit a tenant mirror in Obsidian but Cloudflare KB must remain canonical.

## Model

- Cloudflare-hosted `kb-http` remains the source of truth.
- The local mirror is a tenant-scoped vault for inspection and supported markdown editing.
- The daemon translates supported file edits into canonical KB mutations before refreshing the mirror.
- Raw `kb sync push` remains a support-mode escape hatch, not the default human authoring path.

## Supported Human-Editable Files

- `entities/*.md`
- `sources/*.md`

Support-only files stay non-authoritative:

- `events/*.json`
- `drafts/*.json`
- `registry/*.json`
- `links/**`
- `meta/version.json`

## Setup

```bash
export KB_BACKEND=r2-mirror
export KB_TENANT_ID=my-agent
export KB_R2_MIRROR_ROOT="$PWD/.kb-sync"
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me
```

Pull canonical state first:

```bash
npx kb-local sync pull
```

Start the daemon:

```bash
npx kb-local daemon start
```

## Authoring Loop

1. Pull canonical state into the tenant mirror.
2. Edit only `entities/*.md` and `sources/*.md` in Obsidian.
3. Let the daemon detect local edits and compile them into canonical mutations.
4. Let the daemon pull canonical state again after successful writes.
5. Inspect semantic status with `npx kb-local daemon status --stats`.

## Safety Rules

- Entity edits compile onto `record` plus `annotate` when the change is safely additive.
- Source edits compile onto an exact canonical source upsert route so fields like `linkedEntities`, `tags`, `rawSourceRef`, and `freshnessStatus` round-trip cleanly.
- Destructive entity rewrites such as removing aliases or rewriting historical timeline lines are rejected instead of being silently coerced.
- Remote drift blocks semantic apply; the daemon preserves local edits and reports the blockage through daemon status.

## Operator Signals

- `state: semantic_blocked` means the daemon is running but human edits need intervention.
- `counts.rejectedEdits` means a local edit touched an unsupported file or unsupported mutation shape.
- `counts.semanticConflicts` means canonical state changed since the last baseline or the daemon could not reconcile the edit safely.
