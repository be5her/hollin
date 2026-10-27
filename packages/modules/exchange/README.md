# Exchange

Exports of the design to files other programs read. Milestone 9 grows it step by step: the plan drawing as DXF, SVG and PDF (now), the building as glTF, PNG renders and the DXF import (to come).

## What it does

- **`export.plan`** turns each requested level into a plan drawing (`planDrawing` in `packages/core/src/exchange/drawing.ts`: layered strokes, fills and texts in millimetres, from the same derived geometry the canvas draws) with the display units and rule limits from Settings, then writes it with one of the pure writers in core:
  - **DXF** (`drawingToDxf`): AutoCAD R2000, millimetres, one CAD layer per drawing layer; one file per level.
  - **SVG** (`drawingToSvg`): one self-contained document per level, on a paper sheet (A4, A3, A2, A1, Letter or Tabloid, portrait or landscape; A3 landscape by default) at 1:`scale`, in paper millimetres so it prints to scale, one `<g>` per drawing layer named after it, arcs as `A` commands, texts upright, a title block (project, level, scale, date).
  - **PDF** (`drawingToPdf`): one file with a page per level, a hand-written PDF 1.4 (no dependency): true vectors, arcs as Béziers, tints through an ExtGState alpha, texts in the standard Helvetica (WinAnsi), the same title block; content streams compressed with node's `deflateSync`.
- With several levels, DXF and SVG put the level's name before the extension (`Plan - Ground floor.svg`, numbered when two names clash); PDF writes the one path. `fit` (SVG and PDF) picks, per level, the largest of 1:20, 1:25, 1:50, 1:100, 1:200, 1:250, 1:500 and 1:1000 that fits inside the 10 mm margin above the title block.
- After writing, the module announces `exchange.exported { projectId, format, files }`.
- Files are written with `writeFileAtomic` (the folder is created when missing). Paths must be absolute.

## Storage

Nothing in the library: the files go where `path` says. The project is only read.

## Agents

`export.plan` (**gated**: it writes outside the library, so MCP agents are refused with `MUTATION_BLOCKED` until the user allows mutations in Settings, and the in-app assistant asks first). Input: `path` (full file path), `format` (`dxf` | `svg` | `pdf`), `levelIds` (default every level, bottom to top), `scale` (1:N, default 100), `page` (default `A3`), `orientation` (default `landscape`), `fit`, `layers` (drawing layer kinds; default all), `title` (default true). Returns `{ format, files: [{ path, levelId?, bytes }], levels: [{ levelId, name, scale }] }`.

## Verified by

`packages/core/src/exchange/svg.test.ts` (well-formed and self-contained, the sheet from the bounds at the scale or from the paper size, `fit`, one named group per layer back to front, arc flags for counter-clockwise, clockwise, large and full-turn arcs, y flipped with texts upright, escaping, even-odd fills with their tint), `packages/core/src/exchange/pdf.test.ts` (header and `%%EOF`, every xref offset pointing at its object, one page per entry with content streams of the stated length, texts with the level names, page sizes, `fit` on A3 landscape for the house fixture, the deflate hook with `/FlateDecode`, WinAnsi with `m²`, `?` for the rest and byte offsets kept right, alignment from Helvetica's widths, arcs as Béziers on the circle), `packages/modules/exchange/exchange.test.ts` (file names per level) and `src/main/smoke/exchange.ts` (the smoke's duplex exported as DXF, SVG and PDF through commands: the files exist, the DXFs read back with their walls and the stair, the SVGs name their level and carry the title block, the PDF has two compressed pages, each export announced; relative paths and unknown levels refused; over MCP `export_plan` is listed as destructive, refused while mutations are off and writes a PDF once they are allowed).
