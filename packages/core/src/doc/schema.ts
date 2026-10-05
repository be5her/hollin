import { z } from 'zod';

/**
 * The project document. One model drives every view: a building with levels (floors), each level
 * with layers, each layer with entities; vertical connectors belong to the building.
 * Lengths are millimetres; angles are degrees.
 */

/** Bump when the stored shape changes, and add a step to `migrateProject`. */
export const FORMAT_VERSION = 1;

export const IdSchema = z.string().regex(/^(?:[a-z]{1,8}_)?[0-9a-hjkmnp-tv-z]{16}$/, 'Not a valid id');
const Mm = z.number().finite();
const PositiveMm = z.number().finite().positive();

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
  z.object({ k: z.literal('stack'), height: PositiveMm }),
  z.object({ k: z.literal('offset'), hostLevelId: IdSchema, offset: Mm, height: PositiveMm }),
]);
export type LevelPlace = z.infer<typeof LevelPlaceSchema>;

export const LevelSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  slabThickness: z.number().finite().min(0),
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
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().min(0).max(1),
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

/** Every entity has these; the full union per type arrives with the editors. */
export const EntityBaseSchema = z.object({
  id: IdSchema,
  type: z.string(),
  levelId: IdSchema,
  layerId: IdSchema,
});
export const EntitySchema = EntityBaseSchema.loose();
export type Entity = z.infer<typeof EntitySchema>;

export const ConnectorSchema = z.object({ id: IdSchema, kind: z.string() }).loose();
export type Connector = z.infer<typeof ConnectorSchema>;

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
