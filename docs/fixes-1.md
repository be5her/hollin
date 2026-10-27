# Fixes 1: skipped fixes across milestones 1–9

A review of milestones 1–9 (2026-10-27) found these. Each group is one commit on `main`, verified with `npm run typecheck`, `npm test` and `npm run smoke` (with `SMOKE_SHOTS` and the screenshots looked at, light and dark, when the group touches the UI). Every fix gets a unit test next to the code, or a smoke check when it is UI. File:line references are from commit 67996d9 and may have moved; re-read the code before changing it, and if a finding turns out wrong, skip it and say so in the commit message. Module READMEs (what it does, Verified by) and CLAUDE.md gotchas are kept current in the same commit.

## Group 1: storage and library (milestones 1–2)

1. `readProjectDir` (`packages/core/src/node/project-store.ts:55`) always runs `removeStrays`. `exportPackage` (`package.ts:55,69`) and `Library.duplicate` (`library.ts:341`) read an open project's folder unserialized against autosave; `writeProjectDir` writes new level files before `project.json`, so a read in between deletes the new level file and the level later opens empty. Fix: strays are removed only by `open` (a read option), and reads of an open project go through its session (flush first or read under its write queue). Test: a read between the two writes keeps the file.
2. Two concurrent `open`s of the same closed project (`project-service.ts:163-190`) create two sessions (sessions.has is checked before `await readProjectDir`). Fix: a map of in-flight open promises. Test: `Promise.all` of two opens yields one session.
3. Trash (`library.ts:358-367`) renames the folder and writes `trashed.json` before the index marks it trashed; a late `setThumbnail` (`:464`) recreates `projects/<id>/` and `restore` then fails. Fix: mark the index first / refuse writes for a project being moved, and have restore clear a target folder that has no `project.json`. Test.
4. A failed close leaves a zombie session (`project-session.ts:129` sets `closed` in `finally`; `ProjectService.close` rethrows without unregistering). Fix: on a failed flush keep the session open and usable (not closed) and report the error, or unregister consistently; pick the one that loses no edits. Test.
5. `emptyTrash` (`library.ts:387`): a failing `fs.rm` skips `changed()`. Fix: always save the index and announce `library.changed` (try/finally), report the failure. Test.
6. `project.export`, `project.import`, `library.move` (`packages/modules/library/main.ts:147,156,167`) accept relative paths; refuse them like `exchange/main.ts:80` does.
7. `createSnapshot` staging folders `snapshots/.tmp-<id>` are never cleaned after a crash; remove stale ones (on open or on listing).
8. `src/main/index.ts:150`: `session-end` calls `host.stop()` without setting `stopping`, so `before-quit` stops again. Make stop idempotent.

## Group 2: document model and 2D editor (milestones 3–4)

1. `plan.transform` (`packages/modules/plan/main.ts:726-733`) slides a selected opening along its wall even when the wall is selected too (it then moves twice). Skip openings whose wall is in `ids`; a nudge of a lone opening goes through `fitOpening` (no past-the-end, no overlap). Tests.
2. Horizontal/vertical dimensions under rotate and mirror (`packages/core/src/geometry/transform.ts:105`): a mirror across x=0 jumps the line, a 180° rotation keeps it on the wrong side, a 90° rotation reads 0. Fix: swap `kind` on 90°/270°, turn into `aligned` for other angles, get the offset sign right for mirrors and 180°. Tests.
3. Mirror does not flip a wall's `alignment` (left↔right) or `materials.left/right` (`transform.ts:84-85`). Fix and test.
4. `labelPoint` (`packages/core/src/geometry/rooms.ts:86-94`) falls back to `polygon[0]` (on the wall face), so `plan.room.detect` on a ring corridor seeds a room that is "not enclosed"; the void check in `unclaimedCavities` and label placement share it. Fix: a pole-of-inaccessibility or scanline interior point. Test with a ring.
5. A tied dimension whose anchor stops resolving falls back to the stored `from`/`to` (`dimensions.ts:17-46`), which a tied wall's move never updates. Fix: keep `from`/`to` in step with the resolved anchors when the tied entity changes (in the transaction), and when `plan.entity.update` replaces a path, drop or remap anchors whose vertex index no longer means the same vertex. Tests.
6. `plan.wall.add` (`main.ts:171-174`): with `closed: true` the zero-length check skips the closing segment, and two points with `closed: true` make two overlapping walls. Check `(i+1) % n` like `plan.shape.add`, refuse a closed wall with fewer than 3 points. Test.
7. `engine.ts:132-138`: a merged step that cancels out is popped, but its `txId` is still returned; return none (or the current top) so `edit.undo({ifTop})` is not refused. Test.
8. Paste (`packages/viewport/src/plan2d/tools/select.ts:777`) drops each entity's layer; keep it when the layer exists on the target level. Test or smoke.

## Group 3: assistant and MCP (milestones 5–6)

1. `packages/modules/assistant/loop.ts:76,82`: at the round limit, and on a Stop with several tool calls pending, the assistant message holding `tool_use` is kept without `tool_result`s, so the next send gets a 400 from the real API. Fix: answer every pending call with a result (an error "not run: stopped" / "round limit") or drop that message. `fake-api.ts` checks that every `tool_use` has its `tool_result` (fail the scripted turn otherwise). Tests for both cases.
2. `claude-code.ts:379,405`: any death before the first result counts as `resume-failed` and drops the stored session. Only treat it so when Claude Code says the session could not be found (read what the real binary prints, see the module README); other failures keep the session. Test via fake-claude.
3. The Claude Code live prompt (project name, levels) is computed once at process start (`main.ts:298`, `claude-code.ts:316`). Refresh it: send the current level list with each user message (or restart on level changes); pick the cheaper, explain in the README. Test.
4. `loadChat` (`main.ts:355`) restores a stored Claude Code transcript into an API chat, and `assistant.clear` never removes it there (`storeChat` saves nothing for the API provider). Fix: clear removes the stored copy for every provider; load only what belongs to the current provider. Test.
5. `packages/mcp/src/index.ts:155`: `readOnlyHint: !meta.mutating` marks ordinary edits read-only. Use `readOnlyHint` from a command's real nature (commands that change nothing: queries, describe, list, get) and `destructiveHint: mutating`. If the registry has no read-only notion, add `readOnly?: boolean` to command metadata or infer from a naming rule; mcp.test checks an edit is not read-only and a query is.
6. `claude-code.ts:454`: echo detection matches text and ignores `isReplay`; use `isReplay`. Test.
7. `packages/modules/building/main.ts:189` `building.level.remove` description: elevators lose the stop; stairs, ramps, ladders and escalators arriving at it are removed. Fix the text.
8. `src/main/host.ts:204`: the MCP server instructions point to `studio://guidelines` and the prompts.

## Group 4: 3D view and decor (milestones 7–8)

1. `walkFrom` (`packages/viewport/src/scene3d/view.ts:446`) reads the level lift from `hit.object.parent?.parent`, wrong for furniture meshes; use the level group as `pick()` does.
2. The walker is stuck within `WALKER_RADIUS` of walls/obstacles (`solids/walk.ts:100`), even when moving away. Allow moves that do not reduce clearance, and nudge a start point out of an obstacle. Unit tests.
3. Repaint by material name fails for unnamed (`material-<i>`) or long/trimmed names (`decor/glb.ts:303`, `scene3d/decor.ts:136`). Key slots so that the 3D view finds the same material (e.g. by glTF material index, mapped from the loaded scene via `parser.associations`), keeping stored slot names working. Test.
4. The repaint material drops `flatShading` that GLTFLoader set for primitives without normals; carry it over (a flat-shaded variant). Test.
5. Stand-in boxes (`scene3d/decor.ts:157`): dispose their geometry on removal and dispose; the colour comes from the scene theme, not a raw `#9a9a9a`.
6. `scene3d/models.ts:46`: a failed model load is cached forever; retry on the next build after a failure (or when the asset is announced again).
7. WebGL context loss: listen for `webglcontextlost`/`restored` on the 3D view's canvas; show the existing "could not start WebGL" style banner while lost and rebuild on restore. Smoke check if feasible via `WEBGL_lose_context`.
8. The Library settings' Rescan (`library.reindex`, `node/library.ts:210`) also rebuilds the catalog index (`Catalog.reindex`); `reindex` builds the new index before swapping it in, so lookups during a rebuild still succeed. Test.

## Group 5: export writers (milestone 9, steps 1–2)

1. DXF text height (`packages/core/src/exchange/dxf.ts:426`): group 40 is cap height; write `height * 0.72` (`paper.ts` cap ratio, one constant).
2. DXF `baseline: 'bottom'` (`dxf.ts:422`) → 73 = 0 (baseline), not 1.
3. A zero-sweep arc (`dimensions.ts:91-105`, `drawing.ts:368`) is written as a full circle; skip arcs with |sweep| < 1e-9 in the drawing.
4. Solid fills on non-hatch layers (the stair/ramp start dot, `drawing.ts:484`) are missing in DXF (`dxf.ts:440`); write them as HATCH (or a filled CIRCLE) whenever opacity is 1.
5. PDF: Info `/Title` as UTF-16BE with BOM (`pdf.ts:358`); control characters in text become spaces, not `?` (`pdf.ts:185-194`); README notes page text is WinAnsi.
6. Text bounds (`drawing.ts:563`) honour `align`.
7. A fixed scale whose drawing does not fit the sheet (`paper.ts:74`): `export.plan` returns `fits: false` per level and the UI toast says so.
8. The title block shrinks or ellipsizes a long project name (`paper.ts:116`) using `textWidthEm`.
9. `export.plan` takes the `units` input the spec lists (default the config's).
10. Tests: empty drawings to SVG and PDF, DXF text height and alignment, a zero-sweep angular dimension, PDF control characters, an oversize drawing at a fixed scale.

## Group 6: glTF and DXF import (milestone 9, steps 3–5)

1. `readGlbTriangles` (`packages/core/src/decor/glb.ts:546`) bakes the world matrix without reversing winding when its determinant is negative. Fix and test with a mirrored node.
2. Imported models lose alpha and double-sidedness in the glTF export (`glb.ts:561`, `exchange/gltf.ts:196`): keep baseColorFactor alpha, `alphaMode`, `doubleSided`.
3. An imported model that yields no triangles is dropped silently (`gltf.ts:187-203`): report it in `skipped`.
4. DXF ATTRIB after INSERT (`dxf-read.ts:339-343`): import attribute values as labels (or at least count them as skipped).
5. MINSERT (`dxf-read.ts:433`): expand the column/row array (70/71, 44/45).
6. `$MEASUREMENT` (0 = imperial) is used when `$INSUNITS` is absent (`dxf-read.ts:573`, `dxf-import.ts:73`).
7. Layer name case is one rule everywhere (`dxf-import.ts:122-126,194,208-210`): case-insensitive, as DXF is.
8. ARC and elliptical arcs import as open `shape`s, as the spec says (`dxf-import.ts:261-267`), not separators (which split rooms). Update the command description.
9. Tests: INSERT with negative X scale, INSERT with ATTRIBs, MINSERT, a single undo removes everything an import added.

## Group 7: exchange UI and safety (milestone 9, step 6)

1. Component dialogs (`packages/ui/src/dialogs/dialog-host.html:4-14`): focus moves inside on open (first field), Escape cancels wherever focus is inside, Tab is trapped, `aria-labelledby` the heading; focus returns to the opener on close.
2. Multi-level DXF/SVG export (`exchange/main.ts:150`, `levelPaths`): the UI lists the files it will write and asks before overwriting any that exist (a check command, or `export.plan` with `overwrite: false` returning a CONFLICT with the names).
3. Exports refuse paths inside the library folder (`exchange/main.ts:128,184,229`).
4. A busy state during an export: the Export… button is disabled and shows progress until the command returns.
5. glTF honours the level choice (`export-dialog.html:20`, `exchange-actions.ts:91`).
6. The PNG theme starts as the app's current theme each time (`exchange-actions.ts:65,82`), as the README says.
7. `import.dxf` / `import.dxf.probe` refuse files over 200 MB before reading (`exchange/main.ts:83`).
8. The import toast counts only unsupported entities as skipped (`exchange-actions.ts:136`), not degenerate/empty ones.
9. The Layers panel's Import DXF… passes the panel's `levelId` (`building/ui/layers-panel.ts:105`).
10. Smoke (`src/main/smoke/exchange-ui.ts`): Escape on both dialogs, Cancel on import, the prefilled scale and editing it, the Current level choice, a non-DXF pick giving an error toast and no dialog, the overwrite question, the busy state.

## Group 8: theme, shell, docs; the escalator tool

1. Light slab colour: `packages/viewport/src/plan2d/theme.ts:38` `#dcdcd7` vs `styles.css:34` `#e2e2dd`; pick the CSS value. `snapshot-theme.test.ts` also checks `LIGHT_THEME` against `:root` `--plan-*` and `SOLID_COLORS`/`LIGHT_SCENE_THEME` against `--scene-*` (then drop the "unchecked" note in CLAUDE.md).
2. Remove the dead `connectorFill` / `--plan-connector-fill` token.
3. `triangulatePolygons` (`packages/core/src/geometry/clip.ts:118`): compare the triangles' area with the net area; on a mismatch retry after a union / larger simplification, and test it.
4. The title-bar Settings gear uses `button[xIconButton]`.
5. Docs: viewport README lists `scene3d/scene.test.ts`; plan README's stale "milestone 5" note; CLAUDE.md's shortcut list adds `I` (Furniture) and `G` (Light).
6. The escalator tool: escalators can be placed from the plan like stairs and ramps (a tool and shortcut, an options bar, and an intent form of `building.connector.add`), with smoke checks through commands, MCP and the UI.
