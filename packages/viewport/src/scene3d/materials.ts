import { builtinMaterial, parseRef, type BuiltinMaterial } from '@studio/core';
import { CanvasTexture, DoubleSide, FrontSide, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Plane } from 'three';
import { drawMaterialTile, patternTile } from '../decor/patterns';

/** Faces sit a hair behind their edge lines, so the lines never flicker. */
export const FACE_OFFSET = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;
/**
 * A finish is a skin (`SKIN`, 2 mm) over the floor or wall face it finishes. From a few tens of metres
 * the depth buffer cannot tell 2 mm apart, so the two fought in stripes: finishes are pulled forward
 * in the depth test where every other face is pushed back.
 */
export const FINISH_OFFSET = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 } as const;

/** A pattern's texture is drawn at this many pixels per millimetre, within these bounds a side. */
const PX_PER_MM = 0.5;
const MIN_PX = 64;
const MAX_PX = 512;

/**
 * A material's pattern as a repeating texture: one seamless tile (`drawMaterialTile`) for UVs in mm
 * (see core's `Mesh`), so the planks, tiles and bricks keep their real size on any face. Null
 * without a pattern, or without a DOM (unit tests).
 */
export function patternTexture(m: BuiltinMaterial): CanvasTexture | null {
  if (!m.pattern || typeof document === 'undefined') return null;
  const [tw, th] = patternTile(m.pattern);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(tw * PX_PER_MM)));
  canvas.height = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(th * PX_PER_MM)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawMaterialTile(ctx, m, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / tw, 1 / th);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The materials of the design (`builtin:<id>` or `paint:#rrggbb`) as three materials, one per
 * reference, shared by everything drawn in it: physically based, so the project's lights light them.
 * Clipping planes (the cutaway) apply to all of them at once.
 */
export class DecorMaterials {
  private readonly cache = new Map<string, MeshStandardMaterial>();
  private planes: Plane[] = [];

  /** The material for a reference; `fallback` (a colour) for none or one that does not resolve. `finish` for a finish's skin (see `FINISH_OFFSET`). */
  get(ref: string | undefined, fallback = '#b8b4ac', finish = false): MeshStandardMaterial {
    const key = `${finish ? 'finish:' : ''}${ref ?? `color:${fallback}`}`;
    let material = this.cache.get(key);
    if (!material) {
      material = this.make(ref, fallback, finish ? FINISH_OFFSET : FACE_OFFSET);
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
    for (const m of this.cache.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.cache.clear();
  }

  private make(ref: string | undefined, fallback: string, base: typeof FACE_OFFSET | typeof FINISH_OFFSET): MeshStandardMaterial {
    const parsed = ref ? parseRef(ref) : null;
    if (parsed?.k === 'builtin') {
      const m = builtinMaterial(parsed.id);
      if (m) {
        const clear = m.opacity !== undefined && m.opacity < 1;
        // A pattern carries its own colours; the material's colour then leaves it as drawn.
        const map = patternTexture(m);
        return new MeshStandardMaterial({ ...base, color: map ? '#ffffff' : m.color, map, roughness: m.roughness, metalness: m.metalness, transparent: clear, opacity: m.opacity ?? 1, depthWrite: !clear, side: clear ? DoubleSide : FrontSide, name: ref });
      }
    }
    if (parsed?.k === 'paint') return new MeshStandardMaterial({ ...base, color: parsed.color, roughness: 0.85, metalness: 0, name: ref });
    return new MeshStandardMaterial({ ...base, color: fallback, roughness: 0.8, metalness: 0 });
  }
}
