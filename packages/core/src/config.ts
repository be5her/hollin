import { z } from 'zod';
import { BRANDING } from './branding';

/** Models offered for the in-app assistant. The first is the default. */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Recommended' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'Most capable, slower and pricier' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster, lower cost' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest, lowest cost' },
] as const;

export const DEFAULT_AI_MODEL: string = AI_MODELS[0].id;

/** The sections of config.json and what each field may hold. */
const SECTIONS = {
  appearance: z.object({
    theme: z.enum(['system', 'light', 'dark']),
  }),
  units: z.object({
    /** Display system. Lengths are always stored in millimetres. */
    system: z.enum(['metric', 'imperial']),
    metricUnit: z.enum(['mm', 'cm', 'm']),
    imperialStyle: z.enum(['ft-in', 'in']),
    /** Decimal places shown for metric lengths and for angles. */
    precision: z.number().int().min(0).max(4),
    /** Smallest fraction of an inch shown for imperial lengths: 1, 2, 4 … 64. */
    fraction: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
  }),
  mcp: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    /** When false, commands flagged `mutating` are refused for MCP callers. */
    allowMutations: z.boolean(),
  }),
  ai: z.object({
    /** Any model id is accepted, so a newer model can be typed in before the list knows it. */
    model: z.string().min(1),
  }),
  library: z.object({
    /** Where the project library lives. Empty means the default folder in the app's data folder. */
    path: z.string(),
  }),
  session: z.object({
    /** Projects reopened on startup, in tab order. */
    openProjects: z.array(z.string()),
    activeProjectId: z.string().nullable(),
  }),
  /** The 2D editor's snapping, grid and tool defaults; set from the plan's toolbar, kept across projects. */
  editor: z.object({
    snap: z.boolean(),
    snapEndpoint: z.boolean(),
    snapMidpoint: z.boolean(),
    snapCenter: z.boolean(),
    snapIntersection: z.boolean(),
    snapPerpendicular: z.boolean(),
    snapExtension: z.boolean(),
    snapGrid: z.boolean(),
    /** Snap the drawing direction to multiples of `angleStep` degrees (Shift always does, in 45° steps). */
    snapAngle: z.boolean(),
    angleStep: z.number().min(1).max(90),
    gridShow: z.boolean(),
    /** Grid snap spacing in mm. */
    gridSpacing: z.number().positive(),
    wallThickness: z.number().positive(),
    /** null: the level's height. */
    wallHeight: z.number().positive().nullable(),
    doorWidth: z.number().positive(),
    doorHeight: z.number().positive(),
    windowWidth: z.number().positive(),
    windowHeight: z.number().positive(),
    windowSill: z.number().min(0),
  }),
};

type Sections = typeof SECTIONS;
export type GlobalConfig = { [K in keyof Sections]: z.infer<Sections[K]> };
export type UnitSettings = GlobalConfig['units'];
export type ThemePreference = GlobalConfig['appearance']['theme'];
/** A patch: any subset of sections, each with any subset of its fields. */
export type ConfigPatch = { [K in keyof GlobalConfig]?: Partial<GlobalConfig[K]> };

const DEFAULTS: GlobalConfig = {
  appearance: { theme: 'system' },
  units: { system: 'metric', metricUnit: 'mm', imperialStyle: 'ft-in', precision: 0, fraction: 16 },
  mcp: { enabled: true, port: BRANDING.defaultMcpPort, allowMutations: false },
  ai: { model: DEFAULT_AI_MODEL },
  library: { path: '' },
  session: { openProjects: [], activeProjectId: null },
  editor: {
    snap: true,
    snapEndpoint: true,
    snapMidpoint: true,
    snapCenter: true,
    snapIntersection: true,
    snapPerpendicular: true,
    snapExtension: true,
    snapGrid: false,
    snapAngle: false,
    angleStep: 15,
    gridShow: true,
    gridSpacing: 100,
    wallThickness: 200,
    wallHeight: null,
    doorWidth: 900,
    doorHeight: 2100,
    windowWidth: 1200,
    windowHeight: 1200,
    windowSill: 900,
  },
};

/** Validates patches strictly: unknown sections or fields and invalid values are errors, not silently fixed. */
export const ConfigPatchSchema = z
  .object({
    appearance: SECTIONS.appearance.partial().strict().optional(),
    units: SECTIONS.units.partial().strict().optional(),
    mcp: SECTIONS.mcp.partial().strict().optional(),
    ai: SECTIONS.ai.partial().strict().optional(),
    library: SECTIONS.library.partial().strict().optional(),
    session: SECTIONS.session.partial().strict().optional(),
    editor: SECTIONS.editor.partial().strict().optional(),
  })
  .strict();

export function defaultConfig(): GlobalConfig {
  return structuredClone(DEFAULTS);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Merges `patch` over `base` one level deep (each section field by field), then normalises the
 * result field by field: unknown sections and keys are dropped and any invalid value falls back to
 * its default, so an older, newer or hand-edited config.json can never stop the app from starting.
 */
export function mergeConfig(base: unknown, patch: unknown): GlobalConfig {
  const from = isRecord(base) ? base : {};
  const over = isRecord(patch) ? patch : {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [section, schema] of Object.entries(SECTIONS)) {
    const a = isRecord(from[section]) ? from[section] : {};
    const b = isRecord(over[section]) ? over[section] : {};
    const merged: Record<string, unknown> = { ...a, ...b };
    const defaults = DEFAULTS[section as keyof GlobalConfig] as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const [field, fieldSchema] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      const parsed = fieldSchema.safeParse(merged[field]);
      fields[field] = parsed.success ? parsed.data : structuredClone(defaults[field]);
    }
    result[section] = fields;
  }
  return result as GlobalConfig;
}
