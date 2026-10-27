# Milestone 9: export and import

The last milestone of the brief: "DXF per level, SVG/PDF plans, glTF building, PNG renders", plus the import that belongs with it (DXF drawings; glTF models already come in through the catalog). Seven steps, each verified (`npm run typecheck`, `npm test`, `npm run smoke`) and committed on local `main` on its own.

## Design

- **One drawing, three vector formats.** A level's plan is first turned into a pure, layered vector drawing in millimetres (`PlanDrawing`: layers of strokes, fills and texts, each with a kind such as `walls`, `openings`, `rooms`, `connectors`, `furniture`, `dimensions`, `labels`), in core, from the same derived geometry the canvas draws (`deriveLevelGeometry`, `openingFrame`, `dimensionGeometry`, `deriveConnector`, `itemFootprint`). DXF, SVG and PDF are then writers over that drawing. This keeps the writers testable in node, gives DXF real layers and SVG/PDF true vectors at a drawing scale, and does not entangle the canvas renderer.
- **The building in glTF is flattened.** `deriveBuildingSolids` gives every part as a mesh; furniture comes from recipes (meshes per slot) or from the registered asset's triangles (`readGlbTriangles`), so the file is self-contained with base-colour materials from the design's finishes. The writer (`writeGlb`) grows a node hierarchy: one node per level, one per connector, children per part.
- **PNG renders reuse the snapshot path.** The window draws (`view.snapshot.request` / `view.snapshot.reply`), the command writes the file. Larger sizes, the dark theme and a transparent background are the additions.
- **DXF import makes shapes, not walls.** Entities from a DXF (LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, TEXT/MTEXT) land on a level as shapes, separators and labels on layers named after the DXF layers, scaled by `$INSUNITS` or a given factor, in one undoable transaction. The user traces walls over them; an agent can do the same with `plan.query`.
- **Everything is a command** in a new `exchange` module (`packages/modules/exchange`): `export.plan`, `export.building`, `export.image`, `import.dxf`. Exports write outside the library, so they are `mutating: true` like `project.export`; the import is an ordinary undoable transaction. The UI is one Export dialog on the project tab and an Import entry next to it; paths come from `app.pickSavePath` / `app.pickFile`, agents pass paths.

## Steps

### Step 1: the plan drawing and DXF
- `packages/core/src/exchange/drawing.ts`: `PlanDrawing` types and `planDrawing(doc, levelId, options)` (units, rule limits, which layers, whether hidden layers are skipped, text sizes in mm). Walls as the joined outlines (outer loops and holes), openings as jambs plus a door's leaf and swing arc or a window's lines, rooms as their names and areas at their label point, columns, slabs and voids, shapes with their corners resolved, separators, fixtures and points as their glyphs, dimensions through `dimensionGeometry`, labels, items as their footprints, lights as their glyphs, connectors as the plan symbols (treads, cut line, arrow, elevator shaft and door marks). Arcs stay arcs (centre, radius, angles); cubics are flattened.
- `packages/core/src/exchange/dxf.ts`: `drawingToDxf(drawing, options)`: an AC1015 (R2000) file with HEADER (`$INSUNITS` 4 = mm, `$EXTMIN`/`$EXTMAX`), TABLES (LAYER per drawing layer with a colour index, LTYPE for dashes, STYLE), ENTITIES (LWPOLYLINE with bulges for arcs, LINE, ARC, CIRCLE, TEXT, HATCH only for solid fills). Handles as hex counters. Text in `\P`-free single lines.
- Unit tests: a room with a door and a window, a stair and a dimension: the drawing's layers and counts, a wall outline's area, a door's arc; the DXF parses back with the step 5 reader's predecessor (a small `readDxfEntities` written here, reused in step 5) and round-trips the polylines within 0.001 mm.
- Export from `@studio/core`. README section in `packages/core/README.md`.

### Step 2: SVG and PDF, and the export command
- `packages/core/src/exchange/svg.ts`: `drawingToSvg(drawing, options)`: a `viewBox` in mm with y flipped, one `<g>` per layer with its name, paths with `A` arcs, texts, a `scale` and page size option that sets `width`/`height` in mm, a title block option (project, level, scale, date).
- `packages/core/src/exchange/pdf.ts`: `drawingToPdf(pages, options)`: a hand-written PDF 1.4 (no dependency): one page per level, page size (A4, A3, A2, Letter, Tabloid; portrait or landscape), scale (1:50, 1:100, 1:200 or fit), paths with `m`/`l`/`c` (arcs as Béziers), strokes with widths and dashes, fills, text in Helvetica (WinAnsi), a title block, an xref table with correct offsets. Optional `deflate` hook (main passes node's `deflateSync`).
- `packages/modules/exchange/main.ts`: `export.plan` (`format: 'dxf' | 'svg' | 'pdf'`, `levelIds` or all levels, `path`, `scale`, `page`, `orientation`, `layers`, `units`): DXF and SVG write one file per level (a suffix with the level name when several), PDF one file with a page per level. Returns the files written. Registered in `packages/modules/main.ts` and `tsconfig.node.json`. Emits `exchange.exported` (add to `HostEvents`).
- Unit tests for SVG (well-formed, viewBox, layer groups) and PDF (header, `%%EOF`, xref offsets point at `obj`, page count, text present). Smoke: `src/main/smoke/exchange.ts` exports the smoke's duplex as DXF, SVG and PDF through commands and through MCP (gated until mutations are allowed), checks the files exist, parse and mention the level names.
- `packages/modules/exchange/README.md`.

### Step 3: the building as glTF
- `packages/core/src/exchange/gltf.ts`: `buildingToGlb(doc, options)`: `deriveBuildingSolids` with finishes; each part's colour from its material (`builtin:` materials' colour, roughness and metalness; `paint:#rrggbb`; else the kind's default), glass with alpha; items placed with their 4 × 4 placement (recipe slot meshes, or the asset's triangles with their base colours); lights skipped. Extend `writeGlb` to take a node tree (`GlbNode { name, children?, meshes? }`), keeping `meshToGlb` and the existing callers.
- `export.building` (`path`, `levelIds`, `includeItems`, `includeFinishes`). Returns the file, the node and triangle counts.
- Unit tests: a two-level house with a stair and a table: the GLB inspects (`inspectGlb`), the node names are the level names, the triangle count matches the solids, a part's colour round-trips; a volume check on the walls through `readGlbTriangles` within 1 %. Smoke through commands and MCP.

### Step 4: PNG renders
- `export.image`: the `view.snapshot` options plus `width`/`height` up to 4096, `theme: 'light' | 'dark'`, `transparent`, `path`. Goes through the window like `view.snapshot` (the request gains `theme` and `transparent`; the plan responder draws with `DARK_THEME` or a cleared background; the 3D responder sets the renderer's clear alpha). Writes the PNG, returns the file and size.
- Smoke (UI phase, after `smoke.openWindow`): a plan render and a 3D render of the duplex to the smoke's temp folder, the files decode as PNG with the asked size; a transparent plan has an alpha-0 corner.

### Step 5: DXF import
- `packages/core/src/exchange/dxf-read.ts`: a tolerant group-code reader (`readDxf`): `$INSUNITS`, the layer table (names, colours, frozen), ENTITIES in model space (LINE, LWPOLYLINE with bulges and closure, POLYLINE/VERTEX/SEQEND, ARC, CIRCLE, ELLIPSE as a flattened polyline, SPLINE through its fit or control points as a flattened polyline, TEXT, MTEXT with formatting codes stripped, INSERT of BLOCK definitions expanded with their transform one level deep). Unknown entities are counted and skipped. Both CRLF and LF, UTF-8 and the `\U+XXXX` escapes.
- `dxfToOps(file, doc, levelId, options)`: a layer per DXF layer (kind `interior`... use the existing `shape`/`separator`/`label` entity types on new layers named `DXF <layer>`), a unit scale (from `$INSUNITS`, or `scale` given), an `origin` offset, closed polylines as shapes with arc segments (bulges to arcs), open ones as separators, texts as labels, arcs and circles as shapes. Everything in one transaction.
- `import.dxf` (`path`, `levelId`, `scale`, `origin`, `layerPrefix`). Returns counts per entity type and the skipped kinds.
- Unit tests: the step 1 writer's output imports back to the same outlines; hand-written DXF snippets for bulges, POLYLINE/VERTEX, INSERT, MTEXT codes, an inches file scaled to mm, CRLF. Smoke through commands and MCP.

### Step 6: the UI
- An **Export…** button on the project tab's toolbar (next to the view switch) opening a dialog (a Signal Form): format (DXF, SVG, PDF, glTF, PNG), which levels (the current one or all), page and scale for SVG/PDF, size and theme for PNG, items and finishes for glTF; then `app.pickSavePath` with the format's filter and the command. A toast on success with the folder to reveal (`app.reveal` if the host has one; else just the path).
- An **Import DXF…** entry in the same place (and the Layers panel's menu): picks a file, asks for the level (the current one), scale (from the file's units, editable) and origin, then `import.dxf`; a toast with the counts.
- Smoke UI checks in `src/main/smoke/exchange-ui.ts` (the dialog opens, each format's fields show, the native picker is bypassed by a smoke hook that returns a temp path, the files appear); screenshots light and dark looked at.
- `exchange/README.md` updated with the UI; the plan module README mentions the DXF layers.

### Step 7: wrap-up
- README status table (milestone 9 done), the layout section (`exchange`), `packages/core/README.md` (the `exchange` folder), `CLAUDE.md` gotchas learned (the PDF xref, the DXF bulge sign, the snapshot theme), the MCP prompt and `DESIGN_GUIDELINES` mention exports, final full smoke with screenshots.
