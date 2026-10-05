import {
  EntitySchema,
  LAYER_KINDS,
  StudioError,
  addEntityOps,
  addLayerOps,
  authorFrom,
  defineCommand,
  defineModule,
  deleteEntitiesOps,
  editProject,
  entitiesOnLevel,
  moveLayerOps,
  removeLayerOps,
  requireEntity,
  updateEntityOps,
  type CommandContext,
  type EditContext,
  type Entity,
  type ProjectApi,
} from '@studio/core';
import { z } from 'zod';

const levelId = z.string().describe('Level id, from building_get');
const layerId = z.string().describe('Layer id, from building_get');

/** Entity input: any entity without its id, level and layer (they are given separately). */
const NewEntitySchema = z.discriminatedUnion(
  'type',
  (EntitySchema.options as readonly z.ZodObject<z.ZodRawShape>[]).map((o) => o.omit({ id: true, levelId: true, layerId: true })) as unknown as [z.ZodObject<{ type: z.ZodLiteral<'wall'> }>, ...z.ZodObject<{ type: z.ZodLiteral<Entity['type']> }>[]],
);

/** Large batches by agents are kept as an automatic snapshot first. */
const LARGE_BATCH = 20;

const StepSchema = z.object({
  command: z.string().describe('Command id of an editing tool, e.g. "plan.entity.add" or "building.level.add"'),
  input: z.record(z.string(), z.unknown()).default({}),
  as: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .optional()
    .describe('Name the id this step creates; later steps can use it as "$name"'),
});

/** Replaces "$name" strings (anywhere in the input) with ids created by earlier steps. */
function resolveRefs(value: unknown, refs: Map<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const id = refs.get(value.slice(1));
    if (!id) throw new StudioError('INVALID_INPUT', `"${value}" does not name an earlier step`);
    return id;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, refs));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, refs)]));
  return value;
}

/** The project as the steps of a batch see it: edits join the open transaction. */
function batchProject(project: ProjectApi, tx: EditContext): ProjectApi {
  return {
    ...project,
    batching: true,
    get id() {
      return project.id;
    },
    get name() {
      return project.name;
    },
    get doc() {
      return tx.doc;
    },
    edit: async (_author, _label, fn) => ({ result: await fn(tx), changed: true, txId: null }),
    undo: () => Promise.reject(new StudioError('INVALID_INPUT', 'Undo cannot be a step of a batch')),
    redo: () => Promise.reject(new StudioError('INVALID_INPUT', 'Redo cannot be a step of a batch')),
  };
}

async function runSteps(ctx: CommandContext, steps: z.infer<typeof StepSchema>[], tx: EditContext) {
  const refs = new Map<string, string>();
  const results: { command: string; result: unknown }[] = [];
  const project = batchProject(ctx.project!, tx);
  for (const [index, step] of steps.entries()) {
    const meta = ctx.host.meta(step.command);
    if (!meta) throw new StudioError('UNKNOWN_COMMAND', `Step ${index + 1}: unknown command "${step.command}"`);
    if (!meta.batchable) throw new StudioError('INVALID_INPUT', `Step ${index + 1}: "${step.command}" cannot run in a batch; only editing tools can`);
    try {
      const result = await ctx.host.execute(step.command, resolveRefs(step.input, refs), { ...ctx, project });
      results.push({ command: step.command, result });
      const id = (result as { id?: unknown } | null)?.id;
      if (step.as) {
        if (typeof id !== 'string') throw new StudioError('INVALID_INPUT', `"${step.command}" does not create anything to name "${step.as}"`);
        refs.set(step.as, id);
      }
    } catch (err) {
      const e = err as StudioError;
      throw new StudioError(e.code ?? 'INTERNAL', `Step ${index + 1} (${step.command}) failed, so nothing was changed: ${e.message}`, e.details);
    }
  }
  return { results, ids: Object.fromEntries(refs) };
}

/**
 * Editing on a level: layers and entities (walls, openings, rooms, fixtures, items…), and
 * `plan.apply`, which runs many edits as one transaction and one undo step.
 */
export const planModule = defineModule({
  id: 'plan',
  commands: [
    defineCommand({
      id: 'plan.query',
      title: 'Find entities',
      description: 'Lists the entities on a level (including columns, shafts and voids that pass through it), optionally only one layer, one type, or given ids.',
      scope: 'project',
      input: z.object({ levelId: levelId.optional(), layerId: layerId.optional(), type: z.string().optional(), ids: z.array(z.string()).optional() }),
      handler: async ({ levelId: lv, layerId: layer, type, ids }, ctx) => {
        const doc = ctx.project!.doc;
        const levels = lv ? [lv] : Object.keys(doc.levels);
        let entities = levels.flatMap((l) => (lv ? entitiesOnLevel(doc, l) : Object.values(doc.levelData[l]?.entities ?? {})));
        if (layer) entities = entities.filter((e) => e.layerId === layer);
        if (type) entities = entities.filter((e) => e.type === type);
        if (ids) entities = entities.filter((e) => ids.includes(e.id));
        return entities;
      },
    }),
    defineCommand({
      id: 'plan.layer.add',
      title: 'Add a layer',
      description: 'Adds a layer to a level. Structure layers hold walls, openings, columns, slabs, voids and shafts; interior layers rooms, fixtures and service points; decor layers furniture and lights. Returns its id.',
      scope: 'project',
      batchable: true,
      input: z.object({ levelId, kind: z.enum(LAYER_KINDS), name: z.string().trim().min(1).max(120).optional() }),
      handler: async (input, ctx) => {
        const { result } = await editProject(ctx, `Add ${input.kind} layer`, (tx) => {
          const { ops, layerId: id } = addLayerOps(tx.doc, input);
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'plan.layer.update',
      title: 'Change a layer',
      description: 'Renames a layer, shows or hides it, locks or unlocks it, or sets its opacity (0–1).',
      scope: 'project',
      batchable: true,
      input: z.object({ layerId, name: z.string().trim().min(1).max(120).optional(), visible: z.boolean().optional(), locked: z.boolean().optional(), opacity: z.number().min(0).max(1).optional() }),
      handler: async ({ layerId: id, ...set }, ctx) => {
        const layer = ctx.project!.doc.layers[id];
        if (!layer) throw new StudioError('NOT_FOUND', `No layer ${id}`);
        const label = set.visible !== undefined ? `${set.visible ? 'Show' : 'Hide'} "${layer.name}"` : set.locked !== undefined ? `${set.locked ? 'Lock' : 'Unlock'} "${layer.name}"` : `Change layer "${layer.name}"`;
        await editProject(ctx, label, (tx) => tx.apply([{ t: 'upd', c: 'layer', id, set }]), set.opacity !== undefined ? { coalesce: `opacity:${id}` } : undefined);
        return ctx.project!.doc.layers[id];
      },
    }),
    defineCommand({
      id: 'plan.layer.move',
      title: 'Reorder a layer',
      description: "Moves a layer within its level's list (0 = first).",
      scope: 'project',
      batchable: true,
      input: z.object({ layerId, index: z.number().int().min(0) }),
      handler: async ({ layerId: id, index }, ctx) => {
        await editProject(ctx, 'Reorder layers', (tx) => tx.apply(moveLayerOps(tx.doc, id, index)));
        return { moved: id };
      },
    }),
    defineCommand({
      id: 'plan.layer.remove',
      title: 'Remove a layer',
      description: 'Removes a layer. A layer that holds anything is refused unless `withEntities` is true, which removes its contents too. Can be undone.',
      scope: 'project',
      batchable: true,
      input: z.object({ layerId, withEntities: z.boolean().default(false) }),
      handler: async ({ layerId: id, withEntities }, ctx) => {
        const name = ctx.project!.doc.layers[id]?.name ?? id;
        await editProject(ctx, `Remove layer "${name}"`, (tx) => tx.apply(removeLayerOps(tx.doc, id, withEntities)));
        return { removed: id };
      },
    }),
    defineCommand({
      id: 'plan.entity.add',
      title: 'Add an entity',
      description:
        'Adds an entity to a level: wall (path, thickness), opening (door or window in a wall, `along` its path), column, slab, void, shaft, room, fixture, point (electrical or plumbing), dimension, label, item (furniture) or light. Without `layerId` it goes on the first layer of the right kind. Coordinates in mm, y up; paths are vertices with optional arc (bulge) or Bézier segments and fillet/chamfer corners. Returns its id.',
      scope: 'project',
      batchable: true,
      input: z.object({ levelId, layerId: layerId.optional(), entity: NewEntitySchema }),
      handler: async ({ levelId: lv, layerId: layer, entity }, ctx) => {
        const { result } = await editProject(ctx, `Add ${entity.type}`, (tx) => {
          const { ops, id } = addEntityOps(tx.doc, { levelId: lv, layerId: layer, entity: entity as { type: Entity['type'] } });
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'plan.entity.update',
      title: 'Change an entity',
      description: "Sets fields of an entity (whole values: e.g. pass the complete `path`). `unset` removes optional fields. Its type and level cannot change; its layer can, within the level.",
      scope: 'project',
      batchable: true,
      input: z.object({ id: z.string(), set: z.record(z.string(), z.unknown()).default({}), unset: z.array(z.string()).default([]) }),
      handler: async ({ id, set, unset }, ctx) => {
        const entity = requireEntity(ctx.project!.doc, id);
        await editProject(ctx, `Change ${entity.type}`, (tx) => tx.apply(updateEntityOps(tx.doc, id, set, unset)));
        return requireEntity(ctx.project!.doc, id);
      },
    }),
    defineCommand({
      id: 'plan.entity.delete',
      title: 'Delete entities',
      description: 'Deletes entities (openings in a deleted wall go with it). Can be undone.',
      scope: 'project',
      batchable: true,
      input: z.object({ ids: z.array(z.string()).min(1) }),
      handler: async ({ ids }, ctx) => {
        const { result } = await editProject(ctx, ids.length === 1 ? `Delete ${requireEntity(ctx.project!.doc, ids[0]).type}` : `Delete ${ids.length} items`, (tx) => {
          const ops = deleteEntitiesOps(tx.doc, ids);
          tx.apply(ops);
          return ops.map((o) => o.id);
        });
        return { deleted: result };
      },
    }),
    defineCommand({
      id: 'plan.apply',
      title: 'Apply many edits at once',
      description:
        'Runs a list of editing tools (building_level_add, plan_entity_add, plan_entity_update, building_connector_add, …) as one change and one undo step: all succeed or nothing changes. Name what a step creates with `as`, and use "$name" in later steps (e.g. a door\'s wallId: "$w1"). With dryRun the edits are checked but not applied. Use it to draw a whole floor in one call.',
      scope: 'project',
      input: z.object({ label: z.string().trim().min(1).max(200).describe('What the change does, shown in the undo history'), steps: z.array(StepSchema).min(1).max(2000), dryRun: z.boolean().default(false) }),
      handler: async ({ label, steps, dryRun }, ctx) => {
        if (ctx.project!.batching) throw new StudioError('INVALID_INPUT', 'plan.apply cannot be nested');
        if (!dryRun && ctx.caller !== 'ui' && steps.length >= LARGE_BATCH) {
          await ctx.host.projects.autoSnapshot?.(ctx.project!.id, `Before "${label}"`, authorFrom(ctx).label);
        }
        const { label: _display, ...author } = authorFrom(ctx);
        const outcome = await ctx.project!.edit(author, label, (tx) => runSteps(ctx, steps, tx), { dryRun });
        return { ...outcome.result, changed: outcome.changed, applied: !dryRun && outcome.changed, txId: outcome.txId };
      },
    }),
  ],
});
