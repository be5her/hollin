# @studio/viewport

Framework-free renderers driven by the document. `plan2d` draws and edits one level from above on a Canvas 2D; `scene3d` (three) arrives with milestone 7. The package is imported by the renderer only; main never loads it.

## plan2d

| File | What |
|---|---|
| `camera.ts` | The camera (`{ x, y, scale }`: the world point at the canvas centre in mm and the zoom in CSS pixels per mm), world ↔ screen mapping (the world is y-up, the screen y-down), zoom about a point, pan, fit to a box, the `1:N` drawing scale. |
| `theme.ts` | The colours the plan is drawn with, read from the CSS variables in `styles.css` (`--plan-*`, `--canvas`, `--fg` …) so the canvas follows the theme. |
| `scene.ts` | A level's entities in an R-tree (`rbush`), with a generous world box per entity type. `syncLevelScene` diffs by object identity: the mirror keeps untouched entities' objects through patches, so only changed entities are rebuilt. An opening follows its wall. |
| `draw.ts` | Tracing paths (lines, arcs by bulge, cubics) onto a `Path2D` or a context. |
| `render.ts` | One frame: background, the adaptive grid (minor and major lines by zoom, metric or imperial), the reference level faintly, then the entities in a fixed order (slab, rooms, voids, walls, columns, openings, fixtures, dimensions, labels), culled by the visible box, then text in screen space. `Path2D` outlines are cached per entity and refilled, so panning and zooming never rebuild geometry. |
| `editor.ts` | `Plan2dEditor`: attach to a canvas, feed it the document, the active level, the underlay mode, the theme and the units; it keeps a scene for the active level and the reference level only, renders at most once per animation frame (`invalidate()`), and handles the mouse and keyboard: wheel zooms at the cursor, middle-drag or Space+drag pans, Home fits, PageUp/PageDown ask the host to change level. Callbacks report the camera, the cursor's world position and frame statistics. |

The Angular host (`packages/modules/plan/ui/plan-view.ts`) owns the canvas element, sizes it with a `ResizeObserver` times `devicePixelRatio`, re-reads the theme when `<html class>` changes, persists the camera and mirrors the editor's state into `data-camera="x,y,scale"`, `data-level`, `data-underlay`, `data-entities` and `data-frame-ms` attributes on the canvas, which the smoke test reads to convert millimetres to window pixels and to assert without any globals.

## Dependencies and why

| Package | Why |
|---|---|
| `rbush` 4 | An R-tree for culling what is drawn and for hit-testing candidates. ESM, so the Angular build raises no CommonJS warning; it ships no types, hence `@types/rbush` at the root. |

## Tests

`npm test` runs `*.test.ts` here in node: the camera mapping and zoom, the scene index (boxes per type, diffing, openings following walls) and the editor without a canvas (scenes per level, underlay choice, fit, camera callbacks). Nothing here touches `ResizeObserver`, `OffscreenCanvas` or `Path2D` at import time; `Path2D` outlines are built lazily at draw time. Drawing itself is checked by the smoke test (`src/main/smoke/plan-ui.ts`), which samples canvas pixels and takes screenshots.
