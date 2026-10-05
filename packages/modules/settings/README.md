# Settings

The Settings tab (activity bar gear, `Ctrl+,`, or the palette) and the commands behind its secrets.

- **Appearance:** light, dark or follow the system. The native window buttons are recoloured to match.
- **Units:** metric (mm, cm or m, with a decimal precision) or imperial (feet and inches, or inches, rounded to a fraction from 1" to 1/64"). Only display and typing change: designs are stored in millimetres. The units editor is one `FormValueControl` bound with `[formField]`.
- **MCP server:** on/off, port (applied when the field loses focus; the server restarts on the new port), whether agents may run mutating commands, ready-to-copy client snippets, and the latest agent calls with their outcome.
- **Assistant:** the model (Claude Opus 5.5 by default) and the Claude API key.
- **About:** version, runtime and data folder.

Choices apply as they are made, through the hidden `config.update` command.

## Storage

Everything but the key is in the global `config.json` (see `packages/core/README.md`). The API key is in the encrypted secret store under `anthropic-api-key`; without OS encryption it is kept for the session only, and Settings says so.

## Agents

- Allowed: `config.get` (read the settings; never contains secrets), `app.info`, `mcp.status`.
- Not exposed at all (hidden): `config.update`, `ai.key.status`, `ai.key.set`, `ai.key.clear`, `mcp.restart`, `mcp.calls`. An agent can neither read the key nor allow its own mutations.

## Verified by

`src/main/smoke/host.ts` (config written and announced, patches validated, key stored encrypted and never returned), `src/main/smoke/mcp.ts` (hidden commands are not tools, port changes restart the server, on/off), and `src/main/smoke/shell.ts` (theme, units editor, MCP section and call log, mutations switch, saving and removing the key, About).
