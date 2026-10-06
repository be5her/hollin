# Build a desktop floor & interior design studio with built-in AI

## Product
A desktop app for engineers, architects and interior designers (not developers) to design buildings,
floor plans, interiors and decor. Anything can be drawn:
- walls, rooms and free shapes of any size and outline
- any corner: sharp, rounded or chamfered
- straight or curved edges
- exact numeric input for every length and angle

There are no fixed templates; the only limit is the user's imagination.

A project is a building with any number of floors (levels), including basements. Floors stack into one
building and are connected by vertical circulation: stairs, ladders, ramps, elevators and escalators.

Each floor is edited on layers of increasing detail:
1. Structure: a 2D wall plan (walls, doors, windows, columns, slab).
2. Interior: rooms (name, finish, area), fixtures, electrical and plumbing points, dimensions, labels.
3. Decor: a 3D layer for furniture models, materials and lighting.

Floors and layers share one model; they are not separate documents. Walls drawn in 2D appear in 3D
automatically: extruded, with openings cut out and floors filled, and every floor sits at its own elevation.

Name, branding, visual design and theme are undecided. Use a neutral working name that is easy to
rename, and propose options when I ask.

## Stack
- Electron for Windows, macOS and Linux.
  - electron-vite builds only the main process and the preload.
  - electron-builder packages the app (NSIS, dmg, AppImage/deb).
  - electron-updater adds in-app updates later.
- Angular renderer, built by the Angular CLI (application builder) into out/renderer, which Electron
  loads from disk in production. Tailwind 4 via @tailwindcss/postcss. Lucide icons.
- TypeScript everywhere, an npm-workspaces monorepo, and zod for every command input schema.
- MCP and AI: @modelcontextprotocol/sdk for the MCP server; the Anthropic SDK (Claude API) for the in-app assistant.
- Geometry and rendering:
  - three for 3D
  - a Clipper2 port for polygon offsets and booleans
  - three-bvh-csg or manifold-3d for cutting openings
  - rbush for 2D hit-testing
- Testing: vitest for unit tests, a headless Electron smoke test end to end, GitHub Actions CI.
- Use current stable versions, and the Node version the Angular CLI requires.

## Monorepo layout
```
packages/core           Pure engine: no Electron, no Node I/O, no UI framework. Document model, geometry,
                        transactions, command registry, shared types. Safe to import from the renderer.
packages/core/node      Node-only: project library storage, global config store.
packages/viewport       Framework-free renderers driven by the document: plan2d (Canvas 2D), scene3d (three).
packages/mcp            Adapts the command registry to an MCP server.
packages/ui             Renderer side of the host contract, shared Angular components and state services.
packages/modules/<name> One folder per feature: main.ts (commands, Node side), ui/ (Angular side), README.md.
src/main                Electron main: host wiring, IPC, windows, updater, smoke test.
src/preload             The only bridge between renderer and main.
src/renderer            The Angular app and shell (its own npm workspace).
```

## Core architecture: everything is a command
A feature is a set of commands plus UI. Commands are the only way the UI reaches the host. That way
the command palette, the MCP server, the in-app assistant and a future CLI get every feature for free.

```ts
interface CommandDefinition<S extends z.ZodObject, O> {
  id: string;                  // 'plan.wall.add'
  title: string;
  description: string;         // becomes the tool description for agents
  scope: 'global' | 'project'; // project commands need an open project
  input: S;                    // validated on every call; becomes the tool's input schema
  mutating?: boolean | ((input: z.infer<S>, ctx: CommandContext) => boolean | Promise<boolean>);
  hidden?: boolean;            // kept out of the palette and MCP
  handler(input: z.infer<S>, ctx: CommandContext): Promise<O>;
}
interface CommandContext {
  caller: 'ui' | 'mcp' | 'assistant';
  agent?: string;              // which agent, for attribution
  host: HostApi;
  project?: ProjectApi;
}
```
- `defineCommand()` is a typed identity helper, so the handler infers its input type from the schema.
- `defineModule({ id, commands, onProjectOpen?, onProjectClose? })` groups a feature's commands.
- `CommandRegistry.execute(id, rawInput, ctx)` runs these checks in order:
  - an unknown id fails with UNKNOWN_COMMAND
  - a project-scope command with no open project fails with NO_PROJECT
  - a zod `safeParse` failure gives INVALID_INPUT, with each issue written as "path: message"
  - then the mutating gate runs, then the handler
- Errors are a typed error class with a code, serialised as `{ code, message, details? }`.
- `registry.list()` returns metadata (id, module, title, description, scope, mutating, conditional,
  hidden, noInput) for the palette and the MCP server.
- Mutating gate: commands that delete, write outside the library or are otherwise destructive are
  mutating. Ordinary design edits are not; they are undoable transactions instead (see below).
  - MCP callers: mutating commands are refused until the user enables them in Settings.
  - The in-app assistant: it asks the user for confirmation in the UI instead.

## Process boundary and live updates
- The preload exposes one object via contextBridge and nothing else:
  - `invoke(id, input, projectId)`
  - `listCommands()`
  - `onEvent(listener)`, which returns an unsubscribe function
  - `platform` and `version`
- Electron settings: contextIsolation on, nodeIntegration off. Modules never touch IPC.
- Main process: an `ipcMain.handle` for invoke calls `host.invoke(id, input, { caller: 'ui', projectId })`
  and returns `{ ok: true, result } | { ok: false, error }`. It never throws across IPC.
- Host events: core defines a typed map `HostEvents` (event name → payload), for example
  `config.changed`, `library.changed`, `project.changed` and `doc.patched`. The host broadcasts
  `{ event, payload }` to every window on one channel.
- Every change the UI shows must be announced. Storage writes emit their event automatically. Any
  other write must emit explicitly, or the view only catches up when it is reopened.
- The open document lives in the main process as the single source of truth. The renderer keeps a
  mirror that `doc.patched` events update, so edits from an agent appear live.
- Gestures stay local: while dragging, the renderer previews the change on its own; on pointer-up it
  sends one command.

## Renderer conventions
- Current Angular defaults only:
  - standalone components, zoneless change detection, OnPush
  - signals (`signal`, `computed`, `linkedSignal`, `effect`, `afterRenderEffect`)
  - signal inputs, outputs and `model()`; `viewChild()`
  - built-in control flow, host bindings in the `host` metadata, `inject()`
- Forms use Signal Forms. An editor with more than one field implements `FormValueControl`, so
  `[formField]` binds it like a native input. No experimental APIs.
- packages/ui holds the host contract:
  - `HostBridge`, a service over the preload
  - `invokeResource(commandId, input, { refreshOnEvents })`, which wraps a command in a `resource()`
    that reloads on the given host events and keeps its last value while reloading
  - `injectHostEvent(name, handler)`
- Startup loads config and the command list before the first render (`provideAppInitializer`) and
  then follows host events.
- A module's UI half is `defineModuleUI({ id, title, icon, sidebar, tabs: { [type]: Component }, actions })`.
  The shell renders a tab's component with `NgComponentOutlet`.
- Shared controls are attribute directives on native elements (`button[xButton]`, `input[xInput]`,
  `select[xSelect]`) rather than wrapper components, so forms and accessibility stay native.
- The shell:
  - title bar, activity bar, sidebar and status bar
  - tabs, with several projects open at once
  - a command palette (Ctrl+K) listing every non-hidden command
  - settings, toasts, dialogs and context menus
  - drag reordering built on pointer events rather than HTML drag and drop, so it behaves the same on every platform
- Theme: colours are semantic CSS variables exposed to Tailwind as utilities, with light and dark
  modes toggled by a class. The palette and look are open design decisions.

## Build and dev setup
- `npm run dev`: a small node script starts `ng serve`, waits until it is up, then starts electron-vite
  with Electron pointed at the dev server URL.
  - electron-vite's "renderer config is missing" note is expected.
  - Use electron-vite's watch mode so changes to main or preload restart Electron. Otherwise the main
    process keeps running stale code.
- The workspace packages are TypeScript sources containing Angular components, and the renderer
  consumes them through node_modules. So:
  - exclude them from the dev server's dependency pre-bundling in angular.json, so they compile with the app
  - register them with Tailwind's `@source`, so their classes are generated
- The Angular compiler supports a specific TypeScript range. Pin that in the renderer workspace,
  separately from the root's TypeScript if they differ.
- Two typechecks:
  - `tsc -p tsconfig.node.json` for main, preload, core, mcp and each module's main.ts
  - `ngc -p tsconfig.app.json` for the renderer, including every module's ui/ folder
- LF line endings everywhere via .gitattributes.
- Scripts: dev, build, typecheck, test, smoke, package.

## Storage: one central project library
Users never pick folders. The app owns a single library, in the app's data folder by default. A
setting lets the user move it, for example to a synced or backed-up drive.

Library layout:
- `projects/<id>/`: project.json (the building and its vertical connectors), levels/<id>.json,
  assets/ (glTF models, textures) and thumbnail.png
- `catalog/`: furniture, materials and symbols shared by every project
- an index for fast listing and search

Rules:
- Writes are atomic: write a temp file, then rename. On Windows, retry the rename briefly, because an
  antivirus or the indexer can lock files for a moment.
- Saving is automatic, and each project keeps named versions (snapshots) that can be restored.
- Deleting moves a project to a trash that can be restored. Emptying the trash is a mutating command.
- Projects are shared by exporting and importing a single-file package (a zip with its own extension).
- Global config is a JSON file in the app's data folder. Nested sections are merged one level deep
  with defaults and normalised on load, so an older or hand-edited file cannot break the app.
- Secrets (the AI API key) use Electron safeStorage, are stored encrypted in the app's data folder,
  never go into projects or exports, and are masked for MCP callers.
- Lengths are stored in millimetres. Display units (metric or imperial) and precision are user settings.

## Document model and transactions
Hierarchy: Project (a building) → Levels → Layers (kind, visibility, lock, opacity) → Entities (stable ids).

Building rules:
- Each level has a name, an elevation, a floor-to-floor height and a slab thickness.
- Levels below ground have negative elevations.
- Elevations stay consistent: changing a level's height shifts every level above it.
- Levels can be added, duplicated (copying a floor's layout), reordered and removed.
- Each level has a floor slab, derived from its outer walls or drawn freely.
- Entities that pass through several levels reference a level range, so they stay continuous
  (columns, shafts, multi-storey voids).

The geometry primitive is a Path: segments {line | arc | cubic bezier}, open or closed, with holes. Each
corner stores a fillet or chamfer parameter rather than baked geometry, so shapes stay editable.

Per-level entities:
- Structure:
  - Wall: path, thickness, height (defaults to the level's height), alignment
  - Opening: door or window hosted on a wall (offset along it, width, height, sill)
  - Column, Slab, Void (a double-height space)
- Interior:
  - Room: detected from closed wall loops or drawn freely (name, finish, computed area)
  - Fixture
  - Point: electrical or plumbing
  - Dimension, Label
- Decor:
  - Item: glTF model, transform, material overrides
  - Light
  - surface materials on walls and floors

Vertical connectors are owned by the building, not by one level:
- Stair: straight, L, U, winder, spiral or curved, generated along a path. It connects a from-level
  to a to-level. Riser count, riser height and tread depth are derived from the height difference,
  with configurable limits; the app warns when a stair breaks them. Landings and handrails are generated.
- Ladder: from-level, to-level, angle.
- Ramp: path, from-level, to-level, slope limit with a warning.
- Elevator: shaft footprint, the list of levels it stops at, a door side per stop, car size.
- Escalator: from-level, to-level, width.
- A connector automatically cuts its opening (stairwell, shaft) in the slab of every level it passes through.
- On each level's plan it shows with the right symbol: the cut line and up/down arrow for stairs,
  the shaft with a door mark for elevators.

Transactions:
- Every edit is a transaction: a list of ops applied atomically, with the inverse recorded for undo/redo.
- Each transaction is labelled and attributed to the user, the assistant or an MCP agent by name.
- Derived geometry (slab openings, stair steps, room areas) is recomputed from the model, never edited
  directly. A change to a level's height therefore regenerates every connector attached to it.

Views (one model drives both):
- plan2d draws one level at a time from above, with a level switcher. The level below or above can be
  shown faintly as a reference for aligning walls and stairs.
- scene3d shows the whole building, stacked by elevation. It:
  - extrudes walls, cuts openings with CSG and triangulates floors and slabs
  - generates connector geometry and loads decor items as glTF
  - can isolate one level, hide the levels above (cutaway), or explode the floors apart
  - lets the walk camera move between floors by stairs, ramps or elevators

## AI
The users are not developers, so AI must work inside the app with no setup.

In-app assistant (a chat panel):
- Runs an agent loop against the Claude API, with the command registry as its tools (zod schemas
  converted to JSON Schema).
- Executes tool calls through the registry with `caller: 'assistant'`, feeds the results back, and
  loops until it is done.
- Streams its replies. Snapshot results go back to the model as images.
- The model can be chosen in Settings.
- Every change it makes is a labelled, undoable transaction.

MCP server, for Claude Desktop and other clients:
- Endpoint: Streamable HTTP on 127.0.0.1, a default port that can be changed in Settings, path `/mcp`,
  plus `GET /health`.
- Stateless: build a fresh McpServer and transport for each POST (`sessionIdGenerator: undefined`,
  `enableJsonResponse: true`) and answer 405 to other methods. This avoids keeping session state.
- Each non-hidden command becomes a tool:
  - name: the id with characters outside `[A-Za-z0-9_-]` replaced by `_`
  - input schema: the zod schema
  - description: says whether the tool is gated
  - annotations: `readOnlyHint` and `destructiveHint`, from the mutating flag
  - results: JSON text; errors as `isError` with the error payload; snapshots as image content
- Agent identity comes from `clientInfo` in the initialize request, falling back to the User-Agent.
  Return an id in a response header so later calls are attributed; it drives transaction labels and a call log.
- Calls act on the active project by default, or on a project chosen by query parameter or argument.
  Add project.list, project.open and project.current.
- Settings shows the URL and a config snippet ready to copy for common clients.

Tools both callers get:
- Building: building.level.add/update/duplicate/move/remove, building.connector.add/update/remove
  (stair, ladder, ramp, elevator, escalator).
- Editing on a level: plan.wall.add, plan.shape.add, plan.entity.update/delete, plan.layer.*,
  decor.item.place, catalog.search, and so on.
- plan.apply: many ops in one transaction, so a whole floor is one call and one undo step.
- Understanding the design:
  - plan.describe: levels; each level's rooms, areas, adjacency and openings; vertical circulation
    (which rooms each stair or elevator connects)
  - plan.query: entities by level, region or layer
  - view.snapshot: renders one level's plan or the 3D building to PNG, so the AI can see its own result
- MCP resources: the document schema and design guidelines. MCP prompts: e.g. "design a 3-storey house
  with a central stair".

## Testing
- Unit tests (vitest) sit beside every pure piece of core:
  - geometry, corners, room detection
  - level elevation propagation
  - stair, ramp and ladder generation and their limits
  - slab openings from connectors
  - transactions and undo, the registry, unit conversion
- `npm run smoke` builds the app, then launches Electron with a smoke flag, using a temporary library
  and a private MCP port. It:
  - exercises every feature through commands, through MCP and through the UI, including a two-storey
    building with a stair and an elevator
  - saves screenshots when `SMOKE_SHOTS=<dir>` is set
  - exits non-zero on any failure
- CI runs typecheck, unit tests and a production build on Linux, and the full smoke test on Windows.

## Workflow (write this into the repo's CLAUDE.md)
- git init locally. Don't create a GitHub repository or push until I ask.
- Once the repo is on GitHub: one branch and one pull request per change against main; never commit to main.
- Before every commit, typecheck, tests and smoke must pass. For UI changes, take screenshots and look at them.
- Each module has a README covering what it does, what it stores, which tools agents may call and
  which are gated, and what the smoke test covers.
- No new dependency without a one-line reason.

## Milestones
1. Scaffold: monorepo, registry, MCP adapter, preload, host, shell, a settings page, the dev and build
   scripts, the smoke test and CI. Typecheck, tests and smoke all pass.
2. Project library: storage, index, home screen (recent projects with thumbnails, search, tags), create,
   open, duplicate, rename, trash, autosave, snapshots, package export/import.
3. Document model with levels from the start (building, levels, layers, entities, connectors as data),
   plus transactions and undo/redo in core, with tests.
4. 2D editor: level switcher and reference underlay, walls (straight and arc), snapping, exact numeric
   input, dimensions, openings, room detection, free shapes with any corner.
5. Vertical circulation: level management UI, stairs, ladders, ramps, elevators and escalators, slab
   openings, plan symbols, rule warnings.
6. AI: MCP tools (building, editing, plan.apply, plan.describe, view.snapshot) and the in-app assistant.
7. 3D view: stacked levels, extrusion, cut openings, slabs, connector geometry, isolate, cutaway and
   explode, orbit camera and a walk camera that moves between floors.
8. Decor: glTF catalog, placing and transforming items, materials, lighting.
9. Export and import: DXF per level, SVG/PDF plans, glTF building, PNG renders.

## How to start
Use plan mode. Propose the plan for milestones 1 to 3, wait for my approval, then work milestone by
milestone. Verify each milestone before moving on.
