import type { Entity } from '../doc/schema';
import { pathLength, pointAt } from './path';
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

/** Where an opening of `width` may sit on a wall, given the openings already there. */
export interface OpeningFit {
  /** True when the asked position fits as it is. */
  fits: boolean;
  /** The nearest position that fits (the asked one when it fits); NaN when nothing fits. */
  along: number;
  /** The ranges of `along` (opening centre) that are free, from the wall start. */
  gaps: [number, number][];
  /** The wall's length. */
  length: number;
}

/**
 * Checks and clamps an opening's position: it must stay within the wall's length and clear of the
 * other openings (each given by its centre and width). Positions are distances along the wall's
 * reference line to the opening's centre.
 */
export function fitOpening(wall: Pick<WallLike, 'path'>, others: readonly { along: number; width: number }[], along: number, width: number): OpeningFit {
  const length = pathLength(wall.path);
  const half = width / 2;
  // Forbidden centre ranges, then the free gaps between them.
  const blocked = others.map((o): [number, number] => [o.along - o.width / 2 - half, o.along + o.width / 2 + half]).sort((p, q) => p[0] - q[0]);
  const gaps: [number, number][] = [];
  let from = half;
  for (const [b0, b1] of blocked) {
    if (b0 > from) gaps.push([from, Math.min(b0, length - half)]);
    from = Math.max(from, b1);
  }
  if (from <= length - half) gaps.push([from, length - half]);
  const valid = gaps.filter(([g0, g1]) => g1 >= g0 - 1e-9);
  const fits = valid.some(([g0, g1]) => along >= g0 - 1e-9 && along <= g1 + 1e-9);
  if (fits) return { fits: true, along, gaps: valid, length };
  let best = NaN;
  let bestD = Infinity;
  for (const [g0, g1] of valid) {
    const clamped = Math.min(g1, Math.max(g0, along));
    const d = Math.abs(clamped - along);
    if (d < bestD) {
      bestD = d;
      best = clamped;
    }
  }
  return { fits: false, along: best, gaps: valid, length };
}

/** True when an opening does not fit its wall where it is (too near an end, or over another opening). */
export function openingMisfits(wall: Pick<WallLike, 'path'>, opening: { id: string; along: number; width: number }, others: readonly { id: string; along: number; width: number }[]): boolean {
  return !fitOpening(
    wall,
    others.filter((o) => o.id !== opening.id),
    opening.along,
    opening.width,
  ).fits;
}

/** A column's footprint on the plan, flattened. */
export function columnPolygon(column: Extract<Entity, { type: 'column' }>, tolerance = 0.5): Polygon {
  const s = column.shape;
  if (s.k === 'circle') {
    const n = Math.max(16, Math.ceil((Math.PI * 2 * s.r) / 50));
    return Array.from({ length: n }, (_, i): Vec2 => [column.at[0] + s.r * Math.cos((i / n) * Math.PI * 2), column.at[1] + s.r * Math.sin((i / n) * Math.PI * 2)]);
  }
  if (s.k === 'region') {
    return s.region.outer.v.map((v) => v.p);
  }
  void tolerance;
  const a = column.rotation * DEG;
  const u: Vec2 = [Math.cos(a), Math.sin(a)];
  const v = perp(u);
  const at = column.at;
  return [add(add(at, scale(u, -s.w / 2)), scale(v, -s.d / 2)), add(add(at, scale(u, s.w / 2)), scale(v, -s.d / 2)), add(add(at, scale(u, s.w / 2)), scale(v, s.d / 2)), add(add(at, scale(u, -s.w / 2)), scale(v, s.d / 2))];
}

/** An opening's plan symbol, in mm: what the plan and the exports draw over the cut in the walls. */
export interface OpeningSymbol {
  /** The jamb lines across the wall's body. */
  jambs: [Vec2, Vec2][];
  /** A window's two glazing lines along the wall. */
  glazing: [Vec2, Vec2][];
  /** A door's leaf, open at 90° from its hinge. */
  leaf: [Vec2, Vec2] | null;
  /** A door's swing: the arc the leaf's end sweeps from the open leaf to the far jamb (radians, counter-clockwise positive). */
  swing: { center: Vec2; radius: number; start: number; sweep: number } | null;
}

/** The plan symbol of an opening in its wall: jambs; a window's glazing lines; a door's leaf and swing on its hinge side. */
export function openingSymbol(wall: WallLike, e: { kind: 'door' | 'window' | 'opening'; along: number; width: number; swing?: { hinge: 'start' | 'end'; side: 'left' | 'right' } }): OpeningSymbol {
  const { jambs, normal: n, cut, across } = openingFrame(wall, e);
  const [jambA, jambB] = jambs;
  const out: OpeningSymbol = {
    jambs: [
      [cut[0], cut[3]],
      [cut[1], cut[2]],
    ],
    glazing: [],
    leaf: null,
    swing: null,
  };
  if (e.kind === 'window') {
    const mid = (across.left + across.right) / 2;
    const quarter = (across.left - across.right) / 4;
    for (const k of [mid - quarter, mid + quarter]) out.glazing.push([add(jambA, scale(n, k)), add(jambB, scale(n, k))]);
    return out;
  }
  if (e.kind !== 'door') return out;
  const hinge = e.swing?.hinge === 'end' ? jambB : jambA;
  const other = hinge === jambA ? jambB : jambA;
  const side = e.swing?.side === 'right' ? -1 : 1;
  const leafEnd = add(hinge, scale(n, side * e.width));
  out.leaf = [hinge, leafEnd];
  const a0 = Math.atan2(leafEnd[1] - hinge[1], leafEnd[0] - hinge[0]);
  const a1 = Math.atan2(other[1] - hinge[1], other[0] - hinge[0]);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  out.swing = { center: hinge, radius: e.width, start: a0, sweep };
  return out;
}
