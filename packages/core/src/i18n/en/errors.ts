/**
 * Errors a person can meet through the interface. The English text is the error's `message`, which
 * agents read (MCP, the assistant's model) and the unit tests and the smoke compare: never reword it.
 * An error without a key here shows the lead for its code (`errors.code.*`) before its English message
 * in another language; the English interface shows the message alone.
 */
export const errors = {
  /** The lead shown before an untranslated error's English message, per code. */
  'errors.code.UNKNOWN_COMMAND': 'There is no such command.',
  'errors.code.NO_PROJECT': 'Open a project first.',
  'errors.code.INVALID_INPUT': 'The request is not valid.',
  'errors.code.NOT_FOUND': 'It could not be found.',
  'errors.code.MUTATION_BLOCKED': 'This change is not allowed.',
  'errors.code.MUTATION_DECLINED': 'The change was declined.',
  'errors.code.CONFLICT': 'This clashes with the current state.',
  'errors.code.UNSUPPORTED_VERSION': 'This needs a newer version of the app.',
  'errors.code.UNAVAILABLE': 'This is not available right now.',
  'errors.code.INTERNAL': 'Something went wrong.',

  // ---------- the registry ----------
  'errors.registry.noProject': '"{command}" needs an open project. Open or create one first.',
  'errors.registry.declined': 'The user declined "{title}".',
  'errors.library.noOpenProject': 'No project is open. Name one with `id`, or open one first.',

  // ---------- undo and redo ----------
  'errors.history.nothingToUndo': 'There is nothing to undo.',
  'errors.history.nothingToRedo': 'There is nothing to redo.',
  'errors.history.notNewest': 'The newest change is "{label}" by {author}, not the one you meant; nothing was undone.',
  'errors.history.noChange': 'No change {id} in the history',
  /** A change made meanwhile: "The wall was changed by you meanwhile; …". */
  'errors.stale.reloaded': 'The project was reloaded since you looked at it; nothing was changed. Try again.',
  'errors.stale.changed': 'The {what} was changed by {by} meanwhile; nothing was changed. Look again and retry.',
  'errors.stale.byYou': 'you',
  'errors.stale.byAssistant': 'the assistant ({name})',
  'errors.stale.byMcp': 'via MCP: {name}',

  // ---------- projects and the library ----------
  'errors.project.invalidFile': 'project.json is not valid: {issues}',
  'errors.project.notObject': 'project.json is not an object',
  'errors.project.newerFormat': 'This project was saved by a newer version of the app (format {format}; this version reads up to {max}). Update the app to open it.',
  'errors.project.noMigration': 'No migration from format {format}.',
  'errors.project.unreadable': 'project.json could not be read: {reason}',
  'errors.project.noneInFolder': 'No project in {folder}',
  'errors.project.notOpen': 'Project {id} is not open',
  'errors.project.nameRequired': 'name: A project needs a name',
  'errors.project.inTrash': 'Project "{name}" is in the trash',
  'errors.library.newer': 'This library was created by a newer version of the app. Update the app to use it.',
  'errors.library.noProject': 'No project with id {id}',
  'errors.library.notInTrash': '"{name}" is not in the trash',
  'errors.library.trashed': '"{name}" is in the trash; restore it first',
  'errors.library.exists': 'A project with id {id} already exists',
  'errors.library.noSnapshot': 'No snapshot {id}',
  'errors.library.notOpenYet': 'The project library is not open yet',
  'errors.library.sameFolder': 'The library is already in that folder.',
  'errors.library.insideCurrent': 'The new folder cannot be inside the current library.',
  'errors.library.noLibraryThere': 'There is no library in {folder}.',
  'errors.library.holdsLibrary': 'That folder already holds a library. Use it instead of moving this one.',
  'errors.library.notEmpty': 'Choose an empty folder for the library.',
  'errors.library.copyMismatch': 'The copy lists {after} projects instead of {before}; the library was not moved.',

  // ---------- project packages ----------
  'errors.file.missing': 'No file at {path}',
  'errors.package.tooLarge': 'The package is too large.',
  'errors.package.tooManyFiles': 'The package has too many files.',
  'errors.package.unsafe': 'The package contains an unsafe file ({problem}): {name}',
  'errors.package.caseClash': 'The package contains two files whose names differ only in case: {name}',
  'errors.package.unpacksTooLarge': 'The package unpacks to more than the allowed size.',
  'errors.package.compressed': 'The package contains a suspiciously compressed file: {name}',
  'errors.package.invalid': 'Not a valid project package: {reason}',
  'errors.package.noManifest': 'Not a project package: manifest.json is missing.',
  'errors.package.badManifest': 'Not a project package: manifest.json is not valid.',
  'errors.package.newer': 'This package was made by a newer version of the app. Update the app to import it.',
  'errors.package.noProject': 'Not a project package: project.json is missing.',
  'errors.package.damaged': 'The package is damaged: {name} does not match its checksum.',
  'errors.package.projectFailed': "The package's project could not be opened: {reason}",

  // ---------- the catalog and models ----------
  'errors.model.unusable': 'Not a usable glTF model: {reason}',
  'errors.model.notJson': 'Not a usable glTF model: the file is not valid JSON',
  'errors.model.format': 'Import a .glb file (or a .gltf with its data embedded).',
  'errors.model.tooLarge': 'The model is larger than {mb} MB.',
  'errors.catalog.checksum': '{file} does not match its checksum',
  'errors.catalog.noModel': 'The catalog has no model {file}',
  'errors.catalog.damaged': "The catalog's copy of {file} is damaged",

  // ---------- levels, layers and connectors ----------
  'errors.level.belowNeighbour': '"{name}" cannot be at or below "{other}" ({elevation} mm).',
  'errors.level.aboveNeighbour': '"{name}" cannot be at or above "{other}" ({elevation} mm).',
  'errors.level.mezzanineHost': 'A mezzanine must be placed from a stacked level',
  'errors.level.onlyMezzanineRehosts': 'Only a mezzanine can change its host; reorder stacked levels instead',
  'errors.level.groundStacked': 'Only a stacked level can be the ground level',
  'errors.level.reorderStacked': 'Only stacked levels can be reordered; move a mezzanine by changing its host or offset',
  'errors.level.hosted': { one: 'Remove or re-host {names} first: it is placed from this level.', other: 'Remove or re-host {names} first: they are placed from this level.' },
  'errors.level.last': 'A building needs at least one level.',
  'errors.level.duplicateMezzanine': 'Mezzanines cannot be duplicated yet; add a new one instead',
  'errors.layer.holds': { one: 'Layer "{name}" holds {count} item; move them or remove them with the layer.', other: 'Layer "{name}" holds {count} items; move them or remove them with the layer.' },
  'errors.layer.noDecorForLights': 'Level "{name}" has no decor layer for lights; add one with plan_layer_add',
  'errors.layer.noDecorForFurniture': 'Level "{name}" has no decor layer for furniture; add one with plan_layer_add',
  'errors.connector.spiralStart': 'A spiral stair needs its first step away from its centre',
  'errors.connector.lEnd': 'An L stair needs its end off both axes through its start',
  'errors.connector.stairPoints': 'A stair needs two different points',
  'errors.connector.rampPoints': 'A ramp needs two different points',
  'errors.connector.elevatorStops': 'An elevator needs two stacked levels to stop at',
  'errors.connector.escalatorLevels': 'An escalator needs its top level above its bottom level',

  // ---------- drawing ----------
  'errors.plan.closedRun': 'A closed run of walls needs at least three points, or arcs',
  'errors.plan.wallPoints': 'A wall needs at least two points',
  'errors.plan.closedWall': 'A closed wall needs at least three points, or arcs',
  'errors.plan.wallSamePoint': 'Two consecutive wall points are at the same place',
  'errors.plan.closedShape': 'A closed shape needs at least three points, or arcs',
  'errors.plan.samePoint': 'Two consecutive points are at the same place',
  'errors.plan.dimensionSamePoint': 'The two points are at the same place',
  'errors.plan.openingNowhere': 'The {kind} does not fit anywhere on this wall',
  'errors.plan.openingAt': 'The {kind} does not fit at {at} mm; the nearest place is {nearest} mm',
  'errors.plan.door': 'door',
  'errors.plan.window': 'window',
  'errors.plan.opening': 'opening',
  'errors.plan.stepFailed': 'Step {step} ({command}) failed, so nothing was changed: {reason}',
  'errors.plan.noWindow': 'No window drew the snapshot in time: snapshots need the app window open.',
  /** A snapshot or a PNG export with nothing to draw. */
  'errors.snapshot.nothing3d': 'Nothing is built in 3D yet: the building has no walls, slabs, columns or connectors.',
  'errors.snapshot.nothingOnLevel': 'Nothing is drawn on level {name} yet.',
  'errors.decor.noFaces': 'No wall faces look into "{name}" (is it enclosed?)',

  // ---------- export and import ----------
  'errors.exchange.noPng': 'The window did not answer with a PNG image.',
  'errors.exchange.tooBig': 'The window could draw only {drawnWidth} × {drawnHeight} px, not the {width} × {height} asked for; ask for a smaller image.',
  'errors.exchange.insideLibrary': 'Exports cannot be written inside the project library ({folder}); choose another folder.',
  'errors.exchange.exists': 'These files are there already: {names}. Export again with overwrite: true to replace them.',
  'errors.dxf.tooLarge': '{name} is {size} MB; DXF files over {max} MB are not imported.',
  'errors.dxf.missing': 'No file at {path}.',
  'errors.dxf.folder': '{path} is a folder, not a DXF file.',
  'errors.dxf.binary': 'This is a binary DXF; save it as an ASCII DXF and import that.',
  'errors.dxf.notDxf': '{name} is not a DXF file (no SECTION at its start).',

  // ---------- the app ----------
  /** The native dialog when a package opened from the system (a double-click) cannot be imported. */
  'errors.dialog.importFailed': 'Could not import the project',
  'errors.mcp.off': 'The MCP server is turned off in Settings.',
  'errors.updates.unavailable': 'Updates are not available in this host.',
  'errors.updates.nothingToDownload': 'There is no update to download: check for updates first.',
  'errors.updates.nothingToInstall': 'No update is ready to install: download it first.',
} as const;
