# Decor

Furniture, lights and finishes: the 3D layer of a design.

- **The catalog** holds the furniture models a project can use. Models imported by the user live in the library (`catalog/furniture/`) and are shared by every project; a project keeps its own copy of each model it uses, so it never needs the catalog again (packages, snapshots and other machines carry the model with the project).
- **Importing a model** (`catalog.import`): a `.glb` file, or a `.gltf` whose buffers are embedded as data URIs, up to 50 MB. The file is checked before anything is stored: the GLB header and chunks, the JSON, every buffer view inside its buffer and every accessor inside its buffer view, the meshes, nodes and scenes it names (and no cycles), and no outside files. Draco and meshopt compression and KTX2 textures are refused with a clear message (the app ships no decoders for them). The model is measured from its position accessors' bounds through the node transforms, and glTF's metres with y up become the app's millimetres with z up (a model's front, +z in glTF, faces −y on the plan). It is stored as `<sha256>.glb` (a `.gltf` is packed into a GLB first), named from its file name, in the category `imported`, with the file name's words as tags. Importing the same file again lists it once. GLB reading and writing is `packages/core/src/decor/glb.ts`, no library: the writer makes the smoke test's model and will make Milestone 9's export.
- **References** follow one grammar (`packages/core/src/decor/refs.ts`): `asset:<sha256>.<ext>` (a model in the catalog and in a project's assets), `builtin:<id>` (furniture, materials and styles that ship with the app) and `paint:#rrggbb` (any colour, as a material). Items take models, finishes and slots take materials, openings take styles; the schema checks the form, and the transaction checks that every `asset:` an item uses is in the project's registry.
- **Placing an item** (`decor.item.place`) puts a model's bottom centre at a point of a level, at a height above its floor, turned on the plan, sized by `size` in mm or by `scale`. A library model is copied into the project's `assets/` and registered in the same undoable change.

## Storage

```
<library>/catalog/furniture/<sha256>.glb   imported models
<library>/catalog/furniture/<sha256>.png   their thumbnails (drawn by the window)
<library>/catalog/furniture/index.json     name, category, tags, size, low corner, bytes, triangles per model:
                                           a cache, rebuilt from the files when missing, broken or out of step
<library>/projects/<id>/assets/<sha256>.glb  the project's copy of each model it uses
project.json `assets`                      the project's registry: per file, its name, kind, category, size and low corner
```

Every write is atomic (`writeFileAtomic`) and queued per file. The registry arrived with format 2 of `project.json`; a format 1 project is migrated (an empty registry) after an automatic snapshot. Removing a model from the catalog never touches the projects that use it.

The window reads models and thumbnails read-only through `library://project/<id>/assets/<sha256>.<ext>` and `library://catalog/furniture/<sha256>.glb|.png` (`libraryUrlFile` in `packages/core/src/node/library-urls.ts`: every segment matched whole, so nothing else in the library is reachable).

## Agents

- Allowed: `catalog.search` (imported models by words in their name, category or tags, with their size and where they come from; the project's own models too when the catalog lacks them), `catalog.get`, `catalog.import` (from a file path), `decor.item.place` (also a step of `plan.apply`). Items are edited and removed with `plan.entity.update`, `plan.transform` and `plan.entity.delete`.
- Gated: `catalog.remove` (deletes from the library catalog for good).
- Not exposed: `catalog.thumbnail.set`.

## Verified by

Unit tests: `packages/core/src/decor/glb.test.ts` (a written model read back with its extent, node transforms and a quarter turn, truncated and hostile files, refused extensions, a split `.gltf` packed into one GLB, outside files refused), `packages/core/src/node/catalog.test.ts` (import under the hash with size and tags, once; a `.gltf` stored as a GLB; refusals that leave nothing behind, the 50 MB limit; the index rebuilt and pruned; thumbnails, removal, copying into a project; the `library://` paths and everything they refuse), `packages/core/src/doc/doc.test.ts` (the format 1 migration, an item's asset checked against the registry, an asset in use kept, the reference grammar, the registration undone with the item and followed by the mirror). Smoke: `src/main/smoke/decor.ts` (a GLB from the core writer imported, its index entry and size, the event, a second import listed once, damaged and foreign files refused, the tools over MCP with the thumbnail plumbing hidden, an agent finding the model and being refused its removal, an agent placing it in a project sized in mm with the copy and registry entry, an unknown model and a malformed reference refused, the project exported and imported as a package after the model left the catalog with its asset intact, the project's own model offered by `catalog.search`; in the window, a project asset and a catalog model served over `library://` and the project file, the index and a climbing path not).
