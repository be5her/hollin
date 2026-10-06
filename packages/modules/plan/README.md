# Plan

Editing on a level: layers and entities, and batches.

- **Layers** belong to a level and have a kind: structure (walls, openings, columns, slabs, voids, shafts), interior (rooms, fixtures, electrical and plumbing points) or decor (furniture items, lights). Dimensions and labels go on any layer. Every level starts with one of each; more can be added. Layers can be shown or hidden, locked, faded (opacity) and reordered. Moving the opacity slider makes many small changes that merge into one undo step.
- **Entities** are validated against their schema (`packages/core/src/doc/schema.ts`) on every change, with lengths rounded to 0.001 mm and defaults filled in. Their geometry is the `Path`: vertices joined by lines, arcs (by bulge) or cubic Béziers, with fillet or chamfer corners stored as parameters. An opening sits in a wall on the same level, at a distance along its path; deleting the wall deletes its openings. Columns, shafts and voids can span several levels (`span.topLevelId`) and then show on every level they pass through, mezzanines included.
- **The plan view** is the main view of the project tab (a Plan | Section switcher sits above it): the active level drawn from above on a canvas by `@studio/viewport`'s `plan2d` (see `packages/viewport/README.md`), with an adaptive grid in display units. The toolbar switches the level (also PageUp/PageDown with the canvas focused; the levels panel and the section follow the same choice), shows the level below or above faintly as a reference, and zooms (wheel at the cursor, buttons, Home or the fit button). Middle-drag or Space+drag pans. The footer shows the cursor in display units. Walls are drawn as bodies with the door and window cuts, columns, rooms (a badge at the seed, or the drawn region), slabs, voids, dimensions and labels; an agent's change appears on the canvas at once. Drawing and editing tools arrive in the next steps of milestone 4.
- **`plan.apply`** runs a list of editing commands as one transaction: all succeed or nothing changes, and it is one undo step. A step can name what it creates (`as: "w1"`) and later steps refer to it as `"$w1"`. `dryRun` checks without applying. Only editing commands can be steps; batches cannot be nested. A batch of 20 steps or more by an agent first keeps the project in an automatic snapshot.

## Storage

Entities live in their level's file (see the library README). The plan's camera, the reference underlay choice and the chosen main view are view state, stored per machine in the project's `.local/ui.json` (`camera`, `underlay`, `centerView`) next to the active level.

## Agents

All allowed and undoable: `plan.query` (entities by level, layer, type or id), `plan.layer.add/update/move/remove`, `plan.entity.add/update/delete`, `plan.apply`. Agents send intent (add this wall, set this field); the change is built from the current document in the main process, never from a possibly stale copy.

## Verified by

Unit tests: `packages/core/src/doc/doc.test.ts` (validation and rounding, all-or-nothing transactions, reference integrity, layer kinds, cascades, spans) and `packages/modules/plan/plan.test.ts` (a floor drawn in one batch with `$name` references, failed batches change nothing, dry runs, attribution, guarded undo, patches, the session snapshot). Smoke: `src/main/smoke/building.ts` (an agent draws a floor with `plan_apply` over MCP, a failing batch changes nothing, the patches rebuild main's document exactly) and `src/main/smoke/plan-ui.ts` (the plan view with real input: the level switcher, every entity drawn and the door's cut checked by sampling canvas pixels, zoom to fit, wheel zoom at the cursor, middle-drag and Space+drag pans, the camera stored, PageUp/PageDown, the underlay, an agent's wall appearing live and vanishing on undo, light and dark screenshots). Unit tests of the viewport: `packages/viewport/src/plan2d/*.test.ts`.
