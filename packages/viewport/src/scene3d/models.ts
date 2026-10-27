import { gltfMaterialSlots } from '@studio/core';
import { Group, Matrix4, Mesh, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** glTF's metres with y up to the building's millimetres with z up: (x, y, z) → (1000 x, −1000 z, 1000 y). */
const GLTF_TO_MM = new Matrix4().set(1000, 0, 0, 0, 0, 0, -1000, 0, 0, 1000, 0, 0, 0, 0, 0, 1);
/** A model that could not be loaded is tried again on the first build this long after the failure, ms. */
export const MODEL_RETRY_MS = 5000;

/**
 * A loaded glTF in the building's terms (mm, z up), each of its materials marked with the repaint
 * slot it answers to (`userData.slot`, core's `gltfMaterialSlots`, found through the glTF material
 * index three records in `parser.associations`): the name an item stores its repaint under, which
 * three's own material name is not when the glTF one is missing, padded or long.
 */
export function modelFromGltf(gltf: GLTF): Group {
  const slots = gltfMaterialSlots(gltf.parser.json as { materials?: { name?: string }[] });
  gltf.scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const index = gltf.parser.associations.get(m)?.materials;
      if (index !== undefined && slots[index] !== undefined) m.userData['slot'] = slots[index];
    }
  });
  const model = new Group();
  const inner: Object3D = gltf.scene;
  inner.applyMatrix4(GLTF_TO_MM);
  model.add(inner);
  model.updateMatrixWorld(true);
  return model;
}

/**
 * Imported models, loaded once per file from `library://` with three's `GLTFLoader` and kept: each
 * item gets a clone. A model is turned into the building's terms (mm, z up) on load, so an item's
 * placement matrix applies to it as it does to a recipe. A failed load is tried again on the first
 * build `MODEL_RETRY_MS` after it, or at once after `retryFailed` (the project's assets changed).
 */
export class ModelCache {
  private readonly loaded = new Map<string, Group>();
  private readonly loading = new Map<string, Promise<Group | null>>();
  /** When each failed load failed (`Date.now()`). */
  private readonly failed = new Map<string, number>();
  private readonly loader = new GLTFLoader();

  constructor(private readonly onLoaded: () => void = () => {}) {}

  /** A model ready to clone, or undefined while it loads (the cache calls `onLoaded` when it arrives); null when it could not be loaded. */
  get(url: string): Group | null | undefined {
    const model = this.loaded.get(url);
    if (model) return model;
    const failedAt = this.failed.get(url);
    if (failedAt !== undefined) {
      if (Date.now() - failedAt < MODEL_RETRY_MS) return null;
      this.failed.delete(url);
    }
    if (!this.loading.has(url)) this.loading.set(url, this.load(url));
    return undefined;
  }

  /** Forgets every failure, so the next build tries those models again. */
  retryFailed(): void {
    this.failed.clear();
  }

  /** Resolves when every model asked for so far has arrived (or failed). */
  async settled(): Promise<void> {
    while (this.loading.size) await Promise.all([...this.loading.values()]);
  }

  private async load(url: string): Promise<Group | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const model = modelFromGltf(await this.loader.parseAsync(await response.arrayBuffer(), ''));
      this.loaded.set(url, model);
      return model;
    } catch (err) {
      console.warn(`[scene3d] could not load ${url}: ${(err as Error).message}`);
      this.failed.set(url, Date.now());
      return null;
    } finally {
      this.loading.delete(url);
      this.onLoaded();
    }
  }
}
