import { StudioError, addEntityOps, defineCommand, defineModule, editProject, parseRef, requireLevel, type Asset, type CatalogModel, type CommandContext, type Op } from '@studio/core';
import { z } from 'zod';

const levelId = z.string().describe('Level id, from building_get');
const Point = z.tuple([z.number(), z.number()]).describe('[x, y] in mm, y up');
const Size = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

/** One result shape for every kind of catalog entry, built-in or imported. */
export interface CatalogEntry {
  ref: string;
  kind: 'item' | 'material' | 'style';
  /** Where it comes from: shipped with the app, imported into the library, or only in this project's assets. */
  source: 'builtin' | 'library' | 'project';
  name: string;
  category: string;
  tags: string[];
  /** mm, z up: width (x), depth (y), height (z). */
  size: readonly [number, number, number] | null;
  /** The material slots a model can be given (built-ins only). */
  slots: string[];
  /** A token that changes with the stored thumbnail; null when there is none to fetch. */
  thumbnail: string | null;
}

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

function modelEntry(m: CatalogModel): CatalogEntry {
  return { ref: m.ref, kind: 'item', source: 'library', name: m.name, category: m.category, tags: m.tags, size: m.size, slots: [], thumbnail: m.thumbnail };
}

function assetEntry(file: string, a: Asset): CatalogEntry {
  return { ref: `asset:${file}`, kind: 'item', source: 'project', name: a.name, category: a.category, tags: [], size: a.size, slots: [], thumbnail: null };
}

/** Every entry an agent or the Catalog panel can pick from: the library's models, and models only the project has. */
function allEntries(ctx: CommandContext): CatalogEntry[] {
  const library = ctx.host.projects.catalog.models().map(modelEntry);
  const known = new Set(library.map((e) => e.ref));
  const project = Object.entries(ctx.project?.doc.assets ?? {})
    .filter(([file]) => !known.has(`asset:${file}`))
    .map(([file, a]) => assetEntry(file, a));
  return [...library, ...project];
}

/** Ranks entries against a query: every word must appear in the name, category or tags; name matches first. */
export function searchEntries(entries: CatalogEntry[], query: string | undefined): CatalogEntry[] {
  const words = fold(query?.trim() ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  const scored = entries
    .map((e) => {
      const name = fold(e.name);
      const rest = fold(`${e.category} ${e.tags.join(' ')}`);
      let score = 0;
      for (const w of words) {
        if (name.startsWith(w)) score += 3;
        else if (name.includes(w)) score += 2;
        else if (rest.includes(w)) score += 1;
        else return null;
      }
      return { e, score };
    })
    .filter((s): s is { e: CatalogEntry; score: number } => s !== null);
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).map((s) => s.e);
}

/** What a model reference stands for in this project: its size, and the asset to register (and file to copy) when it is new here. */
async function resolveModel(ctx: CommandContext, ref: string): Promise<{ name: string; size: readonly [number, number, number]; register?: Asset }> {
  const parsed = parseRef(ref);
  if (parsed?.k === 'asset') {
    const own = ctx.project!.doc.assets[parsed.file];
    if (own) return { name: own.name, size: own.size };
    const model = ctx.host.projects.catalog.model(parsed.file);
    if (!model) throw new StudioError('NOT_FOUND', `No model ${ref} in the catalog or the project; catalog_search lists them`);
    await ctx.host.projects.catalog.copyToProject(parsed.file, ctx.project!.id);
    return { name: model.name, size: model.size, register: { id: parsed.file, kind: 'model', name: model.name, category: model.category, size: model.size, min: model.min, bytes: model.bytes } };
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
        "Searches the catalog of furniture models (kind 'item'). Every word of `query` must appear in an entry's name, category or tags (name matches rank first); `category` keeps one category. Returns entries with `ref` (pass it to decor_item_place), name, category, tags, size [width, depth, height] in mm, material slots, and where it comes from (the library, or only this project).",
      scope: 'global',
      input: z.object({
        query: z.string().max(200).optional(),
        kind: z.enum(['item', 'material', 'style']).default('item'),
        category: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      handler: async ({ query, kind, category, limit }, ctx) => {
        const entries = allEntries(ctx).filter((e) => e.kind === kind && (!category || fold(e.category) === fold(category)));
        return searchEntries(entries, query).slice(0, limit);
      },
    }),
    defineCommand({
      id: 'catalog.get',
      title: 'Catalog entry',
      description: 'One catalog entry by its `ref` (from catalog_search), with its size in mm and material slots.',
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
      id: 'decor.item.place',
      title: 'Place a furniture item',
      description:
        "Places a model from the catalog (`ref`, from catalog_search) on a level's decor layer, its bottom centre at `at` [x, y] mm and `height` mm above the floor (0 by default), turned `rotation` degrees counter-clockwise on the plan. Give `size` [width, depth, height] in mm, or `scale`, to resize it (its own size by default). A library model is copied into the project the first time it is used. Returns the item's id.",
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        ref: z.string().min(1).max(200),
        at: Point,
        height: z.number().min(-100_000).max(100_000).default(0).describe('Above the floor, mm'),
        rotation: z.number().min(-360).max(360).default(0).describe('Degrees, counter-clockwise on the plan'),
        size: Size.optional().describe('[width, depth, height] mm'),
        scale: Size.optional().describe('Relative to the model'),
        materials: z.record(z.string(), z.string().min(1).max(200)).optional().describe('Material per slot (builtin:<id> or paint:#rrggbb)'),
        layerId: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
      }),
      handler: async (input, ctx) => {
        if (input.size && input.scale) throw new StudioError('INVALID_INPUT', 'Give `size` or `scale`, not both');
        const doc = ctx.project!.doc;
        requireLevel(doc, input.levelId);
        if (!input.layerId && !Object.values(doc.layers).some((l) => l.levelId === input.levelId && l.kind === 'decor')) {
          throw new StudioError('INVALID_INPUT', `Level "${doc.levels[input.levelId].name}" has no decor layer for furniture; add one with plan_layer_add`);
        }
        const model = await resolveModel(ctx, input.ref);
        const scale = input.scale ?? (input.size ? ([0, 1, 2].map((k) => input.size![k] / Math.max(1e-6, model.size[k])) as [number, number, number]) : [1, 1, 1]);
        const { result } = await editProject(ctx, `Place ${input.name ?? model.name}`, (tx) => {
          const ops: Op[] = [];
          if (model.register && !tx.doc.assets[model.register.id]) ops.push({ t: 'ins', c: 'asset', id: model.register.id, v: model.register });
          const entity = {
            type: 'item' as const,
            asset: input.ref,
            at: [input.at[0], input.at[1], input.height] as const,
            rotation: [0, 0, input.rotation] as const,
            scale,
            materials: input.materials ?? {},
            ...(input.name ? { name: input.name } : {}),
          };
          const added = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity });
          tx.apply([...ops, ...added.ops]);
          return added.id;
        });
        return { id: result };
      },
    }),
  ],
});
