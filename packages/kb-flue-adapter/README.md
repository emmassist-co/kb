# `@emmassist-co/kb-flue-adapter`

Flue adapter for the KB runtime surface.

## Owns

- Flue-facing `kb` command parsing
- focused help, schema, and validation surfaces
- result shaping for mounted-runtime KB commands
- direct runtime and RPC bridging for KB reads, writes, drafts, events, relations, rebuild, and restore

## Does not own

- KB storage semantics
- storage backends
- tenant product-config resolution
- host runtime creation or service wiring

## Host contract

Hosts should pass a small adapter into `createKbCommand(...)` that provides:

- product-config resolution
- KB runtime creation
- KB service creation

That keeps the published package reusable across Flue hosts without hard-wiring one app's product-config or runtime layout into the package.

## Notes

- Runtime consumers should use `@emmassist-co/kb-flue-adapter/command` directly.
- This package stays Flue-structural and host-agnostic.
- If a behavior is pure KB contract, keep it here instead of re-implementing it in an app-local wrapper.
