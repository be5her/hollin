# Concept 3 · AI-native: **Nolli** & Otto

Files: `README.md` (this sheet), `icon.svg` (1024 × 1024), `concept.html` (wordmark, type, palettes, 3D view, Otto's presence, and the five mocks at 1890 × 1020; open it in a browser, it loads Manrope and JetBrains Mono from Google Fonts for the preview only).

## (a) The story

You open Nolli for the first time and it does not look like a tool you have to learn. It looks like a clean sheet of ink-grey graph paper with a short note on it: draw a wall, trace a drawing you already have, or tell Otto what the place is. Otto is the other author in the room. It draws in its own colour, plum, so you can always see which walls are yours and which it added; it asks before it deletes anything; its edits sit on your undo stack with its name on them, and when it has looked at the building in 3D, the picture it saw is right there in the conversation. Nothing glows, nothing sparkles, nothing pretends to be magic. It feels like working with a careful collaborator who knows millimetres and never moves your things without saying so, and the plan, the thing you actually care about, is always the biggest thing on the screen.

## (b) Names

| Name | Rationale | Quick collision check (web search, 31 Oct 2026) |
|---|---|---|
| **Nolli** (recommended) | After Giambattista Nolli's 1748 map of Rome, the first figure-ground plan: built space in ink, open space left white, exactly what a floor plan is. Two syllables, friendly, says nothing literal, and the double **l** sets two walls in the wordmark. | One paid iOS app "Nolli" that shows the Rome map itself (a different category); a Belgian student app "Nodli" with a different spelling. No design or home software found. `nolli.app`, `.psp` → `.nolli` and an MCP name `nolli` are unproblematic; the appId would be `app.nolli.desktop`. |
| **Bothy** | A one-room shelter you can walk into and make yours; hides "both" (you and Otto) in plain sight. Cosy, short, pronounceable. | No app, software or startup under that name found in the search; the word is a common Scottish noun, so trademark strength is lower. The "bot" inside the name cuts both ways for an AI product. |
| **Aedis** | From Latin *aedes*, a house; reads as a made-up word to everyone else. Calm, slightly formal, looks good in capitals on an installer. | No exact match found (near misses: Aedion, AESIS, myAEDES, none in this field). Harder to pronounce at first sight (EE-dis). |

The assistant is **Otto**: a palindrome, four letters that look like two rooms and two posts, a builder's name rather than a chatbot's, and easy to say in a sentence ("ask Otto", "Otto drew that"). It is an in-app name, not a product mark, so the Otto retailer and robots are no concern. The model name (Claude Opus, or the user's Claude Code) stays visible under it in the panel header, as today.

## (c) Wordmark

`nolli`, lowercase, Manrope 800, letter-spacing −0.045 em, in `--fg`. The only colour is the tittle of the **i**, drawn as a plum dot (`--ai`) slightly larger than the font's own: Otto's dot, the same dot that sits on the last corner of the plum room in the icon. In the title bar the lockup is the 22 px icon tile plus the wordmark at 18 px; on dark surfaces the dot uses the dark-theme plum. The dotless base is set as `ı` (U+0131) with the dot positioned by CSS, so the wordmark is live text everywhere; for exports it is outlined.

## (d) Type

Both fonts are OFL and ship as one variable file each (Manrope ≈ 70 KB, JetBrains Mono ≈ 50 KB per style); they load from `font-src 'self'`.

- **Manrope** (sans, variable 200–800): all reading text. Slightly geometric bowls that match the plan's right angles, a tall x-height that survives 11 px, and tabular figures (`tnum`) when numbers must sit in the sans.
- **JetBrains Mono** (mono, variable 100–800): every number and unit, coordinates, scales, command ids, key caps. Its figures are tall and open, the zero is slashed, and it was drawn for 11–13 px.

| Role | Face | Size / line | Weight, tracking |
|---|---|---|---|
| Home title ("Projects") | Manrope | 24 / 30 | 800, −0.02 em |
| Panel / dialog title ("Room", "Otto") | Manrope | 16 / 22 | 800, −0.01 em |
| Project name in the header | Manrope | 17 / 22 | 800, −0.02 em |
| Body, list rows, chat | Manrope | 13 / 18 | 500 (strong: 700) |
| Section label (LEVELS, LAYERS) | Manrope | 11 / 14 | 700, +0.06 em, caps |
| Field label | Manrope | 11 / 14 | 600 |
| Value in a field | JetBrains Mono | 13 / 18 | 500, `tnum` |
| Numbers in lists (elevations) | JetBrains Mono | 12.5 / 16 | 500 |
| Canvas labels, status bar, coordinates | JetBrains Mono | 11 / 14 | 500 |
| Command ids in tool cards and the palette | JetBrains Mono | 11 / 14 | 500, `--muted` |
| Key caps | JetBrains Mono | 11 / 16 | 600 |

Icons stay Lucide at 1.75 px stroke (18 px in chrome, 16 px in cards).

## (e) Palette

Surfaces are cool graphite rather than warm paper, so the plan reads as ink on a screen; the dark theme is a deep slate designed on its own, not an inversion. One accent, ink blue, belongs to you: buttons, selection, dimensions, links. One colour, plum, belongs to Otto and to nothing else. Five variables are new: `--ai`, `--ai-hover`, `--ai-fg`, `--ai-tint` (the fill behind Otto's cards and rows) and `--plan-ai` (Otto's halo and nodes on the canvas; `#rrggbb` because the canvas applies alpha in code, like the other `--plan-*`). `--titlebar` and `--titlebar-fg` stay `#rrggbb`.

### Light (`:root`)

| Variable | Hex | | Variable | Hex |
|---|---|---|---|---|
| `--canvas` | `#f5f6f8` | | `--plan-grid` | `#e8eaef` |
| `--surface` | `#eceef2` | | `--plan-grid-major` | `#d7dae1` |
| `--elevated` | `#e1e4ea` | | `--plan-wall` | `#3f444e` |
| `--fg` | `#171a21` | | `--plan-wall-line` | `#171a21` |
| `--muted` | `#5f6676` | | `--plan-room` | `#5b7fc6` |
| `--edge` | `#d4d8df` | | `--plan-slab` | `#e3e5ea` |
| `--accent` | `#2457d5` | | `--plan-dim` | `#2457d5` |
| `--accent-hover` | `#1c47b3` | | `--plan-underlay` | `#9aa0ab` |
| `--accent-fg` | `#ffffff` | | `--plan-snap` | `#1e8a56` |
| `--danger` | `#cf3b3b` | | `--plan-selection` | `#2457d5` |
| `--success` | `#1e8a56` | | `--plan-warning` | `#b8771a` |
| `--warning` | `#b8771a` | | `--plan-connector` | `#2f343d` |
| `--titlebar` | `#eceef2` | | `--plan-decor` | `#8c6a44` |
| `--titlebar-fg` | `#171a21` | | `--plan-ai` (new) | `#a0338e` |
| `--ai` (new) | `#a0338e` | | `--scene-edge` | `#363a44` |
| `--ai-hover` (new) | `#86277a` | | `--scene-wall` | `#ebe9e3` |
| `--ai-fg` (new) | `#ffffff` | | `--scene-slab` | `#c8c6c0` |
| `--ai-tint` (new) | `#f6e8f3` | | `--scene-column` | `#dcd9d1` |
| | | | `--scene-glass` | `#8db6de` |
| | | | `--scene-connector` | `#d9d1c3` |
| | | | `--scene-rail` | `#585c66` |
| | | | `--scene-car` | `#2457d5` |
| | | | `--scene-stand-in` | `#9c9c9c` |

### Dark (`.dark`)

| Variable | Hex | | Variable | Hex |
|---|---|---|---|---|
| `--canvas` | `#14171f` | | `--plan-grid` | `#1c2029` |
| `--surface` | `#1b1f28` | | `--plan-grid-major` | `#272c37` |
| `--elevated` | `#262b36` | | `--plan-wall` | `#c4c8d2` |
| `--fg` | `#e6e8ee` | | `--plan-wall-line` | `#f2f3f7` |
| `--muted` | `#969dac` | | `--plan-room` | `#6d9bff` |
| `--edge` | `#2e3340` | | `--plan-slab` | `#1f242e` |
| `--accent` | `#6d9bff` | | `--plan-dim` | `#6d9bff` |
| `--accent-hover` | `#8db1ff` | | `--plan-underlay` | `#646b7a` |
| `--accent-fg` | `#0d1119` | | `--plan-snap` | `#4fd08a` |
| `--danger` | `#f27a7a` | | `--plan-selection` | `#6d9bff` |
| `--success` | `#4fd08a` | | `--plan-warning` | `#f0b84c` |
| `--warning` | `#f0b84c` | | `--plan-connector` | `#d2d6e0` |
| `--titlebar` | `#1b1f28` | | `--plan-decor` | `#d4ad7e` |
| `--titlebar-fg` | `#e6e8ee` | | `--plan-ai` (new) | `#e07ad0` |
| `--ai` (new) | `#e07ad0` | | `--scene-edge` | `#0f1117` |
| `--ai-hover` (new) | `#ea98dc` | | `--scene-wall` | `#b8b6b0` |
| `--ai-fg` (new) | `#1a0d18` | | `--scene-slab` | `#6b6a66` |
| `--ai-tint` (new) | `#2b1f2a` | | `--scene-column` | `#a19e96` |
| | | | `--scene-glass` | `#5b8fc6` |
| | | | `--scene-connector` | `#a29a8c` |
| | | | `--scene-rail` | `#d2d6e0` |
| | | | `--scene-car` | `#6d9bff` |
| | | | `--scene-stand-in` | `#5b5b5a` |

**Staying apart on the canvas.** Selection and dimensions share the saturated ink blue, while rooms fill with a softer slate blue at low alpha, so a selected room still shows its outline; Otto's plum is the only magenta-family colour in the app, so a plum halo is never read as a selection (blue), a snap (green), a rule warning (amber), a decor outline (umber) or a danger (red); in the dark theme plum lightens to orchid, blue to cornflower and walls to light grey, keeping the same distances on the wheel, so the five stay separable by night as by day. The 3D palette keeps warm-grey solids with ink edges on both canvases (`SOLID_COLORS` and `LIGHT_SCENE_THEME` in core change with it; `snapshot-theme.test.ts` pins them).

## (f) How Otto is present

Otto is a named collaborator with a mark, a colour and a voice, not a chat window. The rule that keeps it from becoming a gimmick: **plum never asks you to click it**. Buttons that decide something (Allow, Keep it, Send, Draft it on the Home composer) are yours and ink blue (the composer's single "Draft it" is the one plum button, because it starts Otto's work rather than approving it). Plum only tells you where Otto has been or is.

- **Mark.** A plum rounded tile with Otto's room on it: a white outlined square with the pen (a dot) on its top-right corner, the same figure as the plum room in the app icon. Drawn at 28 px (panel header), 24, 20 and 16 px (History rows, card corners). No face, no sparkle.
- **Chat panel.** Header: mark, "Otto", and under it the model and the standing rule ("Claude Opus 5.5 · asks before deleting"). Your messages are bubbles in `--elevated`; Otto's are plain text. Every tool call is a card with a 3 px plum left edge, the human title first, the command id in mono on the right, a second line with level, layer and "undoable, by Otto"; a green check when it ran, an amber shield when it waits for your yes (with Allow / Keep it), a camera when it took a snapshot, and the snapshot image inline so you see what Otto saw. The input says "Ask Otto…" and the hint under it says where edits land: on your undo stack, signed.
- **Canvas.** What Otto changed in the last minute carries a plum halo (`--plan-ai` at 22 % alpha, 34 px wide), end nodes, and a tag ("Otto · 3 m wall · now") on a short leader; it fades after a minute or on the next edit of yours. Selection stays ink blue and can coexist with it, as the mock shows on the kitchen. A pending destructive call draws its target with a dashed plum outline until you answer.
- **History.** Entries by Otto are tinted with `--ai-tint`, signed "Otto · layer · command id", and carry the 16 px mark where your entries have a neutral dot. An entry waiting for your yes is shown greyed at the bottom. Undo treats them like any of yours.
- **Status bar.** A plum dot next to a short state, "Otto · ready", "Otto · adding a 3 m wall…", "Otto · waiting for your yes", between the units and the MCP indicator, so you know what it is doing without opening the panel. Outside agents over MCP get no colour of their own: they appear in History as "MCP · <client>" with the neutral dot, because the identity is about the collaborator you talk to.

## (g) App icon

`icon.svg`: a flat ink tile (`#171a21`, radius 228) with two rooms on it. Your room is the finished white outline on the left; Otto's room is the plum outline on the right, three walls drawn and the pen, a dot, still on the last corner. Walls are 80 px strokes with butt caps, like the plan's own walls. The artwork sits in the central 70 % so the tile can be inset with the system margin for macOS (the mock shows that framing on the light dock) or used edge to edge on Windows and Linux. The tile is the same on both themes, so it sits on a light or dark dock alike.

At 16 px it becomes two boxes, one white and one plum, on a dark square; the pen dot melts into the corner but the two-author idea survives, and nothing else in a taskbar looks like it. At 32 px the dot returns; at 128 px and up the walls read as a plan. `concept.html` shows 1024, 128, 64, 32 and 16 px side by side, and the two dock framings.

## (h) Home cards and the three empty moments

- **Home cards.** Thumbnails are the ground floor on the canvas colour with the grid, as today, but drawn with this palette (ink walls, slate rooms, and Otto's halo on anything it touched recently). A project without a thumbnail gets a quiet `--elevated` plate with its initials in `--muted`, no gradients. Each card's corner shows who has worked on it: your initial, and Otto's 14 px mark when it has. The first slot of the grid is a composer card on `--ai-tint`: "Start with Otto", a sentence to describe the place, and the rule written on it: "Otto asks before it deletes anything".
- **First launch (empty library).** The composer card alone, wider, with the wordmark above it and the same three ways to begin as the empty project; no sample projects, no tour.
- **New empty project.** A card over the empty grid: "An empty ground floor", three key caps (W wall, R room, Ctrl K any command), two ink buttons (Draw a wall, Import a DXF to trace), and a plum-tinted line with a suggestion phrased as a sentence you can edit ("Or tell Otto: 'a 5 by 7 m studio with a bathroom in the corner'"). It leaves as soon as the first wall lands. The Properties panel says "Nothing selected" and where you are.
- **About.** The lockup, the version, and one line of credit in two colours: "nolli" in ink and "with Otto" in plum, then the licences (fonts, Lucide, three, Electron). The Otto line is where the model name and the provider (Claude API or your own Claude Code) are stated, next to the rule it keeps.

## What a build would touch

`branding.json` (names), `styles.css` (the two tables above plus the five new variables), `SOLID_COLORS` / `LIGHT_SCENE_THEME` in core, the two bundled fonts, `resources/icon.svg`, the Home card component, the assistant panel (header, tool-call cards, input hint), the plan canvas (halo and tag for the last assistant edits, read from the undo stack's author), History rows, the status bar, and the three empty states. Nothing in the layout moves.
