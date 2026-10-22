import { unionPolygons } from '../geometry/clip';
import type { Polygon } from '../geometry/polygon';
import { MeshBuilder, circlePolygon, roundedRect, type Mesh } from '../solids/mesh';
import type { Part, Recipe } from './builtin';

/** The top view of one part. */
function partOutline(part: Part): Polygon {
  if (part.k === 'box') return roundedRect(part.min[0], part.min[1], part.max[0], part.max[1], part.r ?? 0);
  return circlePolygon(part.c, Math.max(part.r0, part.r1));
}

function addPart(builder: MeshBuilder, part: Part): void {
  if (part.k === 'box') builder.roundedBox(part.min, part.max, part.r ?? 0);
  else builder.cylinder(part.c, part.z0, part.z1, part.r0, part.r1);
}

const meshCache = new Map<string, { slot: string; mesh: Mesh }[]>();
const outlineCache = new Map<string, Polygon[]>();

/** A recipe's triangles, one mesh per material slot in the order the slots first appear (mm, z up, bottom centre at the origin). */
export function recipeMeshes(recipe: Recipe): { slot: string; mesh: Mesh }[] {
  const cached = meshCache.get(recipe.id);
  if (cached) return cached;
  const builders = new Map<string, MeshBuilder>();
  for (const part of recipe.parts) {
    let b = builders.get(part.slot);
    if (!b) builders.set(part.slot, (b = new MeshBuilder()));
    addPart(b, part);
  }
  const out = [...builders].map(([slot, b]) => ({ slot, mesh: b.build() }));
  meshCache.set(recipe.id, out);
  return out;
}

/** What the plan draws for a recipe: the union of its parts seen from above (outlines counter-clockwise, holes clockwise). */
export function recipeOutline(recipe: Recipe): Polygon[] {
  const cached = outlineCache.get(recipe.id);
  if (cached) return cached;
  const out = unionPolygons(recipe.parts.map(partOutline));
  outlineCache.set(recipe.id, out);
  return out;
}
