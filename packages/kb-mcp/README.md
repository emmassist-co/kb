# `@emmassist-co/kb-mcp`

MCP transport adapter for the Cloudflare-first KB stack.

## Owns

- stateless Streamable HTTP MCP handler for deployed KB Workers
- scope-filtered KB tool registration over the existing KB service layer
- reuse of the deployed KB auth model instead of a parallel runtime contract

## Install

```bash
npm install @emmassist-co/kb-mcp --@emmassist-co:registry=https://npm.pkg.github.com
```

## Exports

- `@emmassist-co/kb-mcp`
  `createKnowledgeBaseMcpServer`, tool registration, and package-level exports
- `@emmassist-co/kb-mcp/cloudflare-worker`
  Worker-facing MCP fetch adapter for `/mcp`
- `@emmassist-co/kb-mcp/mcp-server`
  Server construction for stdio or custom transport wiring
- `@emmassist-co/kb-mcp/tools`
  Scope-filtered KB MCP tool registration helpers

## Tool Surface

Read-scoped tools:

- `capabilities`
- `inspect`
- `doctor`
- `search`
- `query_relations`

Write-scoped tools:

- `remember`
- `record`
- `relate`
- `annotate`

Operator-scoped tools:

- `export`
- `rebuild`

## External Client Example

For any MCP client that supports Streamable HTTP plus static headers, point it at the deployed Worker endpoint and send the same API key used for `/v1`:

```json
{
  "mcpServers": {
    "acme-kb": {
      "transport": {
        "type": "streamable-http",
        "url": "https://kb.acme.example/mcp",
        "headers": {
          "Authorization": "Bearer replace-me-with-a-secret"
        }
      }
    }
  }
}
```

Verify that host before handing it to an external client:

```bash
KB_BASE_URL=https://kb.acme.example \
KB_API_TOKEN=replace-me-with-a-secret \
npx kb cloudflare verify --workspace-id acme
```

## Verification

Default HTTP transport smoke against the Worker-shaped `/mcp` surface:

```bash
npm run smoke:kb-mcp -- --workspace-id kb-mcp-smoke
```

Local stdio smoke for direct server registration:

```bash
npm run smoke:kb-mcp -- --transport stdio --workspace-id kb-mcp-smoke
```

Codex-session registration smoke for debugging only:

```bash
npm run smoke:codex-mcp -- --workspace-id kb-mcp-smoke
```

## Agent Adoption Boundary

Use CLI skills for command-running agents that can execute `kb` commands. Use `/mcp` for MCP-aware clients that need tool registration through their host. Skills do not auto-configure every MCP host; each client still needs its own server configuration pointing at `/mcp` with bearer auth.

## Notes

- `kb-http` remains the canonical deployed JSON contract.
- `kb-mcp` is an additional client surface over the same workspace-scoped runtime.
- The first release is designed for shared-secret bearer auth and keeps fuller OAuth flows deferred.
- The preferred automated verification path is the direct MCP client smoke over HTTP, not an interactive agent session.
