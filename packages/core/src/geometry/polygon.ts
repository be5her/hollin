import { emptyBox, extendBox, type Box, type Vec2 } from './vec';

/** A flattened closed polygon: straight edges between consecutive points, the last joined to the first. */
export type Polygon = Vec2[];

/** Signed area by the shoelace formula: positive when counter-clockwise. */
export function polygonArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

export function polygonPerimeter(poly: Polygon): number {
  let l = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) l += Math.hypot(poly[i][0] - poly[j][0], poly[i][1] - poly[j][1]);
  return l;
}

export function polygonBox(poly: Polygon): Box {
  return poly.reduce(extendBox, emptyBox());
}

/** Even–odd containment. Points on the boundary count as inside or outside arbitrarily. */
export function polygonContains(poly: Polygon, p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The polygon running the wanted way round (reversed when it does not). */
export function orient(poly: Polygon, counterClockwise: boolean): Polygon {
  return polygonArea(poly) >= 0 === counterClockwise ? poly : [...poly].reverse();
}

/** The area centroid (falls back to the first point for a degenerate polygon). */
export function polygonCentroid(poly: Polygon): Vec2 {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-9) return poly[0] ?? [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** The nearest distance from a point to the polygon's edges. */
export function polygonEdgeDistance(poly: Polygon, p: Vec2): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}
