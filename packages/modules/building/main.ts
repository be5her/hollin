import {
  ConnectorSchema,
  DEFAULT_RULE_LIMITS,
  StudioError,
  addConnectorOps,
  addLevelOps,
  assertUnchanged,
  defineCommand,
  defineModule,
  deriveLevels,
  duplicateLevelOps,
  editProject,
  levelRemovalImpact,
  moveLevelOps,
  removeConnectorOps,
  removeLevelOps,
  updateConnectorOps,
  updateLevelOps,
  type Connector,
  type DerivedLevel,
  type ProjectDoc,
  type RuleLimits,
  connectorNumbers,
  connectorFromIntent,
  isConnectorIntent,
  type ConnectorIntent,
} from '@studio/core';
import { z } from 'zod';

const levelId = z.string().describe('Level id, from building_get');
const position = z
  .union([z.enum(['top', 'bottom']), z.object({ above: levelId }), z.object({ below: levelId })])
  .describe('Where in the stack: "top", "bottom", { above: levelId } or { below: levelId }. Levels above it move up.');

/** Connector input: any connector without an id. */
const NewConnectorSchema = z.discriminatedUnion(
  'kind',
  (ConnectorSchema.options as readonly z.ZodObject<z.ZodRawShape>[]).map((o) => o.omit({ id: true })) as unknown as [z.ZodObject<{ kind: z.ZodLiteral<'stair'> }>, ...z.ZodObject<{ kind: z.ZodLiteral<Connector['kind']> }>[]],
);

const point = z.tuple([z.number(), z.number()]).readonly();
const turn = z.enum(['left', 'right']).optional().describe('Which way the stair turns (default left)');
/** Intent forms: a stair, ramp or elevator asked for by its points and levels; the record is laid out from the rise and the rule limits. */
const StairIntentSchema = z.object({
  kind: z.literal('stair'),
  shape: z.enum(['straight', 'l', 'u', 'winder', 'spiral', 'curved']),
  from: point.describe('Start of the walk line (a spiral: its centre)'),
  to: point.describe('End of the walk line (a U: the direction; a spiral: the first step)'),
  bottomLevelId: levelId,
  topLevelId: levelId,
  width: z.number().positive().optional().describe('mm, default 1000'),
  turn,
  name: z.string().max(200).optional(),
});
const RampIntentSchema = z.object({ kind: z.literal('ramp'), from: point, to: point, bottomLevelId: levelId, topLevelId: levelId, width: z.number().positive().optional().describe('mm, default 1200'), maxSlope: z.number().positive().max(100).optional().describe('Percent; default from the rules'), name: z.string().max(200).optional() });
const ElevatorIntentSchema = z.object({
  kind: z.literal('elevator'),
  at: point.describe('Shaft centre'),
  fromLevelId: levelId.describe('Lowest stop'),
  toLevelId: levelId.describe('Highest stop; it stops at every stacked level between'),
  shaft: z.object({ w: z.number().positive(), d: z.number().positive() }).optional().describe('Default 2000 × 2200'),
  car: z.object({ w: z.number().positive(), d: z.number().positive() }).optional().describe('Default 1100 × 1400'),
  rotation: z.number().optional().describe('Degrees'),
  door: z.enum(['front', 'back', 'left', 'right']).optional(),
  name: z.string().max(200).optional(),
});
const ConnectorIntentSchema = z.discriminatedUnion('kind', [StairIntentSchema, RampIntentSchema, ElevatorIntentSchema]);

/** The building as agents and the UI read it: levels bottom to top with derived elevations, their layers, and the connectors with their derived numbers. */
export function describeBuilding(doc: ProjectDoc, limits: RuleLimits = DEFAULT_RULE_LIMITS) {
  const derived = deriveLevels(doc);
  const levels = derived.map((l) => ({
    ...l,
    layers: Object.values(doc.layers)
      .filter((layer) => layer.levelId === l.id)
      .sort((a, b) => a.order - b.order)
      .map((layer) => ({ ...layer, entities: Object.values(doc.levelData[l.id]?.entities ?? {}).filter((e) => e.layerId === layer.id).length })),
    entities: Object.keys(doc.levelData[l.id]?.entities ?? {}).length,
  }));
  return {
    datum: doc.building.datum,
    groundLevelId: doc.building.groundLevelId,
    levels,
    connectors: Object.values(doc.connectors).map((c) => ({ id: c.id, kind: c.kind, name: c.name ?? null, levels: 'stops' in c ? c.stops.map((s) => s.levelId) : [c.bottom.levelId, c.top.levelId], derived: connectorNumbers(c, derived, limits) })),
  };
}

/**
 * The building: levels (floors, basements, mezzanines) and the vertical connectors between them.
 * Elevations are derived: changing a level's height moves the levels above it.
 */
export const buildingModule = defineModule({
  id: 'building',
  commands: [
    defineCommand({
      id: 'building.get',
      title: 'Describe the building',
      description:
        'The levels from bottom to top with their elevation (mm, negative below ground), floor-to-floor height, slab thickness and layers, plus the stairs, ramps, elevators and other connectors between levels. Each connector has derived: its bottom, top and rise (mm), the levels whose slab it cuts, the limits it breaks (roken), and for a stair its risers, riser height, tread depth and flights, for a ramp its slope (%), for an elevator its stops bottom to top. Derived numbers follow level heights and are never stored.',
      scope: 'project',
      input: z.object({}),
      handler: async (_input, ctx) => describeBuilding(ctx.project!.doc, ctx.host.config.get().rules),
    }),
    defineCommand({
      id: 'building.level.add',
      title: 'Add a level',
      description: 'Adds a floor (or basement, when placed below the ground floor) with Structure, Interior and Decor layers. With `mezzanineOf` it is placed at an offset from a level instead of in the stack. Returns its id.',
      scope: 'project',
      batchable: true,
      input: z.object({
        name: z.string().trim().min(1).max(120).optional(),
        height: z.number().positive().optional().describe('Floor-to-floor height in mm (default 3000)'),
        slabThickness: z.number().min(0).optional().describe('mm (default 200)'),
        position: position.optional(),
        mezzanineOf: z.object({ levelId, offset: z.number().describe('mm above that level') }).optional(),
      }),
      handler: async (input, ctx) => {
        const { result } = await editProject(ctx, `Add level${input.name ? ` "${input.name}"` : ''}`, (tx) => {
          const { ops, levelId: id } = addLevelOps(tx.doc, { ...input, offsetFrom: input.mezzanineOf });
          tx.apply(ops);
          return id;
        });
        return { id: result, levels: deriveLevels(ctx.project!.doc) };
      },
    }),
    defineCommand({
      id: 'building.level.update',
      title: 'Change a level',
      description:
        'Renames a level or changes its height, slab thickness or elevation. Setting an elevation changes what produces it: for the ground floor the whole building moves; above ground the level below gets taller or shorter; a basement changes its own height; a mezzanine its offset. `ground: true` makes it the ground floor, keeping every elevation. `hostLevelId` moves a mezzanine to another host.',
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        name: z.string().trim().min(1).max(120).optional(),
        height: z.number().positive().optional(),
        slabThickness: z.number().min(0).optional(),
        elevation: z.number().optional().describe('mm'),
        ground: z.literal(true).optional(),
        hostLevelId: levelId.optional().describe('Mezzanines only: the stacked level it is placed from. Keeps its elevation when that lies within the new host, otherwise it sits on the host floor.'),
      }),
      handler: async ({ levelId: id, ...input }, ctx) => {
        const name = ctx.project!.doc.levels[id]?.name ?? id;
        await editProject(ctx, `Change level "${name}"`, (tx) => tx.apply(updateLevelOps(tx.doc, id, input)), input.height !== undefined || input.elevation !== undefined ? { coalesce: `level-size:${id}` } : undefined);
        return deriveLevels(ctx.project!.doc);
      },
    }),
    defineCommand({
      id: 'building.level.duplicate',
      title: 'Duplicate a level',
      description: "Copies a level's layers and everything on them to a new level stacked right above it. Returns the new level's id.",
      scope: 'project',
      batchable: true,
      input: z.object({ levelId, name: z.string().trim().min(1).max(120).optional() }),
      handler: async ({ levelId: id, name }, ctx) => {
        const source = ctx.project!.doc.levels[id]?.name ?? id;
        const { result } = await editProject(ctx, `Duplicate level "${source}"`, (tx) => {
          const { ops, levelId: copy } = duplicateLevelOps(tx.doc, id, { name });
          tx.apply(ops);
          return copy;
        });
        return { id: result, levels: deriveLevels(ctx.project!.doc) };
      },
    }),
    defineCommand({
      id: 'building.level.move',
      title: 'Reorder a level',
      description: 'Moves a level to another place in the stack (0 = bottom). Elevations follow.',
      scope: 'project',
      batchable: true,
      input: z.object({ levelId, index: z.number().int().min(0) }),
      handler: async ({ levelId: id, index }, ctx) => {
        await editProject(ctx, `Move level "${ctx.project!.doc.levels[id]?.name ?? id}"`, (tx) => tx.apply(moveLevelOps(tx.doc, id, index)));
        return deriveLevels(ctx.project!.doc);
      },
    }),
    defineCommand({
      id: 'building.level.impact',
      title: 'What removing a level would remove',
      description:
        'Read-only. What building.level.remove would do to a level: the mezzanines that block it, its entities counted by type, entities on other levels whose span is cut short, connectors removed with it and elevators that lose a stop.',
      scope: 'project',
      input: z.object({ levelId }),
      handler: async ({ levelId: id }, ctx) => levelRemovalImpact(ctx.project!.doc, id),
    }),
    defineCommand({
      id: 'building.level.remove',
      title: 'Remove a level',
      description: 'Removes a level and everything on it. Levels above it drop by its height. Stairs and ramps ending on it are removed; elevators stop skipping it. Can be undone.',
      scope: 'project',
      batchable: true,
      input: z.object({ levelId }),
      handler: async ({ levelId: id }, ctx) => {
        await editProject(ctx, `Remove level "${ctx.project!.doc.levels[id]?.name ?? id}"`, (tx) => tx.apply(removeLevelOps(tx.doc, id)));
        return deriveLevels(ctx.project!.doc);
      },
    }),
    defineCommand({
      id: 'building.connector.add',
      title: 'Add a stair, ramp, ladder, elevator or escalator',
      description:
        'Adds a vertical connector between levels. Either the full record (stairs and ramps follow an axis path bottom to top; elevators list the levels they stop at) or an intent: a stair by shape, from, to, bottomLevelId and topLevelId (its walk line is laid out from the rise: an L turns at the right angle, a U runs two flights a width apart, a spiral sweeps around `from`), a ramp by from, to and its levels, an elevator by its shaft centre and the lowest and highest level (it stops at every stacked level between). Lengths in mm, angles in degrees. Returns its id.',
      scope: 'project',
      batchable: true,
      input: z.object({ connector: z.union([ConnectorIntentSchema, NewConnectorSchema]).describe('A full connector record, or an intent form (see the description)') }),
      handler: async ({ connector }, ctx) => {
        const record = isConnectorIntent(connector as { kind: string } & Record<string, unknown>) ? connectorFromIntent(connector as ConnectorIntent, ctx.project!.doc, ctx.host.config.get().rules) : connector;
        const { result } = await editProject(ctx, `Add ${connector.kind}`, (tx) => {
          const { ops, id } = addConnectorOps(record as unknown as Parameters<typeof addConnectorOps>[0]);
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'building.connector.update',
      title: 'Change a connector',
      description: 'Sets fields of a stair, ramp, ladder, elevator or escalator (whole values: e.g. pass the complete `stops` list).',
      scope: 'project',
      batchable: true,
      input: z.object({
        id: z.string(),
        set: z.record(z.string(), z.unknown()),
        baseSeq: z.number().int().min(0).optional().describe('The change number (seq) your copy of the document had; refused with CONFLICT if the connector changed since'),
        epoch: z.number().int().min(1).optional().describe('The document epoch your copy had'),
      }),
      handler: async ({ id, set, baseSeq, epoch }, ctx) => {
        const kind = ctx.project!.doc.connectors[id]?.kind ?? 'connector';
        await editProject(ctx, `Change ${kind}`, (tx) => {
          assertUnchanged(ctx, id, kind, baseSeq, epoch);
          tx.apply(updateConnectorOps(tx.doc, id, set));
        });
        return ctx.project!.doc.connectors[id];
      },
    }),
    defineCommand({
      id: 'building.connector.remove',
      title: 'Remove a connector',
      description: 'Removes a stair, ramp, ladder, elevator or escalator. Can be undone.',
      scope: 'project',
      batchable: true,
      input: z.object({ id: z.string() }),
      handler: async ({ id }, ctx) => {
        const kind = ctx.project!.doc.connectors[id]?.kind;
        if (!kind) throw new StudioError('NOT_FOUND', `No connector ${id}`);
        await editProject(ctx, `Remove ${kind}`, (tx) => tx.apply(removeConnectorOps(tx.doc, id)));
        return { removed: id };
      },
    }),
  ],
});
