# 01 · Brand: name, wordmark, icon, palette, type, Otto's mark, the hero moments

Built on `00-decisions.md` (which wins where anything here seems to differ). Companion files: `brand.html` (the sheet in the browser: wordmark, both icons at every size and framing, Otto's mark, the type specimen, both palettes as swatches, and seven mocks at 1890 × 1020), `icon-a.svg`, `icon-b.svg`, `otto-mark.svg`, `wordmark.svg`. Every hex below is the one `brand.html` uses; its swatches read the page's own stylesheet, so the two cannot drift.

## a. The story

A clean sheet on a desk, drawn by two authors. The paper, the ink walls, the graphite, the one terracotta mark, the serif that speaks only in headings, the typewriter numbers: all of Craft. On that sheet works **Otto**, the assistant: a named collaborator with its own ink colour, mulberry, who draws in your drawing, signs its work in History, asks before it deletes, and never asks you to click its colour. The feeling, for someone planning their own home: making something with your hands, with a careful colleague who knows millimetres.

## b. Name and wordmark

**Working name: Hollin.** Wordmark `Hollin.` with the terracotta full stop. Alternates kept on the table: **Penrow** and **Bothy**. The owner checks domains, stores and trademarks before any name goes into `branding.json`; until then every document says "working name". The assistant is **Otto**, an in-app name, not a product mark; the model and provider stay visible under it.

**Wordmark spec.** Fraunces Semibold (600), optical size 144, SOFT 80, tracking −0.015 em, in `--fg`; the full stop in `--accent`. The dot is the icon's door swing reduced to a point and the one place the accent appears in the chrome.

| Where | Size | Fraunces axes | Notes |
|---|---|---|---|
| Title bar | 16 px, after the 22 px app icon, 9 px gap | opsz 18, SOFT 80, tracking −0.01 em | `--titlebar-fg`; the dot `--accent` |
| About (Settings, bottom) | 40 px | opsz 48, SOFT 80 | Next to the icon at 112 px |
| First launch (empty library) | 56 px | opsz 72, SOFT 80 | Above the sketch, centred |
| Installer, icon, exports | any | outlined paths | `wordmark.svg`; no font needed |

`wordmark.svg` (viewBox 0 0 691 170): "Hollin." as outlined paths, a hand-drawn soft serif after Fraunces (bracketed serifs, a flag serif on the l, i and n, a round tittle), baseline 150, cap height 130, x-height 94, stem 30, ink `#2a2521` with the dot `#b9552f`; on the dark desk recolour to `#ebe3d6` and `#e07c50`. A 2.4-unit same-colour stroke with round joins gives the SOFT rounding; keep it when scaling. `brand.html` shows it beside live Fraunces for comparison; see Problems found for the difference.

## c. The complete final palette

Craft's two tables with the five Otto variables added (`00-decisions.md` §4, verbatim). All `#rrggbb`; `--titlebar` = `--surface`, `--titlebar-fg` = `--fg`; `--plan-ai` is read by the canvas, which applies alpha in code. Hue families: terracotta 17°, ochre 42°, sage 85°, moss 140°, indigo 228°, mulberry 325° (the only magenta-family colour in the app).

### Light · paper

| Variable | Hex | Role |
|---|---|---|
| `--canvas` | `#f6f1e8` | Window and page background: warm paper |
| `--surface` | `#efe8dc` | Panels, title bar, cards |
| `--elevated` | `#e6ddcd` | Hover, chips, badges, swatches, your chat messages |
| `--fg` | `#2a2521` | Text and icons: ink |
| `--muted` | `#7b7064` | Secondary text, units, captions: graphite |
| `--edge` | `#dcd2c2` | 1 px borders and rules |
| `--accent` | `#b9552f` | Terracotta: primary buttons (Allow, Send, New project), active tabs, focus, links |
| `--accent-hover` | `#9c4525` | Pressed terracotta |
| `--accent-fg` | `#fbf6ee` | Text on terracotta |
| `--danger` | `#b5392c` | Trash, errors, a failed tool call |
| `--success` | `#4f7d3d` | Saved, MCP connected, the tool-call check: moss |
| `--warning` | `#b8841f` | Warnings, below-ground elevations, the waiting shield: ochre |
| `--titlebar` | `#efe8dc` | Native window chrome (= surface) |
| `--titlebar-fg` | `#2a2521` | Native window buttons (= fg) |
| `--ai` | `#8a3f6f` | Otto's mark, rules, tags, text accents: mulberry ink |
| `--ai-hover` | `#733259` | The one Otto button (the Home composer's "Draft it") pressed |
| `--ai-fg` | `#fbf6ee` | Text on `--ai` |
| `--ai-tint` | `#f1e3ea` | Fill behind Otto's History rows, cards and the composer |
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
| `--plan-ai` | `#8a3f6f` | The halo (22 % alpha), end nodes, tag and pending dashed outline on the canvas |
| `--scene-edge` | `#3a332e` | Edge lines on every solid |
| `--scene-wall` | `#efe6d6` | Walls: limewashed plaster |
| `--scene-slab` | `#cdbea7` | Slabs: sand |
| `--scene-column` | `#ddd1bd` | Columns |
| `--scene-glass` | `#9bb9c7` | Glazing: the one cool note |
| `--scene-connector` | `#d5c2a3` | Stairs, ramps: timber |
| `--scene-rail` | `#5a4f45` | Handrails |
| `--scene-car` | `#b9552f` | Elevator cars: terracotta |
| `--scene-stand-in` | `#a69b8e` | Stand-in blocks for missing models |

### Dark · the desk lamp

| Variable | Hex | Role |
|---|---|---|
| `--canvas` | `#1d1a17` | The desk after the lamp goes on: warm, not blue |
| `--surface` | `#262220` | Panels, title bar, cards |
| `--elevated` | `#332d29` | Hover, chips, badges, your chat messages |
| `--fg` | `#ebe3d6` | Paper-coloured text |
| `--muted` | `#a2968a` | Secondary text |
| `--edge` | `#3c3531` | 1 px borders and rules |
| `--accent` | `#e07c50` | Terracotta lifted two steps to read on the dark desk |
| `--accent-hover` | `#ea9471` | Pressed terracotta |
| `--accent-fg` | `#1d1a17` | Dark ink on the lighter terracotta |
| `--danger` | `#e8705f` | Trash, errors |
| `--success` | `#8fbf6e` | Saved, MCP connected, the tool-call check |
| `--warning` | `#e2b24a` | Warnings, the waiting shield |
| `--titlebar` | `#262220` | = surface |
| `--titlebar-fg` | `#ebe3d6` | = fg |
| `--ai` | `#d892bd` | Otto's mark, rules, tags, text accents |
| `--ai-hover` | `#e3a9cb` | "Draft it" pressed |
| `--ai-fg` | `#1d1a17` | Text on `--ai` |
| `--ai-tint` | `#332631` | Fill behind Otto's History rows, cards and the composer |
| `--plan-grid` | `#272320` | A shade over the desk |
| `--plan-grid-major` | `#352f2b` | Major grid |
| `--plan-wall` | `#d8cfc2` | Paper-coloured walls on the dark desk |
| `--plan-wall-line` | `#f3ece1` | Wall edges, door leaves, glazing |
| `--plan-room` | `#a4b385` | Sage, lightened; the 18 % wash reads olive-grey |
| `--plan-slab` | `#2a2623` | Slab under the footprint |
| `--plan-dim` | `#91a4e0` | Indigo lifted to read on dark |
| `--plan-underlay` | `#7a7066` | DXF / reference underlay |
| `--plan-snap` | `#6fcf8a` | Snap marks and tracking rays |
| `--plan-selection` | `#e07c50` | = accent |
| `--plan-warning` | `#e2b24a` | = warning |
| `--plan-connector` | `#e3dacc` | Stairs, ramps, ladders, lifts |
| `--plan-decor` | `#d4a97a` | Furniture and fixture outlines |
| `--plan-ai` | `#d892bd` | The halo, end nodes, tag and pending dashed outline on the canvas |
| `--scene-edge` | `#141210` | Near-black edges |
| `--scene-wall` | `#c4b9a8` | Walls |
| `--scene-slab` | `#6f6358` | Slabs |
| `--scene-column` | `#a89c8c` | Columns |
| `--scene-glass` | `#6e93ab` | Glazing |
| `--scene-connector` | `#a8947a` | Stairs, ramps |
| `--scene-rail` | `#d8cfc2` | = plan-wall |
| `--scene-car` | `#e07c50` | = accent |
| `--scene-stand-in` | `#5f574f` | Stand-in blocks |

The light and dark `--ai*` values are the decisions' values verbatim. Measured contrast (WCAG): `--ai` on `--canvas` 6.2 (light) and 7.2 (dark); `--ai-fg` on `--ai` 6.5 and 7.2; `--fg` on `--ai-tint` 12.2 and 11.3; `--muted` on `--ai-tint` 3.9 and 5.0. See Problems found for the two weak pairs.

## d. Type

Three OFL families, bundled as variable files (`font-src 'self'`). Craft's role table, unchanged, then Otto's typographic treatment.

| Role | Face | Size / line (px) | Notes |
|---|---|---|---|
| Body, controls, panel text | Alegreya Sans 400 | 13 / 18 | Medium 500 for selected rows and card names; letter-spacing 0 |
| Labels, meta, captions | Alegreya Sans 400 | 11 / 14 | Section caps (LEVELS, LAYERS, FINISHES) at 11 px, Medium, tracking .08 em, uppercase |
| Times and states | Alegreya Sans Italic 400 | 12–14 | "Saved just now", "Edited yesterday": the notebook's handwriting |
| Panel heading (Room, Dimension, Level) | Fraunces 600 | 18 / 24 | opsz 20, SOFT 50 |
| Project name, dialog titles | Fraunces 600 | 20 / 26 | opsz 24, SOFT 60 |
| Home heading, empty moments | Fraunces 600 | 28–30 / 34 | opsz 36, SOFT 60–80 |
| Wordmark | Fraunces 600 | 16 · 40 · 56 | opsz 144, SOFT 80, tracking −.015 em; outlined wherever it ships |
| Numbers, units, ids, coordinates, shortcuts, badges | IBM Plex Mono 400 / 500 | 13 (11 in badges and kbd) | Values in `--fg`, units in `--muted`, thin space as thousands separator |
| Icons | Lucide | 18 px, 1.6 px stroke | 16 px in cards and rows |

**Otto's typographic treatment**

| Place | Face | Size / line | Colour and layout |
|---|---|---|---|
| Otto's name in the panel header | Fraunces 600, opsz 20, SOFT 50 | 18 / 24 | `--fg`, after the 28 px mark (12 px gap); under it "Claude Opus 5.5 · asks before deleting" in Alegreya Sans 12.5 `--muted`, the model name in Plex Mono 12 |
| Otto's paragraphs in the chat | Alegreya Sans 400 | 14 / 20 | `--fg`, a 2 px `--ai` rule on the left, 14 px padding: a margin note |
| Tool-call card title · command id | Alegreya Sans 500 · Plex Mono 400 | 13.5 · 11 | `--fg` · `--muted`, right-aligned; card on `--canvas` with a 3 px `--ai` left edge; second line "Ground floor · Structure · undoable, by Otto" in 12.5 `--muted` |
| The tag on the canvas | Alegreya Sans 500 | 12 / 14 | `--ai-fg` on a `--plan-ai` tile (22 px tall, radius 4) with the 14 px mark at its left: "Otto · 3 m wall · now", on an 18 px leader |
| The status-bar state | Alegreya Sans 400 | 12.5 / 14 | `--fg`, after an 8 px `--ai` dot with a 3 px ring at 22 %: "Otto · ready", "Otto · adding a 3 m wall…", "Otto · waiting for your yes"; between the units and MCP |
| Otto's signature in History | Alegreya Sans 400 + Plex Mono 400 | 11 | "Otto · Structure · `plan.apply`" in `--muted` under the entry title, the row on `--ai-tint`, the 16 px mark where your rows have a graphite dot |
| The composer's title on Home | Alegreya Sans 500 | 17 | "Start with Otto" after the 26 px mark; the card name style, so the card sits with the others |
| The credit line in About | Fraunces 600, opsz 24, SOFT 60 | 20 / 26 | "Hollin" in `--fg`, "with Otto" in `--ai` |

## e. The app icon: two candidates

Both on a paper tile (`#f6f1e8`) with a hairline edge (`#d9cebc`, 12 units at 1024: it vanishes below 64 px, which is the point: it only has to keep the paper apart from a white Explorer window), radius 22 % of the side, in paper, ink `#2a2521` and terracotta `#b9552f`. The icon does not follow the theme. macOS framing: the tile at 64..960 inside the system margin. Windows and Linux: the same artwork, scaled 1.07, on a square tile at 32..992 with radius 72 (3 % padding); `brand.html` shows both, and `npm run icon` can render either from one source.

**A · One room** (`icon-a.svg`). Four ink walls 100 units thick, outer 200..824, the opening in the left wall (y 400..660), the leaf as a 28-unit ink line and the swing a filled terracotta quarter-disc of radius 260. At 128 px it is a plan; at 32 a room with a door; at 16 px (walls 1.6 px, the swing 4 px) it is a dark box with a notch and one warm mark on a light square, which is still a room and still nothing else in a taskbar.

**B · Two rooms** (`icon-b.svg`). Your room finished in ink on the left (walls 88, x 176..560, the same door and swing at radius 200), Otto's room on the right sharing the ink wall: bottom and right walls and a partial top wall in mulberry `#8a3f6f`, with the pen dot (radius 66) on the last corner. At 128 and 64 the story reads; at 32 the dot survives; at 16 px it is two boxes, one ink and one mulberry, and the terracotta swing is a 2.5 px smudge inside the ink box.

**Recommendation: A.** The two-author story belongs to the product, but the dock is not where it is told: at 16 and 32 px B has three colours fighting for twelve pixels, the terracotta all but disappears, and a magenta square next to an ink square reads as a generic "two tiles" glyph. A is the wordmark's full stop drawn as a door: one room, one warm mark, the same corner-and-door that every plan has, identifiable from across the room as the only paper-coloured icon in a dark dock. Otto's presence has its own mark (§f), which is where the mulberry room lives; the app icon stays yours. If the owner prefers B, nothing else changes.

## f. Otto's mark

`otto-mark.svg`, viewBox 64: a `--ai` tile with radius 14 (22 %), Otto's room as a 28-unit square outlined in `--ai-fg` at stroke 5 with corner radius 2.5, placed at (17, 20), and the pen, a dot of radius 7, on the room's top-right corner (45, 20). The room sits a little low and left so the dot has somewhere to be. Draw it as an inline `<svg>` with the two variables, never as a bitmap, so it follows the theme (light `#8a3f6f` / `#fbf6ee`, dark `#d892bd` / `#1d1a17`).

| Size | Where | Tile radius | Room | Stroke | Dot radius |
|---|---|---|---|---|---|
| 28 px | Assistant panel header, the composer card (26) | 6 px | 12.25 px at (7.4, 8.75) | 2.2 px | 3.1 px |
| 24 px | Excerpts, dialogs, the empty-project line (20) | 5.25 px | 10.5 px | 1.9 px | 2.6 px |
| 20 px | The empty-project and first-launch lines | 4.4 px | 8.75 px | 1.55 px | 2.2 px |
| 16 px | History rows, the Home card corner (14) | 3.5 px | 7 px | 1.25 px | 1.75 px |

On the canvas tag the same figure is drawn at 14 px in `--ai-fg` directly on the `--plan-ai` tile (no second tile). No face, no sparkle, no animation; it is a thing on a desk, not a character. It replaces Craft's pencil icon in the panel header; the pencil stays as the verb in hints.

## g. Home cards and the three empty moments, as finally specified

**Home cards.** Paper cards (`--surface`) with a 1 px `--edge`, radius 8, no shadow to speak of; the selected card has a 2 px `--accent` outline. A project with a thumbnail shows its ground floor in the plan colours on paper. A project without one gets a stable tinted sheet picked from its id (straw: paper + 14 % `--warning`; sage: + 18 % `--plan-room`; clay: + 12 % `--accent`; slate: + 10 % `--plan-dim`) with a faint pencil doodle of a house footprint and the project's two initials in Fraunces Italic 500, 30 px, SOFT 100, bottom-left. Names Alegreya Sans Medium 17; "Edited …" in italic; the level count in mono; tags as small paper labels. **Otto's lines:** the first slot is a composer card on `--ai-tint` with a border of `--ai` at 35 % over `--edge`: the 26 px mark, "Start with Otto", one sentence ("Describe the place and Otto drafts the ground floor: rooms, walls and doors, in millimetres you can change."), an editable sentence on `--canvas`, the rule "Otto asks before it deletes anything" and the one mulberry button, "Draft it" (`--ai`, pressed `--ai-hover`). Cards whose project Otto has worked on carry its 14 px mark in the thumbnail's top-right corner, 10 px in.

**First launch (empty library).** The Home header stays (Projects, New project, Import…); the filters row is hidden. Centred below: the wordmark at 56 px, the pencil sketch of one room (walls, a door swing, a window, a 4 000 mm dimension, a terracotta pencil), *Start with a room you know.* in Fraunces 30, two lines of copy ("Draw the walls of the room you are sitting in, with the numbers off a tape measure. Everything else grows from there."), New project and Import…, then **Otto's line** on `--ai-tint` with the 20 px mark: "Or start with Otto: *describe the place and it drafts the ground floor, in millimetres you can change.*", and the quiet promise: "Your projects live in a folder on this computer. Nothing leaves it unless you export." Status bar: "No project open · mm · Otto · ready · MCP".

**New empty project.** The canvas shows its grid; centred on it the same sketch, *Draw the first wall.* in Fraunces 28, one sentence of how ("Press W, click where a corner is, and type a length from your tape measure. Rooms appear by themselves once the walls close."), the row of four keys (W Wall, D Door, N Window, Ctrl K Every command), and **Otto's line** on `--ai-tint` with the 20 px mark and an editable sentence: "Or tell Otto: *'a 5 by 7 m studio with a bathroom in the corner'*". It fades the moment the first wall is placed. The Properties panel says *Nothing selected* in Fraunces 18 with one line of help and the Esc / V key caps. Status bar: "Otto · ready".

**About** (the bottom of Settings). The icon at 112 px, the wordmark at 40 px with its terracotta full stop, the two-sentence description ("Design your home, floor by floor, with exact numbers and a helping hand. Hollin is a drawing board for people who are not architects and a tidy file for the ones who are."), then **the credit line** in Fraunces 20: "Hollin" in ink, "with Otto" in mulberry, under it the model and provider and the rule it keeps ("Claude Opus 5.5 · Anthropic · Otto asks before it deletes anything, and signs its work in History."), and one mono line: version, the three fonts and Lucide with their licences, three.js and Electron, and a Licences… link. Paper, no gradient, no illustration.

## h. Problems found

1. **`--ai-tint` is nearly invisible against `--surface` in light mode** (contrast 1.02; against `--canvas` 1.10; dark 1.10). The composer card and Otto's History rows are told apart by hue, not by value, and a user with weak colour vision will not see the tint at all. The composer gets a visible border (`--ai` at 35 % over `--edge`) and the mark, so it holds; History rows have only the 16 px mark and the signature to rely on. If this matters, the fix is the decisions' to make (a darker tint such as a 20 % mix of `--ai` into `--surface`), not this sheet's.
2. **`--muted` on `--ai-tint` is 3.9:1 in light mode**, under the 4.5 body threshold; it passes only as large or secondary text. The composer's rule line and the History signatures are 12.5–13 px, so they sit on the wrong side of it. Dark is 5.0. Either set that text in `--fg` on tinted surfaces (what the mocks do for the sentence; the rule line stays `--muted`) or lift the tint.
3. **`--ai` and `--muted` are close in value** (1.44) and `--ai` and `--accent` likewise (1.46): mulberry is told from graphite and terracotta by hue only. On the canvas every mulberry mark has a halo, a node or a tile behind it, so this is cosmetic there, but a lone mulberry word in running text (the credit line's "with Otto") depends on colour vision.
4. **Icon B at 16 px loses the terracotta**; the two boxes survive (the decision's own test), but B is then not "in paper, ink and terracotta" at that size. Recorded, and one reason to prefer A.
5. **The outlined wordmark is a drawing, not Fraunces.** `wordmark.svg` is a hand-drawn soft serif in Fraunces' proportions (compare them side by side in `brand.html`: the H is wider and the o rounder than Fraunces'). Before it ships on the icon or the installer, the real Fraunces Semibold at opsz 144 / SOFT 80 should be outlined from the bundled font and the file replaced; `05-implementation.md` should list that step.
6. **Two lines are this sheet's wording, not the decisions'.** The decisions give Otto's sentence for the empty project and the credit line for About; for the first launch they say only "Otto's line added", so the line above ("Or start with Otto: …") is mine. Likewise Otto's name in the panel header set in Fraunces 18 (the panel-heading style) is this sheet's reading of "panel titles only"; Alegreya Sans Medium 15 is the conservative alternative.
7. **The hairline edge is sub-pixel below 64 px** (12 units at 1024 = 0.19 px at 16). Intended, but a white Explorer background then shows the bare paper square; the paper is still a shade darker than white (`#f6f1e8`), which is what keeps it visible.
8. **Status bar on Home.** The decisions place Otto's state "between the units and MCP" in the project window; the mocks also show "Otto · ready" on Home and in Settings, since the composer starts Otto's work from Home. If the owner wants the status bar quiet outside a project, drop it there.
9. Nothing in the palette, type or layout had to change; no value in `00-decisions.md` was altered.
