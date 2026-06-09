# gbrain-world-v1

Vendored copy of the `world-v1` benchmark corpus from `garrytan/gbrain-evals`.

- Source repository: `https://github.com/garrytan/gbrain-evals`
- Source corpus path: `eval/data/world-v1`
- Pinned commit: `b8cf8ad057635cbb03c0f3996acb693afbcae605`
- License: `MIT`

Why this is checked in:

- keeps the KB benchmark self-contained
- removes the `/tmp/gbrain-evals` external prerequisite
- makes benchmark runs deterministic in CI and local development

This corpus is an upstream fictional benchmark set. It is useful for retrieval comparability with GBrain, but it is not first-party company data.

Current repo benchmark contracts:

- `github-benchmark`
  The exact 145-query relational benchmark shape currently presented in the GBrain GitHub side-by-side contract:
  - `Who attended <meeting>?`
  - `Who works at <company>?`
  - `Who invested in <company>?`
  - `Who advises <company>?`
- `corpus-linkable`
  A broader internal exploration surface over every vendored `world-v1` relation that points at another vendored entity page. This is useful for internal comparison, but it is not the public gold benchmark rail.
