import { arcGeometry, circleCircle, lineCircle, paramOf, type Seg } from './path';
import { add, cross, distance, normalize, scale, sub, type Vec2 } from './vec';

const EPS = 1e-6;

/** The parameter of a point on a segment's curve, or null when it lies outside the segment. */
function onSegment(s: Seg, p: Vec2): number | null {
  if (s.k === 'cubic') return null;
  const t = paramOf(s, p);
  return t >= -EPS && t <= 1 + EPS ? Math.min(1, Math.max(0, t)) : null;
}

/** The parameter along the infinite line or full circle a segment lies on, for extensions. */
export function curveParam(s: Seg, p: Vec2): number {
  return s.k === 'cubic' ? NaN : paramOf(s, p);
}

/** Where the curves of two segments meet (lines and arcs; Béziers are skipped), limited to the segments themselves unless `extend`. */
export function segmentIntersections(a: Seg, b: Seg, extend = false): Vec2[] {
  if (a.k === 'cubic' || b.k === 'cubic') return [];
  let points: Vec2[];
  if (a.k === 'line' && b.k === 'line') {
    const da = sub(a.b, a.a);
    const db = sub(b.b, b.a);
    const denom = cross(da, db);
    if (Math.abs(denom) < 1e-12) return [];
    const t = cross(sub(b.a, a.a), db) / denom;
    points = [add(a.a, scale(da, t))];
  } else if (a.k === 'arc' && b.k === 'arc') {
    const ga = arcGeometry(a.a, a.b, a.bulge);
    const gb = arcGeometry(b.a, b.b, b.bulge);
    points = circleCircle(ga.center, ga.radius, gb.center, gb.radius);
  } else {
    const line = (a.k === 'line' ? a : b) as Extract<Seg, { k: 'line' }>;
    const arc = (a.k === 'arc' ? a : b) as Extract<Seg, { k: 'arc' }>;
    const g = arcGeometry(arc.a, arc.b, arc.bulge);
    points = lineCircle(line.a, normalize(sub(line.b, line.a)), g.center, g.radius);
  }
  if (extend) return points;
  return points.filter((p) => onSegment(a, p) !== null && onSegment(b, p) !== null);
}

/** The foot of the perpendicular from `from` onto the segment's line or circle (the nearest point of the full curve), or null for a Bézier. */
export function perpendicularFoot(s: Seg, from: Vec2): Vec2 | null {
  if (s.k === 'line') {
    const d = sub(s.b, s.a);
    const l2 = d[0] * d[0] + d[1] * d[1];
    if (l2 === 0) return null;
    const t = ((from[0] - s.a[0]) * d[0] + (from[1] - s.a[1]) * d[1]) / l2;
    return add(s.a, scale(d, t));
  }
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    const r = sub(from, g.center);
    const len = distance(from, g.center);
    if (len < 1e-9) return null;
    return add(g.center, scale(r, g.radius / len));
  }
  return null;
}

/** The points where lines from `from` touch the circle an arc lies on. */
export function tangentPoints(s: Seg, from: Vec2): Vec2[] {
  if (s.k !== 'arc') return [];
  const g = arcGeometry(s.a, s.b, s.bulge);
  const d = distance(from, g.center);
  if (d <= g.radius) return [];
  // The tangent points lie on the circle with the diameter from–centre.
  const mid: Vec2 = [(from[0] + g.center[0]) / 2, (from[1] + g.center[1]) / 2];
  return circleCircle(g.center, g.radius, mid, d / 2);
}

/** Whether a point of a segment's curve lies within the segment itself. */
export function withinSegment(s: Seg, p: Vec2): boolean {
  return onSegment(s, p) !== null;
}
