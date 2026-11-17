/**
 * Default names main writes into documents and the library when something is created: levels,
 * layers, rooms, copies, automatic snapshots. Written in the language of the moment and kept as
 * written (a project made in Arabic keeps `الطابق الأرضي` after a switch to English). Code that numbers
 * defaults checks the names in every language (`defaultNameTaken`). The English text is what the unit
 * tests, the smoke and agents read: never reword it.
 */
export const defaults = {
  'defaults.level.ground': 'Ground floor',
  'defaults.level.numbered': 'Level {n}',
  'defaults.level.basement': 'Basement {n}',
  'defaults.level.mezzanine': 'Mezzanine',
  'defaults.layer.structure': 'Structure',
  'defaults.layer.interior': 'Interior',
  'defaults.layer.decor': 'Decor',
  /** A second layer of a kind on a level: "Interior 2". */
  'defaults.layer.numbered': '{name} {n}',
  'defaults.room': 'Room {n}',
  /** The light placed with a lamp (`decor.item.place` with `withLight`), named after the lamp. */
  'defaults.lampLight': '{name} light',
  /** A duplicated level or project. */
  'defaults.copy': '{name} copy',
  'defaults.snapshot.named': 'Snapshot',
  'defaults.snapshot.beforeUpgrade': 'Before upgrading from format {format}',
  'defaults.snapshot.beforeRestore': 'Before restoring "{name}"',
  'defaults.snapshot.beforeEditing': 'Before editing ({when})',
  'defaults.snapshot.beforeBatch': 'Before "{label}"',
  /** Who made an automatic snapshot (`createdBy`), as stored; shown through `authorText`. */
  'defaults.author.app': 'App',
  'defaults.author.assistant': 'Assistant',
  'defaults.author.assistantModel': 'Assistant ({name})',
  'defaults.author.mcp': 'via MCP: {name}',
  'defaults.author.unknownAgent': 'unknown agent',
} as const;
