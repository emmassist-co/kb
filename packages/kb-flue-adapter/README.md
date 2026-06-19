# `@emmassist-co/kb-flue-adapter`

Flue-specific KB integration layer.

## Owns

- Flue command wiring for `kb`
- runtime config translation
- compatibility surface for the workspace runtime

## Does not own

- KB semantics
- storage backends
- HTTP route logic
- host-specific runtime assembly

## Compatibility

- returns a structural command object instead of importing legacy `@flue/sdk` subpath types
- works with Flue `0.3.x` and the root-export Flue `1.x` line
- consuming repos can assign `createKbCommand(...)` to their local Flue `Command` type

## Example

```ts
import type { Command } from '@flue/sdk';
import { createKbCommand } from '@emmassist-co/kb-flue-adapter';

const kbCommand: Command = createKbCommand(fs, env, { runtime });
```

Older `0.3.x` consumers that still import `Command` from `@flue/sdk/client` remain compatible because the adapter output is structural rather than nominal.
