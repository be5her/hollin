/**
 * What the plan's canvas says (`packages/viewport`): the tools' hints in the footer, the snap and tracking
 * labels, the words drawn on the plan (shared with the plan exports through `exchange/drawing.ts`), the
 * History labels the tools write. Key names stay in Latin (V, Escape, Ctrl, Shift+M) in every language.
 */
export const tools = {
  // ---------- shared pieces ----------
  /** The kinds of connector, as a hint or a panel names one. */
  'tools.connector.stair': 'Stair',
  'tools.connector.ladder': 'Ladder',
  'tools.connector.ramp': 'Ramp',
  'tools.connector.elevator': 'Elevator',
  'tools.connector.escalator': 'Escalator',
  'tools.arc.through': 'Click a point the arc passes through',
  'tools.arc.end': 'Click the end of the arc · A: straight',
  /** A connector tool without a level above the active one, by kind. */
  'tools.needsLevel.stair': 'The stair needs a level above this one: add one in the Levels panel, or choose the levels in the options',
  'tools.needsLevel.ramp': 'The ramp needs a level above this one: add one in the Levels panel, or choose the levels in the options',
  'tools.needsLevel.ladder': 'The ladder needs a level above this one: add one in the Levels panel, or choose the levels in the options',
  'tools.needsLevel.elevator': 'The elevator needs a level above this one: add one in the Levels panel, or choose the levels in the options',
  'tools.needsLevel.escalator': 'The escalator needs a level above this one: add one in the Levels panel, or choose the levels in the options',

  // ---------- Select ----------
  'tools.select.slide': 'Release to slide the opening here (over another wall: move it there)',
  'tools.select.copyHere': 'Release to copy here',
  'tools.select.moveHere': 'Release to move here · Ctrl: copy',
  'tools.select.window': 'Window: what lies fully inside',
  'tools.select.crossing': 'Crossing: what the box touches',
  'tools.select.rotatePivot': 'Rotate: click the pivot',
  'tools.select.rotateReference': 'Click a reference point',
  'tools.select.rotateDirection': 'Click the new direction · Ctrl: keep a copy',
  'tools.select.mirrorFirst': 'Mirror: click the first point of the axis',
  'tools.select.mirrorSecond': 'Click the second point · Ctrl: keep a copy',
  'tools.select.turnItem': 'Release to turn the item to face here (15° steps hold; Alt: free) · or type an angle',
  'tools.select.sizeCorner': 'Release to size the corner (or type the radius or distance) · onto the vertex: sharp',
  'tools.select.tiePoint': 'Release to tie the point to this corner',
  'tools.select.movePoint': 'Release to move the point (on a wall or shape corner: tie it there)',
  'tools.select.placeDimensionLine': 'Release to place the dimension line here',
  'tools.select.moveCornerJoined': { one: 'Release to move the corner ({count} joined end follow) · Alt: detach', other: 'Release to move the corner ({count} joined ends follow) · Alt: detach' },
  'tools.select.moveCorner': 'Release to move the corner',
  'tools.select.addCorner': 'Release to add a corner here',
  'tools.select.curve': 'Release to curve the segment through here · Alt: add a corner instead',
  'tools.select.corner': 'Corner selected · drag to move · F: round · C: chamfer · Delete: remove · Escape: back',
  'tools.select.connectorPath': '{kind} selected · drag to move · drag a grip to reshape its walk line · R: rotate · Shift+M: mirror · Delete',
  'tools.select.connector': '{kind} selected · drag to move · R: rotate · Shift+M: mirror · Delete',
  'tools.select.one': '1 selected · drag to move (Ctrl: copy) · drag a grip to reshape · click a corner to edit it (F: round · C: chamfer) · R: rotate · Shift+M: mirror · Delete',
  'tools.select.many': '{count} selected · drag to move (Ctrl: copy) · arrows: nudge · R: rotate · Shift+M: mirror · Delete',
  'tools.select.idle': 'Click to select · Shift: add · drag: window (→) or crossing (←) · W: draw walls',

  // ---------- Wall ----------
  'tools.wall.start': 'Click the start of a wall · V: select',
  'tools.wall.next': 'Click the next point · A: arc · click the first point to close · Enter: end · Escape: cancel',

  // ---------- Door and Window ----------
  'tools.door.hover': 'Move over a wall to place a door · V: select',
  'tools.door.noRoom': 'No room for the door on this wall',
  'tools.door.place': "Click to place the door · type a distance from the wall's start · F: flip side · H: flip hinge",
  'tools.window.hover': 'Move over a wall to place a window · V: select',
  'tools.window.noRoom': 'No room for the window on this wall',
  'tools.window.place': "Click to place the window · type a distance from the wall's start",

  // ---------- Room and Room divider ----------
  'tools.room.hover': 'Click to make this space a room · V: select',
  'tools.room.idle': 'Move into a space enclosed by walls (or dividers) · V: select',
  'tools.separator.start': 'Click the start of a room divider · V: select',
  'tools.separator.next': 'Click the next point · Enter or double-click: end · Escape: cancel',

  // ---------- Shape, Rectangle, Circle: {noun} is what the outline makes, {the} the same with its article ----------
  'tools.shape.noun.shape': 'shape',
  'tools.shape.noun.room': 'room',
  'tools.shape.noun.slab': 'slab',
  'tools.shape.noun.void': 'void',
  'tools.shape.the.shape': 'shape',
  'tools.shape.the.room': 'room',
  'tools.shape.the.slab': 'slab',
  'tools.shape.the.void': 'void',
  'tools.shape.rectNext': 'Click the opposite corner of the {the} (or type @width,height) · Escape: cancel',
  'tools.shape.rectStart': 'Click the first corner of a {noun} · V: select',
  'tools.shape.circleNext': "Click a point on the {the}'s circle (or type the radius) · Escape: cancel",
  'tools.shape.circleStart': 'Click the centre of a round {noun} · V: select',
  'tools.shape.start': 'Click the first point of a {noun} · V: select',
  'tools.shape.nextOpen': 'Click the next point · A: arc · click the first point or C: close · Enter: end open · Escape: cancel',
  'tools.shape.nextClosed': 'Click the next point · A: arc · click the first point, C or Enter: close · Escape: cancel',

  // ---------- Dimension ----------
  'tools.dimension.kind.aligned': 'aligned',
  'tools.dimension.kind.horizontal': 'horizontal',
  'tools.dimension.kind.vertical': 'vertical',
  'tools.dimension.angleCorner': 'Click the corner of the angle · V: select',
  'tools.dimension.angleFirst': 'Click a point on the first side',
  'tools.dimension.angleSecond': 'Click a point on the second side',
  'tools.dimension.angleArc': 'Click where the arc goes (or type its radius) · Enter: here · Escape: cancel',
  'tools.dimension.radiusCentre': 'Click the centre of the arc or circle · V: select',
  'tools.dimension.radiusPoint': 'Click a point on the arc (or type the radius)',
  'tools.dimension.first': 'Click the first point of the {kind} dimension · V: select',
  'tools.dimension.second': 'Click the second point (a wall or shape corner ties the dimension to it)',
  'tools.dimension.line': 'Click where the dimension line goes (or type the distance) · Enter: here · Escape: cancel',

  // ---------- Label ----------
  'tools.label.placeholder': 'Label text',
  'tools.label.typing': 'Type the label text · Enter: place it · Escape: cancel',
  'tools.label.idle': 'Click where the label goes · V: select',

  // ---------- Stair, Ramp, Ladder, Elevator, Escalator ----------
  'tools.stair.spiralCentre': 'Click the centre of the spiral · V: select',
  'tools.stair.start': 'Click the start of the stair · V: select',
  /** After a stair hint: how many risers the stair has so far. */
  'tools.stair.risers': { one: ' · {count} risers', other: ' · {count} risers' },
  'tools.stair.uDirection': 'Click the direction of the first flight{risers} · Escape: cancel',
  'tools.stair.spiralStep': 'Click the first step{risers} · Escape: cancel',
  'tools.stair.top': 'Click the top of the stair{risers} · Escape: cancel',
  'tools.stair.topPlain': 'Click the top of the stair · Escape: cancel',
  'tools.stair.through': 'Click a point the arc passes through{risers} · Escape: cancel',
  'tools.stair.corner': 'Click the corner · Escape: cancel',
  'tools.stair.topOrEnd': 'Click the top of the stair{risers} · Enter: end here · Escape: cancel',
  'tools.ramp.start': 'Click the bottom of the ramp · V: select',
  /** After a ramp hint: its slope so far, a percentage. */
  'tools.ramp.slope': ' · {slope} %',
  'tools.ramp.next': 'Click the next point{slope} · Enter or double-click: end · Escape: cancel',
  'tools.ladder.direction': 'Click the direction the ladder leans towards · Escape: cancel',
  'tools.ladder.foot': 'Click the foot of the ladder · V: select',
  'tools.elevator.centre': 'Click the centre of the shaft · V: select',
  'tools.escalator.foot': 'Click the foot of the escalator · V: select',
  /** After an escalator hint: its run so far, in mm. */
  'tools.escalator.run': ' · {run} mm long',
  'tools.escalator.direction': 'Click the direction it rises towards{run} · Escape: cancel',

  // ---------- Column, Furniture, Light, Paint ----------
  'tools.column.place': 'Click where the column goes ({size}; the options set it) · V: select',
  'tools.item.none': 'Pick a model in the Catalog panel to place it · V: select',
  'tools.item.theModel': 'the model',
  'tools.item.place': 'Click to place {name} (turned {angle}°) · R: turn 15° (Shift+R back, Shift+wheel) · Escape: done',
  'tools.light.point': 'Click where the light goes ({lumens} lm, {height} mm above the floor; the options set them) · Escape: done',
  'tools.light.spot': 'Click where the spot goes ({lumens} lm, {height} mm above the floor; the options set them) · Escape: done',
  'tools.light.area': 'Click where the area light goes ({lumens} lm, {height} mm above the floor; the options set them) · Escape: done',
  'tools.paint.none': 'Pick a material in the Catalog panel to paint with it · V: select',
  'tools.paint.place': "Click a wall face or a room's floor to give it {name} · Escape: done",
  /** Beside the cursor: what the Paint tool would paint, the Column tool's span, the item and opening being placed. */
  'tools.paint.leftFace': 'left face',
  'tools.paint.rightFace': 'right face',
  'tools.paint.floor': 'floor',
  'tools.column.upTo': 'up to {name}',
  'tools.column.theLevel': 'the level',
  'tools.item.preview': '{name} · {angle}°',
  'tools.opening.fromStart': '{length} from the start',

  // ---------- snapping and tracking (the footer and the label at the cursor) ----------
  'tools.snap.endpoint': 'Endpoint',
  'tools.snap.intersection': 'Intersection',
  'tools.snap.apparent': 'Apparent intersection',
  'tools.snap.midpoint': 'Midpoint',
  'tools.snap.center': 'Centre',
  'tools.snap.perpendicular': 'Perpendicular',
  'tools.snap.tangent': 'Tangent',
  'tools.snap.on': 'On line',
  'tools.snap.extension': 'Extension',
  'tools.snap.grid': 'Grid',
  'tools.track.parallel': 'Parallel to {name}',
  'tools.track.perpendicular': 'Perpendicular to {name}',
  /** What a tracked direction belongs to, as "Parallel to {name}" names it. */
  'tools.track.previous': 'previous',
  'tools.track.wall': 'wall',
  'tools.track.line': 'line',
  'tools.track.dimension': 'dimension',
  'tools.track.reference': 'reference',

  // ---------- words drawn on the plan (the canvas and the plan exports) ----------
  'tools.canvas.notEnclosed': '{name} · not enclosed',
  'tools.canvas.shared': 'shares its space',
  'tools.canvas.up': 'UP',
  'tools.canvas.down': 'DN',
  /** A stair's riser count beside its walk line. */
  'tools.canvas.risers': { one: '{count} R', other: '{count} R' },
  /** Otto's tag on the plan: who, the edit's label, its age. */
  'tools.canvas.ottoTag': 'Otto · {label} · {age}',
  'tools.canvas.anEdit': 'an edit',
  'tools.canvas.ageNow': 'now',
  'tools.canvas.ageSeconds': { one: '{count} s ago', other: '{count} s ago' },
  'tools.canvas.ageMinutes': { one: '{count} min ago', other: '{count} min ago' },

  // ---------- History labels the tools write ----------
  'tools.history.moveCorner': 'Move corner',
  'tools.history.paste': 'Paste {what}',
  'tools.history.pasteMany': { one: 'Paste {count} items', other: 'Paste {count} items' },
  /** What a one-item paste names, by entity type or connector kind. */
  'tools.noun.wall': 'wall',
  'tools.noun.opening': 'opening',
  /** An opening by its kind, in the History label a command writes ("Add door"). */
  'tools.noun.door': 'door',
  'tools.noun.window': 'window',
  'tools.noun.column': 'column',
  'tools.noun.slab': 'slab',
  'tools.noun.void': 'void',
  'tools.noun.shaft': 'shaft',
  'tools.noun.room': 'room',
  'tools.noun.separator': 'separator',
  'tools.noun.shape': 'shape',
  'tools.noun.fixture': 'fixture',
  'tools.noun.point': 'point',
  'tools.noun.dimension': 'dimension',
  'tools.noun.label': 'label',
  'tools.noun.item': 'item',
  'tools.noun.light': 'light',
  'tools.noun.stair': 'stair',
  'tools.noun.ladder': 'ladder',
  'tools.noun.ramp': 'ramp',
  'tools.noun.elevator': 'elevator',
  'tools.noun.escalator': 'escalator',
} as const;
