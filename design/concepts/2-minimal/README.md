# Concept 2 · Minimal — "Noli"

Paper, ink and one vermilion mark. Files in this folder: `README.md` (this sheet), `icon.svg` (the app icon, 1024 viewBox), `concept.html` (wordmark, icon sizes, type specimen, both palettes, five mocks at 1890 × 1020, the 3D view in both themes and the assistant panel; open it in a browser, the fonts load from Google Fonts for the preview only).

## a. The story

You open it and there is almost nothing there: a white page, a thin grid, a short sentence telling you which key draws a wall. Everything is black ink on white paper, the way the plan of your own flat would look if someone careful had drawn it. There are no coloured panels and no rounded buttons competing with the drawing, only hairlines dividing the window into its parts. Then you click a room and it turns a pale vermilion with a red outline; move near a corner and a small green square tells you it will snap; make a stair too steep and an amber dashed box says so. Colour is the app talking to you, and it only talks when something is alive. Numbers sit in a monospaced face that looks like a printed survey, large where they matter (the area of the room you just clicked) and small everywhere else. At night the paper turns true black and the ink turns white; the mark warms a little. It feels less like software and more like a very good sheet of paper that happens to know the rules.

The one decision that makes it unmistakable: **a strict black-and-white drawing with colour reserved for live state, and a single vermilion square as the only mark.** The square is the dot of the i in the wordmark, the active-level marker, the assistant's avatar and the only thing in the icon that is not ink.

## b. Names

All three are invented or borrowed from architecture rather than descriptive of "plans" or "studios". Search done on 31 Oct 2026 (web only; trademark registers not checked).

| Name | Rationale | Collisions found |
|---|---|---|
| **Noli** (preferred) | After Giambattista Nolli's 1748 map of Rome, the archetype of the black-and-white figure-ground plan: solid ink for the built, white for the open. Four letters, two syllables, no meaning to a homeowner except the sound, which is soft and short. The dot of the i becomes the mark. | An unlaunched children's storybook app announces itself as "Noli" on a `pages.dev` landing page, with support at `trynoli.com`; no shipped product, no plan or design software of that name. `noli.app` / `noli.com` not confirmed either way (Noli is also an Italian town). Low collision risk in this category; `noli.design` or `getnoli.com` would be the safe domains. |
| **Mullion** | The vertical bar that divides a window; a word every window has and nobody owns. Reads as calm and architectural; two syllables, easy to say. Longer than ideal for a 16 px title. | No app, company or product called Mullion found (only unrelated "Mullings Group", "Mobilion"). Clean. |
| **Lintel** | The beam over a door: the first thing a renovator learns the name of. Warm, solid, one of the shortest architectural words. | Taken in adjacent space: `lintel.app` is LintelHub (an inspection-report iPad app, 2026), LintelAI is property-management software, Lintel Labs is a UK software company. Not recommended. |

`branding.json`: `productName: "Noli"`, `shortName: "noli"`, `appId: "studio.noli.app"` (placeholder TLD until the domain is settled), `packageExtension` can stay `.psp` or become `.noli`; `dataDirName` stays so existing libraries are found.

## c. Wordmark

`noli`, lowercase, Geist 500, letter-spacing −0.045 em. The dot of the i is removed and replaced with a square in the accent colour, set 0.145 em wide (about the stem width) and sitting where the dot would be. No other colour, no symbol beside it. Below 24 px the square is too small to carry the mark, so the title bar uses the **small lockup**: a 10 px vermilion square, 10 px gap, `noli` at 17 px with its ordinary dotted i. Dark mode keeps the same geometry with the ink white and the square `#ff6a45`.

In the About page and the first-launch screen the wordmark is set very large (144 px) on an otherwise empty page; that exaggerated scale, against 11 px labels everywhere else, is the identity's one typographic flourish.

## d. Type

Two cuts of one family, both SIL OFL 1.1, both variable (one file each, about 90 KB), bundled under `font-src 'self'`:

- **Geist** (sans, Vercel / The Geist Project Authors) for everything that is read.
- **Geist Mono** for everything that is measured: lengths, elevations, areas, coordinates, scales, dates, ids, the status bar. Tabular figures (`font-feature-settings: "tnum"`) wherever two numbers sit in a column.

Only two weights are used, 400 and 500. Nothing is bold.

| Role | Face | Size / line | Weight | Tracking | Where |
|---|---|---|---|---|---|
| Display | Geist | 34 / 40 | 500 | −0.03 em | Home heading, empty states |
| Title | Geist | 20 / 24 | 500 | −0.02 em | Project name, panel headings ("Room"), dialogs |
| Body | Geist | 13 / 18 | 400 | 0 | Everything |
| Button | Geist | 13 / 18 | 500 | 0 | Buttons, active tabs |
| Label | Geist | 11 / 14 | 500 | +0.08 em, caps | Section labels (LEVELS, LAYERS, FINISHES), field labels at 11/14 400 muted without caps |
| Number, large | Geist Mono | 28 / 32 | 500 | −0.02 em | The hero number in Properties (area, a dimension's reading) |
| Value | Geist Mono | 13 / 18 | 400 | 0 | Inputs holding a length or angle |
| Value, small | Geist Mono | 12 / 16 | 400 | 0 | Level elevations, canvas labels, coordinates |
| Status | Geist Mono | 11 / 14 | 400 | 0 | Status bars, chips' counts, command ids, card metadata |

Units are typeset as part of the mono string with a thin space (`3 000 mm`), in the muted colour inside inputs.

## e. Palette

Six greys and the mark. Surfaces are not tinted: `--canvas`, `--surface` and `--elevated` differ by a few percent only and panels are separated by `--edge` hairlines, not by fill. Radii are 0 everywhere. The accent is **vermilion** `#e8401c`, the red of a marking pencil on a drawing; in dark mode it warms to `#ff6a45` so it does not vibrate on black. Light is paper white; dark is true black `#000000`, redrawn, not inverted.

### Light

| Variable | Hex | Note |
|---|---|---|
| `--canvas` | `#ffffff` | the window and the plan's paper |
| `--surface` | `#fafafa` | inputs' rest state, hover |
| `--elevated` | `#f0f0f0` | pressed, selected rows, keycaps |
| `--fg` | `#121212` | ink |
| `--muted` | `#707070` | secondary text, inactive tabs, icons at rest |
| `--edge` | `#e4e4e4` | every hairline |
| `--accent` | `#e8401c` | vermilion: primary button, focus, active level marker, the i's dot |
| `--accent-hover` | `#c93312` | |
| `--accent-fg` | `#ffffff` | |
| `--danger` | `#b0101a` | a deep cool red, used for error toasts and the confirm step only; the Trash button is muted ink |
| `--success` | `#1a9e5c` | saved state, MCP dot, snap |
| `--warning` | `#c48a00` | amber |
| `--titlebar` | `#ffffff` | |
| `--titlebar-fg` | `#121212` | |
| `--plan-grid` | `#f0f0f0` | |
| `--plan-grid-major` | `#dcdcdc` | |
| `--plan-wall` | `#121212` | solid ink walls, the Nolli look |
| `--plan-wall-line` | `#121212` | |
| `--plan-room` | `#8a8a8a` | drawn at low alpha: a grey wash |
| `--plan-slab` | `#f4f4f4` | |
| `--plan-dim` | `#121212` | dimensions are part of the drawing, ink |
| `--plan-underlay` | `#b8b8b8` | |
| `--plan-snap` | `#1a9e5c` | |
| `--plan-selection` | `#e8401c` | |
| `--plan-warning` | `#c48a00` | |
| `--plan-connector` | `#121212` | |
| `--plan-decor` | `#808080` | furniture lighter than structure: hierarchy by weight, not colour |
| `--scene-edge` | `#121212` | |
| `--scene-wall` | `#f4f4f4` | |
| `--scene-slab` | `#d6d6d6` | |
| `--scene-column` | `#e8e8e8` | |
| `--scene-glass` | `#cbd3d9` | the only cool grey, so glass reads as glass |
| `--scene-connector` | `#e0e0e0` | |
| `--scene-rail` | `#4a4a4a` | |
| `--scene-car` | `#e8401c` | the one coloured solid: the thing that moves |
| `--scene-stand-in` | `#b4b4b4` | |

### Dark

| Variable | Hex | Note |
|---|---|---|
| `--canvas` | `#000000` | true black |
| `--surface` | `#0c0c0c` | |
| `--elevated` | `#1a1a1a` | |
| `--fg` | `#f2f2f2` | paper-white ink |
| `--muted` | `#8a8a8a` | |
| `--edge` | `#242424` | |
| `--accent` | `#ff6a45` | the mark, warmed |
| `--accent-hover` | `#ff8a6b` | |
| `--accent-fg` | `#000000` | |
| `--danger` | `#f0506e` | pink-red, well apart from the orange-red accent |
| `--success` | `#3ddc84` | |
| `--warning` | `#f2c14e` | |
| `--titlebar` | `#0c0c0c` | |
| `--titlebar-fg` | `#f2f2f2` | |
| `--plan-grid` | `#121212` | |
| `--plan-grid-major` | `#222222` | |
| `--plan-wall` | `#f2f2f2` | |
| `--plan-wall-line` | `#ffffff` | |
| `--plan-room` | `#9a9a9a` | |
| `--plan-slab` | `#0e0e0e` | |
| `--plan-dim` | `#f2f2f2` | |
| `--plan-underlay` | `#585858` | |
| `--plan-snap` | `#3ddc84` | |
| `--plan-selection` | `#ff6a45` | |
| `--plan-warning` | `#f2c14e` | |
| `--plan-connector` | `#f2f2f2` | |
| `--plan-decor` | `#8c8c8c` | |
| `--scene-edge` | `#050505` | |
| `--scene-wall` | `#9c9c9c` | |
| `--scene-slab` | `#4c4c4c` | |
| `--scene-column` | `#7c7c7c` | |
| `--scene-glass` | `#6b7b88` | |
| `--scene-connector` | `#6e6e6e` | |
| `--scene-rail` | `#e0e0e0` | |
| `--scene-car` | `#ff6a45` | |
| `--scene-stand-in` | `#505050` | |

**On the canvas** the drawing itself is one colour (ink: walls, dimensions, connectors, door swings) over a grey room wash, so the four live colours never compete with it: selection is the warm vermilion, snap a cool green, warnings a yellow amber, the underlay a pale neutral grey lighter than anything drawn. Vermilion against amber is the closest pair; they are kept apart by value (amber is lighter and yellower in both themes) and by shape (a warning is always a dashed box with a mono label, a selection a solid outline with a wash and grips). The accent is also the selection colour on purpose: the thing you selected and the button that acts on it share the one colour, which is the whole system. Danger is a different, darker red used only in toasts and confirmations; it never appears on the canvas.

Contrast: `--fg` on `--canvas` is 18:1 (light) and 17:1 (dark); `--muted` 5.3:1 and 6.4:1; the accent on white is 4.0:1, used for fills and 13 px 500 text only, never for 11 px text. Core's `SOLID_COLORS` and `LIGHT_SCENE_THEME` take the `--scene-*` values above; `snapshot-theme.test.ts` will need the new hexes.

## f. The assistant

Deliberately quiet. It has no name of its own and no sparkle: the tab says **Assistant**, the model name sits beside it in small mono, and its avatar is the mark, the same vermilion square as the i's dot. While it works the square is hollow (an outlined square), and fills when it answers; that is the only animation in the app. Turns are divided by hairlines, not bubbles; the margin says `you` in mono or shows the square. A tool call is a dashed hairline with a check and the command id in mono; a gated call shows a shield, says "asks first", and offers two plain buttons, `Allow` with an ink border and `Not now`. In History its edits are listed under the square where the user's are under `you`. Nothing about it is a persona: it is the same ink and the same mark as the rest of the app, which is the point: the AI is part of the instrument, not a character in it.

## g. The icon

`icon.svg`: a white tile (rounded square, radius 200 of 1024, with a 6 px ink hairline so it is visible on a white desktop) carrying a single room drawn in ink: four walls at 64 px, the bottom one opened for a door, the leaf standing open at 28 px and its quarter-circle swing at 12 px. In the room, the vermilion square, 120 px. It is the wordmark's dot moved into the drawing: the only colour, and the "you are here".

For macOS the file is used as is (the rounded square with the system margin). For Windows and Linux the same drawing on a square tile (`#appicon-sq` in `concept.html`, inset 96 px) is the variant to render; the only difference is the corner. At **128 px** every element reads, swing included. At **32 px** the swing becomes a faint curve and the icon is a frame, an opening and a red square. At **16 px** it is a white tile with a black frame and a red dot, which is enough: in a row of blue and purple app icons it is the one that looks like paper.

## h. Home cards and the three empty moments

**Home cards.** No gradients, no initials. The cards are cells of one hairline grid (1 px `--edge`, no gaps, no shadows, no radius). The thumbnail area is paper with the ground floor drawn in ink at a fixed scale, centred; the room areas appear in small mono. A project without a drawing shows a small empty frame with a dot, and "no drawing yet" in its metadata line, so a blank project looks blank rather than loud. Name at 14 px 500, metadata in 11 px mono muted, tags as hairline chips. The selected card gets a 1.5 px vermilion outline; hover is a `--surface` fill. The heading is the only display-size text on the page; New project is the one vermilion button.

**First launch (empty library).** The page is white and empty except for the wordmark at 144 px in the optical centre, one sentence under it in 13 px muted ("Draw your first room, or import a plan.") and two text buttons, `New project` in vermilion and `Import…` with a hairline. No illustration.

**New empty project.** The project window exactly as it will be, with a grid and nothing else; in the centre of the canvas "Nothing drawn yet." at 20 px 500 and one line with two keycaps: "Press W to draw a wall, R for a room, or ask the assistant." The Properties panel says "Nothing selected" and what it will show. Nothing else is added for the occasion: the empty state is the tool, not a splash.

**About.** A plain white page: the wordmark at 144 px, the version in mono under it (`1.4.0 · 2026-10-31`), then the licence list as hairline-separated rows (name, licence, mono). The icon is not repeated; the wordmark's square is the only colour on the page.

## Also changed by this concept

- Radius 0 on every control, card, chip, input and dialog; 1 px hairlines replace filled panel backgrounds; the title bar, panels and canvas share one white.
- Lucide icons stay, at 1.5 px stroke (not 1.75 or 2), in `--muted` at rest and `--fg` when active; an active tool shows a 4 px vermilion square under it instead of a filled background.
- The active level is marked by the 10 px square, not a tinted row; negative elevations stay amber.
- Tabs are underlined by a 2 px ink rule; nothing is a filled pill.
- Toasts, dialogs and the command palette: white, hairline edge, no shadow, square corners; the palette lists command ids in mono.
- Exports: the PDF and SVG title block takes the small lockup (square + `noli`) in ink, and the sheet keeps the plan's black-and-white.
