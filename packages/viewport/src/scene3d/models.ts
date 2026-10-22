import { Group, Matrix4, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** glTF's metres with y up to the building's millimetres with z up: (x, y, z) → (1000 x, −1000 z, 1000 y). */
const GLTF_TO_MM = new Matrix4().set(1000, 0, 0, 0, 0, 0, -1000, 0, 0, 1000, 0, 0, 0, 0, 0, 1);

/**
 * Imported models, loaded once per file from `library://` with three's `GLTFLoader` and kept: each
 * item gets a clone. A model is turned into the building's terms (mm, z up) on load, so an item's
 * placement matrix applies to it as it does to a recipe.
 */
export class ModelCache {
  private readonly loaded = new Map<string, Group>();
  private readonly loading = new Map<string, Promise<Group | null>>();
  private readonly failed = new Set<string>();
  private readonly loader = new GLTFLoader();

  constructor(private readonly onLoaded: () => void = () => {}) {}

  /** A model ready to clone, or undefined while it loads (the cache calls `onLoaded` when it arrives); null when it could not be loaded. */
  get(url: string): Group | null | undefined {
    const model = this.loaded.get(url);
    if (model) return model;
    if (this.failed.has(url)) return null;
    if (!this.loading.has(url)) this.loading.set(url, this.load(url));
    return undefined;
  }

  /** Resolves when every model asked for so far has arrived (or failed). */
  async settled(): Promise<void> {
    while (this.loading.size) await Promise.all([...this.loading.values()]);
  }

  private async load(url: string): Promise<Group | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const gltf = await this.loader.parseAsync(await response.arrayBuffer(), '');
      const model = new Group();
      const inner: Object3D = gltf.scene;
      inner.applyMatrix4(GLTF_TO_MM);
      model.add(inner);
      model.updateMatrixWorld(true);
      this.loaded.set(url, model);
      return model;
    } catch (err) {
      console.warn(`[scene3d] could not load ${url}: ${(err as Error).message}`);
      this.failed.add(url);
      return null;
    } finally {
      this.loading.delete(url);
      this.onLoaded();
    }
  }
}
