/**
 * History labels the commands write (`editProject`): written in the language of the moment and kept
 * as written. `{what}` is a noun from `tools.noun.*` (the History labels the viewport's tools write
 * live in `tools.history.*`), `{name}` a name someone gave. Labels an agent supplies (`plan.apply`'s
 * `label`) are kept as given. The English text is what agents and the smoke read: never reword it.
 */
export const labels = {
  'labels.add': 'Add {what}',
  'labels.change': 'Change {what}',
  'labels.remove': 'Remove {what}',
  'labels.delete': 'Delete {what}',
  'labels.move': 'Move {what}',
  'labels.copy': 'Copy {what}',
  'labels.rotate': 'Rotate {what}',
  'labels.mirror': 'Mirror {what}',
  'labels.nudge': 'Nudge {what}',
  /** Several entities at once, as `{what}` above. */
  'labels.items': { one: '{count} items', other: '{count} items' },

  'labels.corner.move': 'Move corner of {what}',
  'labels.corner.add': 'Add corner of {what}',
  'labels.corner.remove': 'Remove corner of {what}',
  'labels.corner.round': 'Round corner of {what}',
  'labels.corner.chamfer': 'Chamfer corner of {what}',
  'labels.corner.sharpen': 'Sharpen corner of {what}',
  'labels.segment.change': 'Change segment of {what}',

  'labels.wall.addMany': { one: 'Add {count} walls', other: 'Add {count} walls' },
  'labels.room.add': 'Add room',
  'labels.room.detect': 'Detect rooms',
  'labels.shape.add': 'Add shape',
  'labels.dimension.add': 'Add dimension',

  'labels.level.add': 'Add level',
  'labels.level.addNamed': 'Add level "{name}"',
  'labels.level.change': 'Change level "{name}"',
  'labels.level.duplicate': 'Duplicate level "{name}"',
  'labels.level.move': 'Move level "{name}"',
  'labels.level.remove': 'Remove level "{name}"',

  'labels.layer.add.structure': 'Add structure layer',
  'labels.layer.add.interior': 'Add interior layer',
  'labels.layer.add.decor': 'Add decor layer',
  'labels.layer.show': 'Show "{name}"',
  'labels.layer.hide': 'Hide "{name}"',
  'labels.layer.lock': 'Lock "{name}"',
  'labels.layer.unlock': 'Unlock "{name}"',
  'labels.layer.change': 'Change layer "{name}"',
  'labels.layer.reorder': 'Reorder layers',
  'labels.layer.remove': 'Remove layer "{name}"',

  'labels.place': 'Place {name}',
  'labels.light.point': 'Add point light',
  'labels.light.spot': 'Add spot light',
  'labels.light.area': 'Add area light',
  'labels.finish.wall.left': 'Finish wall (left): {what}',
  'labels.finish.wall.right': 'Finish wall (right): {what}',
  'labels.finish.walls': 'Finish the walls of {name}: {what}',
  'labels.finish.floor': 'Finish the floor of {name}: {what}',
  'labels.finish.ceiling': 'Finish the ceiling of {name}: {what}',
  /** A finish taken off. */
  'labels.finish.nothing': 'nothing',

  'labels.import': 'Import {name}',
  'labels.projectDetails': 'Project details',
} as const;
