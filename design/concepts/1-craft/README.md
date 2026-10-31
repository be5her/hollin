# Concept 1 · Craft — "Hollin"

Paper, ink, graphite, one terracotta mark. The plan as a drawing on a desk; a tool that feels hand-set and considered, like a good notebook. For homeowners and hobbyists: approachable precision, not CAD. Not the drafting-table cliché: no blueprint blue, no vellum texture, no T-square.

Files: `README.md` (this sheet), `icon.svg` (1024 × 1024 app icon), `concept.html` (wordmark, type, palettes, canvas and 3D swatches, five 1890 × 1020 mocks, first launch and About).

## a. The story

You open it and it looks like a clean sheet on a wooden desk, not a dashboard. The walls you draw are graphite with an ink edge, the rooms take a pale sage wash the moment they close, and the numbers sit in a typewriter face so the 4 000 mm you measured looks exactly like the 4 000 mm you typed. Nothing glows; the one colour, a warm terracotta, is reserved for the thing you are touching right now and the one button you most likely want. Dark mode is the same desk after the lamp goes on: warm shadows, paper-coloured walls, never blue-grey. The assistant is there, but as a pencil at the edge of the page rather than a sparkling character: ask it to draw the room, it draws it in your drawing, and you can rub it out. The feeling is that you are making something with your hands, with a tool that will not let the numbers be wrong.

## b. Names

All three are invented, two syllables, easy to say in any language, with a lowercase-friendly shape for the wordmark. None describes the product.

| Name | Rationale | Quick collision check (web search, 31 Oct 2026) |
|---|---|---|
| **Hollin** (recommended) | An old English word for holly, so it has a rural, homely root, and it sounds like *hollow* and *holding*: a place you live in. Reads as a hamlet or a notebook brand. | No app, software product or home-design tool of that name turned up; the search returned the usual listicles (Homestyler, Planner 5D, SketchUp, RoomSketcher). "Hollin" exists as a place name and a surname (Hollins, Hollin Hall), which is fine. Domains: `hollin.app` / `hollin.design` look plausible; `hollin.com` is likely taken as a surname. App id `app.hollin.desktop`, package `.hollin`, MCP server `hollin`. |
| **Penrow** | Pencil + row: a row of pencil lines, a wall drawn by hand. Reads as a surname, so it feels like a maker's name on a tool. | Nothing by that name; the search found Penbook, Penedex, PENUP, ParkPenrith — all unrelated. Likely free across .app and the stores. |
| **Lindel** | Linden (the wood pencils and drawing boards are made from) + lintel (the beam over a door). The softest-sounding of the three. | No app or company; near-misses were Lodeli, Lindenberg Software, Lindy. Spelling could drift to "Lindell" (a surname), the one weak point. |

## c. Wordmark

"Hollin" set in **Fraunces** Semibold (600), optical size 144, SOFT 80, tracking −0.015 em, with the full stop in terracotta: **Hollin.** The dot is the icon's door swing reduced to a point and the one place the accent appears in the chrome. Title bar: the 22 px icon, then the wordmark at 16 px in ink (`--fg`). About and first launch: the wordmark large, on paper. The wordmark is outlined to paths wherever it ships (icon, About, installer), so no font is needed to draw it.

## d. Type

All three families are OFL and bundled (`font-src 'self'`): variable files where they exist, so the installer grows by under 1 MB.

| Role | Face | Size / line (px) | Notes |
|---|---|---|---|
| Body, controls, panel text | Alegreya Sans 400 | 13 / 18 | Medium 500 for selected rows and card names; letter-spacing 0 |
| Labels, meta, captions | Alegreya Sans 400 | 11 / 14 | Section caps (LEVELS, LAYERS, FINISHES) at 11 px, Medium, tracking .08 em, uppercase |
| Times and states ("Saved just now", "Edited yesterday") | Alegreya Sans Italic | 12–14 | The notebook's handwriting |
| Panel heading (Room, Dimension, Level) | Fraunces 600 | 18 / 24 | opsz 20, SOFT 50 |
| Project name, dialog titles | Fraunces 600 | 20 / 26 | opsz 24, SOFT 60 |
| Home heading, empty moments | Fraunces 600 | 28–30 / 34 | opsz 36, SOFT 60–80 |
| Numbers, units, ids, coordinates, shortcuts, badges | IBM Plex Mono 400 / 500 | 13 (11 in badges and kbd) | Tabular by nature, slashed zero; values in `--fg`, units in `--muted`, thin space as thousands separator |
| Icons | Lucide | 18 px, 1.6 px stroke | Lighter than the 2 px default: a pencil line, not a marker |

Why these: **Alegreya Sans** (Huerta Tipográfica) is a humanist sans with calligraphic roots; it has character at 13 px without looking like a website, and its italic is genuinely nice for meta text. **IBM Plex Mono** has typewriter DNA (the Selectric) which suits "numbers written on paper", and it stays legible at 11 px where Courier-likes fall apart. **Fraunces** (Undercase Type) is the soft serif that carries the craft mood; it is used only where a heading is allowed to speak, never in the dense panels. If a third family is one too many, Fraunces can be dropped to the wordmark (outlined) and the headings set in Alegreya Sans 700.

## e. Palette

Every variable in `styles.css` `:root` and `.dark`. Light is paper on a desk; dark is the same desk under a lamp: warm near-black (`#1d1a17`), never cool.

### Light

| Variable | Hex | Role |
|---|---|---|
| `--canvas` | `#f6f1e8` | Window and page background: warm paper |
| `--surface` | `#efe8dc` | Panels, title bar, cards |
| `--elevated` | `#e6ddcd` | Hover, chips, badges, swatches |
| `--fg` | `#2a2521` | Text and icons: ink |
| `--muted` | `#7b7064` | Secondary text, units, captions: graphite |
| `--edge` | `#dcd2c2` | 1 px borders and rules |
| `--accent` | `#b9552f` | Terracotta: primary buttons, active tabs, focus, links |
| `--accent-hover` | `#9c4525` | Pressed terracotta |
| `--accent-fg` | `#fbf6ee` | Text on terracotta |
| `--danger` | `#b5392c` | Trash, errors |
| `--success` | `#4f7d3d` | Saved, MCP connected, tool-call check: moss |
| `--warning` | `#b8841f` | Warnings, below-ground elevations: ochre |
| `--titlebar` | `#efe8dc` | Native window chrome (= surface) |
| `--titlebar-fg` | `#2a2521` | Native window buttons (= fg) |
| `--plan-grid` | `#ebe4d7` | Minor grid, a shade under the paper |
| `--plan-grid-major` | `#dbd1bf` | Major grid |
| `--plan-wall` | `#3b3531` | Wall fill: warm graphite |
| `--plan-wall-line` | `#231f1c` | Wall edges, door leaves, glazing: ink |
| `--plan-room` | `#8b9a6b` | Room wash, drawn at 18 % alpha: sage |
| `--plan-slab` | `#e9e1d2` | Slab under the footprint |
| `--plan-dim` | `#3f5390` | Dimension lines, ticks and figures: indigo ink |
| `--plan-underlay` | `#a89c8c` | DXF / reference underlay |
| `--plan-snap` | `#2f8a57` | Snap marks and tracking rays: moss |
| `--plan-selection` | `#b9552f` | Selection outlines, grips, seeds: terracotta |
| `--plan-warning` | `#b8841f` | Rule warnings on connectors: ochre |
| `--plan-connector` | `#4b433d` | Stairs, ramps, ladders, lifts |
| `--plan-decor` | `#8c6b4a` | Furniture and fixture outlines: umber |
| `--scene-edge` | `#3a332e` | Edge lines on every solid |
| `--scene-wall` | `#efe6d6` | Walls: limewashed plaster |
| `--scene-slab` | `#cdbea7` | Slabs: sand |
| `--scene-column` | `#ddd1bd` | Columns |
| `--scene-glass` | `#9bb9c7` | Glazing: the one cool note |
| `--scene-connector` | `#d5c2a3` | Stairs, ramps: timber |
| `--scene-rail` | `#5a4f45` | Handrails |
| `--scene-car` | `#b9552f` | Elevator cars: terracotta |
| `--scene-stand-in` | `#a69b8e` | Stand-in blocks for missing models |


### Dark

| Variable | Hex | Note |
|---|---|---|
| `--canvas` | `#1d1a17` | The desk after the lamp goes on: warm, not blue |
| `--surface` | `#262220` |  |
| `--elevated` | `#332d29` |  |
| `--fg` | `#ebe3d6` | Paper-coloured text |
| `--muted` | `#a2968a` |  |
| `--edge` | `#3c3531` |  |
| `--accent` | `#e07c50` | Terracotta lifted two steps to read on the dark desk |
| `--accent-hover` | `#ea9471` |  |
| `--accent-fg` | `#1d1a17` | Dark ink on the lighter terracotta |
| `--danger` | `#e8705f` |  |
| `--success` | `#8fbf6e` |  |
| `--warning` | `#e2b24a` |  |
| `--titlebar` | `#262220` | = surface |
| `--titlebar-fg` | `#ebe3d6` | = fg |
| `--plan-grid` | `#272320` | A shade over the desk |
| `--plan-grid-major` | `#352f2b` |  |
| `--plan-wall` | `#d8cfc2` | Paper-coloured walls on the dark desk |
| `--plan-wall-line` | `#f3ece1` |  |
| `--plan-room` | `#a4b385` | Sage, lightened; the 18 % wash reads olive-grey |
| `--plan-slab` | `#2a2623` |  |
| `--plan-dim` | `#91a4e0` | Indigo lifted to read on dark |
| `--plan-underlay` | `#7a7066` |  |
| `--plan-snap` | `#6fcf8a` |  |
| `--plan-selection` | `#e07c50` | = accent |
| `--plan-warning` | `#e2b24a` | = warning |
| `--plan-connector` | `#e3dacc` |  |
| `--plan-decor` | `#d4a97a` |  |
| `--scene-edge` | `#141210` | Near-black edges |
| `--scene-wall` | `#c4b9a8` |  |
| `--scene-slab` | `#6f6358` |  |
| `--scene-column` | `#a89c8c` |  |
| `--scene-glass` | `#6e93ab` |  |
| `--scene-connector` | `#a8947a` |  |
| `--scene-rail` | `#d8cfc2` | = plan-wall |
| `--scene-car` | `#e07c50` | = accent |
| `--scene-stand-in` | `#5f574f` |  |


**Keeping the canvas colours apart.** The five full-strength roles sit on different hue families: selection and the UI accent are terracotta (red-orange, 17°), warning is ochre (yellow, 42°), snap is moss (green, 140°), dimensions are indigo ink (blue, 228°), and the decor outlines are a desaturated umber that no saturated role shares. The room wash (`--plan-room`, sage, 85°) is only ever drawn at ~18 % alpha, so it is a pale tint under everything rather than a line colour, and it cannot be confused with the moss snap marks or the ochre warning outlines that are drawn at full strength on top of it. Walls are neutral (graphite in light, paper in dark) so every coloured mark reads against them. In dark mode the four line colours are lifted (terracotta `#e07c50`, ochre `#e2b24a`, moss `#6fcf8a`, indigo `#91a4e0`) to keep contrast on the dark desk while staying in the same families.

Exports and the 3D palettes in core (`SOLID_COLORS`, `LIGHT_SCENE_THEME`) take the `--scene-*` values above; `snapshot-theme.test.ts` pins them. `--titlebar` and `--titlebar-fg` stay `#rrggbb` and equal `--surface` / `--fg`.

## f. The assistant's presence

Deliberately quiet, but marked. No persona name: the tab stays **Assistant** and the header shows the model in mono (`Claude Opus 5.5`). Its mark is a **pencil at rest** (Lucide `pen-line`), drawn at the same 1.6 px as every other icon, in terracotta when it is working and graphite when idle; it replaces the sparkle. Its messages are plain paragraphs with a 2 px terracotta rule on the left, like a margin note; the user's messages sit on the elevated paper tint, right-aligned; tool calls are small paper cards with a moss check (done) or an ochre shield (asked, declined). On the empty project the hint ends with the same pencil: "Or describe the room and let the assistant draw it." The pitch is a helping hand that draws in your drawing, not a character that talks.

## g. The app icon

`icon.svg`: a sheet of warm paper (rounded square, a hairline edge so it stays separate from a white Explorer window), two ink walls meeting in a corner, and one terracotta door swing: the smallest possible plan. It is the same corner-and-door that every plan has, in the three colours of the identity, and the terracotta quarter-disc is the wordmark's full stop in another form.

- **macOS**: the artwork is the rounded square at 64–960 with the system margin, like the placeholder; the paper reads as the icon.
- **Windows / Linux**: the same file; the square paper with a little padding (`concept.html` shows a 3 % padded square variant as well, if a separate Windows source is wanted).
- **16 px**: the L of the two walls and the terracotta quarter-disc survive as two shapes on a light square; the leaf line and the hairline vanish harmlessly. The paper square is the only warm, light icon in a dark dock, which is its identification at a glance.

## h. Home cards and the three empty moments

**Home cards.** Paper cards with a 1 px ink-tinted edge, no shadow to speak of. A project with a thumbnail shows its ground floor drawn in the plan colours on paper, as today. A project without one gets a **tinted sheet** from a set of four (straw, sage, clay, slate: each is the paper mixed with 10–18 % of a palette colour) with a faint **pencil doodle** of a house footprint and the project's two initials in Fraunces Italic at the bottom-left, small, instead of a random gradient with big centred capitals. The tint is picked from the project id so it is stable. Names in Alegreya Sans Medium 17 px; the "Edited …" line in italic; the level count in mono; tags as small paper labels. The selected card has a 2 px terracotta outline.

**First launch (empty library).** A pencil sketch of one room (walls, a door swing, a window, a 4 000 mm dimension, a terracotta pencil), the heading *Start with a room you know.* in Fraunces, two lines of copy ("Draw the walls of the room you are sitting in, with the numbers off a tape measure. Everything else grows from there."), New project and Import…, and a quiet promise underneath: "Your projects live in a folder on this computer. Nothing leaves it unless you export."

**New empty project.** The canvas shows its grid; centred on it, the same sketch, *Draw the first wall.*, one sentence of how (press W, click a corner, type a length), a row of four keys (W Wall, D Door, N Window, Ctrl K every command) and the pencil line "Or describe the room and let the assistant draw it". It fades the moment the first wall is placed. The Properties panel says *Nothing selected* in Fraunces with one line of help, instead of being blank.

**About.** The icon at 112 px, the wordmark large with its terracotta full stop, a two-sentence description, and one mono line: version, the three fonts and Lucide with their licences, and a Licences… link. Paper, no gradient, no illustration.

## What this concept does not do

It adds no chrome: the layout is the app's as built. The whole identity is carried by the paper and ink palette, three typefaces, a 1.6 px icon stroke, the terracotta full stop, and the three moments where a heading may speak.
