import { z } from 'zod';
import { ASSET_FILE, isMaterialRef, isModelRef, isStyleRef } from '../decor/refs';
import { roundMm } from '../geometry/vec';

/**
 * The project document. One model drives every view: a building with levels (floors), each level
 * with layers, each layer with entities; vertical connectors belong to the building.
 * Lengths are millimetres (rounded to 0.001 mm when stored); angles are degrees.
 */

/** Bump when the stored shape changes, and add a step to `migrateProject`. */
export const FORMAT_VERSION = 2;

export const IdSchema = z.string().regex(/^(?:[a-z]{1,8}_)?[0-9a-hjkmnp-tv-z]{16}$/, 'Not a valid id');
const Mm = z.number().transform(roundMm);
const PositiveMm = z.number().positive().transform(roundMm);
const NonNegativeMm = z.number().min(0).transform(roundMm);
const Degrees = z.number().min(-360).max(360);
/** A reference to a material, symbol or model in the catalog (or a project asset). */
const CatalogRef = z.string().min(1).max(200);
/** A model: `builtin:<id>` or `asset:<sha256>.<ext>` (see `decor/refs.ts`). */
const ModelRef = CatalogRef.refine(isModelRef, 'Not a model reference (builtin:<id> or asset:<sha256>.<ext>)');
/** A material: `builtin:<id>` or `paint:#rrggbb`. */
const MaterialRef = CatalogRef.refine(isMaterialRef, 'Not a material reference (builtin:<id> or paint:#rrggbb)');
/** A door or window style: `builtin:<id>`. */
const StyleRef = CatalogRef.refine(isStyleRef, 'Not a style reference (builtin:<id>)');

// ---------- geometry ----------

export const Vec2Schema = z.tuple([Mm, Mm]).readonly();
export const Vec3Schema = z.tuple([Mm, Mm, Mm]).readonly();

export const SegmentSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('line') }),
  z.object({ k: z.literal('arc'), bulge: z.number().min(-1e6).max(1e6).describe('tan(sweep/4); positive turns counter-clockwise') }),
  z.object({ k: z.literal('cubic'), c1: Vec2Schema.describe('Handle relative to this vertex'), c2: Vec2Schema.describe('Handle relative to the next vertex') }),
]);

export const CornerSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('fillet'), r: PositiveMm }),
  z.object({ k: z.literal('chamfer'), d1: PositiveMm.describe('Along the incoming edge'), d2: PositiveMm.optional().describe('Along the outgoing edge; defaults to d1') }),
]);

export const VertexSchema = z.object({
  p: Vec2Schema,
  s: SegmentSchema.optional().describe('Segment to the next vertex; a straight line when absent'),
  c: CornerSchema.optional().describe('Corner treatment at this vertex'),
});

export const PathSchema = z.object({ closed: z.boolean(), v: z.array(VertexSchema).min(2) });
export const RegionSchema = z.object({ outer: PathSchema.refine((p) => p.closed, 'The outline must be closed'), holes: z.array(PathSchema.refine((p) => p.closed, 'Holes must be closed')).default([]) });

// ---------- project, building, levels, layers ----------

export const ProjectMetaSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The app version that created the project. */
  createdWith: z.string().optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

/**
 * How a level is placed. Stacked levels sit on the one below (or hang below the one above, for
 * basements); offset levels (mezzanines, split levels) sit at an offset from a stacked host level.
 */
export const LevelPlaceSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('stack'), height: PositiveMm.describe('Floor-to-floor height') }),
  z.object({ k: z.literal('offset'), hostLevelId: IdSchema, offset: Mm.describe('Elevation above the host level'), height: PositiveMm }),
]);
export type LevelPlace = z.infer<typeof LevelPlaceSchema>;

export const LevelSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  slabThickness: NonNegativeMm,
  place: LevelPlaceSchema,
});
export type Level = z.infer<typeof LevelSchema>;

export const LAYER_KINDS = ['structure', 'interior', 'decor'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const LayerSchema = z.object({
  id: IdSchema,
  levelId: IdSchema,
  kind: z.enum(LAYER_KINDS),
  name: z.string().trim().min(1).max(120),
  order: z.number().int(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
});
export type Layer = z.infer<typeof LayerSchema>;

export const BuildingSchema = z.object({
  /** Elevation of the ground level, in mm. */
  datum: Mm,
  groundLevelId: IdSchema,
  /** Stacked levels, bottom to top. Offset levels are not in the stack. */
  stack: z.array(IdSchema).min(1),
});
export type Building = z.infer<typeof BuildingSchema>;

// ---------- entities ----------

const base = {
  id: IdSchema,
  levelId: IdSchema,
  layerId: IdSchema,
  name: z.string().max(200).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
};

/** Entities that may run through several levels: from their own level up to `topLevelId`. */
const SpanSchema = z.object({
  topLevelId: IdSchema,
  baseOffset: Mm.default(0).describe('Start above the base level'),
  topOffset: Mm.default(0).describe('End above the top level (0 = its floor; use its height to reach its ceiling)'),
});

export const WallSchema = z.object({
  ...base,
  type: z.literal('wall'),
  path: PathSchema.describe('The wall axis (see alignment)'),
  thickness: PositiveMm,
  height: PositiveMm.nullable().default(null).describe('null: the height of its level'),
  alignment: z.enum(['center', 'left', 'right']).default('center').describe('Which side of the path the wall body lies on, looking along it'),
  baseOffset: Mm.default(0),
  materials: z.object({ left: MaterialRef.optional(), right: MaterialRef.optional() }).optional().describe('The finish of each face, looking along the path'),
});

export const OpeningSchema = z.object({
  ...base,
  type: z.literal('opening'),
  kind: z.enum(['door', 'window', 'opening']),
  wallId: IdSchema.describe('The wall it sits in'),
  along: NonNegativeMm.describe('Distance from the start of the wall path to the opening centre'),
  width: PositiveMm,
  height: PositiveMm,
  sill: NonNegativeMm.default(0),
  swing: z.object({ hinge: z.enum(['start', 'end']), side: z.enum(['left', 'right']) }).optional(),
  style: StyleRef.optional(),
});

const ColumnShape = z.discriminatedUnion('k', [
  z.object({ k: z.literal('rect'), w: PositiveMm, d: PositiveMm }),
  z.object({ k: z.literal('circle'), r: PositiveMm }),
  z.object({ k: z.literal('region'), region: RegionSchema }),
]);

export const ColumnSchema = z.object({ ...base, type: z.literal('column'), at: Vec2Schema, shape: ColumnShape, rotation: Degrees.default(0), span: SpanSchema.optional() });
export const SlabSchema = z.object({
  ...base,
  type: z.literal('slab'),
  source: z.discriminatedUnion('k', [z.object({ k: z.literal('auto') }).describe('Follows the outer walls'), z.object({ k: z.literal('region'), region: RegionSchema })]),
  thickness: PositiveMm.optional().describe("Defaults to the level's slab thickness"),
});
export const VoidSchema = z.object({ ...base, type: z.literal('void'), region: RegionSchema, span: SpanSchema.optional() });
export const ShaftSchema = z.object({ ...base, type: z.literal('shaft'), region: RegionSchema, span: SpanSchema });
export const RoomSchema = z.object({
  ...base,
  type: z.literal('room'),
  name: z.string().trim().min(1).max(120),
  number: z.string().max(20).optional(),
  boundary: z.discriminatedUnion('k', [z.object({ k: z.literal('detect'), seed: Vec2Schema.describe('A point inside the walls that enclose the room') }), z.object({ k: z.literal('region'), region: RegionSchema })]),
  finish: z.object({ floor: MaterialRef.optional(), walls: MaterialRef.optional(), ceiling: MaterialRef.optional() }).optional(),
});
/** Any outline: a terrace, a pool, a counter, a sketch. Open or closed, with every segment kind and corner; filled when closed. */
export const ShapeSchema = z.object({ ...base, type: z.literal('shape'), path: PathSchema.describe('An open or closed outline: lines, arcs (by bulge) or Béziers, with fillet or chamfer corners'), filled: z.boolean().default(true).describe('A closed shape is filled unless false') });
/** A room divider where there is no wall: an open line that splits the space on either side into two rooms. */
export const SeparatorSchema = z.object({ ...base, type: z.literal('separator'), path: PathSchema.describe('An open line between walls') });
export const FixtureSchema = z.object({ ...base, type: z.literal('fixture'), symbol: CatalogRef, at: Vec2Schema, rotation: Degrees.default(0), size: z.tuple([PositiveMm, PositiveMm]).optional(), mirror: z.boolean().default(false) });
export const PointSchema = z.object({
  ...base,
  type: z.literal('point'),
  service: z.enum(['electrical', 'plumbing', 'data', 'hvac']),
  kind: z.string().min(1).max(40).describe('e.g. socket, switch, light, water, drain'),
  at: Vec2Schema,
  height: NonNegativeMm.default(300).describe('Above the floor'),
  rotation: Degrees.default(0),
});
/** A dimension's end tied to a vertex of a wall (its reference line or a face) or of a shape on the same level, so it follows. */
export const AnchorSchema = z.object({
  entityId: IdSchema.describe('A wall or shape on the same level'),
  vertex: z.number().int().min(0).describe('The index of the vertex on its path'),
  side: z.enum(['axis', 'left', 'right']).default('axis').describe("A wall's reference line, or its left or right face (looking along the line); shapes only have their line"),
});
export const DimensionSchema = z.object({
  ...base,
  type: z.literal('dimension'),
  kind: z.enum(['aligned', 'horizontal', 'vertical', 'angular', 'radius']).default('aligned').describe('Aligned with the two points; horizontal or vertical between them; the angle at `vertex` between the rays through them; the radius from `from` (the centre) to `to`'),
  from: Vec2Schema,
  to: Vec2Schema,
  offset: Mm.default(500).describe('How far the dimension line sits from the points (aligned: to their left; horizontal/vertical: along the other axis; angular: the arc radius)'),
  vertex: Vec2Schema.optional().describe('Angular: the corner the two rays start from'),
  anchors: z.object({ from: AnchorSchema.optional(), to: AnchorSchema.optional() }).optional().describe('Ends tied to wall or shape vertices follow them when the wall or shape changes'),
});
export const LabelSchema = z.object({ ...base, type: z.literal('label'), text: z.string().min(1).max(500), at: Vec2Schema, size: PositiveMm.default(250).describe('Text height in mm'), rotation: Degrees.default(0) });
export const ItemSchema = z.object({
  ...base,
  type: z.literal('item'),
  asset: ModelRef.describe('The model: builtin:<id>, or asset:<file> registered in the project'),
  at: Vec3Schema.describe("x, y of the model's bottom centre, and its height above the floor"),
  rotation: z.tuple([Degrees, Degrees, Degrees]).default([0, 0, 0]).describe('Degrees about x, y and z; z is the turn on the plan'),
  scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).default([1, 1, 1]).describe("Relative to the model's own size"),
  materials: z.record(z.string(), MaterialRef).default({}).describe('Material per slot, over the model defaults'),
});
export const LightSchema = z.object({
  ...base,
  type: z.literal('light'),
  kind: z.enum(['point', 'spot', 'area']),
  at: Vec3Schema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#ffffff'),
  intensity: z.number().min(0).default(800).describe('Lumens'),
  target: Vec3Schema.optional(),
  angle: z.number().min(1).max(179).optional().describe('Spot cone angle, degrees'),
});

export const EntitySchema = z.discriminatedUnion('type', [WallSchema, OpeningSchema, ColumnSchema, SlabSchema, VoidSchema, ShaftSchema, RoomSchema, SeparatorSchema, ShapeSchema, FixtureSchema, PointSchema, DimensionSchema, LabelSchema, ItemSchema, LightSchema]);
export type Entity = z.infer<typeof EntitySchema>;
export type EntityType = Entity['type'];
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;

/** Which layer kind each entity type belongs on. Shapes, dimensions and labels go on any layer. */
export const ENTITY_LAYER: Record<EntityType, LayerKind | 'any'> = {
  wall: 'structure',
  opening: 'structure',
  column: 'structure',
  slab: 'structure',
  void: 'structure',
  shaft: 'structure',
  room: 'interior',
  separator: 'interior',
  shape: 'any',
  fixture: 'interior',
  point: 'interior',
  dimension: 'any',
  label: 'any',
  item: 'decor',
  light: 'decor',
};

/** Id prefix per entity type, for readable ids. */
export const ENTITY_PREFIX: Record<EntityType, string> = {
  wall: 'wal',
  opening: 'opn',
  column: 'col',
  slab: 'slb',
  void: 'vod',
  shaft: 'sft',
  room: 'rom',
  separator: 'sep',
  shape: 'shp',
  fixture: 'fix',
  point: 'pnt',
  dimension: 'dim',
  label: 'lbl',
  item: 'itm',
  light: 'lgt',
};

// ---------- vertical connectors ----------

const LevelRefSchema = z.object({ levelId: IdSchema, offset: Mm.default(0).describe('Above that level') });

const connectorBase = { id: IdSchema, name: z.string().max(200).optional() };

export const StairSchema = z.object({
  ...connectorBase,
  kind: z.literal('stair'),
  shape: z.enum(['straight', 'l', 'u', 'winder', 'spiral', 'curved']),
  bottom: LevelRefSchema,
  top: LevelRefSchema,
  axis: PathSchema.describe('The walk line, from bottom to top'),
  width: PositiveMm,
  riser: z.object({ count: z.number().int().min(2).max(60).optional(), maxHeight: PositiveMm.optional() }).default({}),
  tread: z.object({ minDepth: PositiveMm.optional() }).default({}),
  handrails: z.object({ left: z.boolean(), right: z.boolean() }).default({ left: true, right: true }),
});
export const LadderSchema = z.object({ ...connectorBase, kind: z.literal('ladder'), bottom: LevelRefSchema, top: LevelRefSchema, at: Vec2Schema, direction: Degrees.default(0), width: PositiveMm.default(500), angle: z.number().min(60).max(90).default(75) });
export const RampSchema = z.object({ ...connectorBase, kind: z.literal('ramp'), bottom: LevelRefSchema, top: LevelRefSchema, axis: PathSchema, width: PositiveMm, maxSlope: z.number().positive().max(100).default(8.33).describe('Percent') });
export const ElevatorSchema = z.object({
  ...connectorBase,
  kind: z.literal('elevator'),
  at: Vec2Schema.describe('Shaft centre'),
  rotation: Degrees.default(0),
  shaft: z.object({ w: PositiveMm, d: PositiveMm }),
  car: z.object({ w: PositiveMm, d: PositiveMm }),
  stops: z.array(z.object({ levelId: IdSchema, door: z.enum(['front', 'back', 'left', 'right']).default('front') })).min(2),
});
export const EscalatorSchema = z.object({ ...connectorBase, kind: z.literal('escalator'), bottom: LevelRefSchema, top: LevelRefSchema, at: Vec2Schema.describe('Foot of the escalator'), direction: Degrees.default(0), width: PositiveMm.default(1000) });

export const ConnectorSchema = z.discriminatedUnion('kind', [StairSchema, LadderSchema, RampSchema, ElevatorSchema, EscalatorSchema]);
export type Connector = z.infer<typeof ConnectorSchema>;
export type ConnectorKind = Connector['kind'];

export const CONNECTOR_PREFIX: Record<ConnectorKind, string> = { stair: 'str', ladder: 'lad', ramp: 'rmp', elevator: 'elv', escalator: 'esc' };

// ---------- assets ----------

/** A file in the project's `assets/` folder, by its content-addressed name: what it is and how big. */
export const AssetSchema = z.object({
  id: z.string().regex(ASSET_FILE, 'Not an asset file name'),
  kind: z.literal('model'),
  name: z.string().trim().min(1).max(200),
  category: z.string().max(40).default('imported'),
  size: Vec3Schema.describe("The model's extent, mm (x, y on the plan, z up)"),
  min: Vec3Schema.describe("The low corner of the extent, mm, in the model's own coordinates"),
  bytes: z.number().int().min(0).optional(),
  slots: z.array(z.string().max(60)).max(64).optional().describe("The model's material names, which an item can repaint"),
});
export type Asset = z.infer<typeof AssetSchema>;

// ---------- the document and its files ----------

export const LevelDataSchema = z.object({
  entities: z.record(z.string(), EntitySchema),
});
export type LevelData = z.infer<typeof LevelDataSchema>;

export const ProjectDocSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  meta: ProjectMetaSchema,
  building: BuildingSchema,
  levels: z.record(z.string(), LevelSchema),
  layers: z.record(z.string(), LayerSchema),
  connectors: z.record(z.string(), ConnectorSchema),
  /** The models and textures in the project's assets, by file name, so the project needs no catalog. */
  assets: z.record(z.string(), AssetSchema),
  levelData: z.record(z.string(), LevelDataSchema),
});
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;

/** What `project.json` holds: everything but the entities, plus the file of each level. */
export const ProjectFileSchema = ProjectDocSchema.omit({ levelData: true }).extend({
  levelFiles: z.record(z.string(), z.string().regex(/^[a-z0-9_]+\.[0-9a-f]{12}\.json$/)),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** What a level file holds. */
export const LevelFileSchema = z.object({
  levelId: IdSchema,
  entities: z.array(EntitySchema),
});
export type LevelFile = z.infer<typeof LevelFileSchema>;
