# Concept 4 · Playful — "Cubby"

The sheet from `docs/identity/01-ux-study.md`, answered for the playful mood. The visuals are in `concept.html` (open it in a browser; fonts load from Google Fonts for the preview only) and `icon.svg`. Every hex value below is the one `concept.html` uses.

## (a) The story

You open it and it does not look like software you have to learn; it looks like the first page of planning a place you will live in. Cream paper, a coral tile with a little house on it, a wordmark that says *cubby* like a nickname. Your projects are cards with your own floors on them, not initials on gradients. Inside, the tool is dense and exact: three panels, millimetres everywhere, a warnings tab, a DXF import. But the exactness is warm: numbers sit in a friendly mono, the selected room glows teal over a peach fill, the dimension you just pulled reads in blueberry, and if you don't know where to start, an empty floor says so in one line and offers a pencil, a file, or Cub, the assistant, who will sketch a start from a sentence. Dark mode is the same room with the lights down: warm charcoal, not black. The feeling is a well-made home-and-garden app that happens to be as precise as CAD; never a toy.

## (b) Names

All three are invented or re-purposed words, not descriptions.

| Name | Rationale | Quick collision check (web search, 31 Oct 2026) |
|---|---|---|
| **Cubby** (lead) | A cubby is a small snug space of your own, and a *cubby house* is the first house anyone builds. Two syllables, round letters (c u b b y) that match the icon's radii, easy to say, easy to type, `.cubby` as a file extension, `cubby://` as a scheme. The assistant becomes **Cub**. | No floor-plan or home-design app of that name found. LogMeIn's "Cubby" file-sync service was discontinued in 2016 (cubby.com is almost certainly still held by GoTo, so expect `cubbyapp.*` / `getcubby.*` rather than the bare domain). App-store and npm spellings should be checked by hand before committing. |
| **Snuggery** | A real but rare English word for a cosy room. Unmistakably playful, zero ambiguity about who it is for; the longest of the three, and the one most likely to be read as twee by the engineering half of the audience. | No app, company or product of that name found; searches surface only "Snug"-prefixed apps (Snug Safety, Snugsy, Snuggy). Domains look free. |
| **Doma** | "At home" in Czech, Slovak and Polish; short and warm, a good wordmark. | Collides: Doma (doma.com, formerly States Title) is a US real-estate title-insurance company, home-adjacent and well indexed. Keep as a fallback only if the owner wants a non-English word. |

The rest of this sheet uses **Cubby**.

## (c) Wordmark

`cubby` in Rubik ExtraBold (800), lowercase, letter-spacing −3.5 %, set in the foreground ink (`--fg`) beside the mark: `[tile] cubby`. The lowercase bowls of c, u, b, b, y repeat the rounded square and the round window of the icon, so the mark and the word read as one object. One decorated form, teal `cubby` with a coral full stop (`cubby.`), is reserved for About and the first-launch screen; it never appears in the chrome. Title bar: the 22 px tile + the wordmark at 17 px / 800. There is no monogram "C"; the tile *is* the small mark.

## (d) Type

Both faces are OFL and variable, so they bundle as one file each under the `font-src 'self'` CSP.

- **Sans: Rubik** (Hubert & Fischer, OFL, variable wght 300–900). Slightly rounded corners carry the mood at 13 px without being bubbly; wide counters stay legible in the status bar and panel labels; tabular figures via `tnum` when a number has to sit in running text.
- **Mono: Spline Sans Mono** (Eben Sorkin, Mirko Velimirović, OFL, variable wght 300–700). Same soft terminals as Rubik, strict mono grid, slashed zero, tabular by nature; reads as *exact* for elevations, lengths, areas, coordinates, scales and command ids.

| Role | Face | Size / weight | Where |
|---|---|---|---|
| Display | Rubik | 26 px / 700, −2 % | "Projects" heading |
| Heading | Rubik | 19 px / 700, −1.5 % | Project name in the header, empty-state titles (22 px) |
| Title | Rubik | 15.5 px / 600 | Card names, panel titles ("Room", "Dimension") |
| Control | Rubik | 14.5 px / 500 | Buttons, tabs, selects, level rows (15 px) |
| **Body** | Rubik | **13 px / 400**, line-height 1.45 | Help text, descriptions, chat |
| **Label** | Rubik | **11 px / 600**, caps, +9 % tracking, `--muted` | LEVELS, LAYERS · GROUND FLOOR, FINISHES, layer kinds |
| Hint | Rubik | 12.5 px / 400, `--muted` | 3D hints, opacity captions |
| Readout | Spline Sans Mono | 15 px / 500 | Inputs holding a length (`3000 mm`) |
| Value | Spline Sans Mono | 13 px / 400 | Area / perimeter, status bar, canvas footer |
| Canvas | Spline Sans Mono | 13 px / 500, `--plan-dim` | Dimension text; room areas at 12.5–13 px in `--muted` |
| Id / key cap | Spline Sans Mono | 12 px / 11 px | Command ids in the palette, `Ctrl K` |

Icons stay Lucide at 1.75 px stroke (2 px for the plus and the close), 18–19 px in the strip; radii are 12 px on buttons, inputs and level rows, 16 px on cards and the level editor, 999 px on chips and the command search. Round, not bubbly.

## (e) Palette

Three real colours, used with discipline: **teal** is what you do (accent, selection, active tab, sliders, primary buttons), **coral** is the home (room fills, Home cards, illustrations, the assistant), **blueberry** is the number (dimensions). Light is cream, dark is warm charcoal. `--titlebar` and `--titlebar-fg` are plain `#rrggbb`.

### Light (`:root`)

| Variable | Hex | Note |
|---|---|---|
| `--canvas` | `#fbf7f1` | cream paper |
| `--surface` | `#f3ece2` | panels, title bar |
| `--elevated` | `#e9dfd1` | key caps, tags, hover |
| `--fg` | `#2b2320` | warm ink |
| `--muted` | `#7c6f66` | |
| `--edge` | `#e2d8c9` | |
| `--accent` | `#0f8a7e` | teal; 4.2:1 on white text |
| `--accent-hover` | `#0b6f66` | |
| `--accent-fg` | `#ffffff` | |
| `--danger` | `#d4372e` | |
| `--success` | `#2f9a47` | |
| `--warning` | `#d9930c` | amber |
| `--titlebar` | `#f3ece2` | |
| `--titlebar-fg` | `#2b2320` | |
| `--plan-grid` | `#efe6d9` | |
| `--plan-grid-major` | `#e0d4c3` | |
| `--plan-wall` | `#4a3f38` | warm dark fill |
| `--plan-wall-line` | `#2b2320` | |
| `--plan-room` | `#f07a4a` | coral; peach at the canvas alpha |
| `--plan-slab` | `#f1eadf` | |
| `--plan-dim` | `#5b5fd8` | blueberry |
| `--plan-underlay` | `#b5a898` | |
| `--plan-snap` | `#6cb41e` | leaf |
| `--plan-selection` | `#0f8a7e` | = accent |
| `--plan-warning` | `#d9930c` | = warning |
| `--plan-connector` | `#3d342f` | |
| `--plan-decor` | `#a0623b` | warm wood |
| `--scene-edge` | `#4a3f38` | |
| `--scene-wall` | `#f4ece0` | |
| `--scene-slab` | `#cdbfae` | |
| `--scene-column` | `#e4d8c7` | |
| `--scene-glass` | `#8fd0c7` | teal-tinted |
| `--scene-connector` | `#e8cfae` | |
| `--scene-rail` | `#5e5048` | |
| `--scene-car` | `#0f8a7e` | |
| `--scene-stand-in` | `#b5a898` | |

### Dark (`.dark`)

| Variable | Hex | Note |
|---|---|---|
| `--canvas` | `#221c1b` | warm charcoal, not black |
| `--surface` | `#2a2322` | |
| `--elevated` | `#352c2a` | |
| `--fg` | `#f3eae1` | |
| `--muted` | `#a99b91` | |
| `--edge` | `#3e3432` | |
| `--accent` | `#3fc9b9` | |
| `--accent-hover` | `#66d8ca` | |
| `--accent-fg` | `#14211f` | |
| `--danger` | `#f27a6a` | |
| `--success` | `#6fd088` | |
| `--warning` | `#f2b438` | |
| `--titlebar` | `#2a2322` | |
| `--titlebar-fg` | `#f3eae1` | |
| `--plan-grid` | `#2b2423` | |
| `--plan-grid-major` | `#3a302e` | |
| `--plan-wall` | `#d9ccbf` | |
| `--plan-wall-line` | `#f6efe7` | |
| `--plan-room` | `#f58c5e` | terracotta at the canvas alpha |
| `--plan-slab` | `#2d2625` | |
| `--plan-dim` | `#9095f7` | |
| `--plan-underlay` | `#7d716a` | |
| `--plan-snap` | `#8fd63c` | |
| `--plan-selection` | `#3fc9b9` | |
| `--plan-warning` | `#f2b438` | |
| `--plan-connector` | `#e3d8cc` | |
| `--plan-decor` | `#d9a071` | |
| `--scene-edge` | `#171211` | |
| `--scene-wall` | `#c9b9a9` | |
| `--scene-slab` | `#7a6a5c` | |
| `--scene-column` | `#a89684` | |
| `--scene-glass` | `#4fb0a4` | |
| `--scene-connector` | `#b0937a` | |
| `--scene-rail` | `#e3d8cc` | |
| `--scene-car` | `#3fc9b9` | |
| `--scene-stand-in` | `#6a5e55` | |

**Staying distinguishable on the canvas.** The five hues that can meet on a plan sit at five well-separated angles: teal selection ≈ 174°, coral room ≈ 18°, blueberry dimension ≈ 238°, leaf snap ≈ 88°, amber warning ≈ 40°; coral and amber are the closest pair, but coral only ever appears as a translucent *fill* and amber only as a saturated *stroke or badge*, so they never play the same role. Selection and dimension are both strokes but 64° apart and the dimension always carries a mono label; snap is a small bright green glyph that nothing else uses; the decor brown and the dark wall fill are desaturated so they sit under everything. Danger red lives in the chrome only (Trash), where the accent is teal, so a red button is never next to an orange one.

Extras the identity needs beyond `styles.css` (proposed as two new variables, not raw values): `--brand-coral` (= `--plan-room`) and `--brand-berry` (= `--plan-dim`), used by the Home doodles, the empty-state illustrations and Cub's mark. In core, `SOLID_COLORS` and `LIGHT_SCENE_THEME` follow the `--scene-*` table above; `snapshot-theme.test.ts` pins them.

## (f) The assistant

Named **Cub**: a nickname from the product name, short enough for a tab. Mark: a coral round with the icon's door and round window in cream, 16–20 px, drawn by one inline SVG. Colour: coral, the home's colour, so the assistant reads as part of the house you are making rather than as a foreign "AI" violet. Presence: quiet until asked. The right-panel tab says `● Cub`; the chat header says `Cub · Claude Opus 5.5` so the model is never hidden; Cub's edits appear in History with the same round mark as author; a permission request is a card with a coral shield and two plain buttons (Allow / Not this time). No sparkles, no persona copy beyond its name; the three places Cub speaks first are the empty canvas ("Ask Cub"), the first launch, and the command palette's `assistant.*` group.

## (g) App icon

A cream house with a chimney and one soft puff on a coral tile, a teal door with a round-topped head and a teal round window in the gable. It is the only house silhouette in the identity (everything else is a plan), chosen because the dock, the taskbar and the Store are where the app has to say *home* in a glance; the teal door ties the tile to the accent inside. `icon.svg` is the macOS framing (tile 64–960, rx 200, system margin outside); for Windows the renderer uses the same art with a 32 px pad and rx 120 (`concept.html` shows both). At 128 px every element survives; at 32 px the puff and knob are gone and the house, door and window remain; at 16 px it reads as a coral tile with a cream house and one teal dot, which is still distinct from every blue, white and black icon in a tray. No text anywhere, so nothing to outline.

## (h) Home cards and the three empty moments

**Home cards.** A card with a thumbnail shows the ground floor on cream in the plan colours (peach rooms, warm walls, wood-brown furniture), exactly as the canvas draws it, so the library looks like a shelf of your floors. A card without one gets a *doodle*: a rounded plan outline with a door swing, a sofa and a round table in one of the three colours over a 10 % tint of it, with the project's initials in a round badge of the same colour; the colour is picked by name hash from coral / teal / blueberry only, never a random gradient. Tags are rounded pills in `--elevated`; the selected card has a 2 px teal outline; the New project button is the only solid teal on the screen.

**First launch (empty library).** An illustration of a small house in section, its three rooms tinted coral, teal and blueberry, a door swing, a sofa, and a blueberry dimension under it reading `12 000 mm`; headline "Your first home starts here"; one line of copy naming the three ways in (draw, trace a DXF, ask Cub); New project and Import….

**New empty project.** The canvas keeps its grid. Centred: a plan doodle being drawn by a teal pencil, a `? mm` dimension waiting, Cub's mark in the corner; headline "A blank floor. Nice."; copy "Draw the outside walls with **W**, or trace a DXF of the place you already have. Cub can sketch a starting plan from a sentence."; three buttons: Draw a wall (teal), Trace a DXF…, Ask Cub. The footer reads `0 mm, 0 mm · Ground floor · Nothing drawn yet · W wall · N door · R room`. The Properties panel says "Nothing selected" with one sentence.

**About.** The 96 px tile, `cubby.` in teal with the coral stop, version and build in mono, one sentence ("Plans, interiors and decor for the home you live in, with an assistant that measures twice."), three dots in the three colours, Licences and Check for updates. Dark About keeps the warm charcoal.

## Files

- `README.md` — this sheet
- `icon.svg` — 1024 × 1024 app icon, self-contained
- `concept.html` — wordmark and icon at 1024/128/32/16 px, type specimen, both palettes, mocks at 1890 × 1020 (Home light and dark, plan view light and dark, empty project), the 3D view in both themes, first launch and About
