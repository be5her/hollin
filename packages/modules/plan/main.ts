import {
  AnchorSchema,
  ENTITY_PREFIX,
  EntitySchema,
  LAYER_KINDS,
  PathSchema,
  RegionSchema,
  StudioError,
  addConnectorOps,
  addEntityOps,
  addLayerOps,
  assertUnchanged,
  authorFrom,
  bulgeThrough,
  changedFields,
  connectorCutsLevel,
  connectorPath,
  connectorsOnLevel,
  defineCommand,
  defineModule,
  deleteEntitiesOps,
  deriveConnector,
  deriveLevelGeometry,
  describeDesign,
  deriveLevels,
  dimensionGeometry,
  distance,
  editProject,
  entitiesOnLevel,
  fitOpening,
  insertVertex,
  isConnectorId,
  labelPoint,
  moveLayerOps,
  moveVertex,
  nearestPoint,
  newId,
  openingFrame,
  pathOfEntity,
  polygonArea,
  pruneAnchors,
  remapAnchors,
  remapRefs,
  resolveDimension,
  untiedFields,
  removeConnectorOps,
  removeLayerOps,
  removeVertex,
  requireEntity,
  setCorner,
  setSegment,
  transformConnector,
  transformEntity,
  unclaimedCavities,
  updateConnectorOps,
  updateEntityOps,
  withPath,
  type CommandContext,
  type Connector,
  type Dimension,
  type EditContext,
  type Entity,
  type HostApi,
  type HostEvents,
  type Op,
  type NewConnector,
  type Opening,
  type Path,
  type Polygon,
  type ProjectApi,
  type ProjectDoc,
  type Transform,
  type Vec2,
  type Vertex,
  type WhichPath,
} from '@studio/core';
import { z } from 'zod';

const levelId = z.string().describe('Level id, from building_get');
const layerId = z.string().describe('Layer id, from building_get');
const Point = z.tuple([z.number(), z.number()]).describe('[x, y] in mm, y up');

const WallPointSchema = z.object({ p: Point, bulge: z.number().optional().describe('Makes the segment to the next point an arc: tan(sweep/4), positive counter-clockwise; 1 is a half circle') });

/** Edits addressed by index carry the change number the caller saw, so a stale edit fails instead of landing on moved geometry. */
const Stale = {
  baseSeq: z.number().int().min(0).optional().describe('The change number (seq) your copy of the document had; refused with CONFLICT if the entity changed since'),
  epoch: z.number().int().min(1).optional().describe('The document epoch your copy had'),
};
const WhichSchema = z.union([z.literal('outer'), z.object({ hole: z.number().int().min(0) })]).default('outer').describe("Which path: a wall's own path or a region's outline ('outer'), or a region's hole");
const PathEdit = { id: z.string(), which: WhichSchema, index: z.number().int().min(0), ...Stale };

/**
 * Runs one path edit on an entity as a transaction, with the conflict check inside the edit queue.
 * `remap` says where each vertex of the outline went (null: removed), so dimensions tied to it follow.
 */
async function editPath(ctx: CommandContext, input: { id: string; which: WhichPath; baseSeq?: number; epoch?: number }, label: string, change: (path: Path) => Path, remap?: (vertex: number) => number | null): Promise<Entity | Connector> {
  if (isConnectorId(input.id)) return editConnectorAxis(ctx, input, label, change);
  const type = requireEntity(ctx.project!.doc, input.id).type;
  await editProject(ctx, `${label} of ${type}`, (tx) => {
    assertUnchanged(ctx, input.id, type, input.baseSeq, input.epoch);
    const entity = requireEntity(tx.doc, input.id);
    const path = pathOfEntity(entity, input.which);
    if (!path) throw new StudioError('INVALID_INPUT', `A ${entity.type} has no ${input.which === 'outer' ? 'path' : `hole ${input.which.hole}`} to edit`);
    let next: Path;
    try {
      next = change(path);
    } catch (err) {
      throw new StudioError('INVALID_INPUT', (err as Error).message);
    }
    const set = changedFields(entity, withPath(entity, input.which, next));
    // Dimensions tied to the edited vertices, with the points they show now (before the edit lands).
    const level = tx.doc.levelData[entity.levelId].entities;
    const tied = remap && input.which === 'outer' ? Object.values(level).filter((d): d is Dimension => d.type === 'dimension' && Boolean(d.anchors)).map((d) => ({ d, points: resolveDimension(d, level), anchors: remapAnchors(d, input.id, remap) })) : [];
    if (Object.keys(set).length) tx.apply(updateEntityOps(tx.doc, input.id, set));
    for (const { d, points, anchors } of tied) {
      if (anchors === undefined) continue;
      const fields = untiedFields(d, points, anchors);
      tx.apply(updateEntityOps(tx.doc, d.id, fields.set, fields.unset));
    }
  });
  return requireEntity(ctx.project!.doc, input.id);
}

function requireConnector(doc: ProjectDoc, id: string): Connector {
  const connector = doc.connectors[id];
  if (!connector) throw new StudioError('NOT_FOUND', `No connector ${id}`);
  return connector;
}

/** A path edit on a stair's or ramp's axis: the same edits and conflict check as an entity's path. */
async function editConnectorAxis(ctx: CommandContext, input: { id: string; which: WhichPath; baseSeq?: number; epoch?: number }, label: string, change: (path: Path) => Path): Promise<Connector> {
  const kind = requireConnector(ctx.project!.doc, input.id).kind;
  await editProject(ctx, `${label} of ${kind}`, (tx) => {
    assertUnchanged(ctx, input.id, kind, input.baseSeq, input.epoch);
    const connector = requireConnector(tx.doc, input.id);
    const path = connectorPath(connector);
    if (!path || input.which !== 'outer') throw new StudioError('INVALID_INPUT', `A ${connector.kind} has no ${path ? `hole` : 'axis'} to edit`);
    let next: Path;
    try {
      next = change(path);
    } catch (err) {
      throw new StudioError('INVALID_INPUT', (err as Error).message);
    }
    tx.apply(updateConnectorOps(tx.doc, input.id, { axis: next }));
  });
  return requireConnector(ctx.project!.doc, input.id);
}

/** The wall paths a `plan.wall.add` input describes: one per segment, or one for the whole run. */
export function wallPaths(input: { from?: Vec2; to?: Vec2; through?: Vec2; points?: { p: Vec2; bulge?: number }[]; closed: boolean; path?: Path; single: boolean }): Path[] {
  const vertex = (p: Vec2, bulge?: number): Vertex => (bulge ? { p, s: { k: 'arc', bulge } } : { p });
  let paths: Path[];
  if (input.path) paths = [input.path];
  else if (input.from && input.to) {
    const bulge = input.through ? (bulgeThrough(input.from, input.through, input.to) ?? 0) : 0;
    paths = [{ closed: false, v: [vertex(input.from, bulge), { p: input.to }] }];
  } else if (input.points) {
    const pts = input.points;
    if (input.single) paths = [{ closed: input.closed, v: pts.map((c) => vertex(c.p, c.bulge)) }];
    else {
      paths = [];
      const n = input.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        paths.push({ closed: false, v: [vertex(a.p, a.bulge), { p: b.p }] });
      }
    }
  } else throw new StudioError('INVALID_INPUT', 'Give `from` and `to`, a list of `points`, or a `path`');
  for (const path of paths) {
    if (path.v.length < 2) throw new StudioError('INVALID_INPUT', 'A wall needs at least two points');
    for (let i = 0; i < path.v.length - 1; i++) if (distance(path.v[i].p, path.v[i + 1].p) < 1) throw new StudioError('INVALID_INPUT', 'Two consecutive wall points are at the same place');
  }
  return paths;
}

/** Entity input: any entity without its id, level and layer (they are given separately). */
const NewEntitySchema = z.discriminatedUnion(
  'type',
  (EntitySchema.options as readonly z.ZodObject<z.ZodRawShape>[]).map((o) => o.omit({ id: true, levelId: true, layerId: true })) as unknown as [z.ZodObject<{ type: z.ZodLiteral<'wall'> }>, ...z.ZodObject<{ type: z.ZodLiteral<Entity['type']> }>[]],
);

/** "Room N" with the first N no room on the level uses. */
function nextRoomName(entities: Record<string, Entity>): string {
  const names = new Set(Object.values(entities).filter((e) => e.type === 'room').map((e) => (e as { name: string }).name.toLowerCase()));
  for (let n = 1; ; n++) if (!names.has(`room ${n}`)) return `Room ${n}`;
}

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

/** Snapshots waiting for a window to draw them, by request id. */
const pendingSnapshots = new Map<string, { resolve: (png: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const SNAPSHOT_TIMEOUT = 10_000;

/** What a snapshot request asks the window to draw: the `view.snapshot.request` event without its id. */
export type SnapshotRequest = Omit<HostEvents['view.snapshot.request'], 'id'>;

/**
 * Asks the window to draw a level or the building (`view.snapshot.request`) and waits for the PNG
 * (base64) it answers with through `view.snapshot.reply`: `view.snapshot` and `export.image`. Fails
 * with UNAVAILABLE when no window answers within `timeout` ms, and with the code the window gives
 * (NOT_FOUND when there is nothing to draw, UNAVAILABLE when it cannot draw at that size).
 */
export function requestSnapshot(host: HostApi, request: SnapshotRequest, timeout = SNAPSHOT_TIMEOUT): Promise<string> {
  const id = newId('snp');
  const png = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSnapshots.delete(id);
      reject(new StudioError('UNAVAILABLE', 'No window drew the snapshot in time: snapshots need the app window open.'));
    }, timeout);
    pendingSnapshots.set(id, { resolve, reject, timer });
  });
  host.emit('view.snapshot.request', { id, ...request });
  return png;
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
      description:
        "Lists the entities on a level (including columns, shafts and voids that pass through it), optionally only one layer, one type, or given ids. With `levelId`, the stairs, ramps, ladders, elevators and escalators that reach the level follow, as `{ type: 'connector', role, ...connector }` where role is bottom, top, stop (an elevator stops there) or crosses (it only passes through); `type: 'connector'` lists only those.",
      scope: 'project',
      input: z.object({ levelId: levelId.optional(), layerId: layerId.optional(), type: z.string().optional(), ids: z.array(z.string()).optional() }),
      handler: async ({ levelId: lv, layerId: layer, type, ids }, ctx) => {
        const doc = ctx.project!.doc;
        const levels = lv ? [lv] : Object.keys(doc.levels);
        let entities = levels.flatMap((l) => (lv ? entitiesOnLevel(doc, l) : Object.values(doc.levelData[l]?.entities ?? {})));
        if (layer) entities = entities.filter((e) => e.layerId === layer);
        if (type) entities = entities.filter((e) => e.type === type);
        if (ids) entities = entities.filter((e) => ids.includes(e.id));
        if (!lv || layer || (type && type !== 'connector')) return entities;
        const connectors = connectorsOnLevel(doc, lv)
          .filter(({ connector }) => !ids || ids.includes(connector.id))
          .map(({ connector, role }) => ({ type: 'connector' as const, role, ...connector }));
        return [...entities, ...connectors];
      },
    }),
    defineCommand({
      id: 'plan.describe',
      title: 'Describe the design',
      description:
        "The whole design as a reader would describe it, derived right now (all lengths mm, areas mm²): every level bottom to top with its elevation and height, the count of entities by type, its rooms (name, number, net area, perimeter, whether enclosed), each room's openings with the room they lead to (or `outside`), which rooms are adjacent and how (a shared wall, a door, a window, an opening), the connectors landing in each room, the furniture standing in it (name, model ref, position, turn, size as placed and the area it covers), its lights and its finishes (floor, walls and ceiling materials), and enclosed spaces no room names yet (with furniture and lights in no room under `outside`); then the vertical circulation: for each stair, ramp, ladder, escalator or elevator the levels it connects bottom to top with the room it opens into on each, the slabs it cuts and its derived numbers (risers, slope, stops, broken limits). Call it first to understand a project, and after a change to check the result.",
      scope: 'project',
      input: z.object({}),
      handler: async (_input, ctx) => describeDesign(ctx.project!.doc, ctx.host.config.get().rules),
    }),
    defineCommand({
      id: 'view.snapshot',
      title: 'Snapshot of a level or the building',
      description:
        "Draws a picture fitted into a PNG and returns it as an image, with the level's id and name, the view and the image size. `view: 'plan'` (the default): one level's plan from above (walls joined, openings cut, rooms with their names and areas, stairs and elevators with their symbols, columns, slabs, furniture and lights, dimensions and labels). `view: '3d'`: the whole building in 3D (every level at its elevation, walls with the openings cut through, doors and windows with their frames and leaves, slabs with their stairwells, columns, stairs, ramps and elevators, furniture and finishes), `lighting` by `day` (the sky and the sun, the default) or at `night` (the design's own lights), seen from `azimuth` (degrees counter-clockwise from east on the plan: 270 looks from the south) and `elevation` (degrees above the horizon), the default a three-quarter view from the south-west; `display` shows every level, the level alone (`isolate`), or the level and those below it with its walls cut at the plan cut height (`cutaway`, to see into its rooms from above); `explode` (0 to 1) spreads the levels apart. `levelId` is the level drawn, or the level isolate and cutaway work on; the ground level by default. `theme` picks the light palette (the default) or the dark one; `transparent` leaves the background out (no paper colour on the plan, no sky in 3D). Use it to look at the result of a change. Needs the app window: it fails with UNAVAILABLE when no window can draw, and with NOT_FOUND when there is nothing to draw yet.",
      scope: 'project',
      output: 'image',
      input: z.object({
        levelId: levelId.optional().describe('Default: the ground level'),
        view: z.enum(['plan', '3d']).default('plan').describe('The plan of a level, or the building in 3D'),
        width: z.number().int().min(64).max(2048).default(800).describe('Pixels'),
        height: z.number().int().min(64).max(2048).default(600).describe('Pixels'),
        azimuth: z.number().min(-360).max(360).default(225).describe('3D: degrees counter-clockwise from east the building is seen from (0 east, 90 north, 180 west, 270 south)'),
        elevation: z.number().min(-89).max(89).default(30).describe('3D: degrees above the horizon (89 is from straight above)'),
        display: z.enum(['all', 'isolate', 'cutaway']).default('all').describe('3D: every level, the level alone, or the level and those below it with its walls cut'),
        explode: z.number().min(0).max(1).default(0).describe('3D: 0 as built, 1 spreads each level 4 m above the one below'),
        lighting: z.enum(['day', 'night']).default('day').describe("3D: the sky and the sun, or night with the design's own lights (the 16 nearest the camera)"),
        theme: z.enum(['light', 'dark']).default('light').describe('The light palette (the default) or the dark one'),
        transparent: z.boolean().default(false).describe('Leave the background transparent (no paper colour, no sky) instead of painting it'),
      }),
      handler: async ({ levelId: lv, view, width, height, azimuth, elevation, display, explode, lighting, theme, transparent }, ctx) => {
        const doc = ctx.project!.doc;
        const level = lv ?? doc.building.groundLevelId;
        if (!doc.levels[level]) throw new StudioError('NOT_FOUND', `No level ${level}`);
        const data = await requestSnapshot(ctx.host, { projectId: ctx.project!.id, levelId: level, width, height, view, azimuth, elevation, display, explode, lighting, theme, transparent });
        return { mimeType: 'image/png', data, view, levelId: level, levelName: doc.levels[level].name, width, height };
      },
    }),
    defineCommand({
      id: 'view.snapshot.reply',
      title: 'Answer a snapshot request',
      description: 'The window returns the PNG a `view.snapshot.request` asked for, or why it could not draw it (`code`: NOT_FOUND when there is nothing to draw, the default; UNAVAILABLE when it cannot draw at that size).',
      scope: 'global',
      hidden: true,
      input: z.object({ id: z.string(), png: z.string().optional(), error: z.string().optional(), code: z.enum(['NOT_FOUND', 'UNAVAILABLE']).optional() }),
      handler: async ({ id, png, error, code }) => {
        const waiting = pendingSnapshots.get(id);
        if (!waiting) return { taken: false };
        pendingSnapshots.delete(id);
        clearTimeout(waiting.timer);
        if (png) waiting.resolve(png);
        else waiting.reject(new StudioError(code ?? 'NOT_FOUND', error ?? 'The snapshot could not be drawn.'));
        return { taken: true };
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
      id: 'plan.wall.add',
      title: 'Add walls',
      description:
        'Draws walls on a level. Give `from` and `to` for one straight wall (add `through` for an arc that passes through a point), or `points` for a run of connected walls (one wall per segment, `closed` adds the last one back to the start; a point\'s `bulge` makes its segment an arc), or a full `path`. With `single` the whole run is one wall entity, which is how a wall gets fillet or chamfer corners. Separate walls join automatically where their ends meet. Thickness defaults to 200 mm; `alignment` says which side of the points the body lies on. Returns the ids (and `id`, the first).',
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        layerId: layerId.optional(),
        from: Point.optional(),
        to: Point.optional(),
        through: Point.optional(),
        points: z.array(WallPointSchema).min(2).optional(),
        closed: z.boolean().default(false),
        path: PathSchema.optional(),
        thickness: z.number().positive().default(200),
        height: z.number().positive().nullable().optional().describe('null or omitted: the level height'),
        alignment: z.enum(['center', 'left', 'right']).default('center'),
        single: z.boolean().default(false),
      }),
      handler: async (input, ctx) => {
        const paths = wallPaths(input);
        const { result } = await editProject(ctx, paths.length === 1 ? 'Add wall' : `Add ${paths.length} walls`, (tx) =>
          paths.map((path) => {
            const entity = { type: 'wall' as const, path, thickness: input.thickness, height: input.height ?? null, alignment: input.alignment };
            const { ops, id } = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity });
            tx.apply(ops);
            return id;
          }),
        );
        return { id: result[0], ids: result };
      },
    }),
    defineCommand({
      id: 'plan.opening.add',
      title: 'Add a door or window',
      description:
        "Puts a door, window or plain opening in a wall, at `along` mm from the start of the wall's path to its centre, or at the point of the wall nearest to `at`. It must fit between the wall's ends and its other openings, or the call fails with INVALID_INPUT and the free ranges in `details.gaps`. Defaults: a door 900 × 2100 with the hinge at the start opening to the left; a window 1200 × 1200 with a 900 sill. Returns its id.",
      scope: 'project',
      batchable: true,
      input: z.object({
        wallId: z.string(),
        kind: z.enum(['door', 'window', 'opening']),
        along: z.number().min(0).optional(),
        at: Point.optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        sill: z.number().min(0).optional(),
        swing: z.object({ hinge: z.enum(['start', 'end']), side: z.enum(['left', 'right']) }).optional(),
        style: z.string().min(1).max(200).optional(),
      }),
      handler: async (input, ctx) => {
        const { result } = await editProject(ctx, `Add ${input.kind}`, (tx) => {
          const wall = requireEntity(tx.doc, input.wallId);
          if (wall.type !== 'wall') throw new StudioError('INVALID_INPUT', `${input.wallId} is a ${wall.type}, not a wall`);
          const width = input.width ?? (input.kind === 'window' ? 1200 : 900);
          const height = input.height ?? (input.kind === 'window' ? 1200 : 2100);
          const sill = input.sill ?? (input.kind === 'window' ? 900 : 0);
          const along = input.along ?? (input.at ? nearestPoint(wall.path, input.at).along : undefined);
          if (along === undefined) throw new StudioError('INVALID_INPUT', 'Give `along` (from the start of the wall) or `at` (a point near the wall)');
          const others = Object.values(tx.doc.levelData[wall.levelId].entities).filter((e): e is Opening => e.type === 'opening' && e.wallId === wall.id);
          const fit = fitOpening(wall, others, along, width);
          if (!fit.fits) throw new StudioError('INVALID_INPUT', Number.isNaN(fit.along) ? `The ${input.kind} does not fit anywhere on this wall` : `The ${input.kind} does not fit at ${Math.round(along)} mm; the nearest place is ${Math.round(fit.along)} mm`, { gaps: fit.gaps, length: fit.length, nearest: fit.along });
          const swing = input.kind === 'door' ? (input.swing ?? { hinge: 'start', side: 'left' }) : input.swing;
          const entity = { type: 'opening' as const, kind: input.kind, wallId: wall.id, along, width, height, sill, ...(swing ? { swing } : {}), ...(input.style ? { style: input.style } : {}) };
          const { ops, id } = addEntityOps(tx.doc, { levelId: wall.levelId, layerId: wall.layerId, entity });
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'plan.room.add',
      title: 'Add a room',
      description: 'Makes a room from a point inside walls (`seed`: the room follows the space the walls and dividers enclose around it) or from a drawn `region`. Without a name it is "Room N". Returns its id.',
      scope: 'project',
      batchable: true,
      input: z.object({ levelId, layerId: layerId.optional(), seed: Point.optional(), region: RegionSchema.optional(), name: z.string().trim().min(1).max(120).optional(), number: z.string().max(20).optional() }),
      handler: async (input, ctx) => {
        if (!input.seed && !input.region) throw new StudioError('INVALID_INPUT', 'Give `seed` (a point inside the walls) or `region`');
        const { result } = await editProject(ctx, 'Add room', (tx) => {
          const name = input.name ?? nextRoomName(tx.doc.levelData[input.levelId]?.entities ?? {});
          const entity = { type: 'room' as const, name, ...(input.number ? { number: input.number } : {}), boundary: input.region ? { k: 'region' as const, region: input.region } : { k: 'detect' as const, seed: input.seed! } };
          const { ops, id } = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity });
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'plan.room.detect',
      title: 'Detect rooms',
      description: 'Makes a room for every space on the level that walls and dividers enclose and no room claims yet, named "Room N" in reading order. Spaces under `minArea` mm² (0.5 m² by default) and shafts or voids are skipped. Returns the new ids.',
      scope: 'project',
      batchable: true,
      input: z.object({ levelId, minArea: z.number().min(0).default(500_000) }),
      handler: async ({ levelId: lv, minArea }, ctx) => {
        const { result } = await editProject(ctx, 'Detect rooms', (tx) => {
          const entities = tx.doc.levelData[lv]?.entities ?? {};
          const geometry = deriveLevelGeometry(entities);
          const free = unclaimedCavities(geometry.cavities, geometry.rooms, entities, minArea).map((c) => ({ c, at: labelPoint(c.polygon, c.islands) })).sort((p, q) => q.at[1] - p.at[1] || p.at[0] - q.at[0]);
          const ids: string[] = [];
          for (const { at } of free) {
            const { ops, id } = addEntityOps(tx.doc, { levelId: lv, entity: { type: 'room', name: nextRoomName(tx.doc.levelData[lv].entities), boundary: { k: 'detect', seed: at } } });
            tx.apply(ops);
            ids.push(id);
          }
          return ids;
        });
        return { ids: result };
      },
    }),
    defineCommand({
      id: 'plan.rooms',
      title: 'List rooms with their areas',
      description: "The rooms of a level as the walls enclose them right now: name, number, whether the room is enclosed (a detected room whose walls opened is not), whether it shares its space with another room, the net floor area in mm², the perimeter in mm, where its label sits and its outline.",
      scope: 'project',
      input: z.object({ levelId }),
      handler: async ({ levelId: lv }, ctx) => {
        const entities = ctx.project!.doc.levelData[lv]?.entities;
        if (!entities) throw new StudioError('NOT_FOUND', `No level ${lv}`);
        const geometry = deriveLevelGeometry(entities);
        return [...geometry.rooms.values()].map((g) => {
          const room = entities[g.id] as Extract<Entity, { type: 'room' }>;
          return { id: g.id, name: room.name, number: room.number, enclosed: g.enclosed, shared: g.shared ?? null, area: Math.round(g.area), perimeter: Math.round(g.perimeter), labelAt: g.labelAt, polygon: g.polygon };
        });
      },
    }),
    defineCommand({
      id: 'plan.slab',
      title: 'Describe the floor slab of a level',
      description:
        "A level's floor slab as derived right now: the automatic slab (the outline of the walls that enclose something) and each drawn slab, with the openings that stairs, ramps, elevators and other connectors passing through its floor cut out. Returns the polygons, the total area in mm², and each opening with the connector that makes it.",
      scope: 'project',
      input: z.object({ levelId }),
      handler: async ({ levelId: lv }, ctx) => {
        const doc = ctx.project!.doc;
        const entities = doc.levelData[lv]?.entities;
        if (!entities) throw new StudioError('NOT_FOUND', `No level ${lv}`);
        const limits = ctx.host.config.get().rules;
        const levels = deriveLevels(doc);
        const level = levels.find((l) => l.id === lv)!;
        const openings = Object.values(doc.connectors)
          .filter((c) => connectorCutsLevel(c, level, levels))
          .map((c) => ({ connectorId: c.id, kind: c.kind, polygons: deriveConnector(c, levels, limits).footprint }));
        const geometry = deriveLevelGeometry(entities, { cuts: openings.flatMap((o) => o.polygons) });
        const area = (polys: Polygon[]) => Math.round(polys.reduce((sum, p) => sum + polygonArea(p), 0));
        const slabs = [...(geometry.autoSlabs.length ? [{ id: geometry.autoSlabs[0].id, source: 'auto' as const, polygons: geometry.slab }] : []), ...[...geometry.slabRegions].map(([id, polygons]) => ({ id, source: 'region' as const, polygons }))];
        return {
          levelId: lv,
          area: slabs.reduce((sum, s) => sum + area(s.polygons), 0),
          slabs: slabs.map((s) => ({ ...s, area: area(s.polygons) })),
          openings: openings.map((o) => ({ ...o, area: area(o.polygons) })),
        };
      },
    }),
    defineCommand({
      id: 'plan.shape.add',
      title: 'Add a shape',
      description:
        'Draws a free shape on a level: any outline (a terrace, a pool, a counter, a sketch), from `points` (a point\'s `bulge` makes its segment an arc; `closed`, true by default, joins the last point back to the first) or from a full `path` with corners. A closed shape is filled unless `filled` is false. Shapes go on any layer, the first interior layer by default. Returns its id. Use plan_room_add, or plan_entity_add with a slab or void, for outlines that mean something to the building.',
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        layerId: layerId.optional(),
        points: z.array(WallPointSchema).min(2).optional(),
        closed: z.boolean().default(true),
        path: PathSchema.optional(),
        filled: z.boolean().default(true),
        name: z.string().trim().min(1).max(200).optional(),
      }),
      handler: async (input, ctx) => {
        const path: Path | null = input.path ?? (input.points ? { closed: input.closed, v: input.points.map((c): Vertex => (c.bulge ? { p: c.p, s: { k: 'arc', bulge: c.bulge } } : { p: c.p })) } : null);
        if (!path) throw new StudioError('INVALID_INPUT', 'Give `points` or a `path`');
        if (path.closed && path.v.length < 3 && !path.v.some((v) => v.s?.k === 'arc')) throw new StudioError('INVALID_INPUT', 'A closed shape needs at least three points, or arcs');
        const n = path.closed ? path.v.length : path.v.length - 1;
        for (let i = 0; i < n; i++) if (distance(path.v[i].p, path.v[(i + 1) % path.v.length].p) < 1) throw new StudioError('INVALID_INPUT', 'Two consecutive points are at the same place');
        const { result } = await editProject(ctx, 'Add shape', (tx) => {
          const { ops, id } = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity: { type: 'shape', path, filled: input.filled, ...(input.name ? { name: input.name } : {}) } });
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'plan.dimension.add',
      title: 'Add a dimension',
      description:
        "Adds a dimension to a level. `kind`: aligned (the distance between `from` and `to`, the line `offset` mm to their left), horizontal or vertical (the distance along one axis, the line `offset` mm away along the other), angular (the angle at `vertex` between the rays through `from` and `to`, drawn as an arc of radius `offset`) or radius (from the centre `from` to the point `to` on the arc). An end may be tied to a vertex of a wall (its reference line or a face) or of a shape on the same level with `anchors`; it then follows that wall or shape until it is deleted. Returns its id.",
      scope: 'project',
      batchable: true,
      input: z.object({
        levelId,
        layerId: layerId.optional(),
        kind: z.enum(['aligned', 'horizontal', 'vertical', 'angular', 'radius']).default('aligned'),
        from: Point,
        to: Point,
        offset: z.number().default(500),
        vertex: Point.optional().describe('Angular: the corner'),
        anchors: z.object({ from: AnchorSchema.optional(), to: AnchorSchema.optional() }).optional(),
      }),
      handler: async (input, ctx) => {
        if (input.kind === 'angular' && !input.vertex) throw new StudioError('INVALID_INPUT', 'An angular dimension needs `vertex`');
        if (input.kind !== 'angular' && distance(input.from, input.to) < 1) throw new StudioError('INVALID_INPUT', 'The two points are at the same place');
        const { result } = await editProject(ctx, 'Add dimension', (tx) => {
          const entity = { type: 'dimension' as const, kind: input.kind, from: input.from, to: input.to, offset: input.offset, ...(input.vertex ? { vertex: input.vertex } : {}), ...(input.anchors && (input.anchors.from || input.anchors.to) ? { anchors: input.anchors } : {}) };
          const { ops, id } = addEntityOps(tx.doc, { levelId: input.levelId, layerId: input.layerId, entity });
          tx.apply(ops);
          return id;
        });
        return { id: result };
      },
    }),
    defineCommand({
      id: 'plan.dimensions',
      title: 'List dimensions with their values',
      description: "The dimensions of a level as they read right now: kind, the points as resolved (an end tied to a wall or shape follows it), what each one measures (`value` in mm, or degrees for an angle) and the text it shows in the display units, with its anchors.",
      scope: 'project',
      input: z.object({ levelId }),
      handler: async ({ levelId: lv }, ctx) => {
        const entities = ctx.project!.doc.levelData[lv]?.entities;
        if (!entities) throw new StudioError('NOT_FOUND', `No level ${lv}`);
        const units = ctx.host.config.get().units;
        return Object.values(entities)
          .filter((e): e is Dimension => e.type === 'dimension')
          .map((e) => {
            const points = resolveDimension(e, entities);
            const g = dimensionGeometry(e, points, units);
            return { id: e.id, kind: e.kind, from: points.from, to: points.to, ...(points.vertex ? { vertex: points.vertex } : {}), offset: e.offset, anchors: e.anchors ?? null, value: Math.round(g.value * 1000) / 1000, unit: e.kind === 'angular' ? 'deg' : 'mm', text: g.text };
          });
      },
    }),
    defineCommand({
      id: 'plan.transform',
      title: 'Move, rotate, mirror or copy entities',
      description:
        'Moves entities by `translate` [dx, dy], rotates them by `rotate.angle` degrees (counter-clockwise) about `rotate.pivot`, or mirrors them across the line from `mirror.a` to `mirror.b`; several may be combined (mirror, then rotate, then move). With `copy`, the originals stay and transformed copies are made (a wall\'s openings come along; `translate` [0, 0] copies in place). Openings are not moved on their own: they follow their wall. Stairs, ramps, ladders, elevators and escalators move the same way on the plan (their levels stay). `nudge` merges quick repeated moves into one undo step. Returns the ids of the moved entities, or of the copies.',
      scope: 'project',
      batchable: true,
      input: z.object({
        ids: z.array(z.string()).min(1),
        translate: Point.optional(),
        rotate: z.object({ angle: z.number(), pivot: Point }).optional(),
        mirror: z.object({ a: Point, b: Point }).optional(),
        copy: z.boolean().default(false),
        nudge: z.boolean().default(false),
      }),
      handler: async ({ ids, translate, rotate, mirror, copy, nudge }, ctx) => {
        if (!translate && !rotate && !mirror && !copy) throw new StudioError('INVALID_INPUT', 'Give translate, rotate or mirror (or copy)');
        const xf: Transform = { ...(translate ? { translate } : {}), ...(rotate ? { rotate } : {}), ...(mirror ? { mirror } : {}) };
        const doc = ctx.project!.doc;
        const connectorIds = ids.filter(isConnectorId);
        const connectors = connectorIds.map((id) => requireConnector(doc, id));
        const selected = ids.filter((id) => !isConnectorId(id)).map((id) => requireEntity(doc, id));
        const what = ids.length === 1 ? (selected[0]?.type ?? connectors[0].kind) : `${ids.length} items`;
        const label = copy ? `Copy ${what}` : rotate ? `Rotate ${what}` : mirror ? `Mirror ${what}` : nudge ? `Nudge ${what}` : `Move ${what}`;
        const { result } = await editProject(
          ctx,
          label,
          (tx) => {
            if (copy) {
              // The copied set: what was asked for, plus the openings of any wall in it; an opening without its wall cannot be copied.
              const set = new Map<string, Entity>(selected.map((e) => [e.id, e]));
              for (const e of selected) {
                if (e.type !== 'wall') continue;
                for (const o of Object.values(tx.doc.levelData[e.levelId].entities)) if (o.type === 'opening' && o.wallId === e.id) set.set(o.id, o);
              }
              const map = new Map<string, string>();
              for (const e of set.values()) if (e.type !== 'opening' || set.has(e.wallId)) map.set(e.id, newId(ENTITY_PREFIX[e.type]));
              const copied = new Set(map.values());
              const ops: Op[] = [];
              for (const e of set.values()) {
                const id = map.get(e.id);
                if (!id) continue;
                let source = remapRefs('entity', e, map);
                if (source.type === 'dimension') {
                  // The copy starts from the points the original shows; ties to what is not copied are dropped.
                  const points = resolveDimension(e as Dimension, tx.doc.levelData[e.levelId].entities);
                  const anchors = pruneAnchors(source, (target) => copied.has(target));
                  const { anchors: _old, ...rest } = { ...source, from: points.from, to: points.to };
                  source = anchors === undefined ? { ...rest, ...(source.anchors ? { anchors: source.anchors } : {}) } : anchors ? { ...rest, anchors } : rest;
                }
                const moved = transformEntity({ ...source, id }, xf);
                ops.push({ t: 'ins', c: 'entity', id, lv: e.levelId, v: moved });
              }
              for (const c of connectors) {
                const added = addConnectorOps(transformConnector(c, xf) as unknown as NewConnector);
                map.set(c.id, added.id);
                ops.push(...added.ops);
              }
              tx.apply(ops);
              return ids.map((id) => map.get(id)).filter((id): id is string => Boolean(id));
            }
            for (const c of connectors) {
              const set = changedFields(c as unknown as Entity, transformConnector(c, xf) as unknown as Entity);
              if (Object.keys(set).length) tx.apply(updateConnectorOps(tx.doc, c.id, set));
            }
            for (const e of selected) {
              if (e.type === 'opening') {
                // An opening stays in its wall: a move slides it by the move's component along the wall.
                const wall = translate && !rotate && !mirror ? tx.doc.levelData[e.levelId]?.entities[e.wallId] : undefined;
                if (wall?.type === 'wall') {
                  const { tangent } = openingFrame(wall, e);
                  const d = translate![0] * tangent[0] + translate![1] * tangent[1];
                  if (Math.abs(d) > 1e-9) tx.apply(updateEntityOps(tx.doc, e.id, { along: Math.max(0, e.along + d) }));
                }
                continue;
              }
              let set: Record<string, unknown>;
              const unset: string[] = [];
              if (e.type === 'dimension') {
                // A dimension moves from the points it shows; moved without what it is tied to, it lets go.
                const points = resolveDimension(e, tx.doc.levelData[e.levelId].entities);
                set = changedFields(e, transformEntity({ ...e, from: points.from, to: points.to }, xf));
                const anchors = pruneAnchors(e, (target) => ids.includes(target));
                if (anchors) set['anchors'] = anchors;
                else if (anchors === null) unset.push('anchors');
              } else set = changedFields(e, transformEntity(e, xf));
              if (Object.keys(set).length || unset.length) tx.apply(updateEntityOps(tx.doc, e.id, set, unset));
            }
            return ids;
          },
          nudge && !copy ? { coalesce: `nudge:${[...ids].sort().join(',')}` } : undefined,
        );
        return { ids: result };
      },
    }),
    defineCommand({
      id: 'plan.entity.add',
      title: 'Add an entity',
      description:
        'Adds an entity to a level: wall (path, thickness), opening (door or window in a wall, `along` its path), column, slab, void, shaft, room, separator (a room divider line where there is no wall), shape (any outline, filled when closed), fixture, point (electrical or plumbing), dimension, label, item (furniture) or light. Without `layerId` it goes on the first layer of the right kind. Coordinates in mm, y up; paths are vertices with optional arc (bulge) or Bézier segments and fillet/chamfer corners. Returns its id.',
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
      description:
        'Sets fields of an entity (whole values: e.g. pass the complete `path`). `unset` removes optional fields. Its type and level cannot change; its layer can, within the level. Pass `baseSeq` (the change number your copy had) to be refused with CONFLICT if someone changed the entity meanwhile.',
      scope: 'project',
      batchable: true,
      input: z.object({ id: z.string(), set: z.record(z.string(), z.unknown()).default({}), unset: z.array(z.string()).default([]), ...Stale }),
      handler: async ({ id, set, unset, baseSeq, epoch }, ctx) => {
        const entity = requireEntity(ctx.project!.doc, id);
        await editProject(ctx, `Change ${entity.type}`, (tx) => {
          assertUnchanged(ctx, id, entity.type, baseSeq, epoch);
          tx.apply(updateEntityOps(tx.doc, id, set, unset));
        });
        return requireEntity(ctx.project!.doc, id);
      },
    }),
    defineCommand({
      id: 'plan.path.vertex.move',
      title: 'Move a corner',
      description: "Moves vertex `index` of an entity's path (a wall's, shape's or divider's path, a region's outline or hole, or a stair's or ramp's axis given the connector's id) to a point. Returns the entity or connector.",
      scope: 'project',
      batchable: true,
      input: z.object({ ...PathEdit, to: Point }),
      handler: (input, ctx) => editPath(ctx, input, 'Move corner', (path) => moveVertex(path, input.index, input.to)),
    }),
    defineCommand({
      id: 'plan.path.vertex.insert',
      title: 'Add a corner',
      description: "Splits segment `index` of an entity's path with a new vertex at a point (an arc becomes two arcs on the same circle). Returns the entity.",
      scope: 'project',
      batchable: true,
      input: z.object({ ...PathEdit, at: Point }),
      handler: (input, ctx) => editPath(ctx, input, 'Add corner', (path) => insertVertex(path, input.index, input.at), (v) => (v > input.index ? v + 1 : v)),
    }),
    defineCommand({
      id: 'plan.path.vertex.remove',
      title: 'Remove a corner',
      description: "Removes vertex `index` of an entity's path; the segment before it runs straight to the next vertex. A path keeps at least two vertices (three when closed). Returns the entity.",
      scope: 'project',
      batchable: true,
      input: z.object(PathEdit),
      handler: (input, ctx) => editPath(ctx, input, 'Remove corner', (path) => removeVertex(path, input.index), (v) => (v === input.index ? null : v > input.index ? v - 1 : v)),
    }),
    defineCommand({
      id: 'plan.path.segment.set',
      title: 'Straighten or curve a segment',
      description: "Makes segment `index` of an entity's path a straight line, or an arc given by its bulge (tan(sweep/4), positive counter-clockwise) or by a point it passes through. Returns the entity.",
      scope: 'project',
      batchable: true,
      input: z.object({ ...PathEdit, segment: z.union([z.object({ k: z.literal('line') }), z.object({ k: z.literal('arc'), bulge: z.number() }), z.object({ k: z.literal('arc'), through: Point })]) }),
      handler: (input, ctx) => editPath(ctx, input, 'Change segment', (path) => setSegment(path, input.index, input.segment)),
    }),
    defineCommand({
      id: 'plan.path.corner.set',
      title: 'Round or chamfer a corner',
      description: "Sets the corner at vertex `index` of an entity's path: a fillet of radius `r`, a chamfer of `d1` along the incoming edge and `d2` along the outgoing one (default `d1`), or null for a sharp corner. The ends of an open path have no corner. Returns the entity.",
      scope: 'project',
      batchable: true,
      input: z.object({ ...PathEdit, corner: z.union([z.null(), z.object({ k: z.literal('fillet'), r: z.number().positive() }), z.object({ k: z.literal('chamfer'), d1: z.number().positive(), d2: z.number().positive().optional() })]) }),
      handler: (input, ctx) => editPath(ctx, input, input.corner ? (input.corner.k === 'fillet' ? 'Round corner' : 'Chamfer corner') : 'Sharpen corner', (path) => setCorner(path, input.index, input.corner)),
    }),
    defineCommand({
      id: 'plan.entity.delete',
      title: 'Delete entities',
      description: 'Deletes entities (openings in a deleted wall go with it), and stairs, ramps, ladders, elevators or escalators given by id. Can be undone.',
      scope: 'project',
      batchable: true,
      input: z.object({ ids: z.array(z.string()).min(1) }),
      handler: async ({ ids }, ctx) => {
        const doc = ctx.project!.doc;
        const what = ids.length === 1 ? (isConnectorId(ids[0]) ? requireConnector(doc, ids[0]).kind : requireEntity(doc, ids[0]).type) : `${ids.length} items`;
        const { result } = await editProject(ctx, `Delete ${what}`, (tx) => {
          const entityIds = ids.filter((id) => !isConnectorId(id));
          const ops = [...(entityIds.length ? deleteEntitiesOps(tx.doc, entityIds) : []), ...ids.filter(isConnectorId).flatMap((id) => removeConnectorOps(tx.doc, id))];
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
