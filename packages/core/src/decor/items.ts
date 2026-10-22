import type { Asset, Entity } from '../doc/schema';
import { polygonArea, type Polygon } from '../geometry/polygon';
import { DEG } from '../geometry/vec';
import type { Vec3 } from '../solids/mesh';
import { builtinRecipe, type Recipe } from './builtin';
import { recipeDetails, recipeOutline } from './recipes';
import { parseRef } from './refs';

export type Item = Extract<Entity, { type: 'item' }>;

/** What an item's model is, in its own normalised coordinates: mm, z up, its bottom centre at the origin, its front facing −y. */
export interface ItemModel {
  name: string;
  /** Width, depth and height, mm. */
  size: Vec3;
  /** Its top view: a recipe's outline, or an imported model's extent. */
  outline: Polygon[];
  /** The outlines of the parts seen from above, for the plan symbol's inner lines (recipes only). */
  details: Polygon[];
  /** The material slots it has. */
  slots: string[];
  recipe?: Recipe;
  /** An imported model's registry entry. */
  asset?: Asset & { file: string };
  /**
   * The move that brings an imported model's own coordinates (mm, z up) to the normalised ones:
   * its extent's bottom centre to the origin. Zero for recipes, which are made normalised.
   */
  offset: Vec3;
}

const rect = (w: number, d: number): Polygon => [
  [-w / 2, -d / 2],
  [w / 2, -d / 2],
  [w / 2, d / 2],
  [-w / 2, d / 2],
];

/** A stand-in for a model the project cannot resolve (a registry entry lost by hand): a half-metre cube. */
const MISSING: ItemModel = { name: 'Missing model', size: [500, 500, 500], outline: [rect(500, 500)], details: [], slots: [], offset: [0, 0, 0] };

/**
 * The model an item reference stands for: a built-in recipe, or an asset the project registers.
 * `fallback` is a size to use for a library model not yet in the project (the Item tool's ghost).
 */
export function itemModel(ref: string, assets: Readonly<Record<string, Asset>>, fallback?: { name: string; size: Vec3; min?: Vec3; slots?: string[] }): ItemModel {
  const parsed = parseRef(ref);
  if (parsed?.k === 'builtin') {
    const recipe = builtinRecipe(parsed.id);
    if (recipe) return { name: recipe.name, size: recipe.size, outline: recipeOutline(recipe), details: recipeDetails(recipe), slots: Object.keys(recipe.slots), recipe, offset: [0, 0, 0] };
  }
  if (parsed?.k === 'asset') {
    const asset = assets[parsed.file];
    const size = asset?.size ?? fallback?.size;
    const min = asset?.min ?? fallback?.min ?? (size ? [-size[0] / 2, -size[1] / 2, 0] : undefined);
    if (size && min) {
      return {
        name: asset?.name ?? fallback?.name ?? 'Model',
        size,
        outline: [rect(size[0], size[1])],
        details: [],
        slots: asset?.slots ?? fallback?.slots ?? [],
        ...(asset ? { asset: { ...asset, file: parsed.file } } : {}),
        offset: [-(min[0] + size[0] / 2), -(min[1] + size[1] / 2), -min[2]],
      };
    }
  }
  return MISSING;
}

/** An item's size as placed: its model's size times its scale, mm (always positive). */
export function itemSize(item: Pick<Item, 'scale'>, model: ItemModel): Vec3 {
  return [Math.abs(model.size[0] * item.scale[0]), Math.abs(model.size[1] * item.scale[1]), Math.abs(model.size[2] * item.scale[2])];
}

/** Where the item lies on the plan: its model's outline scaled, turned by `rotation[2]` and moved to `at`; counter-clockwise outlines. */
export function itemFootprint(item: Pick<Item, 'at' | 'rotation' | 'scale'>, model: Pick<ItemModel, 'outline'>): Polygon[] {
  const r = item.rotation[2] * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const [sx, sy] = item.scale;
  return model.outline.map((poly) => {
    const out: Polygon = poly.map(([x, y]) => {
      const px = x * sx;
      const py = y * sy;
      return [item.at[0] + px * c - py * s, item.at[1] + px * s + py * c];
    });
    // A mirrored item (negative scale) turns its outlines round; keep the boolean convention.
    return sx * sy < 0 ? out.reverse() : out;
  });
}

/**
 * The item's placement as a 4 × 4 matrix (column-major, mm, z up) taking its model's own coordinates
 * to the building: the normalising offset, the scale, the turns about x, y and z, then `at` with its
 * height above `floor` (the level's elevation).
 */
export function itemMatrix(item: Pick<Item, 'at' | 'rotation' | 'scale'>, model: ItemModel, floor = 0): number[] {
  const [ax, ay, az] = item.rotation.map((d) => d * DEG);
  const [cx, sx] = [Math.cos(ax), Math.sin(ax)];
  const [cy, sy] = [Math.cos(ay), Math.sin(ay)];
  const [cz, sz] = [Math.cos(az), Math.sin(az)];
  // R = Rz · Ry · Rx (row-major here).
  const r = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  const k = item.scale;
  const o = model.offset;
  const m = (i: number, j: number) => r[i][j] * k[j];
  const t = [0, 1, 2].map((i) => m(i, 0) * o[0] + m(i, 1) * o[1] + m(i, 2) * o[2]);
  const at = [item.at[0], item.at[1], item.at[2] + floor];
  return [m(0, 0), m(1, 0), m(2, 0), 0, m(0, 1), m(1, 1), m(2, 1), 0, m(0, 2), m(1, 2), m(2, 2), 0, at[0] + t[0], at[1] + t[1], at[2] + t[2], 1];
}

/** The area an item covers on the plan, mm². */
export const footprintArea = (polys: readonly Polygon[]): number => Math.abs(polys.reduce((sum, p) => sum + polygonArea(p), 0));
