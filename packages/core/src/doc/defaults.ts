import { newId } from '../ids';
import { FORMAT_VERSION, LAYER_KINDS, type Layer, type LayerKind, type Level, type ProjectDoc } from './schema';

export const DEFAULT_LEVEL_HEIGHT = 3000;
export const DEFAULT_SLAB_THICKNESS = 200;

export const LAYER_NAMES: Record<LayerKind, string> = { structure: 'Structure', interior: 'Interior', decor: 'Decor' };

/** The three layers every new level starts with. */
export function defaultLayers(levelId: string): Layer[] {
  return LAYER_KINDS.map((kind, order) => ({ id: newId('lay'), levelId, kind, name: LAYER_NAMES[kind], order, visible: true, locked: false, opacity: 1 }));
}

export interface NewProjectInput {
  name: string;
  description?: string;
  tags?: string[];
  /** The app version, recorded in the project. */
  createdWith?: string;
  /** Fixed for tests; normally the current time. */
  now?: string;
}

/** A new project: one ground floor at elevation 0 with its three layers, and nothing drawn yet. */
export function newProjectDoc(input: NewProjectInput): ProjectDoc {
  const now = input.now ?? new Date().toISOString();
  const level: Level = { id: newId('lvl'), name: 'Ground floor', slabThickness: DEFAULT_SLAB_THICKNESS, place: { k: 'stack', height: DEFAULT_LEVEL_HEIGHT } };
  const layers = defaultLayers(level.id);
  return {
    formatVersion: FORMAT_VERSION,
    meta: {
      id: newId('prj'),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))],
      createdAt: now,
      updatedAt: now,
      ...(input.createdWith ? { createdWith: input.createdWith } : {}),
    },
    building: { datum: 0, groundLevelId: level.id, stack: [level.id] },
    levels: { [level.id]: level },
    layers: Object.fromEntries(layers.map((l) => [l.id, l])),
    connectors: {},
    assets: {},
    levelData: { [level.id]: { entities: {} } },
  };
}
