# @studio/core

The engine. Everything here is pure TypeScript with no Electron, Node I/O or UI framework, so the renderer imports it too; Node-only storage lives in `src/node` and is imported as `@studio/core/node`.

## Commands

- `defineCommand({ id, title, description, scope, input, mutating?, hidden?, handler })` is a typed identity helper: the handler infers its input type from the zod schema.
- `defineModule({ id, commands, onStart?, onStop?, onProjectOpen?, onProjectClose? })` groups a feature's commands.
- `CommandRegistry.execute(id, rawInput, ctx)` checks, in order: unknown id → `UNKNOWN_COMMAND`; a project-scope command without a project → `NO_PROJECT`; `safeParse` failure → `INVALID_INPUT` (each issue as "path: message", also in `details`); the mutating gate; then the handler.
- The mutating gate never applies to the UI. MCP callers are refused (`MUTATION_BLOCKED`) unless `config.mcp.allowMutations` is on. The assistant goes through `host.confirmMutation`, which asks the user (`MUTATION_DECLINED` when they say no; refused while no host provides it). A function-valued `mutating` decides per call, after validation.
- `registry.list()` gives `{ id, module, title, description, scope, mutating, conditional, hidden, noInput }` for the palette and MCP.
- `StudioError(code, message, details?)` is the one error type; `toErrorPayload` turns anything thrown into `{ code, message, details? }`.

## Other pieces

| File | What |
|---|---|
| `config.ts` | The config schema and `mergeConfig`: sections merged one level deep and normalised field by field, so an old or hand-edited file falls back per field instead of failing. `ConfigPatchSchema` validates patches strictly. `AI_MODELS` lists the assistant's models. The `editor` section holds the 2D editor's snapping, grid and tool defaults (`snapAngle`, on by default, is the angle tracking and `angleStep` its step; a stored choice is kept); `rules` the limits stairs and ramps are checked against (riser 100–190, tread 250, 2R + T 600–650, width 800, ramp 8.33 %, the plan cut at 1200; `DEFAULT_RULE_LIMITS` for code without settings). |
| `units.ts` | `formatLength`/`parseLength` (metric mm/cm/m, imperial feet-inches or inches with fractions), `formatArea` (m² or ft²) and `formatAngle`/`parseAngle`. Lengths are always stored in millimetres. |
| `input.ts` | The coordinate grammar typed while drawing (`3000`, `3000<45`, `@1000,500`, `1000,500`, lengths in any unit) and `resolveCoordinate`, which turns one into a point given the last point and the current direction. |
| `ids.ts` | `newId(prefix)`: prefix + 16 lowercase Crockford base32 characters (80 bits) from `crypto.getRandomValues`. |
| `branding.ts` | The product names from `branding.json`. |
| `mcp-snippets.ts` | Ready-to-copy MCP client configuration for Settings. |
| `command-score.ts` | Fuzzy ranking for the palette (a port of cmdk's scoring, MIT). |
| `test-host.ts` | An in-memory `HostApi` for unit tests. |

## Storage (`src/node`)

- `writeFileAtomic(file, data)`: a uniquely named temp file next to the target, fsync, then rename. The rename is retried with backoff for about two seconds on `EPERM`/`EBUSY`/`EACCES`, which Windows reports while an antivirus scanner, the indexer or a preview pane holds the file. The temp file is removed on failure. `renameWithRetry` does the same for folders.
- `WriteQueue` runs writes one after another per key; a failed write rejects its caller but never blocks later writes.
- `ConfigStore`: `config.json` in the app's data folder. A file that is not JSON is kept aside as `config.corrupt-<time>.json` and the app starts from defaults. Every update is written atomically and announced (`config.changed`).
- `SecretStore`: named secrets encrypted with the OS keychain (Electron `safeStorage`) in `secrets.json`. Without OS encryption (or with Linux's fixed-key `basic_text` backend) nothing is written and secrets last for the session only; `persistent` says which.
- `project-store.ts`: reads and writes a project folder with the commit protocol (content-hashed level files, `project.json` last, then old files removed), so a crash never mixes old and new files. Only changed levels are stringified.
- `project-session.ts`: one open project's document and its autosave (750 ms debounce, 5 s maximum wait, clean only after a successful write, retries on failure, flush on close).
- `library.ts`: the library folder: index (a rebuildable cache), listing and search, create, duplicate, trash, snapshots, thumbnails, packages, the lock heartbeat.
- `package.ts`: export and import of `.psp` packages with the import guards.
- `project-service.ts`: the library plus the open projects; what `host.projects` is. See `packages/modules/library/README.md`.

## Document (`src/doc`)

| File | What |
|---|---|
| `schema.ts` | The document (zod): meta; building (datum, ground level, level stack); levels (stacked or offset); layers; every entity type (wall, opening, column, slab, void, shaft, room, separator, shape, fixture, point, dimension with its kind and anchors, label, item, light) per level in `levelData`; connectors (stair, ladder, ramp, elevator, escalator). Lengths are rounded to 0.001 mm on parse. |
| `derive.ts` | `deriveLevels` (elevations from the stack), `elevationChange` (which value to change for a wanted elevation), `entitiesOnLevel` (including spanning entities). |
| `ops.ts` | Ops (`ins`, `upd`, `del` per record), `Transaction` (copy-on-write draft, schema validation, reference integrity at commit, net before/after values), `patchOps`, `applyPatch` (the mirror). |
| `engine.ts` | `DocumentEngine`: transactions with labels and authors, the linear undo stack (merging, caps, guarded undo), dry runs, `setMeta` outside history, `replace` with a new epoch, `DocPatch` events. |
| `builders.ts` | Intent to ops against the current draft: add/update/move/remove/duplicate levels, layers, entities (deleting a wall deletes its openings), connectors. |
| `refs.ts` | The one list of references between records, for integrity checks and id remapping. |
| `defaults.ts`, `files.ts` | A new project; the split into `project.json` and level files and back; format migrations. |

## Geometry (`src/geometry`)

`path.ts`: the `Path` primitive (vertices with line, arc-by-bulge or cubic segments and fillet/chamfer corners), `resolvePath` (corners applied exactly for line and arc neighbours, clamped with a diagnostic when they do not fit), length, signed area (exact for arcs and cubics), bounding box, flattening within a tolerance, point and tangent at a distance, nearest point, containment, reversal and transforms, plus the line–circle and circle–circle intersections. `vec.ts`: 2D vector helpers; points are readonly tuples in mm, y up.

| File | What |
|---|---|
| `polygon.ts` | Flattened polygons: signed area, perimeter, box, containment, orientation, centroid, edge distance. |
| `clip.ts` | Clipper2 (`clipper2-ts`, a pure TypeScript port, pinned exactly to `2.0.1-18`) behind a millimetre interface: unions as a tree of outlines and holes, differences, intersections, offsets of polygons and polylines, morphological closing. Coordinates are scaled to integer micrometres. |
| `offset.ts` | `offsetPath`: a path moved to its left or right exactly (lines shift, arcs stay concentric, neighbours are trimmed or extended to meet, sharp corners bevel at the miter limit); null when it cannot be exact (Bézier segments, a vanishing arc, a flipped segment). `extendPathEnd` carries an open path on along its tangent. |
| `walls.ts` | A wall's body from its reference line, thickness and alignment (exact faces, or a flattened offset as the fallback), the ends of open walls clustered into junction nodes, the corner fills where two ends meet (the overlap of both walls carried on past the node: the quadrilateral bounded by the four face lines), and `joinWalls`, the union of bodies and fills. |
| `intersect.ts` | Segment–segment intersections (lines and arcs, within the segments or extended), the perpendicular foot and tangent points from a point, for snapping and joins. |
| `transform.ts` | `transformEntity`: every entity type moved, rotated about a pivot or mirrored across a line (openings stay on their wall; a mirror swaps a door's swing and flips arcs), and `changedFields` for the resulting update. |
| `path-edit.ts` | Vertex, segment and corner edits on a path, and `pathOfEntity`/`withPath` to address a wall's, shape's or divider's path or a region's outline or hole. |
| `dimensions.ts` | Dimensions: `anchorPoint`/`resolveDimension` (an end tied to a vertex of a wall's line or face or of a shape follows it; the stored point is the fallback), `dimensionGeometry` (the lines, ticks, arc, arrow, reading and text of the five kinds), `dimensionOutline`, `offsetTowards` (the offset that puts the line through a cursor), and the tie bookkeeping (`remapAnchors` after a vertex insert or removal, `pruneAnchors`, `untiedFields`: an untied end keeps the point it showed). |
| `corners.ts` | The corner grip's geometry: where a fillet's arc or a chamfer's line crosses the vertex's bisector (`cornerFrame`, `cornerGripPoint`), the largest fillet the edges allow, and the corner a grip dragged to a point means (`cornerFromGrip`: the radius, or both chamfer distances in their ratio; onto the vertex, sharp). Straight edges only; the inspector covers the rest. |
| `openings.ts` | `openingFrame` (an opening's centre, jambs and cut through its wall's body), `fitOpening` (whether an opening fits between the wall's ends and its other openings, the nearest place that does, the free ranges), `openingMisfits` and `columnPolygon`. |
| `rooms.ts` | Rooms: the solids (joined walls, columns, hair-thin dividers) closed by a millimetre and unioned into a tree; every hole at every depth is a cavity with its islands, net area and perimeter; a detected room resolves to the cavity its seed lies in (not enclosed when none, shared when another room claimed it first), a drawn room to its region; unclaimed cavities for detection (slivers, shafts and voids skipped); the automatic slab (outlines that enclose something). |
| `connectors.ts` | Vertical connectors derived from the levels' elevations, never stored: `deriveConnector` gives a stair its risers (`riser.count`, or the rise over the riser limit rounded up) and riser height, flights split at the axis's sharp corners by landings that take half the width either side (a U's short middle leg becomes one half-landing; a winder winds its treads round the inside corner instead), the treads shared between flights by length, tread lines perpendicular to the walk line (radial on arcs: curved and spiral stairs), handrails 50 mm inside, the footprint, and the riser where the plan cut falls; a ramp its slope over its sloped length; a ladder its run from its angle; an escalator its 30° run with landings; an elevator its shaft, car and a door mark per stop, bottom to top. Each lists the limits it breaks (`broken`). `connectorRole` (a level it starts, ends or stops on, or only crosses), `connectorCutsLevel`/`connectorCuts`/`connectorCutLevels` (the slabs it opens: every level above its bottom up to its top), `segmentsSelfIntersect`. |
| `connector-intent.ts` | `stairAxisFrom`: a stair's walk line laid out from its start and end per shape (straight; L and winder with the corner at the right angle on the turn's side; U as two flights a width apart as long as their treads need; a quarter-circle curve; a spiral swept around its centre as far as the treads need, in arcs of at most 180°), `stairSteps` (the riser count from the limit and a comfortable tread), and `connectorFromIntent`: the full record a stair, ramp or elevator intent stands for (`building.connector.add` accepts both). |
| `connector-edit.ts` | Connectors under the plan's editing commands: `isConnectorId` (by the id prefix), `connectorPath`/`withConnectorPath` (the walk line of a stair or ramp as the path the `plan.path.*` commands edit) and `transformConnector` (move, rotate, mirror of an axis or of `at`/`direction`/`rotation`; a mirror swaps a stair's handrails and an elevator's front and back doors). |
| `level-geometry.ts` | `deriveWalls` / `deriveRooms` / `deriveLevelGeometry`: everything a level's entities derive to (walls joined and cut, cavities, rooms, the slab), uncached. The renderer memoises by object identity (valid there, where the mirror builds a fresh draft per patch); main derives afresh, because a transaction mutates a level's record in place while a batch runs. |

## Tests

`npm test` runs `*.test.ts` here: the registry and its gates, config merging and normalising, units, ids, atomic writes and the retry, the write queue, the config and secret stores, project folders and crash simulation, autosave timing, the library, packages, the project service, path geometry against analytic values, connector geometry against hand-computed riser counts, treads, landings, slopes and runs, elevations, transactions, history and references.
