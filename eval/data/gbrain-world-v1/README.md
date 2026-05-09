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
