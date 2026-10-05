# Plan

Editing on a level: layers and entities, and batches.

- **Layers** belong to a level and have a kind: structure (walls, openings, columns, slabs, voids, shafts), interior (rooms, fixtures, electrical and plumbing points) or decor (furniture items, lights). Dimensions and labels go on any layer. Every level starts with one of each; more can be added. Layers can be shown or hidden, locked, faded (opacity) and reordered. Moving the opacity slider makes many small changes that merge into one undo step.
- **Entities** are validated against their schema (`packages/core/src/doc/schema.ts`) on every change, with lengths rounded to 0.001 mm and defaults filled in. Their geometry is the `Path`: vertices joined by lines, arcs (by bulge) or cubic Béziers, with fillet or chamfer corners stored as parameters. An opening sits in a wall on the same level, at a distance along its path; deleting the wall deletes its openings. Columns, shafts and voids can span several levels (`span.topLevelId`) and then show on every level they pass through, mezzanines included. In this milestone entities are data; the 2D editor arrives in milestone 4.
- **`plan.apply`** runs a list of editing commands as one transaction: all succeed or nothing changes, and it is one undo step. A step can name what it creates (`as: "w1"`) and later steps refer to it as `"$w1"`. `dryRun` checks without applying. Only editing commands can be steps; batches cannot be nested. A batch of 20 steps or more by an agent first keeps the project in an automatic snapshot.

## Agents

All allowed and undoable: `plan.query` (entities by level, layer, type or id), `plan.layer.add/update/move/remove`, `plan.entity.add/update/delete`, `plan.apply`. Agents send intent (add this wall, set this field); the change is built from the current document in the main process, never from a possibly stale copy.

## Verified by

Unit tests: `packages/core/src/doc/doc.test.ts` (validation and rounding, all-or-nothing transactions, reference integrity, layer kinds, cascades, spans) and `packages/modules/plan/plan.test.ts` (a floor drawn in one batch with `$name` references, failed batches change nothing, dry runs, attribution, guarded undo, patches, the session snapshot). Smoke: `src/main/smoke/building.ts` (an agent draws a floor with `plan_apply` over MCP, a failing batch changes nothing, the patches rebuild main's document exactly).
