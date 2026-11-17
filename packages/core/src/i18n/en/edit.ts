/** Undo, redo and the History panel. */
export const edit = {
  'edit.title': 'History',
  'edit.group': 'Edit',
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'edit.waiting': 'Otto · waiting for your yes',
  /** A History row as a screen reader reads it: "Add wall, You. Enter selects it on the plan, …". */
  'edit.entry': '{label}, {signature}. Enter selects it on the plan, double-click undoes down to it.',
  'edit.entryHint': 'Click to select what it changed; double-click to undo down to here',
  'edit.empty': 'No changes yet. Everything you, Otto or an agent change appears here and can be undone.',
  /** Who made a change, in its meta line. */
  'edit.author.user': 'You',
  'edit.author.mcp': 'MCP · {name}',
} as const;
