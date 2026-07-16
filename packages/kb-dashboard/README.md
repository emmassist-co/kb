# `@emmassist-co/kb-dashboard`

Static Vite dashboard for browsing and operating a local KB through the existing `/v1` API.

This package owns the browser app and built assets. Hosts such as `@emmassist-co/kb-cli` decide whether to serve those assets alongside a local KB HTTP API.

## Build Output

- TypeScript package helper: `dist/index.js`
- Static browser app: `dist/client/`

The package exports `resolveKnowledgeBaseDashboardAssetsDir()` so a local host can locate the packaged static assets without knowing this package's internal build layout.
