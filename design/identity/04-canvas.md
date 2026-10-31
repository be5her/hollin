# 04 · The drawings: plan, section, 3D, thumbnails, snapshots, exports

How everything the app *draws* looks in the identity decided in `00-decisions.md`: the plan canvas, the section view, the 3D view by day and by night, the Home-card thumbnails, Otto's snapshots and the five exports. Light and dark. The hex values are Craft's tables (`design/concepts/1-craft/README.md` §e) and the decisions' §4, verbatim; nothing here changes them. `canvas.html` beside this file shows all of it.

Sources read: `packages/viewport/src/plan2d/*` (the renderer, the tools' previews, the snap overlay), `packages/core/src/geometry/plan-symbols.ts`, `packages/viewport/src/scene3d/*`, `packages/core/src/exchange/*`, `src/renderer/src/styles.css`, `renderLevelToPng` (`plan2d/offscreen.ts`) and its callers (`plan-view.ts`, `snapshot-responder.ts`), the section view (`packages/modules/building/ui/section-view.ts`) and the reference screenshots in `design/reference/`.

Conventions in this document:

- **px** is a screen pixel at any zoom. The renderer gives every stroke its width as `n / camera.scale` (`px(frame, n)`), so a "1.5 px" line is 1.5 px on screen whether the plan is at 1:20 or 1:500; dash patterns the same. Only three things scale with the zoom: the reference underlay's wall bands (drawn at their real thickness), the point and light glyphs (`PLAN_GLYPHS`: 100 mm and 150 mm) and label text (its `size` is in mm). Screen text (`screenPx`) is a fixed pixel size and is skipped under 5 px.
- **alpha** is applied in code (`withAlpha`); every `--plan-*` variable stays `#rrggbb`.
- **Sans** is Alegreya Sans, **Mono** is IBM Plex Mono: the canvas reads `--font-sans` / `--font-mono` from `styles.css`, so it follows the identity the moment the variables name the bundled fonts (see Problems, P8, for the offscreen renders).
- Light / dark hex pairs are written `light · dark`.

## (a) The plan

### The sheet

| Thing | Variable | Light · dark | Alpha | Stroke | Notes |
|---|---|---|---|---|---|
| Canvas background | `--canvas` | `#f6f1e8` · `#1d1a17` | 1 | — | Painted first; `transparent` renders clear it instead |
| Minor grid | `--plan-grid` | `#ebe4d7` · `#272320` | 1 | 1 px, pixel-snapped (+0.5) | Spacing: the smallest metric step (1, 10, 100 mm, 1 m, 10 m, 100 m; imperial 1″, 1′, 10′, 100′, 1000′) at least 14 px apart; skipped when more than 600 lines would show |
| Major grid | `--plan-grid-major` | `#dbd1bf` · `#352f2b` | 1 | 1 px, pixel-snapped | The next step up; drawn over the minor |
| Origin axes | `--muted` | `#7b7064` · `#a2968a` | 0.5 | 1 px | The x = 0 and y = 0 lines when in view |
| Slab under the footprint | `--plan-slab` | `#e9e1d2` · `#2a2623` | 1 | no outline | The automatic slab, nonzero fill, stairwells and shafts cut out; a region slab the same |

The grid is a shade under the paper, never a line colour: at 1 m spacing on the usual zooms it reads as the faint squares of a notebook. The slab is one more shade so a footprint sits on the paper like a cut sheet.

### Structure

| Thing | Variable | Light · dark | Alpha | Stroke | Dash / cap / join | Notes |
|---|---|---|---|---|---|---|
| Wall body (poché) | `--plan-wall` | `#3b3531` · `#d8cfc2` | 1 × layer opacity | fill | — | All walls of the level filled as one joined shape (`walls.cut`), so junctions show no seam; the opacity is the lowest of the layers that hold walls |
| Wall edges | `--plan-wall-line` | `#231f1c` · `#f3ece1` | same | 1.5 px | miter join | The ink line round the joined shape, holes included |
| Wall without derived geometry | `--plan-wall` | | 1 | its thickness (world mm) | miter | A fallback only (`frame.walls` null) |
| Column | `--plan-wall` | | layer opacity | fill, no outline | — | Rectangles, circles and region columns in the walls' graphite (a column spanning up from another level draws here too) |
| Door jambs and leaf | `--plan-wall-line` | | 1 | 1 px | butt | The two jamb lines across the wall and the leaf from the hinge, from `openingSymbol` |
| Door swing | `--plan-wall-line` | | 1 | 1 px | dash **3 / 3 px** | A quarter arc from the leaf's tip to the other jamb (`sweep < 0` clockwise) |
| Window glazing and sill | `--plan-wall-line` | | 1 | 1 px | butt | The jambs and the glazing lines along the wall from `openingSymbol`; the cut itself is part of the wall shape (paper shows through) |
| Opening that does not fit | `--plan-warning` | `#b8841f` · `#e2b24a` | lines 1, cut fill 0.12 | 1 px | as above | `openingMisfits` (past the wall's end, overlapping another): the whole symbol in ochre and its cut filled at 12 % |
| Shaft outline | `--plan-wall-line` | | 1 | 1 px | dash 6 / 4 px | Through-floor shafts, the slab cut under them |
| Void outline | `--muted` | | 1 | 1 px | dash 6 / 4 px | |

Walls are neutral on purpose: graphite with an ink edge in light, paper with a lighter edge in dark, so every coloured mark reads against them (Craft §e).

### Rooms

| Thing | Variable | Light · dark | Alpha | Stroke / size | Font | Notes |
|---|---|---|---|---|---|---|
| Room wash (enclosed) | `--plan-room` | `#8b9a6b` · `#a4b385` | **0.18** | fill, even-odd (holes left) | | The sage tint under the room; 0.18 is the decided value (code draws 0.10 today: P1). Over paper it is `#e2e1cf`-ish, over the dark desk `#35392b`-ish: a tint, never a line colour |
| Room wash (shares its space) | `--plan-room` | | **0.06** | fill | | Two rooms detected in one space: both faint (code: 0.04) |
| Room outline | `--plan-room` | | 0.6 | 1 px | | The detected polygon's edge, just inside the walls |
| Room name | `--fg` | `#2a2521` · `#ebe3d6` | 1 | 12 px | Sans 400, centred, bottom-aligned 2 px above `labelAt` | `"12 Kitchen"` when it has a number |
| Room area | `--muted` | `#7b7064` · `#a2968a` | 1 | 11 px | Mono, centred, top-aligned 3 px below | `formatArea`: `39.4 m²` (thin space thousands) |
| "shares its space" | `--plan-warning` | | 1 | 10 px | Mono | In place of the area |
| Seed badge (not enclosed, or no geometry yet) | `--plan-room`; `--plan-warning` when a wall is missing | | fill 0.25, ring 1 | 5 px radius, 1 px | name 12 px Sans at 9 px to the right | Text `"Study · not enclosed"` in ochre when not enclosed |
| Selected room's seed (detect rooms) | `--plan-selection` | `#b9552f` · `#e07c50` | fill 0.12 | 8 px radius, 2 px | | What the selection outline draws for a detected room (the polygon is drawn too) |
| Room tool preview | `--plan-room` | | fill 0.18 | 2 px outline | area 12 px Mono in `--plan-room` | The space under the cursor before the click |

### Shapes, dividers, fixtures, labels

| Thing | Variable | Alpha | Stroke | Dash / join | Font |
|---|---|---|---|---|---|
| Shape outline | `--plan-wall-line` | 1 | 1 px | round join | |
| Shape fill (closed, `filled`) | `--muted` | 0.16 | fill, even-odd | | |
| Shape name | `--muted` | 1 | 11 px | | Sans, centred at the centroid, closed shapes only |
| Room divider | `--muted` | 1 | 1 px | dash 8 / 4 px | |
| Fixture (sized) | `--muted` | 1 | 1 px rectangle | | |
| Service point / fixture without size | `--muted` | 1 | 1 px circle + cross | glyph 100 mm (`PLAN_GLYPHS.point`, scales) | |
| Label | `--fg` | 1 | text only | rotated with `rotation`, never upside down | Sans, `size` in mm (so it scales; skipped under 5 px) |

### Dimensions

| Thing | Variable | Light · dark | Stroke | Notes |
|---|---|---|---|---|
| Dimension line and extension lines | `--plan-dim` | `#3f5390` · `#91a4e0` | **0.75 px**, no dash, butt | `dimensionGeometry` with a 6 px gap between the measured point and the extension line; aligned, horizontal, vertical, angular (an arc) and radius kinds |
| Ticks | `--plan-dim` | | 0.75 px | A 4 px slash at 45° to the line at each end (`dimensionMarks`); a radius gets an open 8 px arrow head instead |
| Figure | `--plan-dim` | | 11 px | Mono, centred, 3 px above the line, rotated with it (`textAngle`), kept readable; `formatLength`: `6 000 mm`, units in the figure as the setting says |
| Dimension tool preview | `--plan-selection` | | the same geometry | Terracotta while the second point is being picked; the figure too |

The 0.75 px line is the thinnest line on the plan: a dimension is an annotation, drawn finer than any wall, divider or stair. Indigo (228°) is the one blue-family colour on the sheet, so a figure is found at a glance.

### Connectors (stairs, ramps, ladders, escalators, elevators)

Colour: `--plan-connector` (`#4b433d` · `#e3dacc`), the whole symbol in `--plan-warning` when the connector breaks a rule (`geometry.broken`), and the whole symbol at **40 % alpha** on a level it only passes through (`role === 'crosses'`) and for drag previews. Labels are 11 px Mono in the same colour (50 % when faint).

| Part | Stroke | Dash / cap | Notes |
|---|---|---|---|
| Footprint outline | 1.5 px | miter, butt | Every connector |
| Treads below the cut, handrails | 1 px | — | Stairs |
| Treads above the plan cut | 1 px | dash **4 / 3 px** | On the level the stair starts from, beyond the break line |
| Break line | 1.5 px | — | `breakLinePoints`: a slanted line across the flight with a zigzag in the middle, at the cut |
| Walk line | 1 px | — | From the start dot to the cut (UP) or from the top back (DN) |
| Arrow head | 1 px | open, **10 px** long, half-width 4.5 px (`arrowHeadLines`, 0.45) | |
| Start dot | fill | **3 px** radius | At the walk line's start |
| `UP` / `DN` | 11 px Mono | 14 px off the walk line, at the dot | `UP` on the level it starts from, `DN` on the level it arrives at |
| Risers `16 R` | 11 px Mono | 14 px off, the other side | Stairs only |
| Ramp slope `8.0 %` | 11 px Mono | 12 px off the mid-point of the walk line | Ramps, with the walk arrow but no break line |
| Ladder rails and rungs | 1 px | | |
| Escalator steps | 1 px | | Plus a walk arrow from 10 % to 90 % of its length and `UP` / `DN` 12 px aside |
| Elevator shaft | 1.5 px (the outline) | | |
| Elevator car | 1 px, crossed corner to corner | | |
| Elevator door at this level | **4 px**, butt | | On the side the stop opens; only on levels it stops at |

Warnings on connectors are therefore the ochre symbol itself; the Warnings panel names the rule. A selected connector takes the terracotta selection outline and fill over that (next section), so warned + selected reads as ochre lines inside a terracotta frame.

### Decor: furniture and lights

| Thing | Variable | Light · dark | Alpha | Stroke | Notes |
|---|---|---|---|---|---|
| Item footprint | `--plan-decor` | `#8c6b4a` · `#d4a97a` | fill 0.16, line 1 | **1.25 px**, round join | The model's outline from above |
| Item details (cushions, a back) | `--plan-decor` | | 0.7 × layer | 0.75 px | When the model has more than one detail polygon |
| Item front tick | `--plan-decor` | | 1 | 1.25 px | A short line just inside the front (−y) edge, a quarter of the width, inset min(depth / 4, 4 px) |
| Item name | `--muted` | | 1 | 10 px Sans, centred | Only when the item's smaller side is ≥ 48 px on screen |
| Rotate grip | `--plan-selection` | | 1 | 5 px radius disc, filled | 250 mm in front of a selected item (`ROTATE_GRIP_MM`) |
| Light symbol | `--plan-decor` | | fill 0.25, rays 1 | 1.25 px | Glyph reach 150 mm (`PLAN_GLYPHS.light`): a circle (an area light: a square) of radius 67.5 mm and eight rays from 1.35 r to 150 mm; a spot adds a line to its target. Scales with the zoom |
| Furniture / Light tool preview | `--plan-selection` | | item 0.15 fill, 1.5 px dash 6 / 4; light at 80 % | | Label `Sofa, 3 seats · 90°` or `800 lm` 11 px Mono under the cursor |

Umber is a desaturated brown no full-strength role shares, so furniture never competes with the ochre of a warning next to it.

### Snapping and tracking

| Thing | Variable | Light · dark | Alpha | Stroke | Notes |
|---|---|---|---|---|---|
| Guide lines (extensions, perpendicular feet) and **tracking rays** | `--plan-snap` | `#2f8a57` · `#6fcf8a` | 1 | 1 px, dash **6 / 4 px** | An angle snap's guide runs from the start point six tolerances past the snapped point; apparent intersections add a guide from the crossed segment |
| Snap marker | `--plan-snap` | | fill 0.15, line 1 | 1.5 px, half-size **6 px** | Endpoint: square. Midpoint: triangle. Centre / tangent: circle. Intersection / extension: ×. Perpendicular: the right-angle glyph. On line: a bow tie. Grid: a 2.5 px dot. Drawn in screen space, so it never scales |
| Snap label | `--plan-snap` on a `--canvas` chip at 0.9 | | | 11 px Sans, 16 px chip, 12 px right and 10 px below the point | `Endpoint`, `Perpendicular to Wall 3 · 2 400 mm`, `45°` |
| Rotate / mirror helpers (Select tool) | `--plan-snap` | | 1 | 1 px; pivot circle 6 px; reference dashed 4 / 4, mirror axis dashed 8 / 4 | Angle 11 px Mono |
| Footer snap word | `--success` | `#4f7d3d` · `#8fbf6e` | | the status bar's Mono | The same moss family as the canvas marks |

### Selection, grips, hover, marquee

| Thing | Variable | Light · dark | Alpha | Stroke | Notes |
|---|---|---|---|---|---|
| Selection outline | `--plan-selection` | `#b9552f` · `#e07c50` | line 1, fill **0.12** | **2 px**, round join | The entity's own outline (a wall's body, an opening's cut, a column, a room polygon, a connector's footprint); open lines (dividers, open shapes, dimensions) outline only |
| Vertex grip | `--plan-selection` | | 1 | 8 × 8 px square, 1.5 px, filled `--canvas`; the active vertex filled terracotta | Pixel-aligned |
| Segment-middle grip | `--plan-selection` | | 1 | 3.5 px radius circle, 1.5 px, paper-filled | |
| Corner grip (round / chamfer) | `--plan-selection` | | 1 | 4 px diamond, filled | |
| Door hinge / swing-side grip | `--plan-selection` | | 1 | 5 px diamond, paper-filled | |
| Rotate grip | `--plan-selection` | | 1 | 5 px disc, filled | Items |
| Hover | — | | | | The plan draws **no hover outline**; the cursor and the footer say what is under the pointer, and the sheet stays quiet. Two tools hover on purpose: the Opening tool's fit preview (terracotta, ochre when it will not fit, `1 200 mm from the start` 11 px Mono) and the Paint tool (below) |
| Marquee, window (left → right) | `--plan-selection` | | fill **0.08**, line 1 | 1 px, solid | |
| Marquee, crossing (right → left) | `--plan-selection` | | fill 0.08 | 1 px, dash 6 / 4 px | |
| Move / copy preview | walls `--plan-wall` at 0.7 with `--plan-wall-line` 1.5 px; everything else as drawn at 80 % | | | | Connectors at 80 % too |
| Wall tool preview | body `--plan-wall` 0.45 + `--plan-wall-line` 1 px; axis `--plan-selection` 1 px dash 6 / 4; `6 000 mm · 90.0°` 11 px Mono terracotta 6 px above the segment | | | | |
| Shape / divider / column / connector tool previews | `--plan-selection` 1–1.5 px, dashes 4 / 4 or 8 / 4, fills 0.10; column at 80 % | | | | The Column tool writes `up to Level 2` 11 px Mono |
| Paint tool: wall face | `--plan-selection` | | 1 | **4 px**, round cap, along the face | Label `left face` 11 px Mono 14 px right of the cursor |
| Paint tool: floor | `--plan-selection` | | fill 0.12 | 2 px round the room polygon | Label `floor` |

Terracotta is the colour of *what you are touching*: selection, grips, every tool's preview and the marquee, and nothing that stays on the sheet. That is why nothing stored (rooms, dimensions, furniture) is ever terracotta.

### The reference underlay

`--plan-underlay` (`#a89c8c` · `#7a7066`) at **0.35** alpha: the level below or above (`setUnderlay('below' | 'above')`), drawn under the slab and the plan. Walls as solid bands of their real thickness (world mm, miter join, butt cap) along their axis, columns filled, rooms, slabs, shapes and dividers as 1 px outlines. No openings, text or connectors. The code's underlay is the adjacent level, not a DXF: an imported DXF becomes real entities on the level (Craft's role text "DXF / reference underlay" should read "reference level": P7).

### Otto on the canvas

From the decisions §5; the full behaviour is `03-otto.md`'s. On the plan it is three marks, all in `--plan-ai` (`#8a3f6f` · `#d892bd`), drawn after the entities and connectors and before the selection, never in thumbnails, snapshots or exports:

| Mark | Alpha | Stroke | Notes |
|---|---|---|---|
| Halo | **0.22** | **34 px** wide, round cap and join, along the entity's outline (a wall: its axis is enough, the body sits inside it) | What Otto changed in the last minute; fades out over the last 10 s of that minute, or at once on the user's next edit |
| End nodes | 1 | 5 px radius disc filled `--plan-ai`, 1.5 px `--canvas` ring | At the ends of a wall or path Otto drew, at an item's centre |
| Tag | chip `--canvas` 0.9 with a 1 px `--plan-ai` edge | 11 px Sans `Otto` + Mono `3 m wall` + Sans italic `now`, separated by ` · `; a 1 px leader 18 px long from the halo | `Otto · 3 m wall · now` |
| Pending destructive call | 1 | 1.5 px, dash 6 / 4 px, round join, round the target's outline | Until the user answers Allow / Keep it; no fill, so the target stays legible |

A terracotta selection can coexist: the 2 px selection line sits on top of the 34 px halo, which reads as "mine, and Otto drew it".

### The cursor footer

The strip under the canvas (`plan-view`): cursor coordinates `4 512 mm, 3 208 mm` in Mono 11 px `--muted`; the snap word (`Endpoint`, `On line`) in `--success`; level name, counts and the tool's hint in Mono 11 px `--muted`, the level name in `--fg`. Numbers are Mono so they line up as the cursor moves.

### Keeping the colours apart, with Otto's mulberry

Craft §e: the five full-strength roles sit on five hue families: terracotta 17° (selection, the UI accent), ochre 42° (warning), sage 85° (the room wash, only ever at 18 %), moss 140° (snap and tracking), indigo 228° (dimensions); umber is a desaturated brown no saturated role shares, and walls are neutral. Mulberry `#8a3f6f` is at **322°** (`#d892bd` 323° in dark): the only magenta-family colour, 55° from terracotta the short way round, 80° from ochre, 94° from indigo and more from the greens. It is also the only one of the six drawn *wide*: the 34 px halo at 22 % is a soft band, where terracotta is a 2 px line, moss a dashed 1 px ray, indigo a 0.75 px line and ochre a 1–1.5 px symbol, so even in a greyscale print of the screen Otto's marks are told from the others by their shape. Over the sage wash the halo reads as a dusty rose, still unmistakably not the terracotta selection fill, which is warmer and redder. In dark the four lifted line colours and the lifted mulberry keep the same families and spacing.

## (b) The section view

The section (`section-view.ts`) is an SVG diagram of the levels, not a canvas: every level as a bar at its elevation and height, basements under the ground line, mezzanines inset to the right half, and the stairs, ramps, ladders and elevators as lanes on the right. It takes the chrome's semantic variables through Tailwind classes, so it follows the palette with no code change except where this table says *proposed*.

| Thing | Variable | Light · dark | Alpha | Stroke / size | Font |
|---|---|---|---|---|---|
| Level bar | fill `--elevated`, stroke `--edge` | `#e6ddcd` · `#332d29`, `#dcd2c2` · `#3c3531` | 1 | 1.5 px, radius 3 | |
| Active level | fill `--accent` 0.15, stroke `--accent` | `#b9552f` · `#e07c50` | | 2.5 px | The one terracotta thing in the view |
| Basement bar | fill `--muted` 0.10, stroke `--edge` | | | 1.5 px | |
| Mezzanine (offset placement) | as its kind, right half | | | dash 6 / 4 | |
| Slab under a floor | `--muted` 0.45 | | | its thickness, min 2 px | |
| Ground line | `--muted` 0.6 | | | 1.5 px, dash 8 / 6 | `Ground 0 mm` 13 px Sans `--muted`, right |
| Level name | `--fg` | | | | **Sans 500, 15 px**, 18 px in from the bar's left |
| Elevation | `--muted`; `--warning` below ground | | | | Mono 13 px, right-aligned left of the bar, a 1 px `--muted` 0.5 leader to the bar |
| Stair steps | *proposed* `--plan-connector` (code: `--accent`) | `#4b433d` · `#e3dacc` | | 2 px, round join | A staircase polyline with the real riser count |
| Ramp / ladder lane | *proposed* `--plan-connector` (code: `--accent`) | | | 3 px, round cap | |
| Elevator shaft | *proposed* `--plan-connector` 0.1 fill, 0.7 stroke; stops 4 px discs | | | 1.5 px, radius 2 | |
| Connector label | `--muted` | | | | Sans 12 px above the lane |
| Contents strip | the chrome's `--surface`, `--edge`, `--elevated` chips | | | | Sans 11 px; counts in Mono |

Why move the connectors off the accent: with three stairs and a lift, the section today is mostly terracotta, and terracotta means *what you are touching*. In the identity the active level alone is terracotta; stairs and lifts are drawn in the same graphite they have on the plan, so the section and the plan say the same thing.

## (c) The 3D view

### Roles

| Role | Variable | Light | Dark | What it is |
|---|---|---|---|---|
| Background | `--canvas` | `#f6f1e8` | `#1d1a17` | The scene's clear colour by day |
| Edge lines | `--scene-edge` | `#3a332e` | `#141210` | `LineBasicMaterial`, 1 px (WebGL lines are 1 px), on every edge where faces meet at more than 25°, for walls, slabs, columns, stairs, glass, cars, frames and leaves; not on rails (they would be all edge) or finishes |
| Walls | `--scene-wall` | `#efe6d6` | `#c4b9a8` | Limewashed plaster; frames, leaves and finishes without a material take it too |
| Slabs | `--scene-slab` | `#cdbea7` | `#6f6358` | Sand: what the walk camera stands on |
| Columns | `--scene-column` | `#ddd1bd` | `#a89c8c` | |
| Glass | `--scene-glass` | `#9bb9c7` | `#6e93ab` | The one cool note, at **0.35 opacity**, double-sided, no depth write |
| Stairs, ramps, ladders, escalators | `--scene-connector` | `#d5c2a3` | `#a8947a` | Timber |
| Handrails | `--scene-rail` | `#5a4f45` | `#d8cfc2` | |
| Elevator cars | `--scene-car` | `#b9552f` | `#e07c50` | The accent, the only terracotta solid |
| Stand-in block | `--scene-stand-in` | `#a69b8e` | `#5f574f` | A box of the model's size while an imported model loads, or when it cannot |

All of them are `MeshStandardMaterial` with roughness 0.9, metalness 0, lit physically so the design's own lights light them like the materials of the catalog. A painted or catalogued material (`paint:#rrggbb`, `builtin:<id>`) replaces the kind's colour on that face; an imported model keeps its own materials.

### Day

- Hemisphere sky light: sky `#ffffff`, ground `#8c8a84`, intensity 2.9: upward faces at about 0.9 of their colour, walls at about 0.6. Proposed: ground `#8f877c`, a warmer bounce, so the undersides of stairs and the shaded wall faces lean towards the paper rather than grey (a constant in `view.ts`, not a variable).
- Key light: directional, `#ffffff` at 1.15, from the camera's upper left (turned 40°, 35° up), so whatever is in view reads in three tones; it follows the orbit. No shadows (software GL must keep up).
- Background `--canvas`. In dark the warm near-black makes the plaster walls look lamplit without any change to the lights.

### Night

- Sky light down to 0.12, key light off. Background: a constant `NIGHT_BACKGROUND`, today `#0b0e14` (a cool blue-black, P3); **proposed `#0f0d0b`** in both themes, the concept page's night: the desk with the lamp off.
- The design's lights come on: the **16 nearest the camera** (`MAX_LIGHTS`), re-chosen only when the set changes (three rebuilds its shaders when the number of lights changes). Each light keeps its own colour and lumens: a point light at lm / 4π, a spot over its cone, an area panel 600 mm square. The schema's default light colour is `#ffffff`; proposed: the Light tool's default option becomes a warm `#ffe9c9` (about 2 700 K) so a room lit by the defaults looks like a room at night, not a workshop. The canvas mirrors `data-lighting` and `data-lights`.
- Lit plaster then reads as the light's colour × the wall's; the terracotta car and the sand slab warm further. Glass stays cool.

### Treatments

| State | What is drawn |
|---|---|
| All | Every level stacked as built |
| Isolate | The active level alone, with the connectors that start on it; the rest not drawn (no ghosting) |
| Cutaway | The active level cut at `cutHeight` (1 200 mm by default, the plan cut) with caps in the kind's colour; the levels below it whole; connectors, rails, cars and glass clipped by a plane at the same height, their edge lines with them. Nothing above the plane is drawn or picked |
| Explode | Each level lifted `EXPLODE_GAP` 4 000 mm × the slider above the one below; no leader lines; walking happens with everything in place |
| Selection in 3D | Not drawn today (a click selects the item on the plan and the Properties panel follows; P5). Proposed: the picked item's or connector's edge lines redrawn in `--plan-selection`, 1 px (WebGL); walls are never selected in 3D |
| Walk | Eyes 1.6 m above the feet, on the floor under the double-click (the slab, or the finish's skin), through doors, up stairs and ramps, not through walls; every level whole and in place. The floor needs no special treatment: it is the slab or finish as drawn |
| Picked face while painting | The plan's Paint tool does the hover; 3D painting applies to the clicked face with no preview |

Imported models' default material (a material reference that does not resolve) is a constant `#b8b4ac` in both the view and the glTF writer; proposed `#ddd1bd` (= light `--scene-column`), one plaster-coloured fallback instead of a grey.

### The canvas background

Light `#f6f1e8`, dark `#1d1a17`, by day; night `#0f0d0b` (proposed) whatever the theme; transparent renders (`export.image` with `transparent`) clear to alpha 0.

## (d) Thumbnails and snapshots

**Thumbnail** (`renderLevelToPng` from `plan-view.ts`): the ground floor, 1.5 s after a project's last change and when its tab is left, stored through `project.thumbnail.set` and shown on the Home card in a 4:3 frame (`aspect-[4/3]`, `object-cover`).

- Size: **480 × 360** today at `dpr` 1; proposed **960 × 720** so a card on a HiDPI screen (a 340 px card at 2×) shows crisp ink (P9). Padding 24 px (48 at the larger size) round the fitted level.
- Palette: **always light** (`LIGHT_THEME`), no grid, no underlay, no selection, no Otto marks; connectors and warnings as the plan draws them. Rationale: a thumbnail is a stored PNG shared by both themes, and the Home card is "the ground floor in the plan colours on paper" (Craft §h) in either theme: in dark the card holds a small sheet of paper on the desk, which is the identity's story, where a theme-following thumbnail would have to be re-rendered at every theme switch for every project and would turn the Home into a wall of dark squares. The paper `#f6f1e8` and the card's `--surface` differ by one step in light; in dark the 1 px `--edge` frame the card already has is enough of a mat.
- Fonts: the bundled faces must be loaded before the draw and `LIGHT_THEME.fontSans` / `fontMono` must name them, or thumbnails fall back to system fonts (P8).

**Snapshot** (`view.snapshot`, answered in the window by `SnapshotResponder`): what Otto and MCP agents see.

- Plan: `renderLevelToPng` at the requested size, light palette by default, no grid, opaque paper; dark only when asked (`theme: 'dark'`), transparent only when asked. A model reads ink on paper best, and a snapshot must look like the exported drawing, not like the user's screen.
- 3D: `renderBuildingToPng`, `LIGHT_SCENE_THEME` by default, the asked azimuth, elevation, mode, level, explode and lighting (`night` turns the lights on as in the view); the WebGL drawing buffer caps the size and a render that cannot be drawn at the asked size is refused (`SnapshotSizeError` → `UNAVAILABLE`), never shrunk.
- Neither carries the selection, grips, snap marks or Otto's halo: the snapshot is the drawing, not the session.

## (e) Exports

### PDF and SVG: the plan on a sheet

The plan drawing (`drawing.ts`) is one layered vector model in mm; `svg.ts` and `pdf.ts` write it on paper. The sheet:

- **White `#ffffff`**, not paper: the drawing prints on real paper, and a tinted sheet would print as a grey wash over the whole page (and waste ink). The paper colour is the screen's; the sheet is the printer's.
- Sizes A4–A1, Letter, Tabloid; 10 mm margin; the drawing centred in the area left, at 1:20 … 1:1000 (`fit` picks the largest that fits); clipped to the drawing area when it does not.
- Round caps and joins on every stroke (SVG `stroke-linecap: round`; PDF the same).

**Print palette** (`PRINT_COLORS`, today a darkened copy of the *old* blue palette, P4): the light table with ink for the lines.

| Role | Hex | From |
|---|---|---|
| `fg` | `#231f1c` | `--plan-wall-line` light: ink |
| `wallLine` | `#231f1c` | ink |
| `wall` (poché) | `#3b3531` | `--plan-wall` light |
| `muted` | `#7b7064` | `--muted` light |
| `slab` | `#e9e1d2` | `--plan-slab` light |
| `room` | `#8b9a6b` | `--plan-room` light; the wash at **0.18** (0.06 shared), the outline at full strength, `PEN.fine` |
| `dim` | `#3f5390` | `--plan-dim` light |
| `connector` | `#4b433d` | `--plan-connector` light |
| `decor` | `#8c6b4a` | `--plan-decor` light |
| `warning` | `#b8841f` | `--plan-warning` light |

**Pens** (paper mm, whatever the scale; `PEN` in `drawing.ts`, unchanged):

| Pen | mm | Used for |
|---|---|---|
| heavy | 0.50 | Wall outlines (poché edges), column outlines |
| medium | 0.35 | Connector footprints, the break line, the title block frame |
| normal | 0.25 | Door jambs, leaves, glazing |
| thin | 0.18 | Treads, rails, walk lines, arrow heads, ladder rungs, escalator steps, elevator car and cross, item outlines and front ticks, light symbols, fixture glyphs, dimension ticks, dividers, voids, the seed ring |
| fine | 0.13 | Door swings (dash 1 / 1), slab and room outlines, dimension lines and extension lines, item details, a spot's aim line |
| mark | 0.70 | The elevator door at a stop |

Dashes on paper: swing 1 / 1, void 2 / 1.3, divider 2.5 / 1.2, treads above the cut 1.3 / 1 mm.

**Type on paper**: the drawing's text height `h` is 200 mm by default: 2.0 mm at 1:100, **4.0 mm at 1:50**. Room name `h` (Sans, `fg`), area 0.9 h Mono `muted`, dimension figures 0.8 h Mono `dim` a quarter height above the line, connector labels 0.8 h Mono, item names 0.7 h `muted`, shape names 0.85 h; labels keep their own mm size. The PDF today sets Helvetica and Courier (the standard 14, no embedding); the SVG names `Helvetica, Arial` and `ui-monospace`. Proposed: the SVG names `'Alegreya Sans', Helvetica, Arial, sans-serif` and `'IBM Plex Mono', ui-monospace, monospace` (it renders in the identity wherever the fonts are installed, and falls back cleanly); the PDF keeps Helvetica and Courier until core can embed a subset (a font writer with no dependency: deferred to `05-implementation.md`, since the PDF writer measures text with Helvetica's AFM widths and the title block's `fitText` depends on them).

**Title block** (proposed; `TITLE_BLOCK` stays 90 × 24 mm in the bottom-right corner, inside the margin, so `paper.ts`'s layout does not move):

```
┌──────────────────────────────────────────────────────┐
│ Hollin.                        Kitchen extension      │  row 1: 8 mm
├──────────────────────────────────────────────────────┤
│ Ground floor                                          │  row 2: 8 mm
│ Scale 1:50                      2026-10-31            │  row 3: 8 mm
└──────────────────────────────────────────────────────┘
```

- Frame and the one rule under row 1: `fg` ink, 0.35 mm, square caps.
- Row 1 left: the wordmark **`Hollin.`** as outlined paths (the wordmark ships as paths, so the PDF needs no font), cap height 3.2 mm, the full stop in terracotta `#b9552f` (the one colour in the block; `rg 0.725 0.333 0.184`). Row 1 right: the project name, 4 mm, right-aligned, `fitText` shrinking to 70 % then cut with an ellipsis.
- Row 2: the level name, 3 mm. Row 3: `Scale 1:50` left and the date `YYYY-MM-DD` right, 2.8 mm.
- Without a project name (`title` undefined) there is no block, as today.
- The working name lives in `branding.json`; the block reads `BRANDING.productName` for the PDF's `/Producer` and the wordmark paths from the brand assets (`01-brand.md`).

### DXF

`dxf.ts` writes one layer per drawing layer (optionally prefixed, e.g. `A-`), lineweights from the pens (group 370, nearest of the DXF set: 0.13 → 13, 0.18 → 18, 0.25 → 25, 0.35 → 35, 0.5 → 50, 0.7 → 70), `DASHED` line types from the dash patterns, poché as `HATCH`, texts as `TEXT` in `STANDARD`. Colours are AutoCAD colour indices (ACI) per role; an entity carries its own index only when it differs from its layer's. Proposed mapping from the palette (today's in brackets):

| Layer (name) | Role | ACI | ACI colour | Nearest to |
|---|---|---|---|---|
| Slabs | `muted` fill `slab` | **8** (8); fill **9** (9) | `#808080`; `#c0c0c0` | graphite; the slab tint |
| Rooms | `room` | **75** (5) | `#8c995c` | sage `#8b9a6b` |
| Voids and shafts | `muted` / `wallLine` | 8 / 7 | | |
| Shapes | `wallLine` | **7** (7) | black on white, white on black | ink |
| Room dividers | `muted` | **8** (8) | `#808080` | |
| Walls | `wallLine`, hatch `wall` | **7**; hatch **8** | | ink; graphite poché |
| Columns | `wallLine`, hatch `wall` | 7; 8 | | |
| Doors and windows | `wallLine` | 7 | | |
| Fixtures and points | `muted` | 8 | | |
| Furniture | `decor` | **35** (32) | `#997a5c` | umber `#8c6b4a` |
| Lights | `decor` | 35 | | |
| Stairs and lifts | `connector` | **7** (7); broken: **42** | ink; `#cc9900` | |
| Dimensions | `dim` | **165** (4) | `#4c5c99` | indigo `#3f5390` |
| Labels | `fg` | 7 | | |
| (warning override) | `warning` | **42** (40) | `#cc9900` | ochre `#b8841f` |

The ACI table has no sage, umber, indigo or ochre: these are the nearest of its 255 fixed colours, and 7 flips with the CAD background as it should. `colors.ts`'s `DXF_COLORS` is the one place to change.

### glTF

`SOLID_COLORS` in `gltf.ts` is the light `--scene-*` table, and `LIGHT_SCENE_THEME` takes its kind colours from it (`snapshot-theme.test.ts` pins both to `:root`):

| Kind | Hex | = |
|---|---|---|
| wall, frame, leaf, finish | `#efe6d6` | `--scene-wall` |
| slab | `#cdbea7` | `--scene-slab` |
| column | `#ddd1bd` | `--scene-column` |
| glass | `#9bb9c7` | `--scene-glass`, `baseColorFactor` alpha 0.35, `BLEND`, double-sided |
| connector | `#d5c2a3` | `--scene-connector` |
| rail | `#5a4f45` | `--scene-rail` |
| car | `#b9552f` | `--scene-car` |

Written as linear `baseColorFactor` (`srgbToLinear`), roughness 0.9, metalness 0; materials of the design (builtins, paints) and imported models keep their own. The dark table is for the window and dark renders only: a glTF has no theme.

### PNG renders

`export.image`: the plan through `renderLevelToPng` (light or dark palette as asked, opaque or transparent, no grid) or the building through `renderBuildingToPng` (light or dark scene theme, day or night, mode, level, explode, azimuth and elevation), at the asked size; a 3D size WebGL cannot draw is refused, never shrunk. Nothing of the session (selection, snap, Otto) is in it.

## (f) Problems found

- **P1 · Room wash alpha.** `render.ts` fills an enclosed room at 0.10 (0.04 when shared) and `drawing.ts` writes the same 0.10 / 0.04 to SVG and PDF, while the decision is ~18 % and the Room tool's preview already uses 0.18. With the new sage (`#8b9a6b`), 0.10 over paper is barely a tint (`#ebe8dc` against `#f6f1e8`). Set both to **0.18 / 0.06**; the smoke's room pixel checks (`canvasPixel` in the rooms section) sample the wash and will need their expected colour recomputed.
- **P2 · Hardcoded night sky and ground.** `NIGHT_BACKGROUND = '#0b0e14'` (cool), the hemisphere ground `#8c8a84` and the key `#ffffff` are constants in `view.ts`, not variables; the night background is the one cool surface left in the app. Proposed `#0f0d0b` and `#8f877c`; keep the key white. `renderBuildingToPng` night smoke shots sample the background.
- **P3 · Three constants stand in for `--scene-stand-in`.** `LIGHT_SCENE_THEME.standIn = '#9a9a9a'` in `scene3d/theme.ts` is not read from `SOLID_COLORS`, and `DecorMaterials`/`gltf.ts` use their own `FALLBACK = '#b8b4ac'` for an unresolved material. The theme test pins `standIn` to `:root`, so it must become `#a69b8e`; the fallback is a separate role (proposed `#ddd1bd`).
- **P4 · `PRINT_COLORS` is the old palette.** `exchange/colors.ts` mirrors the old blue (`room` and `dim` `#1f5fbf`) and must be replaced by the table in (e); core never imports the viewport, so it stays a hand-written mirror and `snapshot-theme.test.ts` (or a sibling) should pin it to the light `--plan-*` values.
- **P5 · No selection in 3D, no hover on the plan.** Both are absent today, not wrong; this document keeps the plan quiet and proposes terracotta edge lines for the 3D pick.
- **P6 · The section's connectors are terracotta.** `section-view.ts` draws stairs, lanes, shafts and stops in `--accent`; proposed `--plan-connector` so only the active level is terracotta. A Tailwind class change (the plan variables are not Tailwind colours today: add `--color-plan-connector` to the `@theme inline` block, or set the attribute from the variable).
- **P7 · The underlay is not a DXF.** Craft's role text for `--plan-underlay` says "DXF / reference underlay"; the code's underlay is the reference level (below/above), and a DXF import makes real entities. Fix the wording in `01-brand.md`'s palette table and `05-implementation.md`; the variable and value stay.
- **P8 · Offscreen renders use system fonts.** `LIGHT_THEME` / `DARK_THEME` carry `fontSans: 'system-ui, sans-serif'` and `fontMono: 'ui-monospace, monospace'`; thumbnails, snapshots and `export.image` use those constants, not the document's variables, so they will not be in Alegreya Sans and IBM Plex Mono unless the constants name the bundled families and the fonts are loaded (`document.fonts.load`) before the draw. The theme test pins the colours only; extend it to the font strings.
- **P9 · Thumbnail resolution.** 480 × 360 at dpr 1 is soft on a HiDPI Home (a 340 px card at 2×); proposed 960 × 720 with 48 px padding. The stored PNG grows about 3×, still tens of kB for a plan.
- **P10 · Item names at 10 px.** `--muted` `#7b7064` on paper is 4.4:1; at 10 px Sans that is under the 4.5:1 line. Proposed 11 px (the same threshold of 48 px of item). The `shares its space` warning is 10 px Mono in ochre (`#b8841f`, 2.9:1 on paper): it is an exception flag next to a 12 px name, acceptable, but a 11 px size would help it too.
- **P11 · Slab versus grid.** `--plan-slab` `#e9e1d2` and `--plan-grid` `#ebe4d7` are one step apart: the slab hides the minor grid under the footprint, which is the intent, but the slab's own edge against the paper is faint (ΔL ≈ 5). It reads in the mock; if a sharper footprint is wanted, the exports already stroke the slab with `PEN.fine`, and the canvas could add a 1 px `--plan-slab` darkened line. Not changed here.
- **P12 · DXF room and dimension indices.** `DXF_COLORS` has `room: 5` (pure blue) and `dim: 4` (cyan), the old palette's reading; see the ACI table in (e). CAD users who expect dimensions in cyan will find them indigo-ish (165); the layer prefix option still lets them remap.
- **P13 · Default light colour.** The schema's light `color` defaults to `#ffffff`; at night the view then lights plaster in a neutral white. A warm default (`#ffe9c9`) in the Light tool's options is proposed; existing documents keep their values.
- **P14 · The night smoke pixel checks** (`decor-agent-ui.ts`, `59-snapshot-3d-night.png`) and every plan pixel check that reads a wall, a room wash, a selection or a snap mark colour (`canvasPixel`) compare against the current hex values and will need the new ones; `05-implementation.md` lists them.
