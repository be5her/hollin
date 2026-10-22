import {
  StudioError,
  addEntityOps,
  builtinEntries,
  deriveLevelGeometry,
  requireEntity,
  updateEntityOps,
  wallSidesFacing,
  builtinMaterial,
  builtinRecipe,
  defineCommand,
  defineModule,
  editProject,
  modelEntry,
  parseRef,
  requireLevel,
  searchCatalog,
  type Asset,
  type CatalogEntry,
  type CommandContext,
  type Op,
} from '@studio/core';
import { z } from 'zod';

const levelId = z.string().describe('Level id, from building_get');
const Point = z.tuple([z.number(), z.number()]).describe('[x, y] in mm, y up');
const Size = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

function assetEntry(file: string, a: Asset): CatalogEntry {
  return { ref: `asset:${file}`, kind: 'item', source: 'project', name: a.name, category: a.category, tags: [], size: a.size, slots: a.slots ?? [], thumbnail: null };
}

/** Every entry an agent or the Catalog panel can pick from: the built-ins, the library's models, and models only the project has. */
function allEntries(ctx: CommandContext): CatalogEntry[] {
  const library = ctx.host.projects.catalog.models().map(modelEntry);
  const known = new Set(library.map((e) => e.ref));
  const project = Object.entries(ctx.project?.doc.assets ?? {})
    .filter(([file]) => !known.has(`asset:${file}`))
    .map(([file, a]) => assetEntry(file, a));
  return [...builtinEntries(), ...library, ...project];
}

/** Refuses a material that is neither a built-in nor a paint colour. */
export function checkMaterial(ref: string, where: string): void {
  const parsed = parseRef(ref);
  if (parsed?.k === 'paint') return;
  if (parsed?.k === 'builtin' && builtinMaterial(parsed.id)) return;
  throw new StudioError('INVALID_INPUT', `${where}: ${ref} is not a material; use builtin:<id> from catalog_search with kind "material", or paint:#rrggbb`);
}

interface ResolvedModel {
  name: string;
  size: readonly [number, number, number];
  slots: string[];
  /** The asset to register (and file to copy) when the model is new to the project. */
  register?: Asset;
  elevation?: number;
  /** A lamp's bulb (model coordinates, mm) and its lumens. */
  bulb?: readonly [number, number, number];
  lumens?: number;
}

/** What a model reference stands for in this project. */
async function resolveModel(ctx: CommandContext, ref: string): Promise<ResolvedModel> {
  const parsed = parseRef(ref);
  if (parsed?.k === 'builtin') {
    const recipe = builtinRecipe(parsed.id);
    if (recipe) return { name: recipe.name, size: recipe.size, slots: Object.keys(recipe.slots), ...(recipe.elevation ? { elevation: recipe.elevation } : {}), ...(recipe.bulb ? { bulb: recipe.bulb, lumens: recipe.lumens } : {}) };
  }
  if (parsed?.k === 'asset') {
    const own = ctx.project!.doc.assets[parsed.file];
    if (own) return { name: own.name, size: own.size, slots: own.slots ?? [] };
    const model = ctx.host.projects.catalog.model(parsed.file);
    if (!model) throw new StudioError('NOT_FOUND', `No model ${ref} in the catalog or the project; catalog_search lists them`);
    await ctx.host.projects.catalog.copyToProject(parsed.file, ctx.project!.id);
    return { name: model.name, size: model.size, slots: model.slots, register: { id: parsed.file, kind: 'model', name: model.name, category: model.category, size: model.size, min: model.min, bytes: model.bytes, ...(model.slots.length ? { slots: model.slots } : {}) } };
  }
  throw new StudioError('NOT_FOUND', `No model ${ref}; catalog_search lists the models`);
}

/**
 * Decor: the catalog of furniture models (imported into the library) and placing them in a project.
 * Models are content-addressed GLB files; a project keeps its own copy of every model it uses.
 */
export const decorModule = defineModule({
  id: 'decor',
  commands: [
    defineCommand({
      id: 'catalog.search',
      title: 'Search the catalog',
      description:
        "Searches the catalog: furniture and other models (kind 'item', the default: built-in ones and models imported into the library, which decor_item_place takes), materials (kind 'material': paints, timber, tiles, stone, carpet, brick, fabrics, metals, glass, for decor_material_set and item slots; any colour is also `paint:#rrggbb`) or door and window styles (kind 'style', for an opening's `style`). `query` ranks by name, then category and tags; `category` keeps one category (items: living, dining, bedroom, kitchen, bathroom, office, lighting, outdoor, imported). Returns entries with `ref`, name, category, tags, size [width, depth, height] in mm (items), material slots, the colour (materials), whether a lamp can bring its light, and where it comes from (builtin, the library, or only this project).",
      scope: 'global',
      input: z.object({
        query: z.string().max(200).optional(),
        kind: z.enum(['item', 'material', 'style']).default('item'),
        category: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      handler: async ({ query, kind, category, limit }, ctx) => {
        const entries = allEntries(ctx).filter((e) => e.kind === kind && (!category || fold(e.category) === fold(category)));
        return searchCatalog(entries, query).slice(0, limit);
      },
    }),
    defineCommand({
      id: 'catalog.get',
      title: 'Catalog entry',
      description: 'One catalog entry by its `ref` (from catalog_search): an item with its size in mm and material slots, a material with its colour, or a style.',
      scope: 'global',
      input: z.object({ ref: z.string().min(1).max(200) }),
      handler: async ({ ref }, ctx) => {
        const entry = allEntries(ctx).find((e) => e.ref === ref);
        if (!entry) throw new StudioError('NOT_FOUND', `No catalog entry ${ref}`);
        return entry;
      },
    }),
    defineCommand({
      id: 'catalog.import',
      title: 'Import a model',
      description:
        'Adds a 3D model to the library catalog from a .glb file (or a .gltf with its data embedded), up to 50 MB, at `path` (a full file path). The file is checked (structure, buffers, accessors; Draco, meshopt and KTX2 compression are refused) and measured. Returns the entry, with `added` false when the same model was already there.',
      scope: 'global',
      input: z.object({ path: z.string().min(1) }),
      handler: async ({ path }, ctx) => {
        const { model, added } = await ctx.host.projects.catalog.importModel(path);
        return { ...modelEntry(model), added };
      },
    }),
    defineCommand({
      id: 'catalog.remove',
      title: 'Remove a model from the catalog',
      description: 'Deletes an imported model from the library catalog for good. Projects that use it keep their own copy.',
      scope: 'global',
      mutating: true,
      input: z.object({ ref: z.string().min(1).max(200) }),
      handler: async ({ ref }, ctx) => {
        const parsed = parseRef(ref);
        if (parsed?.k !== 'asset') throw new StudioError('INVALID_INPUT', `${ref} is not an imported model; built-in entries cannot be removed`);
        await ctx.host.projects.catalog.removeModel(parsed.file);
        return { removed: ref };
      },
    }),
    defineCommand({
      id: 'catalog.thumbnail.set',
      title: 'Set a model thumbnail',
      description: 'Stores the PNG thumbnail the window drew for an imported model.',
      scope: 'global',
      hidden: true,
      input: z.object({ ref: z.string().min(1).max(200), png: z.string().min(1).describe('PNG image, base64') }),
      handler: async ({ ref, png }, ctx) => {
        const parsed = parseRef(ref);
        if (parsed?.k !== 'asset') throw new StudioError('INVALID_INPUT', `${ref} is not an imported model`);
        return modelEntry(await ctx.host.projects.catalog.setThumbnail(parsed.file, new Uint8Array(Buffer.from(png, 'base64'))));
      },
    }),
    defineCommand({
      id: 'decor.material.set',
      title: 'Set a finish',
      description:
        "Gives a surface a material (`builtin:<id>` from catalog_search with kind 'material', or `paint:#rrggbb` for any colour), or clears it with `material: null`. The target is one face of a wall (`wallId` and `side`, left or right looking along the wall's path), or a room's `floor`, `ceiling` or `walls` (every wall face that looks into the room, all in one change). Finishes show in the 3D view; plan_describe lists them per room. One undo step. Returns what was changed.",
      scope: 'project',
      batchable: true,
      input: z.object({
        target: z.union([z.object({ wallId: z.string(), side: z.enum(['left', 'right']) }), z.object({ roomId: z.string(), surface: z.enum(['floor', 'walls', 'ceiling']) })]),
        material: z.string().min(1).max(200).nullable(),
      }),
      handler: async ({ target, material }, ctx) => {
        if (material !== null) checkMaterial(material, 'material');
        const doc = ctx.project!.doc;
        const what = material ?? 'nothing';
        type Face = { wallId: string; side: 'left' | 'right' };
        const paintFaces = (tx: { doc: typeof doc; apply: (ops: Op[]) => void }, faces: Face[]) => {
          for (const face of faces) {
            const wall = requireEntity(tx.doc, face.wallId);
            if (wall.type !== 'wall') throw new StudioError('INVALID_INPUT', `${face.wallId} is a ${wall.type}, not a wall`);
            const materials = { ...(wall.materials ?? {}) };
            if (material) materials[face.side] = material;
            else delete materials[face.side];
            tx.apply(Object.keys(materials).length ? updateEntityOps(tx.doc, wall.id, { materials }) : updateEntityOps(tx.doc, wall.id, {}, ['materials']));
          }
        };
        if ('wallId' in target) {
          const wall = requireEntity(doc, target.wallId);
          if (wall.type !== 'wall') throw new StudioError('INVALID_INPUT', `${target.wallId} is a ${wall.type}, not a wall`);
          await editProject(ctx, `Finish wall (${target.side}): ${what}`, (tx) => paintFaces(tx, [target]));
          return { changed: [target] };
        }
        const room = requireEntity(doc, target.roomId);
        if (room.type !== 'room') throw new StudioError('INVALID_INPUT', `${target.roomId} is a ${room.type}, not a room`);
        if (target.surface === 'walls') {
          const entities = doc.levelData[room.levelId].entities;
          const faces = wallSidesFacing(entities, deriveLevelGeometry(entities).rooms.values(), room.id);
          if (!faces.length) throw new StudioError('INVALID_INPUT', `No wall faces look into "${room.name}" (is it enclosed?)`);
          await editProject(ctx, `Finish the walls of ${room.name}: ${what}`, (tx) => paintFaces(tx, faces));
          return { changed: faces };
        }
        await editProject(ctx, `Finish the ${target.surface} of ${room.name}: ${what}`, (tx) => {
          const current = tx.doc.levelData[room.levelId].entities[room.id] as typeof room;
          const finish = { ...(current.finish ?? {}) };
          if (material) finish[target.surface as 'floor' | 'ceiling'] = material;
          else delete finish[target.surface as 'floor' | 'ceiling'];
          tx.apply(Object.keys(finish).length ? updateEntityOps(tx.doc, room.id, { finish }) : updateEntityOps(tx.doc, room.id, {}, ['finish']));
        });
        return { changed: [target] };
      },
    }),
    defineCommand({
      id: 'decor.light.add',
      title: 'Add a light',
      description:
        "Adds a light to a level's decor layer: a `point` light (a bulb, shining all round), a `spot` (aimed at `target` [x, y, z], or straight down, with a cone `angle` in degrees, 60 by default) or an `area` light (a 600 mm panel shining down). `at` is [x, y, height above the floor] in mm; `intensity` is in lumens (800 by default, a household bulb; 1500 a bright ceiling light); `color` is #rrggbb (#ffffff by default; #ffe9c4 is a warm white). Lights show in the 3D view at night. Returns its id.",
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        kind: z.enum(['point', 'spot', 'area']).default('point'),
        at: z.tuple([z.number(), z.number(), z.number()]).describe('[x, y, height above the floor] mm'),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        intensity: z.number().min(0).max(1_000_000).optional().describe('Lumens'),
        target: z.tuple([z.number(), z.number(), z.number()]).optional().describe('A spot: the point it aims at, [x, y, height above the floor] mm'),
        angle: z.number().min(1).max(179).optional().describe('A spot: its cone, degrees'),
        layerId: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
      }),
      handler: async (input, ctx) => {
        const doc = ctx.project!.doc;
        requireLevel(doc, input.levelId);
        if (!input.layerId && !Object.values(doc.layers).some((l) => l.levelId === input.levelId && l.kind === 'decor')) {
          throw new StudioError('INVALID_INPUT', `Level "${doc.levels[input.levelId].name}" has no decor layer for lights; add one with plan_layer_add`);
        }
        if (input.kind !== 'spot' && (input.target || input.angle)) throw new StudioError('INVALID_INPUT', 'Only a spot takes `target` and `angle`');
        const { result } = await editProject(ctx, `Add ${input.kind} light`, (tx) => {
          const entity = {
            type: 'light' as const,
            kind: input.kind,
            at: input.at,
            ...(input.color ? { color: input.color } : {}),
            ...(input.intensity !== undefined ? { intensity: input.intensity } : {}),
            ...(input.kind === 'spot' ? { angle: input.angle ?? 60, ...(input.target ? { target: input.target } : {}) } : {}),
            ...(input.name ? { name: input.name } : {}),
          };
          const added = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity });
          tx.apply(added.ops);
          return added.id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'decor.item.place',
      title: 'Place a furniture item',
      description:
        "Places a model from the catalog (`ref`, from catalog_search) on a level's decor layer, its bottom centre at `at` [x, y] mm and `height` mm above the floor (the model's usual height by default: 0, or e.g. 1450 for a wall cabinet), turned `rotation` degrees counter-clockwise on the plan (0: its front faces south, −y). Give `size` [width, depth, height] in mm, or `scale`, to resize it (its own size by default), and `materials` to repaint slots. A lamp (catalog entries with `lamp`) placed `withLight` also gets a point light at its bulb, with its lumens. A library model is copied into the project the first time it is used. Returns the item's id (and `lightId`).",
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        ref: z.string().min(1).max(200),
        at: Point,
        height: z.number().min(-100_000).max(100_000).optional().describe("Above the floor, mm; the model's usual height by default"),
        rotation: z.number().min(-360).max(360).default(0).describe('Degrees, counter-clockwise on the plan'),
        size: Size.optional().describe('[width, depth, height] mm'),
        scale: Size.optional().describe('Relative to the model'),
        materials: z.record(z.string(), z.string().min(1).max(200)).optional().describe('Material per slot (builtin:<id> or paint:#rrggbb)'),
        layerId: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        withLight: z.boolean().default(false).describe("A lamp: add its light at the bulb"),
      }),
      handler: async (input, ctx) => {
        if (input.size && input.scale) throw new StudioError('INVALID_INPUT', 'Give `size` or `scale`, not both');
        const doc = ctx.project!.doc;
        requireLevel(doc, input.levelId);
        if (!input.layerId && !Object.values(doc.layers).some((l) => l.levelId === input.levelId && l.kind === 'decor')) {
          throw new StudioError('INVALID_INPUT', `Level "${doc.levels[input.levelId].name}" has no decor layer for furniture; add one with plan_layer_add`);
        }
        const model = await resolveModel(ctx, input.ref);
        for (const [slot, ref] of Object.entries(input.materials ?? {})) {
          if (!model.slots.includes(slot)) throw new StudioError('INVALID_INPUT', `${model.name} has no slot "${slot}"; its slots are ${model.slots.join(', ') || 'none'}`);
          checkMaterial(ref, `materials.${slot}`);
        }
        const scale = input.scale ?? (input.size ? ([0, 1, 2].map((k) => input.size![k] / Math.max(1e-6, model.size[k])) as [number, number, number]) : [1, 1, 1]);
        const { result } = await editProject(ctx, `Place ${input.name ?? model.name}`, (tx) => {
          const ops: Op[] = [];
          if (model.register && !tx.doc.assets[model.register.id]) ops.push({ t: 'ins', c: 'asset', id: model.register.id, v: model.register });
          const entity = {
            type: 'item' as const,
            asset: input.ref,
            at: [input.at[0], input.at[1], input.height ?? model.elevation ?? 0] as const,
            rotation: [0, 0, input.rotation] as const,
            scale,
            materials: input.materials ?? {},
            ...(input.name ? { name: input.name } : {}),
          };
          const added = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity });
          ops.push(...added.ops);
          let lightId: string | undefined;
          if (input.withLight) {
            if (!model.bulb) throw new StudioError('INVALID_INPUT', `${model.name} is not a lamp; only lamps can be placed with their light`);
            // The bulb, scaled and turned with the lamp.
            const r = (input.rotation * Math.PI) / 180;
            const [bx, by, bz] = [model.bulb[0] * scale[0], model.bulb[1] * scale[1], model.bulb[2] * scale[2]];
            const light = addEntityOps(tx.doc, {
              levelId: input.levelId,
              layerId: added.ops[0].t === 'ins' ? (added.ops[0].v as { layerId: string }).layerId : undefined,
              entity: { type: 'light', kind: 'point', name: `${input.name ?? model.name} light`, at: [entity.at[0] + bx * Math.cos(r) - by * Math.sin(r), entity.at[1] + bx * Math.sin(r) + by * Math.cos(r), entity.at[2] + bz], intensity: model.lumens ?? 800, color: '#ffe9c4' },
            });
            ops.push(...light.ops);
            lightId = light.id;
          }
          tx.apply(ops);
          return { id: added.id, ...(lightId ? { lightId } : {}) };
        });
        return result;
      },
    }),
  ],
});
