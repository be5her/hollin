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
- Stairs, ramps, escalators and elevators are stored as intent (a walk line, a foot and a direction, or a shaft; the levels they connect; a width); risers, treads, slopes, an escalator's run, stops and the holes they cut in slabs are derived from the level heights and the rule limits, and the rules engine warns when a limit is broken. building_connector_add takes each by an intent form (points and levels) as well as a full record.

## How to work
- Start by reading: plan_describe gives every level's rooms, areas, adjacency and openings and where each stair or elevator lands; building_get the levels and connectors with their derived numbers; plan_query the raw entities; rules_check the current warnings. view_snapshot shows a level's plan as an image, or with view "3d" the whole building in 3D (display "cutaway" with a levelId looks into that floor's rooms from above), so look at the result of a change.
- Make a whole floor, or any change of several steps, with one plan_apply call: all steps succeed or nothing changes, it is one undo step, and its label is what the user sees in the history, so write a short, specific label ("Add kitchen and dining walls").
- Draw sensibly: typical exterior walls are 200-300 mm thick, interior walls 100-150; doors 800-1000 mm wide and 2000-2100 high; windows 900-1800 wide with a 900 mm sill; a floor-to-floor height of 2800-3200 mm; stairs about 1000 mm wide with risers of 150-190 mm and treads of at least 250 mm.
- Close wall loops so rooms can be detected, then name every room. Put a door into every room and a window into every habitable one.
- Prefer small, checkable steps and confirm the result (plan_describe, view_snapshot, rules_check) before going on. Fix every warning you caused.
- Commands that delete or overwrite data are gated: the user decides. Ordinary design edits are undoable transactions and need no confirmation.

## Furnishing, lights and finishes
- Furnish after the rooms are drawn and named: plan_describe then says which room each piece stands in. Find models with catalog_search (furniture by name, tag or category: living, dining, bedroom, kitchen, bathroom, office, lighting, outdoor; materials with kind "material"; door and window styles with kind "style") and place them with decor_item_place, a whole room in one plan_apply.
- An item's \`at\` is its bottom centre and \`rotation\` turns it counter-clockwise on the plan; at 0 its front faces south (−y), so turn it to face the room: 90 faces east, 180 north, 270 west. Keep pieces inside the room and clear of the walls by their depth (catalog_search gives each model's size).
- Typical sizes: a 3-seat sofa 2200 × 900, an armchair 850 × 850, a coffee table 1100 × 600, a dining table 1200 × 800 for four or 1800 × 900 for six, a double bed 1600 × 2100, a single 1000 × 2100, a wardrobe 1200 × 600, a desk 1400 × 700, kitchen units 600 deep with a worktop at 900.
- Clearances: 900 mm to walk past furniture, 1000 in a kitchen between counters, 700 between a sofa and its coffee table's far side, 600 beside a bed, 900 behind a dining chair, 800 in front of a wardrobe or a toilet; keep doors' swings free.
- Light every room: a lamp from the lighting category placed with \`withLight\` brings its own light, or decor_light_add adds one (about 15–20 lumens per m² of floor for a living room, more for a kitchen or a desk: 800 lumens is a household bulb). view_snapshot with \`lighting: "night"\` shows them.
- Finishes: decor_material_set gives a wall face, or a room's floor, walls (every face looking into it) or ceiling a material: timber or carpet floors in living rooms and bedrooms, tiles in kitchens and bathrooms; walls in paint (any colour as \`paint:#rrggbb\`).

## Export and import
- A design can be exported for other programs: export_plan writes levels' plans as DXF (millimetres, a CAD layer per kind of element), SVG or PDF (on a paper sheet at a scale, or \`fit\`); export_building the whole building as one glTF (GLB) file; export_image a PNG render of a plan or of the building in 3D. Give each a full file path. They write outside the library, so they are gated: the user allows them.
- A DXF (a survey, an architect's drawing) comes in with import_dxf as linework to trace over: probe it first with import_dxf_probe (its units, the scale import would use, its layers and extent), then import onto a level; each DXF layer becomes a \`DXF <layer>\` layer of shapes, dividers and labels in one undo step. Find them with plan_query by the returned layer ids, draw the walls over them, then remove the DXF layers (plan_layer_remove): imported lines are not walls, and the open ones come in as room dividers, which split rooms while they stay.
`;
