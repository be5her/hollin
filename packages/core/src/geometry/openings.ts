import type { Entity } from '../doc/schema';
import { pointAt } from './path';
import type { Polygon } from './polygon';
import { DEG, add, perp, scale, type Vec2 } from './vec';
import { wallOffsets, type WallLike } from './walls';

/** Where an opening sits in its wall, on the plan. */
export interface OpeningFrame {
  /** The point on the wall's reference line at `along`. */
  center: Vec2;
  /** The direction of the wall there, and its left normal. */
  tangent: Vec2;
  normal: Vec2;
  /** The jambs on the reference line: start side, then end side. */
  jambs: [Vec2, Vec2];
  /** The cut through the body, as a polygon a hair wider than the body so it covers its outline. */
  cut: Polygon;
  /** The body's extent across the reference line (signed, left positive). */
  across: { left: number; right: number };
}

export function openingFrame(wall: WallLike, opening: { along: number; width: number }): OpeningFrame {
  const { point: center, tangent } = pointAt(wall.path, opening.along);
  const normal = perp(tangent);
  const half = opening.width / 2;
  const across = wallOffsets(wall);
  const a = add(center, scale(tangent, -half));
  const b = add(center, scale(tangent, half));
  const grow = 0.5;
  const cut: Polygon = [add(a, scale(normal, across.left + grow)), add(b, scale(normal, across.left + grow)), add(b, scale(normal, across.right - grow)), add(a, scale(normal, across.right - grow))];
  return { center, tangent, normal, jambs: [a, b], cut, across };
}

/** A column's footprint on the plan, flattened. */
export function columnPolygon(column: Extract<Entity, { type: 'column' }>, tolerance = 0.5): Polygon {
  const s = column.shape;
  if (s.k === 'circle') {
    const n = Math.max(16, Math.ceil((Math.PI * 2 * s.r) / 50));
    return Array.from({ length: n }, (_, i): Vec2 => [column.at[0] + s.r * Math.cos((i / n) * Math.PI * 2), column.at[1] + s.r * Math.sin((i / n) * Math.PI * 2)]);
  }
  if (s.k === 'region') {
    // Lazy import avoided: regions are flattened by the caller through polygonOf when needed; here the outer corners suffice.
    return s.region.outer.v.map((v) => v.p);
  }
  void tolerance;
  const a = column.rotation * DEG;
  const u: Vec2 = [Math.cos(a), Math.sin(a)];
  const v = perp(u);
  const at = column.at;
  return [add(add(at, scale(u, -s.w / 2)), scale(v, -s.d / 2)), add(add(at, scale(u, s.w / 2)), scale(v, -s.d / 2)), add(add(at, scale(u, s.w / 2)), scale(v, s.d / 2)), add(add(at, scale(u, -s.w / 2)), scale(v, s.d / 2))];
}
