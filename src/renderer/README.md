# Renderer

The Angular application: the shell, plus every module's `ui/` folder. It talks to the host only through commands and events (`@studio/ui`'s `HostBridge`), never through IPC directly.

## Build

- The Angular CLI's application builder compiles it into `../../out/renderer` (`outputPath.browser` is empty, so there is no `browser/` subfolder). Electron loads `out/renderer/index.html` from disk in production; `<base href="./">` keeps the asset paths relative for `file://`.
- `npm run dev` serves it on port 4210 and points Electron at the dev server. electron-vite's "renderer config is missing" note is expected: electron-vite builds only main and preload.
- This workspace pins TypeScript 6.0 for the Angular compiler; the rest of the repository uses TypeScript 7.
- The workspace packages (`@studio/core`, `@studio/ui`, `@studio/modules`) are TypeScript sources: `angular.json` excludes them from the dev server's pre-bundling so they compile with the app, and `styles.css` registers them with Tailwind's `@source`.
- `tsconfig.app.json` includes `packages/ui` and every `packages/modules/*/ui` folder; `npm run typecheck` runs `ngc` over it.

## Shell

- **Title bar** (`app/title-bar`): the product name, the document tabs, the palette button and the Settings gear beside it. The window is frameless (`titleBarStyle: 'hidden'`); the OS draws its buttons over the right end on Windows and Linux (recoloured to the theme through `window.titleBarColors`) and the traffic lights on the left on macOS. The bar drags the window (`.app-drag`); its controls opt out (`.app-no-drag`).
- **Tabs** (`TabsState`): Home is pinned first; Settings and, later, each open project are tabs. Drag to reorder (pointer events, `dragReorder` in `@studio/ui`), middle-click or Ctrl+W to close, right-click for Close / Close Others / Close to the Right, Ctrl+Tab to cycle. The project on screen is the active tab's (`AppState.activeProjectId`), and project commands run against it by default.
- **Activity bar and sidebar:** one icon per module that has a sidebar panel; clicking the active one hides the sidebar. Both are left out of the frame while no module has a panel (today every panel lives inside the project tab), so the tab content takes the full width.
- **Status bar:** the project, display units, the MCP server and a theme toggle.
- **Command palette** (Ctrl+K): UI actions plus every non-hidden command. Commands that need input open a form generated from their JSON schema (fetched with the hidden `command.schema`): text, number, choice and switch fields, with JSON for anything structured.
- **Project tabs** are composed from panels modules register with `ProjectPanels` (left column, centre view, right column as tabs); each panel gets a `projectId` input. A project's document comes from `ProjectDocs`, the mirror kept up to date by `doc.patched`; view state such as the active level goes through `ProjectView` (stored in the project's `.local/ui.json`). Lengths are shown and parsed with `Units`.
- **Overlays**, mounted once: toasts (`Toasts`; `notify` takes an optional action, a button such as an export's Show, and such a toast stays 6 s), dialogs (`Dialogs.confirm` with an optional list of details, `prompt`, `form` for several fields with per-field validation, and `open(component, data)` for a module's own dialog: a component with the inputs `data` and `close` (`DialogComponent`), drawn in a wider frame that scrolls, cancelled by Escape or a click outside; the Export and DXF import dialogs are such; every kind takes focus on open, keeps Tab inside, is labelled by its heading and gives focus back to the element that opened it on close, `DialogFocus`), context menus (`ContextMenu.open`).
- **Startup** (`provideAppInitializer`): config, the command list and MCP status load before the first render; then the shell follows `config.changed` and `mcp.status`.

## Conventions

Standalone components, zoneless change detection and OnPush (both Angular defaults), signals (`signal`, `computed`, `linkedSignal`, `effect`, `afterRenderEffect`), signal inputs and outputs, `model()`, `viewChild()`, built-in control flow, host bindings in `host`, `inject()`, `@Service()`. Forms use Signal Forms (`form()`, `[formField]`); an editor with more than one field implements `FormValueControl` so `[formField]` binds it like a native input (see `UnitsEditor`). Write `type="checkbox"` in the template on checkboxes bound with `[formField]`. No experimental APIs.

Shared controls are attribute directives on native elements: `button[xButton]`, `button[xIconButton]`, `input[xInput]`, `textarea[xTextarea]`, `select[xSelect]`, `input[xCheckbox]`, `label[xLabel]`, `svg[xIcon]`, `kbd[xKbd]`, `span[xBadge]`. `input[xLength]` and `input[xAngle]` sit on a text input bound with `[formField]`: they mark text that is not a length or angle invalid while typing (`aria-invalid`, a red border; `#t="xLength"` exposes `invalid()` for a message), put it back on blur or Enter, and emit `(commit)` with the parsed millimetres or degrees when a valid value changed.

Colours are semantic CSS variables (`--canvas`, `--surface`, `--elevated`, `--fg`, `--muted`, `--edge`, `--accent`, `--danger`, `--success`, `--warning`, `--titlebar`) exposed to Tailwind as `bg-surface`, `text-muted` and so on, with dark values under `.dark`. The palette is a placeholder until the visual design is decided.

A module's UI half is `defineModuleUI({ id, title, icon, order, availability, sidebar?, tabs, actions? })`, registered in `packages/modules/ui.ts`. The shell renders tab components with `NgComponentOutlet` and keeps every open tab rendered (hidden when inactive).
