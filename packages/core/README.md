# @studio/core

The engine. Everything here is pure TypeScript with no Electron, Node I/O or UI framework, so the renderer imports it too; Node-only storage lives in `src/node` and is imported as `@studio/core/node`.

## Commands

- `defineCommand({ id, title, description, scope, input, mutating?, hidden?, handler })` is a typed identity helper: the handler infers its input type from the zod schema.
- `defineModule({ id, commands, onStart?, onStop?, onProjectOpen?, onProjectClose? })` groups a feature's commands.
- `CommandRegistry.execute(id, rawInput, ctx)` checks, in order: unknown id → `UNKNOWN_COMMAND`; a project-scope command without a project → `NO_PROJECT`; `safeParse` failure → `INVALID_INPUT` (each issue as "path: message", also in `details`); the mutating gate; then the handler.
- The mutating gate never applies to the UI. MCP callers are refused (`MUTATION_BLOCKED`) unless `config.mcp.allowMutations` is on. The assistant goes through `host.confirmMutation`, which asks the user (`MUTATION_DECLINED` when they say no; refused while no host provides it). A function-valued `mutating` decides per call, after validation.
- `registry.list()` gives `{ id, module, title, description, scope, mutating, conditional, hidden, noInput }` for the palette and MCP.
- `StudioError(code, message, details?)` is the one error type; `toErrorPayload` turns anything thrown into `{ code, message, details? }`.

## Other pieces

| File | What |
|---|---|
| `config.ts` | The config schema and `mergeConfig`: sections merged one level deep and normalised field by field, so an old or hand-edited file falls back per field instead of failing. `ConfigPatchSchema` validates patches strictly. `AI_MODELS` lists the assistant's models. |
| `units.ts` | `formatLength`/`parseLength` (metric mm/cm/m, imperial feet-inches or inches with fractions) and `formatAngle`/`parseAngle`. Lengths are always stored in millimetres. |
| `ids.ts` | `newId(prefix)`: prefix + 16 lowercase Crockford base32 characters (80 bits) from `crypto.getRandomValues`. |
| `branding.ts` | The product names from `branding.json`. |
| `mcp-snippets.ts` | Ready-to-copy MCP client configuration for Settings. |
| `command-score.ts` | Fuzzy ranking for the palette (a port of cmdk's scoring, MIT). |
| `test-host.ts` | An in-memory `HostApi` for unit tests. |

## Storage (`src/node`)

- `writeFileAtomic(file, data)`: a uniquely named temp file next to the target, fsync, then rename. The rename is retried with backoff for about two seconds on `EPERM`/`EBUSY`/`EACCES`, which Windows reports while an antivirus scanner, the indexer or a preview pane holds the file. The temp file is removed on failure. `renameWithRetry` does the same for folders.
- `WriteQueue` runs writes one after another per key; a failed write rejects its caller but never blocks later writes.
- `ConfigStore`: `config.json` in the app's data folder. A file that is not JSON is kept aside as `config.corrupt-<time>.json` and the app starts from defaults. Every update is written atomically and announced (`config.changed`).
- `SecretStore`: named secrets encrypted with the OS keychain (Electron `safeStorage`) in `secrets.json`. Without OS encryption (or with Linux's fixed-key `basic_text` backend) nothing is written and secrets last for the session only; `persistent` says which.

## Tests

`npm test` runs `*.test.ts` here: the registry and its gates, config merging and normalising, units, ids, atomic writes and the retry, the write queue, the config and secret stores.
