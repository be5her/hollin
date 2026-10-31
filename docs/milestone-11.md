# Milestone 11: the visual identity

The app gets its identity before it goes on GitHub. The identity was designed in `design/`: four concepts (`design/concepts/`), the owner combined Craft and AI-native, and five detail documents in `design/identity/` specify it to a buildable level. **`design/identity/00-decisions.md` is the source of truth** (including §6, icon B, and §6a, the points resolved after the detail round); `01-brand.md`, `02-components.md`, `03-otto.md`, `04-canvas.md` hold the exact values; **`05-implementation.md` is the engineering map** (variable map, core mirrors, fonts, icons, branding, components, Otto's code touchpoints, smoke and tests, risks) and this milestone follows its §10 build order; `06-open-points.md` lists what the build must fix.

In one paragraph: a clean sheet on a desk, drawn by two authors. Warm paper and ink with one terracotta mark (Craft), Alegreya Sans, IBM Plex Mono and Fraunces bundled; and **Otto**, the assistant, as a named second author in a mulberry ink nothing else uses, whose edits carry a halo on the plan and are signed in History, who asks before deleting, and whose colour never asks the user to click it.

The repository stays local; each step is verified (`npm run typecheck`, `npm test`, `npm run smoke`, and for UI steps the smoke with `SMOKE_SHOTS=<dir>` with the light and dark shots looked at) and committed on local `main` on its own. The working name stays "Plan Studio" in `branding.json` until the owner confirms the product name; the identity documents use "Hollin" as a working name and the rename is its own later commit.

## Rules for every step

- The layout does not change: this is a skin, the three empty moments, Otto's presence, the Home cards and the exports' title block.
- Colours are the semantic variables in `styles.css`; `--titlebar` / `--titlebar-fg` stay `#rrggbb`; `--scene-*` are mirrored in core (`SOLID_COLORS`, `LIGHT_SCENE_THEME`, pinned by `snapshot-theme.test.ts`). No raw colour in a component.
- Fonts are assets, not dependencies: bundled under the renderer, loaded under `font-src 'self'`, their OFL licence files next to them. No new npm dependency in this milestone.
- Smoke checks that sample canvas pixels or compare colours are updated with the palette, never loosened; a new UI check waits on the condition, never on a delay. Screenshot numbers: grep `src/main/smoke` before taking one (`05-implementation.md` §9 lists those in use).
- Module READMEs, `src/renderer/README.md`, `CLAUDE.md`'s gotchas and `CHANGELOG.md`'s `[Unreleased]` are updated in the step that changes the behaviour.
- Two unit tests are timing-bound and can time out under machine load (`perf.test.ts`, `library.test.ts`'s hostile packages); rerun them alone before treating a timeout as a failure. Stale Electron processes from an earlier smoke make the UI smoke flaky: `tasklist`, then `taskkill /pid <pid> /t /f`.
- Commit messages: `Milestone 11, step N: <title>`, a body that says what changed and how it was verified, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Steps

### Step 1: the reskin (fonts, variables, icon stroke)
`05-implementation.md` §1, §2, §3, §4, §7 rows 1–4, §9. `styles.css` gets the full light and dark tables from `01-brand.md` (every `--*`, `--plan-*`, `--scene-*`, plus `--ai`, `--ai-hover`, `--ai-fg`, `--ai-tint`, `--plan-ai` and their `@theme inline` entries), `--font-sans` / `--font-mono` / `--font-display` and the `@font-face` blocks; the six font files and licences; `window.ts`'s title-bar colour; the viewport themes, `SOLID_COLORS` and the scene themes in core; the 3D night background constant (`#0f0d0b` in both themes); the Lucide stroke default 1.6 and the explicit `strokeWidth` attributes; radii and the one dialog shadow; the room wash at 0.18; the smoke's expected colours. Verified by the three checks and the shots in both themes.
Commit: `Milestone 11, step 1: the reskin`.

### Step 2: app icon and brand components
`05-implementation.md` §5, §7 last rows. `resources/icon.svg` from `design/identity/icon-b.svg` (two rooms), `npm run icon`, `resources/icon.png`; three brand components (the app mark, the wordmark as outlined paths from `wordmark.svg`, Otto's mark from `otto-mark.svg`) in `packages/ui`; the title bar shows the mark and the wordmark per `02-components.md`. `branding.json`, `package.json`'s `productName` and the strings that follow them are **not** renamed in this step. Verified by the checks and a title-bar shot.
Commit: `Milestone 11, step 2: app icon and brand components`.

### Step 3: Home cards, the three empty moments, About
`05-implementation.md` §7, `01-brand.md` §g, `02-components.md` (Home cards, empty states). Tinted sheets with a pencil doodle and initials replace the random gradients; first launch, the empty project card over the grid (with the Otto line), Properties' "Nothing selected"; About with the lockup, the "Hollin with Otto" credit (using `BRANDING.productName`), the version and licence line; Fraunces headings where `01-brand.md` §d allows. New smoke `identity-ui.ts`. Verified with shots in both themes.
Commit: `Milestone 11, step 3: Home cards, empty moments and About`.

### Step 4: Otto in the panel, History and the status bar
`05-implementation.md` §8, `03-otto.md` §b, §d, §e, §g. The panel header (mark, Otto, model and rule line), the message styles, every tool-card state, the input and hint, the Stop control, the provider and error states; History rows for you / Otto / MCP agents with the waiting entry at the top; the status-bar state (`AppState.assistant`, announced by the assistant module); the right-panel tab reads **Otto** with the mark; Settings > Assistant's heading and copy; Otto's voice in the system prompt (`03-otto.md` §a, and the audience wording: homeowners, not architects). Update the smoke text expectations; new `otto-ui.ts`. Verified with shots.
Commit: `Milestone 11, step 4: Otto in the panel, History and the status bar`.

### Step 5: Otto on the canvas and the Home composer
`05-implementation.md` §8, `03-otto.md` §c, §f. Recent assistant edits from the undo stack's author and timestamps to the viewport as highlights; the halo, end nodes and tag in `--plan-ai`; the pending dashed outline while a destructive call waits; coexistence with selection; the Home "Start with Otto" composer (create a project, then start a chat with the sentence) in its three states; the corner mark on cards Otto worked on (the indexed field, or its deferral noted in the README). Smoke: a halo pixel check and the composer flow through the fake API. Verified with shots.
Commit: `Milestone 11, step 5: Otto on the canvas and the Home composer`.

### Step 6: exports' title block and print palette
`05-implementation.md` §10 item 6, `04-canvas.md` §e. `PRINT_COLORS` re-mirrored from the light plan palette darkened for paper; the 90 × 24 mm title block with the product name, project, level, scale and date on SVG and PDF sheets; the DXF colour indices from `04-canvas.md`; the exchange tests' pinned colours updated. Verified by the checks and the exchange unit tests.
Commit: `Milestone 11, step 6: exports' title block and print palette`.

### Review
After step 6: one read-only reviewer over `git diff <base>..HEAD` plus the orchestrator's own read, findings merged into one fixes brief that also writes `docs/milestone-11-review.md`. Commit: `Milestone 11: review fixes`.

## After the review
- **The product rename** landed as its own commit once the owner confirmed the name (31 Oct 2026): `branding.json` (`Hollin`, `app.hollin.desktop`, data folder `Hollin`, packages `.hollin`, MCP server `hollin`), `package.json`'s `productName`, `index.html`'s title, README, CLAUDE.md, the assistant and exchange READMEs. The changelog says that the MCP server's name changed, so `mcp__plan-studio__*` entries in users' allow-lists must become `mcp__hollin__*`, and that the data folder moved (a library under `Plan Studio` is not picked up by itself).
- The wordmark ships as live text in the bundled Fraunces (review finding 19, accepted), so `wordmark.svg` is a record only.
