# Working on Plan Studio

Plan Studio (a working name; every product name lives in `branding.json`) is a desktop studio for designing buildings, floor plans, interiors and decor, with AI built in: Electron + an Angular renderer in an npm-workspaces monorepo. `README.md` is the overview; `packages/core/README.md` covers the engine and storage, `src/renderer/README.md` the shell, and each module has its own README under `packages/modules/<name>/`. This file is about how changes get made.

## Workflow

- The repository is local only until the owner asks for it to go on GitHub. Do not create a GitHub repository or push before that.
- Until then, each milestone or change is committed on the local `main` once it is verified.
- Once the repository is on GitHub: one branch and one pull request per change, against `main`. Never commit to `main`. Open the pull request with `gh pr create` following `.github/pull_request_template.md`, report the link and do not merge.
- Before every commit, all three must pass: `npm run typecheck`, `npm test`, `npm run smoke`.
- For UI changes, run the smoke with `SMOKE_SHOTS=<dir>` and look at the screenshots (light and dark) before committing.
- Each module has a README covering what it does, what it stores, which tools agents may call and which are gated, and what the smoke test covers. Update it when behaviour changes.
- No new dependency without a one-line reason, in the commit message and in the README of the package that uses it.
- Keep the clone's author identity on commits.

## Conventions

- **Everything is a command.** A feature is a set of registry commands (`defineCommand` with a zod input schema, grouped by `defineModule`) plus UI. Commands are the only way the UI reaches the host, so the command palette, the MCP server and the in-app assistant get every feature for free. Write each command's `description` for an agent: what it does and what it returns.
- **Mutating** means deletes, writes outside the library, or is otherwise destructive (`mutating: true`, or a function for per-call decisions). MCP agents are refused those until the user allows mutations; the assistant asks the user. Ordinary design edits are not mutating: they are undoable transactions.
- **Hidden** commands are UI plumbing and never reach the palette or agents. Anything that could let an agent widen its own permissions (`config.update`, secrets) is hidden.
- **Every change the UI shows must be announced.** Add the event to `HostEvents` in `packages/core/src/types.ts` and emit it after the write; the UI follows with `invokeResource(..., { refreshOnEvents })` or `injectHostEvent`. Otherwise a view only catches up when it is reopened.
- **Storage:** atomic writes only (`writeFileAtomic`: temp file, fsync, rename with a retry for Windows locks), serialized per file with `WriteQueue`. Lengths are millimetres everywhere; display units are a setting. Secrets go through `host.secrets` and never into config, projects or exports.
- **Modules:** `packages/modules/<name>/main.ts` (Node side, registered in `packages/modules/main.ts` and listed in `tsconfig.node.json`'s globs), `ui/` (Angular side, registered in `packages/modules/ui.ts`; `src/renderer/tsconfig.app.json` picks it up), `README.md`.
- **Renderer:** current Angular defaults only: standalone components, zoneless, OnPush, signals, signal inputs/outputs/`model()`, `viewChild()`, built-in control flow, `host` metadata, `inject()`, `@Service()`, Signal Forms (`[formField]`; editors with several fields implement `FormValueControl`). No experimental APIs. Shared controls are attribute directives on native elements (`button[xButton]`, `input[xInput]`, `select[xSelect]`). Colours are the semantic variables in `src/renderer/src/styles.css`, never raw values.
- **Smoke test:** new behaviour gets checks in `src/main/smoke/` (one file per area) that drive it through commands, through MCP and through the UI. Unit tests sit next to pure code in `packages/*`.
- **Line endings** are LF everywhere (`.gitattributes`).

## Gotchas

- The Angular compiler needs TypeScript 6.0, pinned in `src/renderer`; the root uses TypeScript 7 for main, preload and the packages.
- Signal Forms types a checkbox only when `type="checkbox"` is written in the template, even with `xCheckbox`.
- `npm run dev` uses a separate data folder (`<name> Dev`); the smoke test uses a temporary one and a private MCP port. Neither touches the real library.
- On Windows, write multi-line scripts with a file rather than a shell heredoc, and stop processes by PID (`taskkill /pid <pid> /t /f`), never by image name.
- `packages/viewport` is type-checked by `tsconfig.node.json` (its unit tests run in node, so nothing there may touch `ResizeObserver`, `OffscreenCanvas` or `Path2D` at import time) and compiled into the renderer through its imports.
- The plan canvas mirrors its state into `data-camera="x,y,scale"`, `data-level`, `data-underlay`, `data-entities` and `data-frame-ms`; the smoke test converts millimetres to window pixels from those and samples pixels with `canvasPixel`. Measure the canvas rect again after switching tools: a tool's options bar changes the canvas height, so screen positions computed before it appeared (or vanished) are off by half its height. The canvas follows the theme by watching `<html class>`, so the smoke's `setDark` works without going through the app's theme service.
- In the smoke harness, `typeText` sends `char` events only: a key a canvas must see goes through `key()`, and the first character typed into a just-focused input too. `wheel()` takes the DOM's sign (negative zooms in).
- `clipper2-ts` is pinned exactly to `2.0.1-18` (its releases are `2.0.1-N`; a caret installs the old plain `2.0.1`). It is ESM-only, so it must never be added to the `external` list in `electron.vite.config.ts`: main's CommonJS bundle would `require()` it. Keep it in `packages/core` and let electron-vite bundle it.
- Derived geometry memoised by object identity (`LevelGeometryCache`) is valid in the renderer only: the mirror builds a fresh draft per patch. In main, a transaction mutates a level's entity record in place while a `plan.apply` batch runs, so main derives afresh (`deriveLevelGeometry`).
- Points are readonly tuples (`Vec2 = readonly [number, number]`) in both the geometry and the zod schemas; build new points instead of mutating.
- Project thumbnails are drawn in the renderer (`renderLevelToPng`, the ground floor) 1.5 s after a project's last change and when its tab is left, and stored through the hidden `project.thumbnail.set`. A smoke section's edits can therefore land a thumbnail during a later section; checks that compare library summaries should ignore `thumbnail`.
- Toasts stack over the bottom-right corner of the window. A smoke step that right-clicks (or clicks) something there, such as the last Home card, must dismiss them first (`rightClickCard` in `src/main/smoke/library-ui.ts`) or aim away from that corner. The smoke window is only about 780 px tall: a Home card on the second row is below the fold, so scroll it into view before a real click (`rightClickCard` does). Every project an earlier smoke section creates adds a card.
- The plan canvas helpers for the smoke (`readCamera`, `toScreen`, `view`) live in `src/main/smoke/plan-canvas.ts`; measure `view()` again after anything that changes the canvas.
- Connectors have no layer and are not entities: `plan.path.*`, `plan.transform`, `plan.entity.delete` and `plan.query` accept their ids next to entity ids and tell them apart by the id prefix (`str_`, `elv_` ..., `isConnectorId`); a path edit on a connector takes only `which: 'outer'` (the walk line). They are always drawn and selectable, and both marquee modes take them, so a smoke marquee over a level a stair arrives at selects the stair too.
- The performance bounds (`perf.test.ts`: 2 s for 5,000 walls; `smoke/perf.ts`: a 100 ms mean frame) are loose because CI draws with software GL. Read the logged numbers, not only the pass.
