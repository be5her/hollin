# Visual identity, step 1: what the app is and how it looks today

A study of the product as built (milestones 1 to 10), to ground the design concepts. Reference screenshots: `design/reference/` (taken from the smoke run, light and dark).

## What the product is

A desktop studio (Electron, Angular, Windows / macOS / Linux) for designing a **building**: any number of levels including basements, walls and rooms of any shape (sharp, rounded or chamfered corners, straight or curved edges), doors, windows, columns, stairs, ramps, ladders, elevators and escalators between floors, dimensions, labels, free shapes. Every floor has three layers of increasing detail: **Structure** (walls, openings), **Interior** (rooms, fixtures, dimensions, labels) and **Decor** (furniture, materials, lights). The same model is drawn as a **2D plan** (Canvas 2D), a **section**, and in **3D** (three.js: stacked levels, isolate / cutaway / explode, orbit and walk cameras, day and night lighting).

AI is a first-class user, not an add-on: every feature is a command, so the command palette, the MCP server and the in-app **assistant** (Claude API, or the user's own Claude Code) get all of them. The assistant edits as a named author on the undo stack, asks before destructive calls, and can look at the plan or the building through snapshots.

Everything else is studio furniture: a project **library** (Home screen with cards, tags, search, trash, single-file packages), autosave and snapshots, **exports** (DXF, SVG, PDF on paper sheets, glTF, PNG), **DXF import** to trace over, **rules** (riser and tread limits with a Warnings panel), in-app **updates**, Settings (theme, units, library, rules, MCP, assistant, updates).

### Who it is for

The original brief named engineers, architects and interior designers. The owner's later decision (31 Oct 2026) was **homeowners and hobbyists**: people planning their own house, flat, renovation or room, who want exact numbers but not CAD. That decision changes what the identity must say: *approachable precision* rather than *professional tool*. The app's bones (millimetre-exact input, rule warnings, DXF) stay; the skin should make them feel welcoming.

## The surfaces that carry identity

In order of how much they define the first impression:

| Surface | What it is today | Weight |
|---|---|---|
| **App icon** | A placeholder: white floor-plan outline with a door swing on a blue rounded square (`resources/icon.svg`, rendered to `icon.png` by `npm run icon`). | Highest: the dock, the taskbar, the installer, the Store page, GitHub. |
| **Name and wordmark** | "Plan Studio", a working name; a 20 px blue square with a bold "P" in the title bar. Every string comes from `branding.json` (`productName`, `shortName`, `appId`, `dataDirName`, `packageExtension`, `mcpServerName`). | Highest: the name is read before anything is seen. |
| **Home screen** | "Projects" heading, New project / Import, search, sort, tag chips, a grid of cards. Cards without a thumbnail show two initials on a random two-colour gradient (magenta, violet, green, teal, orange). With a thumbnail: the ground-floor plan on paper white. | High: the first screen every launch. The gradients are the loudest thing in the app and say nothing about buildings. |
| **Project window** | Title bar (brand, tabs, palette, gear); project header (name, saved state, undo/redo, Save, Export, Duplicate, Trash); left panel (Levels with elevations, level editor, Layers with opacity); centre (Plan / Section / 3D tabs, a tool strip of ~20 Lucide icons, level and reference pickers, zoom); right panel (Properties, Catalog, History, Assistant, Warnings, Project); status bar (project, saved, units, MCP, theme). | High: where every hour is spent. Dense, competent, anonymous. |
| **The plan canvas** | Grid on paper (`--plan-grid`), dark-grey walls, pale blue room fills, blue selection and dimensions, green snap, amber warnings, brown decor outlines, mono labels. Colours read from `--plan-*` variables. | High: the hero picture. Its palette *is* the brand in every screenshot and export preview. |
| **The 3D view** | Flat shaded solids: warm-grey walls, darker slabs, blue elevator cars, blue-grey glass; black background in dark mode; night mode with warm pools of light. Colours from `--scene-*` (and `SOLID_COLORS` in core for exports and renders; the two must match, checked by a test). | Medium-high: the marketing shot. Currently drab; the night render is the best-looking thing in the app. |
| **Catalog** | Chips by category, square cards: furniture renders on white, material swatches. | Medium: colourful already (sage, navy, terracotta paints). |
| **Assistant chat** | Model name with a sparkle icon, tool-call cards with a check or shield icon, user bubbles in a light tint, "Ask the assistant…" input, Send. | Medium: the AI-native story lives here. |
| **Dialogs, palette, toasts, empty states** | Centred white cards with 1 px edges; the palette lists commands with their ids in mono; toasts bottom-right. | Medium-low: consistency rather than character. |
| **Settings and About** | A plain scrolling page with section headings. About will hold the logo, version and licences. | Low. |
| **Exports** | PDF and SVG on a paper sheet, DXF, glTF coloured like the 3D view, PNG. A title block or footer could carry the name. | Low, but it is the one artefact that leaves the app. |
| **Installer, window title, data folder, file extension (.psp), MCP server name** | All follow `branding.json`. | Set once by the name. |

## How it looks today, in one paragraph

A neutral placeholder look, as the stylesheet says: system UI font (Segoe UI on Windows), 13 px body, a single blue accent (`#2f6fda` / `#5b9bf8`), three greys of surface (`--canvas`, `--surface`, `--elevated`) with 1 px `--edge` borders, 6 px radii, Lucide line icons at 1.75–2 px, monospace for every number and unit. Light mode is warm off-white (`#f7f7f5`), dark mode is a cool near-black (`#17181a`). Nothing is wrong with it; it is the default look of every 2024-era developer tool, and it tells a first-time user nothing about what the app is or who it is for.

## Observations that should shape the identity

1. **The plan is the picture.** Walls, rooms, dimensions and the grid appear in every screenshot, export preview, thumbnail and snapshot. The identity's palette has to be designed *with* the canvas (wall colour, room fill, selection, dimension, snap, warning, decor) and not around it. A brand accent that fights the selection blue, or that disappears against room fills, fails.
2. **Numbers are everywhere.** Elevations, lengths, areas, scales, coordinates: the monospace face is a character of the app. A bundled mono with real tabular figures and a matching sans would do more for the feel than any colour.
3. **Two themes, both first-class.** The owner wants light and dark. The canvas and the 3D scene each have their own palettes per theme, in `styles.css` (`--plan-*`, `--scene-*`) and mirrored in core for exports (`SOLID_COLORS`, `LIGHT_SCENE_THEME`, pinned by `snapshot-theme.test.ts`). Any palette change touches both.
4. **Density is high and must stay.** Three panels, two toolbars, a status bar. The identity cannot add chrome; it has to work through type, colour, radius, spacing rhythm and a few hero moments (Home, empty states, About, the splash of a new project).
5. **The Home cards are the loudest element.** Random gradients with initials. The cheapest, most visible win is a card treatment that belongs to the brand: a miniature plan, a paper texture, a signature tint, or at least a palette that comes from the identity.
6. **Three hero moments are empty today:** a new, empty project (nothing on the canvas), an empty library (the first launch), and About. These are where the brand can speak in words and illustration without crowding the tool.
7. **The AI is invisible until you open its tab.** If "AI built in" is the differentiator, the identity should decide how it shows: as a persona (a name, a mark, a colour), or as a quiet capability. The sparkle icon and model name are all there is now.
8. **Technical constraints, so the concepts stay buildable:**
   - Colours are semantic CSS variables; `--titlebar` / `--titlebar-fg` must stay `#rrggbb` (they also colour the native window buttons). Tailwind 4 utilities map onto them.
   - Fonts must be **bundled**: the CSP allows `font-src 'self' data:` only, and the packaged app loads from disk. Variable fonts under an open licence (OFL) keep the installer small.
   - Icons are Lucide line icons drawn by `svg[xIcon]`; a custom icon set is possible but ~60 icons are in use. Stroke weight is a cheap identity lever (1.5 vs 2).
   - The app icon is one SVG rendered to PNG by Electron (`scripts/render-icon.cjs`); macOS wants a 1024 px rounded-square with the system margin, Windows a square with a little padding, Linux either.
   - Every name lives in `branding.json`; renaming is a one-file change plus `package.json`'s `productName`. `dataDirName` can stay so existing libraries are found.
   - Screenshots for the smoke test are checked by pixel in a few places (canvas colours sampled through `canvasPixel`); canvas colour changes mean re-checking those samples.

## What a concept has to deliver

So that the parallel explorations are comparable, each concept should answer the same sheet:

1. **Name** (two or three candidates, with a one-line rationale and a quick check that the .app / domain / npm / Store spellings are not obviously taken) and the **wordmark**.
2. **App icon** at 1024 px, as SVG, in both the macOS and Windows framing, and how it degrades to 16 px.
3. **Palette**: the semantic variables for both themes, *including* `--plan-*` and `--scene-*`, shown on a mock of the plan and the 3D view.
4. **Type**: a sans and a mono (bundled, OFL), sizes for the 13 px body, the 11 px labels and the headings.
5. **Mocks** of the Home screen and the project window (plan view), light and dark, at 1890 × 1020 (the reference size), and the empty-project moment.
6. **The AI's presence**: how the assistant is named and marked.
7. **A one-paragraph story**: what the mood says to a homeowner opening it for the first time.

## Candidate directions (from the owner's earlier session)

Four moods were short-listed and one rejected before this study:

- **Craft**: paper, pencil, warm neutrals, a hand-set feel; the plan as a drawing on a desk. (Not "drafting table": the literal blueprint / vellum / T-square look was rejected as a cliché.)
- **Minimal**: near-monochrome, one accent, generous white, geometric type; the plan does the talking.
- **Playful**: colour and roundness, friendly type, the home as something you make rather than a document; closest to consumer apps for homeowners.
- **AI-native**: the assistant as the centre of the identity, a mark and a colour for it, the plan as what you and the AI build together.

Each can be pushed by one agent into the sheet above, then compared side by side.
