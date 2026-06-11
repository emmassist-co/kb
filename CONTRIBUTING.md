# Contributing

## Before You Start

- use Node `22+`
- run `npm ci`
- work from a branch, not directly on `main`
- keep changes scoped and easy to verify

## Local Verification

For normal code changes:

```bash
npm run build:public
npm run typecheck
npm test
```

For KB eval or retrieval changes, also run:

```bash
npm run verify:kb:evals
```

For benchmark harness changes specifically, run:

```bash
npm run test:bench
```

## Pull Requests

- explain the user-visible or operator-visible change
- list verification commands you ran
- call out benchmark refreshes when retrieval, indexing, or sync behavior changed
- update docs when install, deployment, or runtime behavior changed

## Release Notes

Public package changes should keep `README.md`, package READMEs, and benchmark docs aligned with the shipped surface.
