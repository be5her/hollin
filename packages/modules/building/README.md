# Building

The building of a project: its levels (floors, basements, mezzanines) and the vertical connectors between them (stairs, ladders, ramps, elevators, escalators).

- **Levels** have a name, a floor-to-floor height and a slab thickness. **Elevations are derived, never stored:** the ground level sits at the building's datum (0 by default); levels stacked above it add up the heights below them; basements hang below it, each its own height lower (negative elevations); mezzanines and split levels sit at an offset from a stacked host level. So changing a level's height moves every level above it, a deeper basement pushes the ones below it down, and grade stays put. Setting a level's elevation changes the value that produces it: the datum for the ground floor (the whole building moves), the height of the level below for a level above ground, its own height for a basement, its offset for a mezzanine.
- Levels are added on top, at the bottom, or above/below another level; duplicated (the copy, with new ids and its references remapped, is stacked right above); reordered by dragging; removed (levels above drop by its height; stairs and ramps ending on it go; elevators skip it; columns and shafts that reached up to it stop at their own level). A level that hosts a mezzanine cannot be removed until the mezzanine is.
- **Connectors** belong to the building, not to a level: a stair (straight, L, U, winder, spiral or curved, along an axis path, with riser and tread intent), ladder, ramp (with a slope limit), elevator (shaft and car size, the levels it stops at and the door side at each), escalator. In this milestone they are data; their geometry, plan symbols, slab openings and rule warnings come with milestone 5. A connector's top must be above its bottom.
- **The project tab** shows the levels from top to bottom with their elevations in display units, the active level's name, elevation, height and slab (typed in any unit: `3.6m`, `3600`, `11' 10"`), its layers (show/hide, lock, opacity), and a section through the whole building with every level, the ground line and the connectors. Click a level, in the list or the section, to make it active.

## Storage

Levels, layers and connectors live in `project.json`; each level's entities in its own level file (see the library README). The active level and the open right panel are view state, stored per machine in `.local/ui.json`.

## Agents

All allowed; every change is an undoable transaction attributed to the agent.

- `building.get`: levels bottom to top with derived elevation, height, top, slab, whether it is the ground or a basement, its layers and entity counts; the connectors.
- `building.level.add` (with `position` or `mezzanineOf`), `building.level.update` (name, height, slab, elevation, ground), `building.level.duplicate`, `building.level.move`, `building.level.remove`.
- `building.connector.add`, `building.connector.update`, `building.connector.remove`.
- All of these can be steps of `plan.apply`.

## Verified by

Unit tests in `packages/core/src/doc/doc.test.ts` (stacking, basements, mezzanines, every elevation rule, reorder, removal and its cascade, duplication and remapping, reference completeness). Smoke: `src/main/smoke/building.ts` (the whole building through commands: levels, connectors, height and elevation changes, a stair that would go down refused) and `src/main/smoke/building-ui.ts` (the level list and section, active level, a level an agent adds appearing live, undo from the toolbar, a height typed as `4m` moving the levels above, refusing text that is not a length, layers with Ctrl+Z and Ctrl+Shift+Z, dragging levels to reorder).
