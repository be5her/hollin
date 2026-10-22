# Plan Studio

A desktop studio for engineers, architects and interior designers: buildings with any number of floors, walls and rooms of any shape, interiors and decor, with an AI assistant built in and every feature open to AI agents over MCP. "Plan Studio" is a working name; all product names live in [`branding.json`](branding.json).

Windows, macOS and Linux, built with Electron and Angular.

## Status

| Milestone | State |
|---|---|
| 1. Scaffold: monorepo, command registry, MCP server, host, shell, settings, smoke test, CI | done |
| 2. Project library: storage, index, Home screen, tabs, autosave, snapshots, trash, packages | done |
| 3. Document model: building, levels, layers, entities, connectors, transactions, undo, live mirror | done |
| 4. 2D editor: plan view, walls and joins, snapping, exact input, openings, rooms, shapes, dimensions, thumbnails | done |
| 5. Vertical circulation: stairs, ramps and elevators on the plan, slab openings, plan symbols, drawing tools, angle tracking, rule warnings | done |
| 6. AI tools: `plan.describe`, `view.snapshot`, MCP resources and a prompt, the in-app assistant (the Claude API, or your own Claude Code) | done |
| 7. 3D view: stacked levels, extrusion, cut openings, slabs, connector geometry, isolate, cutaway and explode, orbit and walk cameras, 3D snapshots | done |
| 8. Decor: a built-in and imported (glTF) furniture catalog, placing and editing items, materials and finishes, lights with day and night in 3D, door and window parts | done |
| 9. Export and import: DXF, SVG/PDF plans, glTF building, PNG renders | next |

## Development

Node 24 (see `.nvmrc`; the Angular CLI needs ^22.22.3 or ^24.15).

| Script | What it does |
|---|---|
| `npm run dev` | The Angular dev server, then Electron in watch mode: renderer changes reload the window, main/preload changes restart Electron. Uses its own data folder (`Plan Studio Dev`). |
| `npm run build` | electron-vite builds main and preload into `out/`; the Angular CLI builds the renderer into `out/renderer`. |
| `npm run typecheck` | `tsc -p tsconfig.node.json` (main, preload, core, mcp, modules' Node side) and `ngc -p tsconfig.app.json` (the renderer and every module's `ui/`). |
| `npm test` | vitest unit tests next to the code in `packages/`. |
| `npm run smoke` | Builds, then launches the app with `--smoke`: a temporary data folder and a private MCP port, every feature checked through commands, MCP and the UI. Exits non-zero on any failure. `SMOKE_SHOTS=<dir>` saves screenshots. |
| `npm run package` | Installers with electron-builder: NSIS on Windows, dmg/zip on macOS, AppImage/deb on Linux (unsigned). |
| `npm run icon` | Renders `resources/icon.svg` to `resources/icon.png` with Electron. |

How changes are made, and the conventions: [CLAUDE.md](CLAUDE.md).

## Layout

```
packages/core            The engine: no Electron, Node I/O or UI framework. Command registry, config schema,
                         units, ids, shared types. Safe to import from the renderer.
packages/core/src/node   Node-only storage: atomic writes, config and secret stores, the project library,
                         project folders and sessions (autosave), packages.
packages/mcp             Turns the command registry into a stateless Streamable HTTP MCP server.
packages/ui              The renderer side of the host contract: HostBridge, invokeResource, state services,
                         shared controls and overlays.
packages/viewport        Framework-free renderers driven by the document: plan2d (Canvas 2D) and scene3d (three).
                         Imported by the renderer only.
packages/modules/<name>  One folder per feature: main.ts (commands), ui/ (Angular), README.md.
src/main                 Electron main: the host, IPC, the window, the smoke test.
src/preload              The only bridge between renderer and main.
src/renderer             The Angular app and the shell (its own npm workspace).
```

## Architecture

Every feature is a set of **commands** with zod input schemas, registered in one `CommandRegistry`. The UI reaches the host only through commands (`window.studio.invoke(id, input, projectId)`), and the same registry backs the command palette, the MCP server and the in-app assistant, so every feature reaches all of them for free. `execute` checks, in order: unknown id (`UNKNOWN_COMMAND`), missing project (`NO_PROJECT`), input (`INVALID_INPUT`, one "path: message" per issue), then the mutating gate, then runs the handler. Errors cross IPC and MCP as `{ code, message, details? }`.

**Mutating** commands (delete, write outside the library, otherwise destructive) are refused to MCP agents until the user allows it in Settings, and the in-app assistant pauses until the user allows or declines the call in the chat. Ordinary design edits are undoable transactions instead.

The **document** of an open project lives in the main process: a building (datum, ground level, level stack) with levels, per-level layers and entities, and connectors between levels. Elevations are derived from the stack. Every edit is a validated transaction with a label and an author on one undo stack; the renderer mirrors the document from `doc.patched` events. The stairs, ramps and elevators between levels are stored as intent (a walk line, levels, a width) and everything else about them (risers, treads, the holes they cut in the slabs, the limits they break) is derived from the level heights and the rule limits, never stored; a rules watcher in main keeps the warnings current. The 3D view is derived the same way: core turns the document into solids (walls extruded in height bands with the openings cut through, slabs, columns, stairs, ramps, elevators; `packages/core/src/solids`) and `scene3d` draws them with three, with isolate, cutaway, explode and a walk camera that climbs the stairs. See `packages/modules/building`, `plan`, `edit` and `rules`. Decor (`packages/modules/decor`) adds furniture from a catalog (31 built-in parametric models drawn from code, and `.glb` models imported into the library and copied into each project that uses them), lights, and finishes on wall faces, floors and ceilings (38 built-in materials with procedural patterns, or any colour), drawn on the plan and in 3D, where a Day | Night switch lights the design with its own lights; doors and windows get frames, leaves and casements from their styles.

Projects live in one **library** folder the app owns (see `packages/modules/library/README.md`): crash-safe saves, autosave, snapshots, a restorable trash and single-file packages.

The host broadcasts typed **events** (`config.changed`, `library.changed`, `project.changed`, `mcp.call`, …) to every window; views follow them, so changes made by an agent show up live.

The **assistant** (`packages/modules/assistant`) is a chat per project in the project tab, run in main with every non-hidden command as a tool; its edits are undoable transactions under its name, destructive calls wait for the user in the chat, and `view.snapshot` lets it see the plan it changed, or the building in 3D. Two providers: the Claude API with the user's own key (the default, and the only path supported for anyone but the user), or the user's own installed, logged-in Claude Code driven as a subprocess whose tools come over the app's MCP server (personal use on the user's machine; it consumes their Claude Code usage limits, and the app never touches its credentials: see the module README's Compliance section). `plan.describe` gives any agent the design as a reader would describe it: rooms with areas, adjacency and openings, and where each stair or elevator lands.

### MCP

`http://127.0.0.1:7433/mcp` by default (Settings shows the URL and ready-to-copy snippets for Claude Code, Claude Desktop, Cursor and VS Code), plus `GET /health`. Stateless: every POST gets a fresh server from the SDK's `createMcpHandler`, which serves 2026-07-28 clients directly and 2025-era clients through its stateless fallback; other methods get 405. Host and Origin headers are checked, so web pages cannot reach it. Every non-hidden command is a tool (`plan.wall.add` becomes `plan_wall_add`, see `toolNameFor` in `packages/core/src/tools.ts`) with its zod schema as input schema and `readOnlyHint`/`destructiveHint` from its mutating flag; a command declared `output: 'image'` (`view.snapshot`) answers with image content. Two resources, the document's JSON Schema (`studio://schema/document`) and the design guidelines (`studio://guidelines`, the same text the in-app assistant is given), and two prompts, `design-house` and `furnish-room`. The calling agent is named from the client info it sends and appears in the call log in Settings. A request whose URL carries `assistant=<token>` with a token the in-app assistant issued (to the Claude Code process it spawned) runs as the assistant instead: `caller: 'assistant'`, attributed to that process, destructive calls asked in the chat rather than gated by the Settings switch; any other token is ignored.

## Dependencies and why

| Package | Why |
|---|---|
| electron, electron-vite, electron-builder | The desktop shell; electron-vite builds main and preload only; electron-builder packages installers. |
| @angular/* (renderer workspace) | The renderer, built by the Angular CLI's application builder. |
| tailwindcss, @tailwindcss/postcss | Styling, with the semantic colour variables as utilities. |
| lucide | Icons, as plain data drawn by the `svg[xIcon]` directive. |
| zod | Every command's input schema; also the MCP tool schemas and the config normaliser. |
| @modelcontextprotocol/server, @modelcontextprotocol/node | The MCP server (SDK v2: the stable line; v1 only gets fixes until early 2027). |
| @modelcontextprotocol/client (dev) | Unit tests and the smoke test talk to the server with the SDK's own client. |
| @anthropic-ai/sdk | The in-app assistant's Claude API client: streaming, typed errors and the request types (`packages/modules/assistant`). |
| fflate | Project packages (zip) without native modules. |
| rbush (+ `@types/rbush`) | The plan's R-tree: culling what is drawn and hit-testing candidates. |
| three (+ `@types/three`) | The 3D view's WebGL rendering (`packages/viewport/src/scene3d`); its own `GLTFLoader` and `RectAreaLightUniformsLib` addons load imported models and light area panels (Milestone 8 added no dependency). Pinned exactly to `0.186.1`: three has no semver, any release may change the API. |
| clipper2-ts | Polygon unions, differences and offsets (a TypeScript port of Clipper2): joined walls, opening cuts, room detection, the automatic slab; and its triangulation for the 3D solids' caps. Pinned exactly to `2.0.1-18`: its releases are numbered `2.0.1-N`, which semver ranks below the old plain `2.0.1`. |
| vitest, typescript | Tests and type checking (TypeScript 6.0 pinned for the Angular compiler, 7 elsewhere). |
