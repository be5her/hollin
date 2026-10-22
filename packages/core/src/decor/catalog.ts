import type { Vec3 } from '../solids/mesh';

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
