import { commandScore } from '../command-score';
import type { Vec3 } from '../solids/mesh';
import { MATERIALS, OPENING_STYLES, RECIPES } from './builtin';
import { builtinRef } from './refs';

/** A model imported into the library catalog (`catalog/furniture/<sha256>.glb`), as its index lists it. */
export interface CatalogModel {
  /** `asset:<file>`: the same reference in the catalog and in every project that uses it. */
  ref: string;
  /** `<sha256>.glb`. */
  file: string;
  name: string;
  category: string;
  tags: string[];
  /** The extent, mm, z up. */
  size: Vec3;
  /** The extent's low corner in the model's own coordinates, mm, z up. */
  min: Vec3;
  bytes: number;
  triangles: number;
  /** The model's material names: the slots an item can repaint. */
  slots: string[];
  importedAt: string;
  /** Changes when a thumbnail is stored; null until the window has drawn one. */
  thumbnail: string | null;
}

/** The library catalog as commands see it (`host.projects.catalog`). */
export interface CatalogApi {
  models(): CatalogModel[];
  model(file: string): CatalogModel | undefined;
  /** Checks, measures and stores a `.glb` (or a `.gltf` with embedded data) file; `added` is false when the same file was already there. */
  importModel(source: string): Promise<{ model: CatalogModel; added: boolean }>;
  /** Deletes a model from the catalog (projects that use it keep their copy). */
  removeModel(file: string): Promise<void>;
  setThumbnail(file: string, png: Uint8Array): Promise<CatalogModel>;
  /** Copies a catalog model into a project's assets (nothing to do when it is there already). */
  copyToProject(file: string, projectId: string): Promise<void>;
  /** Rebuilds the index from the files. */
  reindex(): Promise<{ models: number }>;
}

/** The largest model file `catalog.import` accepts. */
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

/** One result shape for every kind of catalog entry, built-in or imported. */
export interface CatalogEntry {
  /** `builtin:<id>` or `asset:<file>`: what items, finishes and styles store. */
  ref: string;
  kind: 'item' | 'material' | 'style';
  /** Shipped with the app, imported into the library, or only in this project's assets. */
  source: 'builtin' | 'library' | 'project';
  name: string;
  category: string;
  tags: string[];
  /** Items: width (x), depth (y), height (z), mm. */
  size: Vec3 | null;
  /** Items: the material slots a built-in model can be given; styles: the frame and leaf slots. */
  slots: string[];
  /** A token that changes with a stored thumbnail (imported models); null when none is stored. */
  thumbnail: string | null;
  /** Materials: the base colour. */
  color?: string;
  /** Items: a lamp, which can be placed with its light. */
  lamp?: boolean;
  /** Items: the height above the floor it is usually placed at, mm. */
  elevation?: number;
}

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The built-in furniture, materials and styles as catalog entries. */
export function builtinEntries(): CatalogEntry[] {
  return [
    ...RECIPES.map((r): CatalogEntry => ({ ref: builtinRef(r.id), kind: 'item', source: 'builtin', name: r.name, category: r.category, tags: r.tags, size: r.size, slots: Object.keys(r.slots), thumbnail: null, ...(r.bulb ? { lamp: true } : {}), ...(r.elevation ? { elevation: r.elevation } : {}) })),
    ...MATERIALS.map((m): CatalogEntry => ({ ref: builtinRef(m.id), kind: 'material', source: 'builtin', name: m.name, category: m.category, tags: m.tags, size: null, slots: [], thumbnail: null, color: m.color })),
    ...OPENING_STYLES.map((s): CatalogEntry => ({ ref: builtinRef(s.id), kind: 'style', source: 'builtin', name: s.name, category: s.kind, tags: s.tags, size: null, slots: Object.keys(s.slots), thumbnail: null })),
  ];
}

/** A library model as a catalog entry. */
export function modelEntry(m: CatalogModel): CatalogEntry {
  return { ref: m.ref, kind: 'item', source: 'library', name: m.name, category: m.category, tags: m.tags, size: m.size, slots: m.slots, thumbnail: m.thumbnail };
}

/**
 * Ranks entries against a query with the palette's fuzzy score over the name (the name counts
 * most) and the category and tags. Entries that do not match are left out; no query keeps them all.
 */
export function searchCatalog(entries: readonly CatalogEntry[], query: string | undefined): CatalogEntry[] {
  const q = fold(query?.trim() ?? '');
  if (!q) return [...entries];
  return entries
    .map((e) => {
      const name = commandScore(fold(e.name), q);
      // A tag or category said exactly is nearly as good as the name.
      const exact = fold(e.category) === q || e.tags.some((t) => fold(t) === q) ? 0.95 : 0;
      const rest = commandScore(fold(`${e.category} ${e.tags.join(' ')}`), q);
      return { e, score: Math.max(name, exact, rest * 0.5) };
    })
    .filter((s) => s.score > 0.02)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
    .map((s) => s.e);
}
