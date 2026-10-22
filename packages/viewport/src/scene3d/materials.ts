import { builtinMaterial, parseRef } from '@studio/core';
import { DoubleSide, FrontSide, MeshStandardMaterial, type Plane } from 'three';

/**
 * The materials of the design (`builtin:<id>` or `paint:#rrggbb`) as three materials, one per
 * reference, shared by everything drawn in it: physically based, so the project's lights light them.
 * Clipping planes (the cutaway) apply to all of them at once.
 */
export class DecorMaterials {
  private readonly cache = new Map<string, MeshStandardMaterial>();
  private planes: Plane[] = [];

  /** The material for a reference; `fallback` (a colour) for none or one that does not resolve. */
  get(ref: string | undefined, fallback = '#b8b4ac'): MeshStandardMaterial {
    const key = ref ?? `color:${fallback}`;
    let material = this.cache.get(key);
    if (!material) {
      material = this.make(ref, fallback);
      material.clippingPlanes = this.planes;
      this.cache.set(key, material);
    }
    return material;
  }

  /** Clips everything drawn in these materials (the cutaway's plane), or nothing. */
  setClipping(planes: Plane[]): void {
    this.planes = planes;
    for (const m of this.cache.values()) m.clippingPlanes = planes;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }

  private make(ref: string | undefined, fallback: string): MeshStandardMaterial {
    const parsed = ref ? parseRef(ref) : null;
    const base = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    if (parsed?.k === 'builtin') {
      const m = builtinMaterial(parsed.id);
      if (m) {
        const clear = m.opacity !== undefined && m.opacity < 1;
        return new MeshStandardMaterial({ ...base, color: m.color, roughness: m.roughness, metalness: m.metalness, transparent: clear, opacity: m.opacity ?? 1, depthWrite: !clear, side: clear ? DoubleSide : FrontSide, name: ref });
      }
    }
    if (parsed?.k === 'paint') return new MeshStandardMaterial({ ...base, color: parsed.color, roughness: 0.85, metalness: 0, name: ref });
    return new MeshStandardMaterial({ ...base, color: fallback, roughness: 0.8, metalness: 0 });
  }
}
