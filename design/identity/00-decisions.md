# The identity: decisions (combined concept, 31 Oct 2026)

The owner chose to combine **Concept 1 · Craft ("Hollin")** and **Concept 3 · AI-native ("Nolli" & Otto)**. This file is the synthesis every detail document in `design/identity/` builds on. Where it is silent, Concept 1's sheet (`design/concepts/1-craft/README.md`) decides the look and Concept 3's sheet (`design/concepts/3-ai-native/README.md`) decides how the assistant is present. Where the two conflict, this file wins.

## 1. The idea in one paragraph

A clean sheet on a desk, drawn by two authors. The paper, the ink walls, the graphite, the one terracotta mark, the serif that speaks only in headings, the typewriter numbers: all of Craft. On that sheet works **Otto**, the assistant: a named collaborator with its own ink colour, who draws in your drawing, signs its work in History, asks before it deletes, and never asks you to click its colour. The feeling: making something with your hands, with a careful colleague who knows millimetres.

## 2. Name

- **The name is Hollin** (wordmark `Hollin.` with the terracotta full stop), confirmed by the owner on 31 Oct 2026 and applied to `branding.json` after the milestone's review. Penrow and Bothy were the alternates. The documents written before that day still say "working name".
- **The assistant is Otto.** An in-app name, not a product mark. The model and provider stay visible under it (`Claude Opus 5.5`, or "your Claude Code").
- Outside agents over MCP are not Otto: they are neutral ("MCP · Claude Code", "MCP · Cursor") in History and the call log.

## 3. Look (from Craft, unchanged)

- **Palette:** the full light and dark tables in Concept 1 §e, every `--*`, `--plan-*` and `--scene-*` variable. Light is warm paper (`#f6f1e8`), dark is the desk under the lamp (`#1d1a17`). Terracotta `#b9552f` / `#e07c50` is the accent and the selection colour. Dimensions indigo, snap moss, warning ochre, room wash sage at ~18 % alpha, decor umber.
- **Type:** Alegreya Sans (body 13/18, labels 11/14, italic for times and states), IBM Plex Mono (every number, unit, id, coordinate, key cap), Fraunces (wordmark, panel and dialog titles, Home and empty-moment headings only). All three bundled as variable OFL files.
- **Icons:** Lucide at 18 px, **1.6 px stroke** (16 px in cards and rows).
- **Radii:** controls 6 px, cards and panels 8 px, chips, badges and key caps 4 px, dialogs and the palette 10 px, the app icon tile 22 % of its side.
- **Edges, not shadows:** 1 px `--edge` borders; a dialog or popover gets one soft shadow at most (`0 8px 24px` of ink at 12 %).
- **Home cards:** paper cards; a thumbnail is the ground floor in the plan colours on paper; a project without one gets a stable tinted sheet (straw, sage, clay, slate) with a pencil doodle and its initials in Fraunces Italic. No gradients.
- **The three empty moments** (first launch, new empty project, About) are Concept 1 §h, with Otto's line added (§5 below).

## 4. Otto's colour (new, decided here)

Concept 3's plum moves into the paper palette as **mulberry ink**: the only magenta-family colour in the app, well apart from terracotta (17°), ochre (42°), sage (85°), moss (140°) and indigo (228°). Five variables are added to `styles.css`, `#rrggbb` like the others (`--plan-ai` is read by the canvas, which applies alpha in code).

| Variable | Light | Dark | Role |
|---|---|---|---|
| `--ai` | `#8a3f6f` | `#d892bd` | Otto's mark, rules, tags, text accents |
| `--ai-hover` | `#733259` | `#e3a9cb` | The one Otto button (the Home composer's "Draft it") pressed |
| `--ai-fg` | `#fbf6ee` | `#1d1a17` | Text on `--ai` |
| `--ai-tint` | `#f1e3ea` | `#332631` | Fill behind Otto's History rows, cards and the composer |
| `--plan-ai` | `#8a3f6f` | `#d892bd` | The halo, end nodes, tag and pending dashed outline on the canvas |

These values are fixed. A detail document that finds a contrast problem reports it rather than changing them.

## 5. How Otto is present (from AI-native, restyled)

The rule: **mulberry never asks you to click it.** Every deciding button (Allow, Keep it, Send, New project) is yours, terracotta or paper. Mulberry only shows where Otto has been or is. The one exception is the Home composer's "Draft it", which starts Otto's work.

- **Mark:** a mulberry rounded tile with Otto's room on it: a paper-coloured outlined square with the pen (a dot) still on its top-right corner. 28, 24, 20 and 16 px. No face, no sparkle. It replaces Concept 1's pencil icon in the panel header; the pencil stays as the *verb* ("describe the room and let Otto draw it") in hints.
- **Chat panel:** header with the mark, "Otto", and the model plus the standing rule under it ("Claude Opus 5.5 · asks before deleting"). Your messages on the elevated paper tint, right-aligned; Otto's plain paragraphs with a 2 px mulberry rule on the left (a margin note). Tool calls are paper cards with a 3 px mulberry left edge: human title, command id in mono, level · layer · "undoable, by Otto"; a moss check when done, an ochre shield when waiting (Allow / Keep it), a camera and the inline image when it took a snapshot, a danger line when it failed. Input: "Ask Otto…"; the hint under it: "Edits land on your undo stack, signed Otto."
- **Canvas:** what Otto changed in the last minute carries a mulberry halo (`--plan-ai` at ~22 % alpha, ~34 px wide), end nodes and a tag on a short leader ("Otto · 3 m wall · now"); it fades after a minute or on your next edit. Terracotta selection can coexist with it. A pending destructive call draws its target with a dashed mulberry outline until you answer.
- **History:** Otto's entries on `--ai-tint`, signed "Otto · layer · command id", with the 16 px mark where yours have a neutral graphite dot. A waiting entry is greyed at the bottom. Undo treats them like yours.
- **Status bar:** a mulberry dot and a short state between the units and MCP: "Otto · ready", "Otto · adding a 3 m wall…", "Otto · waiting for your yes".
- **Home:** the first slot is a composer card on `--ai-tint`: "Start with Otto", a sentence to describe the place, the rule "Otto asks before it deletes anything", the one mulberry button "Draft it". Cards whose project Otto has worked on show its 14 px mark in the corner.
- **Empty project:** Concept 1's sketch and "Draw the first wall." plus the mulberry-tinted line with an editable sentence: "Or tell Otto: 'a 5 by 7 m studio with a bathroom in the corner'".
- **About:** Concept 1's About plus one credit line in two colours: "Hollin" in ink, "with Otto" in mulberry, then the model and provider and the rule it keeps.

## 6. App icon: B, two rooms (decided 31 Oct 2026)

`icon-b.svg`: a paper tile with a hairline edge; your room finished in ink on the left with its terracotta door swing, Otto's room on the right with three walls in mulberry and the pen dot still on the last corner. The two-author story in the icon. The owner chose it over A (one room) after seeing both, knowing that at 16 and 32 px the terracotta thins out and the icon reads as two boxes, one ink and one mulberry: that is acceptable, it is still unlike anything else in a dock. The build renders it through `npm run icon`; if the 16 px rendering loses the mulberry room, the build may thicken the strokes in the master so both rooms survive, without changing the idea. `icon-a.svg` stays in the folder as a record only.

## 6a. Resolved after the detail round

- The right-panel tab is **Otto**, with the 16 px mark, not "Assistant".
- Field labels are **12/16**; captions, meta and section caps stay 11/14 (Alegreya Sans reads a size small).
- The 3D night background is a constant warm near-black `#0f0d0b` in both themes.
- PDF and SVG sheets carry the 90 × 24 mm title block (`04-canvas.md` §e): wordmark, project name, level, scale, date.
- History is newest-first: a call waiting for the user's yes sits greyed at the **top** (corrects §5).
- On `--ai-tint`, meta text uses `--fg` at 70 %, never `--muted` (3.9:1 in light). No graphite body text on `--elevated` in light (3.7:1).
- Otto's tint being near-invisible against the surface in light is accepted: Otto's rows and cards are identified by the mark and the 3 px mulberry edge.
- The room wash is 0.18 alpha on the canvas and in exports.
- The name stays **Hollin (working)** until the owner's own domain, store and trademark check.
- The wordmark is **live text in the bundled Fraunces**, not outlined paths (accepted at the milestone 11 review): the font ships with the app, live text renders sharper at every size and follows `BRANDING.productName`, so the rename needs no new artwork. `wordmark.svg` stays the drawing reference.

## 7. Constraints that still hold

Everything in `docs/identity/01-ux-study.md` §"Technical constraints": semantic variables, `--titlebar` / `--titlebar-fg` as `#rrggbb` (= `--surface` / `--fg`), fonts bundled under `font-src 'self'`, Lucide drawn by `svg[xIcon]`, one icon SVG rendered by `npm run icon`, names only in `branding.json`, the 3D colours also in core's `SOLID_COLORS` / `LIGHT_SCENE_THEME` (pinned by `snapshot-theme.test.ts`), canvas pixel samples in the smoke test. The layout does not change: this is a skin, the three empty moments, Otto's presence, and the Home cards.

## 8. What the detail documents are

| File | Covers |
|---|---|
| `01-brand.md` + `brand.html` + `icon-a.svg`, `icon-b.svg`, `otto-mark.svg`, `wordmark.svg` | Name, wordmark, both icon candidates, type, the final palette tables (Craft's plus §4), and the hero mocks: Home light/dark, project window with Otto light/dark, empty project, first launch, About |
| `02-components.md` + `components.html` | Every shared control and panel in the skin, light and dark, with exact CSS |
| `03-otto.md` + `otto.html` | Otto in every state and place, and how it writes |
| `04-canvas.md` + `canvas.html` | The plan canvas, the section, the 3D view day/night, exports and thumbnails in the palette |
| `05-implementation.md` | The variable-by-variable map onto `styles.css` and core, the font files, the icon pipeline, `branding.json`, the components and smoke checks that change |
