import { LANGUAGES, t, translate, type MessageKey } from '../i18n';
import { newId } from '../ids';
import { FORMAT_VERSION, LAYER_KINDS, type Layer, type LayerKind, type Level, type ProjectDoc } from './schema';

export const DEFAULT_LEVEL_HEIGHT = 3000;
export const DEFAULT_SLAB_THICKNESS = 200;

/** A layer kind's default name, in the language of the moment: "Structure", "Interior", "Decor". */
export function layerName(kind: LayerKind): string {
  return t(`defaults.layer.${kind}`);
}

/**
 * The first numbered default (`key` with `{n}`, "Level 2", "Room 3") whose number no name in `taken`
 * uses in any language, written in the language of the moment. Checking every language keeps the
 * numbering going after a switch: a level named "Level 1" in English still takes 1 when Arabic adds the next.
 */
export function nextNumberedName(key: MessageKey, taken: Iterable<string>): string {
  const names = new Set([...taken].map((name) => name.toLowerCase()));
  for (let n = 1; ; n++) {
    if (LANGUAGES.every((l) => !names.has(translate(l.id, key, { n }).toLowerCase()))) return t(key, { n });
  }
}

/** The three layers every new level starts with. */
export function defaultLayers(levelId: string): Layer[] {
  return LAYER_KINDS.map((kind, order) => ({ id: newId('lay'), levelId, kind, name: layerName(kind), order, visible: true, locked: false, opacity: 1 }));
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
  const level: Level = { id: newId('lvl'), name: t('defaults.level.ground'), slabThickness: DEFAULT_SLAB_THICKNESS, place: { k: 'stack', height: DEFAULT_LEVEL_HEIGHT } };
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
