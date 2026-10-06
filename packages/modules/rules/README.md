# Rules

The design checked against its rules, with the warnings kept current while the user works.

## What it does

- **Rules** (`packages/core/src/rules/check.ts`, pure): stairs and ramps outside the limits in Settings (riser height, tread depth, the comfort formula, width, slope), elevators with a stop off the stack or two stops at one elevation or a car larger than its shaft, a connector whose top is not above its bottom after a level change, a connector whose shape does not match its walk line, doors and windows that do not fit their wall, detected rooms that are not enclosed, walls, shapes and regions that cross themselves, and connector openings that lie outside the slab of a floor they pass through (over 1 % of the footprint, or a floor with no slab). Each warning carries a stable id (target and rule), a rule name, a severity, a message, the entity or connector it is about and the level to show it on (a connector: where it starts).
- **The watcher** (`RulesWatcher` in `main.ts`) runs in main for every open project: 250 ms after the last change of a burst it recomputes what the change could have touched, keeping a cache per level (bumped when a patch touches the level's entities) and one for the connectors (bumped with the building, a level, a connector, or the limits), and announces `rules.changed { projectId, count }` only when the set of warnings differs.
- **The Warnings panel** (right column) lists the warnings grouped by level, with the count on its tab; clicking one shows its level on the plan and selects what it is about, bringing it into view.

## Storage

Nothing. Warnings are derived; the limits are the global `rules` settings (`config.json`, see `packages/core/README.md`).

## Agents

`rules.check` (read-only): every warning, with the total and the count per level, filtered by `levelId` or `rule`.

## Verified by

`packages/core/src/rules/check.test.ts` (each rule on a fixture that breaks it, and a sound house that raises none; a level height change changing the verdict), `packages/modules/rules/rules.test.ts` (warnings live after a change, no announcement when the set is unchanged, the filters, a height change and the limits in the settings) and `src/main/smoke/rules-ui.ts` (a stair made too steep raises a warning and the tab's count live, clicking it switches level and selects the stair, the Properties panel shows the broken limit, an agent reads it over MCP, fixing it clears the panel, a taller floor regenerates the risers and flags the stair again, undo clears it; light and dark screenshots).
