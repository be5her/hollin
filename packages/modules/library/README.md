# Library

The project library: one folder the app owns, where every project lives. Users never pick folders; they see projects.

- **Home** lists projects as cards (thumbnail or a coloured placeholder, name, when it changed, levels, tags), with search (name, description, tags; case and accents ignored), tag filters and sorting. New project, Import, and the trash (restore, delete permanently, empty).
- **Project tabs:** each open project has a tab. Several can be open at once; they reopen on the next start. The tab on screen is the project agents act on by default. A project opened anywhere (Home, the palette, an MCP agent) gets a tab; closing the tab saves and closes the project.
- **The project tab** (until the editors arrive): name, description and tags (saved when a field loses focus), save state, Save now, Export project (the package), Duplicate, Move to trash, and snapshots (save, restore, delete). Next to the view switch, Export… and Import DXF… open the exchange module's dialogs.
- **Settings > Library:** the folder, Move (to an empty folder; or switch to a library already in the chosen folder), Rescan (`library.reindex`: the project list from the folders and the furniture catalog's index from its model files, the old entries answering until the new ones are in).
- **Palette:** New project (Ctrl+N), Import project, and "Open project: <name>" for the 20 most recently opened.

## Storage

```
<library>/library.json                 format marker
<library>/index.json                   listing cache, rebuilt from the folders when missing, broken or stale
<library>/library.lock                 host, process and heartbeat of the copy of the app using the library
<library>/projects/<id>/project.json   meta, building, levels, layers, connectors, and the file of each level
<library>/projects/<id>/levels/<levelId>.<hash>.json   one level's entities
<library>/projects/<id>/assets/<sha256>.<ext>          glTF models and textures (content-addressed)
<library>/projects/<id>/thumbnail.png
<library>/projects/<id>/snapshots/<snapshotId>/        meta.json plus the same layout
<library>/trash/<id>/                  trashed projects, with trashed.json
<library>/catalog/                     furniture, materials and symbols shared by every project
<library>/catalog/furniture/           imported models, their thumbnails and index.json (see packages/modules/decor)
<library>/.staging/                    imports and copies in progress (cleared at startup)
```

- **Saving** is automatic: 750 ms after the last change, and at most 5 s while changes keep coming (an agent making many edits), plus on close and on quit. A project counts as saved only after a successful write; a failed save shows "Not saved" and is retried. When the save on close fails, the close is refused with the error and the project stays open with its edits (still retrying). Two opens of the same project at once make one session. Quitting saves once, even when Windows ends the session and the app then quits.
- **Crash safety:** level files are never overwritten. A save writes changed levels to new files named after their content hash, then replaces `project.json` (which lists each level's file) atomically, then deletes the files no longer listed. A crash at any point leaves either the old or the new `project.json` with all of its files; leftovers (unlisted level files, temp files, a snapshot's `snapshots/.tmp-<id>` staging folder) are removed on the next open, and only then: any other read leaves the folder alone, since an unlisted level file may be a save in progress. Exporting or duplicating an open project saves it first and reads its folder while no save can start. Files the app does not recognise (a sync service's conflict copies) are left alone.
- **Trash:** a project is marked trashed in the index before its folder moves, so a late write (a thumbnail) is refused rather than recreating `projects/<id>/`; restoring removes a folder left in its place without a `project.json`. Emptying the trash saves and announces the index even when one project cannot be deleted, and reports that error.
- **Snapshots** copy `project.json` and the level files; assets are shared because their names are their hashes. Restoring keeps the project's id, name, description and tags, and first saves the current design as an automatic snapshot. The last 10 automatic snapshots are kept; named ones stay until deleted.
- **Format versions:** `project.json` carries `formatVersion` (2 since the decor asset registry). An older file is migrated (after an automatic snapshot); a newer one is refused and never written.
- **Packages** (`.psp`, a zip): `manifest.json` plus a `project/` tree (the saved project, assets, thumbnail, optionally snapshots). Import unpacks into `.staging/`, checks it like opening a project and moves it in. It refuses path escapes, absolute or drive paths, reserved names (`CON`, `NUL`…), names that differ only in case, too many or too large files, suspiciously compressed entries, and assets whose content does not match their hash. An imported project keeps its id unless the library has it already, and gets " (imported)" when its name is taken. Secrets are never part of a project. Double-clicking a `.psp` file imports it.
- **One user at a time:** a second launch focuses the running window. `library.lock` warns on the Home screen when another copy (another computer on a synced folder, or a development build) has the library open. Choosing a cloud-synced folder shows a warning.
- **Thumbnails** are served to the renderer through the read-only `library://project/<id>/thumbnail.png` protocol. The same protocol serves a live project's assets (`library://project/<id>/assets/<sha256>.<ext>`) and the catalog's models and thumbnails (`library://catalog/furniture/<sha256>.glb|.png`); nothing else in the library is reachable that way (`libraryUrlFile` in core).

## Agents

- Allowed: `library.info`, `project.list`, `project.tags`, `project.current`, `project.create`, `project.open`, `project.close`, `project.update`, `project.duplicate`, `project.trash`, `project.restore`, `project.import`, `project.save`, `project.snapshot.list`, `project.snapshot.create`, `project.snapshot.restore` (reversible: it keeps a backup snapshot).
- Gated (refused until the user allows mutations in Settings > MCP): `project.delete`, `library.trash.empty`, `project.snapshot.delete`, `project.export` (writes outside the library), `library.move`.
- Not exposed: `project.focus`, `project.openList`, `project.thumbnail.set`, `library.checkFolder`, `library.reindex`.
- `project.export`, `project.import` and `library.move` take full (absolute) paths; a relative one is refused (`INVALID_INPUT`).
- Project tools act on the project on screen, or on the one named by `projectId` (opened if it is closed). Snapshots made by an agent are attributed to it ("via MCP: <name>").

## Verified by

Unit tests in `packages/core/src/node` (store and crash simulation, strays removed only on open and a read between two steps of a save keeping the new level file, snapshot staging folders cleared on open, session timing and failures, a failed save on close keeping the session open, no save starting during a folder read, library listing/search/index rebuild/trash/snapshots/thumbnails, a thumbnail refused while the project goes to the trash and restore over a leftover folder, emptying the trash failing part way, package round trip and hostile packages, the service's open/rename/restore/resolve/reopen/move, two concurrent opens making one session, a failed close keeping the edits, export and duplicate of an autosaving project); `packages/modules/library/library.test.ts` (relative paths refused); `src/main/host.test.ts` (`Host.stop` runs once). Smoke: `src/main/smoke/library.ts` (the whole lifecycle through commands, files on disk, autosave and save-on-close, snapshots, trash, packages, gates, the library over MCP with attribution) and `src/main/smoke/library-ui.ts` (the Home grid, search and tags, thumbnails over `library://`, New project, renaming and tags in the project tab, snapshots, dragging tabs, card menus, trash and emptying it, live updates when an agent opens, renames and closes a project, Settings > Library).
