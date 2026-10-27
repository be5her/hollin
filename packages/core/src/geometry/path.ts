import { DEG, add, angleOf, cross, distance, dot, emptyBox, extendBox, length, lerp, normalize, perp, scale, signedAngle, sub, type Box, type Vec2 } from './vec';

/**
 * The geometry primitive: a sequence of vertices joined by segments, open or closed.
 *
 * - A vertex's `s` is the segment to the next vertex: a straight line (default), a circular arc given
 *   by its bulge (tan of a quarter of its sweep; positive turns counter-clockwise, as in DXF), or a
 *   cubic Bézier whose handles are relative to their own vertex, so moving a vertex moves its handles.
 * - A vertex's `c` is a corner treatment (fillet radius, or chamfer distances along the incoming and
 *   outgoing segments). Corners are applied when the geometry is evaluated, never baked in, so they
 *   stay editable. The ends of an open path have no corner.
 */
export type Segment = { k: 'line' } | { k: 'arc'; bulge: number } | { k: 'cubic'; c1: Vec2; c2: Vec2 };
export type Corner = { k: 'fillet'; r: number } | { k: 'chamfer'; d1: number; d2?: number };
export interface Vertex {
  p: Vec2;
  s?: Segment;
  c?: Corner;
}
export interface Path {
  closed: boolean;
  v: Vertex[];
}
/** A filled shape: a closed outer boundary and closed holes. */
export interface Region {
  outer: Path;
  holes: Path[];
}

/** An evaluated segment between absolute points (corners already applied). */
export type Seg = { k: 'line'; a: Vec2; b: Vec2 } | { k: 'arc'; a: Vec2; b: Vec2; bulge: number } | { k: 'cubic'; a: Vec2; b: Vec2; c1: Vec2; c2: Vec2 };

export interface Diagnostic {
  code: 'corner-clamped' | 'corner-unsupported' | 'corner-impossible' | 'degenerate-segment' | 'too-few-vertices';
  message: string;
  vertex?: number;
}

/** Number of segments: one per vertex for a closed path, one fewer for an open one. */
export const segmentCount = (path: Path): number => (path.closed ? path.v.length : Math.max(0, path.v.length - 1));

/** The raw segments, without corners. */
export function rawSegments(path: Path): Seg[] {
  const out: Seg[] = [];
  const n = path.v.length;
  for (let i = 0; i < segmentCount(path); i++) {
    const from = path.v[i];
    const to = path.v[(i + 1) % n];
    const s = from.s ?? { k: 'line' };
    if (s.k === 'line' || (s.k === 'arc' && Math.abs(s.bulge) < 1e-12)) out.push({ k: 'line', a: from.p, b: to.p });
    else if (s.k === 'arc') out.push({ k: 'arc', a: from.p, b: to.p, bulge: s.bulge });
    else out.push({ k: 'cubic', a: from.p, b: to.p, c1: add(from.p, s.c1), c2: add(to.p, s.c2) });
  }
  return out;
}

// ---------- arcs ----------

export interface ArcGeometry {
  center: Vec2;
  radius: number;
  /** Angle of the start point around the centre. */
  start: number;
  /** Signed sweep, positive counter-clockwise. */
  sweep: number;
}

export function arcGeometry(a: Vec2, b: Vec2, bulge: number): ArcGeometry {
  const sweep = 4 * Math.atan(bulge);
  const chord = sub(b, a);
  const c = length(chord);
  const mid = lerp(a, b, 0.5);
  const h = (c * (1 - bulge * bulge)) / (4 * bulge);
  const center = add(mid, scale(perp(normalize(chord)), h));
  return { center, radius: distance(center, a), start: angleOf(sub(a, center)), sweep };
}

/** The bulge of an arc that sweeps `sweep` radians. */
export const bulgeOf = (sweep: number): number => Math.tan(sweep / 4);

/** The bulge of the arc from a to b through `through`, or null when the points are collinear. */
export function bulgeThrough(a: Vec2, through: Vec2, b: Vec2): number | null {
  const area = cross(sub(through, a), sub(b, a));
  if (Math.abs(area) < 1e-9) return null;
  // The inscribed angle at `through` is half the arc's central angle on the other side.
  const angle = signedAngle(sub(a, through), sub(b, through));
  const sweep = 2 * (Math.sign(angle) * Math.PI - angle);
  return bulgeOf(-sweep);
}

/** The point at angle fraction t along an arc. */
export const arcPoint = (g: ArcGeometry, t: number): Vec2 => [g.center[0] + g.radius * Math.cos(g.start + g.sweep * t), g.center[1] + g.radius * Math.sin(g.start + g.sweep * t)];

// ---------- cubics ----------

function cubicPoint(s: Extract<Seg, { k: 'cubic' }>, t: number): Vec2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [w0 * s.a[0] + w1 * s.c1[0] + w2 * s.c2[0] + w3 * s.b[0], w0 * s.a[1] + w1 * s.c1[1] + w2 * s.c2[1] + w3 * s.b[1]];
}

function cubicDerivative(s: Extract<Seg, { k: 'cubic' }>, t: number): Vec2 {
  const u = 1 - t;
  const d0 = sub(s.c1, s.a);
  const d1 = sub(s.c2, s.c1);
  const d2 = sub(s.b, s.c2);
  return [3 * (u * u * d0[0] + 2 * u * t * d1[0] + t * t * d2[0]), 3 * (u * u * d0[1] + 2 * u * t * d1[1] + t * t * d2[1])];
}

// Gauss–Legendre nodes and weights on [0, 1].
const GL5 = [
  [0.0469100770306680, 0.1184634425280945],
  [0.2307653449471585, 0.2393143352496832],
  [0.5, 0.2844444444444444],
  [0.7692346550528415, 0.2393143352496832],
  [0.9530899229693319, 0.1184634425280945],
] as const;

function cubicLength(s: Extract<Seg, { k: 'cubic' }>, t0 = 0, t1 = 1, depth = 0): number {
  const span = t1 - t0;
  let total = 0;
  for (const [x, w] of GL5) total += w * length(cubicDerivative(s, t0 + span * x)) * span;
  if (depth >= 6) return total;
  const mid = (t0 + t1) / 2;
  let halves = 0;
  for (const [a, b] of [
    [t0, mid],
    [mid, t1],
  ]) {
    for (const [x, w] of GL5) halves += w * length(cubicDerivative(s, a + (b - a) * x)) * (b - a);
  }
  return Math.abs(halves - total) < 1e-9 * Math.max(1, total) ? halves : cubicLength(s, t0, mid, depth + 1) + cubicLength(s, mid, t1, depth + 1);
}

// ---------- per-segment evaluation ----------

export function segmentLength(s: Seg): number {
  if (s.k === 'line') return distance(s.a, s.b);
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    return Math.abs(g.sweep) * g.radius;
  }
  return cubicLength(s);
}

/** The point at parameter t in [0, 1] (by angle for arcs, by the curve parameter for cubics). */
export function segmentPoint(s: Seg, t: number): Vec2 {
  if (s.k === 'line') return lerp(s.a, s.b, t);
  if (s.k === 'arc') return arcPoint(arcGeometry(s.a, s.b, s.bulge), t);
  return cubicPoint(s, t);
}

/** Unit tangent (direction of travel) at parameter t. */
export function segmentTangent(s: Seg, t: number): Vec2 {
  if (s.k === 'line') return normalize(sub(s.b, s.a));
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    const angle = g.start + g.sweep * t;
    return scale([-Math.sin(angle), Math.cos(angle)], Math.sign(g.sweep));
  }
  const d = cubicDerivative(s, t);
  return length(d) > 1e-12 ? normalize(d) : normalize(sub(s.b, s.a));
}

/** The parameter at arc length `d` from the start of the segment. */
function segmentParamAt(s: Seg, d: number, total: number): number {
  if (total <= 0) return 0;
  if (s.k !== 'cubic') return Math.min(1, Math.max(0, d / total));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubicLength(s, 0, mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Signed area contribution of one segment to a closed boundary (½∮ x dy − y dx). */
function segmentArea(s: Seg): number {
  const chord = (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2;
  if (s.k === 'line') return chord;
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    return chord + (g.radius * g.radius * (g.sweep - Math.sin(g.sweep))) / 2;
  }
  // The integrand is a polynomial of degree 5, which 3-point Gauss–Legendre integrates exactly.
  const nodes = [
    [0.1127016653792583, 0.2777777777777778],
    [0.5, 0.4444444444444444],
    [0.8872983346207417, 0.2777777777777778],
  ] as const;
  let total = 0;
  for (const [t, w] of nodes) {
    const p = cubicPoint(s, t);
    const d = cubicDerivative(s, t);
    total += (w * (p[0] * d[1] - p[1] * d[0])) / 2;
  }
  return total;
}

/** The exact extent of one segment. */
export function segmentBox(s: Seg): Box {
  let box = extendBox(extendBox(emptyBox(), s.a), s.b);
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    // Include every axis extreme (0°, 90°, 180°, 270°) the arc passes through.
    for (let k = -8; k <= 8; k++) {
      const angle = (k * Math.PI) / 2;
      const t = (angle - g.start) / g.sweep;
      if (t > 0 && t < 1) box = extendBox(box, arcPoint(g, t));
    }
  } else if (s.k === 'cubic') {
    for (const axis of [0, 1] as const) {
      // Roots of the derivative's quadratic in t.
      const p0 = s.a[axis];
      const p1 = s.c1[axis];
      const p2 = s.c2[axis];
      const p3 = s.b[axis];
      const a = -p0 + 3 * p1 - 3 * p2 + p3;
      const b = 2 * (p0 - 2 * p1 + p2);
      const c = p1 - p0;
      const roots: number[] = [];
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) roots.push(-c / b);
      } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) roots.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a));
      }
      for (const t of roots) if (t > 0 && t < 1) box = extendBox(box, cubicPoint(s, t));
    }
  }
  return box;
}

/** Points along a segment, `tolerance` mm at most from the true curve, excluding its end point. */
export function flattenSegment(s: Seg, tolerance: number, out: Vec2[]): void {
  if (s.k === 'line') {
    out.push(s.a);
    return;
  }
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    const step = g.radius > tolerance ? 2 * Math.acos(1 - tolerance / g.radius) : Math.PI / 4;
    const n = Math.max(1, Math.ceil(Math.abs(g.sweep) / Math.max(step, 1e-3)));
    for (let i = 0; i < n; i++) out.push(arcPoint(g, i / n));
    return;
  }
  const recurse = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, depth: number) => {
    const chord = sub(b, a);
    const len = length(chord);
    const flat = len < 1e-9 ? Math.max(distance(a, c1), distance(a, c2)) : Math.max(Math.abs(cross(sub(c1, a), chord)), Math.abs(cross(sub(c2, a), chord))) / len;
    if (flat <= tolerance || depth > 16) {
      out.push(a);
      return;
    }
    const ab = lerp(a, c1, 0.5);
    const bc = lerp(c1, c2, 0.5);
    const cd = lerp(c2, b, 0.5);
    const abc = lerp(ab, bc, 0.5);
    const bcd = lerp(bc, cd, 0.5);
    const mid = lerp(abc, bcd, 0.5);
    recurse(a, ab, abc, mid, depth + 1);
    recurse(mid, bcd, cd, b, depth + 1);
  };
  recurse(s.a, s.c1, s.c2, s.b, 0);
}

// ---------- corners ----------

type Curve = { k: 'line'; p: Vec2; d: Vec2 } | { k: 'circle'; c: Vec2; r: number; ccw: boolean };

function curveOf(s: Seg): Curve | null {
  if (s.k === 'line') return { k: 'line', p: s.a, d: normalize(sub(s.b, s.a)) };
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    return { k: 'circle', c: g.center, r: g.radius, ccw: g.sweep > 0 };
  }
  return null;
}

/** Candidate centres of a circle of radius r tangent to both curves on the given sides. */
function filletCentres(c1: Curve, c2: Curve, r: number, left: boolean): Vec2[] {
  const side = left ? 1 : -1;
  const offsetLine = (c: Extract<Curve, { k: 'line' }>) => ({ p: add(c.p, scale(perp(c.d), side * r)), d: c.d });
  // Radius of the offset circle: smaller when the arc's centre is on the fillet's side of travel.
  const offsetRadius = (c: Extract<Curve, { k: 'circle' }>) => (c.ccw === left ? c.r - r : c.r + r);
  if (c1.k === 'line' && c2.k === 'line') {
    const a = offsetLine(c1);
    const b = offsetLine(c2);
    const denom = cross(a.d, b.d);
    if (Math.abs(denom) < 1e-12) return [];
    const t = cross(sub(b.p, a.p), b.d) / denom;
    return [add(a.p, scale(a.d, t))];
  }
  if (c1.k === 'circle' && c2.k === 'circle') return circleCircle(c1.c, offsetRadius(c1), c2.c, offsetRadius(c2));
  const line = offsetLine((c1.k === 'line' ? c1 : c2) as Extract<Curve, { k: 'line' }>);
  const circle = (c1.k === 'circle' ? c1 : c2) as Extract<Curve, { k: 'circle' }>;
  return lineCircle(line.p, line.d, circle.c, offsetRadius(circle));
}

/** Where the line through p with unit direction d meets the circle (0, 1 or 2 points). */
export function lineCircle(p: Vec2, d: Vec2, c: Vec2, r: number): Vec2[] {
  if (r <= 0) return [];
  const f = sub(p, c);
  const b = dot(f, d);
  const disc = b * b - (dot(f, f) - r * r);
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [add(p, scale(d, -b - s)), add(p, scale(d, -b + s))];
}

/** Where two circles meet (0, 1 or 2 points). */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  if (r1 <= 0 || r2 <= 0) return [];
  const d = distance(c1, c2);
  if (d < 1e-12 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = normalize(sub(c2, c1));
  const m = add(c1, scale(u, a));
  return [add(m, scale(perp(u), h)), add(m, scale(perp(u), -h))];
}

/** Where a circle centred at `f` touches the curve. */
function tangentPoint(c: Curve, f: Vec2): Vec2 {
  if (c.k === 'line') return add(c.p, scale(c.d, dot(sub(f, c.p), c.d)));
  return add(c.c, scale(normalize(sub(f, c.c)), c.r));
}

/** The parameter (0..1) of a point known to lie on the segment's curve. */
export function paramOf(s: Seg, p: Vec2): number {
  if (s.k === 'line') {
    const d = sub(s.b, s.a);
    const l2 = dot(d, d);
    return l2 === 0 ? 0 : dot(sub(p, s.a), d) / l2;
  }
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    let delta = angleOf(sub(p, g.center)) - g.start;
    if (g.sweep > 0) while (delta < -1e-9) delta += 2 * Math.PI;
    else while (delta > 1e-9) delta -= 2 * Math.PI;
    return delta / g.sweep;
  }
  return NaN;
}

/** The part of a line or arc segment from parameter t0 to t1. */
export function trim(s: Seg, t0: number, t1: number): Seg {
  if (s.k === 'line') return { k: 'line', a: lerp(s.a, s.b, t0), b: lerp(s.a, s.b, t1) };
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    return { k: 'arc', a: arcPoint(g, t0), b: arcPoint(g, t1), bulge: bulgeOf(g.sweep * (t1 - t0)) };
  }
  return s;
}

/** Applies the corner at the join between `incoming` and `outgoing`; returns the trimmed pair and the piece in between. */
function applyCorner(incoming: Seg, outgoing: Seg, corner: Corner, vertex: number, diagnostics: Diagnostic[], budgetIn: number, budgetOut: number): { incoming: Seg; outgoing: Seg; joint: Seg | null } {
  const dIn = segmentTangent(incoming, 1);
  const dOut = segmentTangent(outgoing, 0);
  const turn = cross(dIn, dOut);
  if (Math.abs(turn) < 1e-9 && dot(dIn, dOut) > 0) return { incoming, outgoing, joint: null };
  if (incoming.k === 'cubic' || outgoing.k === 'cubic') {
    diagnostics.push({ code: 'corner-unsupported', message: 'Corners next to curves (Bézier segments) are drawn sharp.', vertex });
    return { incoming, outgoing, joint: null };
  }
  const lenIn = segmentLength(incoming);
  const lenOut = segmentLength(outgoing);

  if (corner.k === 'chamfer') {
    let d1 = corner.d1;
    let d2 = corner.d2 ?? corner.d1;
    const maxIn = lenIn * budgetIn;
    const maxOut = lenOut * budgetOut;
    if (d1 > maxIn || d2 > maxOut) {
      d1 = Math.min(d1, maxIn);
      d2 = Math.min(d2, maxOut);
      diagnostics.push({ code: 'corner-clamped', message: 'The chamfer is longer than the edges allow and was shortened.', vertex });
    }
    const tIn = 1 - d1 / lenIn;
    const tOut = d2 / lenOut;
    const a = trim(incoming, 0, tIn);
    const b = trim(outgoing, tOut, 1);
    return { incoming: a, outgoing: b, joint: { k: 'line', a: a.b, b: b.a } };
  }

  // Fillet: a circle tangent to both curves on the inside of the turn, shrunk until its tangent points fit.
  const left = turn > 0;
  const c1 = curveOf(incoming)!;
  const c2 = curveOf(outgoing)!;
  let r = corner.r;
  for (let attempt = 0; attempt < 40; attempt++) {
    const vertexPoint = incoming.b;
    const centres = filletCentres(c1, c2, r, left).sort((x, y) => distance(x, vertexPoint) - distance(y, vertexPoint));
    for (const f of centres) {
      const pIn = tangentPoint(c1, f);
      const pOut = tangentPoint(c2, f);
      const tIn = paramOf(incoming, pIn);
      const tOut = paramOf(outgoing, pOut);
      if (!(tIn >= 1 - budgetIn - 1e-9 && tIn <= 1 + 1e-9 && tOut >= -1e-9 && tOut <= budgetOut + 1e-9)) continue;
      if (r < corner.r) diagnostics.push({ code: 'corner-clamped', message: `The fillet does not fit; it was reduced to radius ${r.toFixed(1)} mm.`, vertex });
      const a = trim(incoming, 0, Math.min(1, tIn));
      const b = trim(outgoing, Math.max(0, tOut), 1);
      const sweep = signedAngle(sub(a.b, f), sub(b.a, f));
      return { incoming: a, outgoing: b, joint: { k: 'arc', a: a.b, b: b.a, bulge: bulgeOf(sweep) } };
    }
    r *= 0.8;
    if (r < 1e-3) break;
  }
  diagnostics.push({ code: 'corner-impossible', message: 'No fillet fits at this corner; it is drawn sharp.', vertex });
  return { incoming, outgoing, joint: null };
}

/**
 * The path as absolute segments with its corners applied. Each edge can give up to half its length to
 * the corners at its two ends; a corner that does not fit is shrunk and reported in `diagnostics`.
 */
export function resolvePath(path: Path): { segs: Seg[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (path.v.length < 2) {
    diagnostics.push({ code: 'too-few-vertices', message: 'A path needs at least two points.' });
    return { segs: [], diagnostics };
  }
  const segs = rawSegments(path);
  segs.forEach((s, i) => {
    if (segmentLength(s) < 1e-6) diagnostics.push({ code: 'degenerate-segment', message: 'Two consecutive points are at the same place.', vertex: i });
  });
  const n = path.v.length;
  const hasCorner = (i: number) => Boolean(path.v[i]?.c) && (path.closed || (i > 0 && i < n - 1));
  if (!path.v.some((_, i) => hasCorner(i))) return { segs, diagnostics };

  // Corners consume the ends of segments; collect the joint pieces and trimmed segments.
  const trimmed = [...segs];
  const joints: (Seg | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!hasCorner(i)) continue;
    const inIndex = (i - 1 + segs.length) % segs.length;
    const outIndex = i % segs.length;
    // An edge with corners at both ends gives each half of itself.
    const budgetIn = hasCorner((i - 1 + n) % n) && (path.closed || i - 1 > 0) ? 0.5 : 1;
    const budgetOut = hasCorner((i + 1) % n) && (path.closed || i + 1 < n - 1) ? 0.5 : 1;
    const result = applyCorner(trimmed[inIndex], trimmed[outIndex], path.v[i].c!, i, diagnostics, budgetIn, budgetOut);
    trimmed[inIndex] = result.incoming;
    trimmed[outIndex] = result.outgoing;
    joints[i] = result.joint;
  }
  const out: Seg[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (path.closed && joints[i]) out.push(joints[i]!);
    else if (!path.closed && i > 0 && joints[i]) out.push(joints[i]!);
    out.push(trimmed[i]);
  }
  return { segs: out.filter((s) => segmentLength(s) > 1e-9), diagnostics };
}

// ---------- whole-path measures ----------

export function pathLength(path: Path): number {
  return resolvePath(path).segs.reduce((sum, s) => sum + segmentLength(s), 0);
}

/** Signed area of a closed path: positive when it runs counter-clockwise. */
export function signedArea(path: Path): number {
  return resolvePath(path).segs.reduce((sum, s) => sum + segmentArea(s), 0);
}

export function regionArea(region: Region): number {
  return Math.abs(signedArea(region.outer)) - region.holes.reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);
}

export function pathBox(path: Path): Box {
  return resolvePath(path).segs.reduce((box, s) => {
    const b = segmentBox(s);
    return { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) };
  }, emptyBox());
}

/** Points within `tolerance` mm of the path; closed paths do not repeat their first point. */
export function flatten(path: Path, tolerance = 0.5): Vec2[] {
  const { segs } = resolvePath(path);
  const out: Vec2[] = [];
  for (const s of segs) flattenSegment(s, tolerance, out);
  if (!path.closed && segs.length) out.push(segs[segs.length - 1].b);
  return out;
}

/** The point and direction at a distance along the path, clamped to its ends. */
export function pointAt(path: Path, distanceAlong: number): { point: Vec2; tangent: Vec2; segment: number } {
  const { segs } = resolvePath(path);
  if (!segs.length) return { point: path.v[0]?.p ?? [0, 0], tangent: [1, 0], segment: 0 };
  let remaining = Math.max(0, distanceAlong);
  for (let i = 0; i < segs.length; i++) {
    const len = segmentLength(segs[i]);
    if (remaining <= len || i === segs.length - 1) {
      const t = segmentParamAt(segs[i], Math.min(remaining, len), len);
      return { point: segmentPoint(segs[i], t), tangent: segmentTangent(segs[i], t), segment: i };
    }
    remaining -= len;
  }
  return { point: segs[segs.length - 1].b, tangent: segmentTangent(segs[segs.length - 1], 1), segment: segs.length - 1 };
}

/** Even–odd containment of a point in a region (holes excluded), tested against the flattened outline. */
export function regionContains(region: Region, p: Vec2, tolerance = 0.1): boolean {
  const inside = (poly: Vec2[]) => {
    let wn = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) wn = !wn;
    }
    return wn;
  };
  return inside(flatten(region.outer, tolerance)) && !region.holes.some((h) => inside(flatten(h, tolerance)));
}

/** The closest point on the path to `p`, and how far along the path it is. */
export function nearestPoint(path: Path, p: Vec2): { point: Vec2; distance: number; along: number } {
  const { segs } = resolvePath(path);
  let best = { point: path.v[0]?.p ?? p, distance: Infinity, along: 0 };
  let offset = 0;
  for (const s of segs) {
    const len = segmentLength(s);
    let t: number;
    if (s.k === 'line') {
      const d = sub(s.b, s.a);
      const l2 = dot(d, d);
      t = l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, s.a), d) / l2));
    } else {
      // Sample, then refine around the best sample.
      let bestT = 0;
      let bestD = Infinity;
      for (let i = 0; i <= 64; i++) {
        const d = distance(segmentPoint(s, i / 64), p);
        if (d < bestD) {
          bestD = d;
          bestT = i / 64;
        }
      }
      let lo = Math.max(0, bestT - 1 / 64);
      let hi = Math.min(1, bestT + 1 / 64);
      for (let k = 0; k < 40; k++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (distance(segmentPoint(s, m1), p) < distance(segmentPoint(s, m2), p)) hi = m2;
        else lo = m1;
      }
      t = (lo + hi) / 2;
    }
    const q = segmentPoint(s, t);
    const d = distance(q, p);
    if (d < best.distance) {
      const along = s.k === 'cubic' ? offset + segmentLengthTo(s, t) : offset + len * t;
      best = { point: q, distance: d, along };
    }
    offset += len;
  }
  return best;
}

const segmentLengthTo = (s: Extract<Seg, { k: 'cubic' }>, t: number) => cubicLength(s, 0, t);

// ---------- editing ----------

/** The same path traversed the other way. Arcs flip their bulge, handles swap ends, chamfer distances swap sides. */
export function reversePath(path: Path): Path {
  const n = path.v.length;
  const order = path.closed ? [0, ...Array.from({ length: n - 1 }, (_, i) => n - 1 - i)] : Array.from({ length: n }, (_, i) => n - 1 - i);
  const v: Vertex[] = order.map((idx, j) => {
    const original = path.v[idx];
    const nextIdx = order[(j + 1) % n];
    // The new segment from idx to nextIdx is the old segment from nextIdx to idx, reversed.
    const oldSegOwner = path.v[nextIdx];
    const isSegment = path.closed || j < n - 1;
    const old = oldSegOwner.s;
    let s: Segment | undefined;
    if (isSegment && old) {
      if (old.k === 'arc') s = { k: 'arc', bulge: -old.bulge };
      else if (old.k === 'cubic') s = { k: 'cubic', c1: old.c2, c2: old.c1 };
      else s = old;
    }
    const c = original.c && original.c.k === 'chamfer' ? { k: 'chamfer' as const, d1: original.c.d2 ?? original.c.d1, d2: original.c.d1 } : original.c;
    return { p: original.p, ...(s && s.k !== 'line' ? { s } : {}), ...(c ? { c } : {}) };
  });
  return { closed: path.closed, v };
}

/** Moves, rotates (degrees, counter-clockwise, about the origin), scales and optionally mirrors (across the x axis) a path. */
export function transformPath(path: Path, t: { dx?: number; dy?: number; rotate?: number; scale?: number; mirror?: boolean }): Path {
  const k = t.scale ?? 1;
  const angle = (t.rotate ?? 0) * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const linear = (q: Vec2): Vec2 => {
    const m: Vec2 = t.mirror ? [q[0], -q[1]] : q;
    return [(m[0] * cos - m[1] * sin) * k, (m[0] * sin + m[1] * cos) * k];
  };
  const point = (q: Vec2): Vec2 => add(linear(q), [t.dx ?? 0, t.dy ?? 0]);
  return {
    closed: path.closed,
    v: path.v.map((vx) => {
      const s: Segment | undefined = vx.s && (vx.s.k === 'arc' ? { k: 'arc', bulge: t.mirror ? -vx.s.bulge : vx.s.bulge } : vx.s.k === 'cubic' ? { k: 'cubic', c1: linear(vx.s.c1), c2: linear(vx.s.c2) } : vx.s);
      const c: Corner | undefined = vx.c && (vx.c.k === 'fillet' ? { k: 'fillet', r: vx.c.r * k } : { k: 'chamfer', d1: vx.c.d1 * k, ...(vx.c.d2 !== undefined ? { d2: vx.c.d2 * k } : {}) });
      return { p: point(vx.p), ...(s ? { s } : {}), ...(c ? { c } : {}) };
    }),
  };
}

/** A closed rectangle path, counter-clockwise, from its lower-left corner. */
export function rectPath(x: number, y: number, width: number, height: number): Path {
  return { closed: true, v: [{ p: [x, y] }, { p: [x + width, y] }, { p: [x + width, y + height] }, { p: [x, y + height] }] };
}

/** A circle as two half arcs. */
export function circlePath(center: Vec2, radius: number): Path {
  return { closed: true, v: [{ p: [center[0] + radius, center[1]], s: { k: 'arc', bulge: 1 } }, { p: [center[0] - radius, center[1]], s: { k: 'arc', bulge: 1 } }] };
}
