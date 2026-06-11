# KB R2 Sync

This utility mirrors one tenant's canonical KB files from the `KB_CANONICAL_R2` bucket into a local inspection folder and can push local changes back.

For human authoring, prefer the semantic workflow documented in `docs/operations/kb-obsidian-semantic-sync.md`. Raw `push` remains the explicit support and migration path.

## Requirements

- R2 S3 credentials:
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - optional `R2_SESSION_TOKEN`
- Cloudflare account ID:
  - set `CLOUDFLARE_ACCOUNT_ID`, or
  - let the script derive it from `wrangler whoami --json`
- Bucket name:
  - set `KB_CANONICAL_R2_BUCKET`, or
  - let the script read the `KB_CANONICAL_R2` binding from `wrangler.jsonc`

## Local Mirror

Default mirror path:

- `.tmp/kb-sync/<tenant-id>/`

Manifest path:

- `.tmp/kb-sync/<tenant-id>/.kb-sync-manifest.json`

The remote prefix is derived from the tenant KB root and currently resolves to:

- `.kb/<tenant-id>/`

## Commands

Pull the tenant KB:

```bash
npm run kb:sync -- pull --tenant-id alexandre-portela-dos-santos-limitada
```

Inspect drift without writing:

```bash
npm run kb:sync -- status --tenant-id alexandre-portela-dos-santos-limitada
```

Push changed local files back to R2:

```bash
npm run kb:sync -- push --tenant-id alexandre-portela-dos-santos-limitada
```

Run the local daemon:

```bash
export KB_BASE_URL=https://YOUR-KB-HOST
export KB_API_TOKEN=replace-me

npm run kb:sync -- daemon start
```

Use a custom local root:

```bash
npm run kb:sync -- pull --tenant-id alexandre-portela-dos-santos-limitada --root /tmp/kb-sync
```

## Safety Rules

- `push` requires an existing manifest. Run `pull` first.
- When `KB_BASE_URL` is set, daemon mode treats `entities/*.md` and `sources/*.md` as semantic authoring inputs and keeps raw `push` as the explicit support-mode path.
- `push` uploads only files that changed locally since the last synced baseline.
- If both local and remote changed for the same file, `push` aborts with a conflict list.
- Support-only files such as `events/*.json`, `drafts/*.json`, `registry/*.json`, `links/**`, and `meta/version.json` are not safe human-authoring targets.
- Remote deletions are refused by default.
- Pass `--delete` only when you want destructive cleanup:
  - on `pull`, it removes stale local mirrored files
  - on `push`, it deletes remote files that were previously tracked but are now missing locally

## Notes

- The utility mirrors the canonical R2 layout directly so inspection matches deployed KB storage.
- Current output is JSON for operational clarity and shell piping.
- `kb daemon status --stats` distinguishes raw mirror health from semantic-sync blockage such as rejected local edits or remote conflicts.
