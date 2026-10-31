# Settings

The Settings tab (the gear beside the palette button in the title bar, `Ctrl+,`, or the palette) and the commands behind its secrets.

- **Appearance:** light, dark or follow the system. The native window buttons are recoloured to match.
- **Units:** metric (mm, cm or m, with a decimal precision) or imperial (feet and inches, or inches, rounded to a fraction from 1" to 1/64"). Only display and typing change: designs are stored in millimetres. The units editor is one `FormValueControl` bound with `[formField]`.
- **MCP server:** on/off, port (applied when the field loses focus; the server restarts on the new port), whether agents may run mutating commands, ready-to-copy client snippets, and the latest agent calls with their outcome, signed "Otto · <model>" with the 14 px mark for the assistant's own Claude Code calls and "MCP · <client>" with a hollow ring for outside agents (not tinted: the log is the server's record).
- **Assistant:** the heading with Otto's 20 px mark, a paragraph saying Otto reaches Claude through the API with your key or your Claude Code, and the rule ("Otto edits as a named author on your undo stack and asks before it deletes anything", with how the question works); the provider (the Claude API with your key, the default, or your own installed Claude Code), and for the API the model (Claude Opus 5.5 by default) and the Claude API key; for Claude Code the command (empty means `claude` on PATH, applied when the field loses focus), a Check again button, a line saying whether it was found, which version and whether it is logged in, the model (an alias suggested from a list, or a full id; applied on blur or Enter) and the effort (empty for Claude Code's own defaults), and a note that this mode runs on this computer only and counts against your Claude Code usage limits.
- **About** (the last section): the app icon at 112 px, the wordmark at 40 px, `BRANDING.description`, the credit line "<product> with Otto" in Fraunces (the product name from `BRANDING` in ink, "with Otto" in mulberry), the model and who provides it (the API model's label and Anthropic, or Claude Code with its version and "your own install", from `assistant.status`) with the rule Otto keeps, then one mono line: the version, the three fonts (OFL 1.1), Lucide (ISC), three.js and Electron (MIT), and **Licences…**, a dialog (`licences-dialog.ts`) showing each bundled font's licence text as shipped beside the font files (imported as text through the renderer build's `.txt` loader in `angular.json`; no dependency). A small line under it keeps the platform, the Electron and Chromium versions and the data folder.
- **Headings:** the page title and every section heading are in Fraunces (`heading-page`, `heading-panel` in `styles.css`), the descriptions at 13 px.
- Other modules add sections through `SettingsSections`: **Library** (its folder; the library module) and **Rules** (the stair and ramp limits, typed in any unit; the building module) after Units, and **Updates** (the updates module) after the Assistant, just before About: a section whose `order` is `SETTINGS_LATE` (900) or more goes there.

Choices apply as they are made, through the hidden `config.update` command.

## Storage

Everything but the key is in the global `config.json` (see `packages/core/README.md`). The API key is in the encrypted secret store under `anthropic-api-key`; without OS encryption it is kept for the session only, and Settings says so.

## Agents

- Allowed: `config.get` (read the settings; never contains secrets), `app.info` (also says whether this build can update itself, `updates`), `mcp.status`.
- The Updates section's commands (`app.update.*`) are hidden too: see `packages/modules/updates/README.md`.
- Not exposed at all (hidden): `config.update`, `ai.key.status`, `ai.key.set`, `ai.key.clear`, `mcp.restart`, `mcp.calls`. An agent can neither read the key nor allow its own mutations.

## Verified by

`src/main/smoke/host.ts` (config written and announced, patches validated, key stored encrypted and never returned), `src/main/smoke/mcp.ts` (hidden commands are not tools, port changes restart the server, on/off), `src/main/smoke/shell.ts` (theme, units editor, MCP section and call log, mutations switch, saving and removing the key, About), and `src/main/smoke/assistant-claude-code.ts` (the provider switched to Claude Code, the command field and the not-found line, the MCP switch turned off and the server back on from the chat), `src/main/smoke/identity-ui.ts` (About's icon, wordmark, description, the two-colour credit line, the rule, the version and licence line, the Licences… dialog), and `src/main/smoke/updates-ui.ts` (the Updates section before About, its states, buttons and checkbox, and the toast that opens Settings scrolled to it).
