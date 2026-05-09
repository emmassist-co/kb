# `@emmassist/kb-flue-adapter`

Flue-specific KB integration layer.

## Owns

- Flue command wiring for `kb`
- runtime config translation
- compatibility surface for the workspace runtime

## Does not own

- KB semantics
- storage backends
- HTTP route logic

## Notes

- Existing workspace consumers should keep using the `kb` command through the runtime.
- New local agents should prefer `@emmassist/kb-cli` or `@emmassist/kb-http`.

