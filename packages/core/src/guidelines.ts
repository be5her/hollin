import { BRANDING } from './branding';

/**
 * Design guidelines for agents: how the document is organised and how to work on it well. Served as
 * an MCP resource and folded into the in-app assistant's system prompt, so both agents read the same.
 */
export const DESIGN_GUIDELINES = `# Designing in ${BRANDING.productName}

## The model
- A project is one building: levels (floors, basements, mezzanines) stacked by elevation, each with layers (structure, interior, decor) that hold entities, plus the vertical connectors (stairs, ladders, ramps, elevators, escalators) that belong to the building, not to one level.
- Every length is in millimetres and every area in mm², whatever the user's display units. Angles are degrees. Coordinates are plan coordinates: x to the right, y up, the origin wherever the design started.
- Elevations are derived from the level stack: changing a level's height moves every level above it. Never store or guess elevations; read them with building_get.
- Walls are drawn on their reference line (path) with a thickness and an alignment (centre, left or right of the line). Walls that meet join automatically; openings (doors, windows) sit in a wall at a distance along it.
- Rooms are detected from the space the walls enclose around a seed point: draw the walls first, then place rooms. A room's area follows its walls.
- Stairs, ramps and elevators are stored as intent (a walk line or a shaft, the levels they connect, a width); risers, treads, slopes, stops and the holes they cut in slabs are derived from the level heights and the rule limits, and the rules engine warns when a limit is broken.

## How to work
- Start by reading: plan_describe gives every level's rooms, areas, adjacency and openings and where each stair or elevator lands; building_get the levels and connectors with their derived numbers; plan_query the raw entities; rules_check the current warnings. view_snapshot shows a level's plan as an image, so look at the result of a change.
- Make a whole floor, or any change of several steps, with one plan_apply call: all steps succeed or nothing changes, it is one undo step, and its label is what the user sees in the history, so write a short, specific label ("Add kitchen and dining walls").
- Draw sensibly: typical exterior walls are 200-300 mm thick, interior walls 100-150; doors 800-1000 mm wide and 2000-2100 high; windows 900-1800 wide with a 900 mm sill; a floor-to-floor height of 2800-3200 mm; stairs about 1000 mm wide with risers of 150-190 mm and treads of at least 250 mm.
- Close wall loops so rooms can be detected, then name every room. Put a door into every room and a window into every habitable one.
- Prefer small, checkable steps and confirm the result (plan_describe, view_snapshot, rules_check) before going on. Fix every warning you caused.
- Commands that delete or overwrite data are gated: the user decides. Ordinary design edits are undoable transactions and need no confirmation.
`;
