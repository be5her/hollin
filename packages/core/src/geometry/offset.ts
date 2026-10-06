import { arcGeometry, arcPoint, bulgeOf, circleCircle, lineCircle, resolvePath, type Path, type Seg, type Vertex } from './path';
import { add, angleOf, cross, distance, dot, normalize, perp, scale, sub, type Vec2 } from './vec';

/** Beyond this many offsets from the vertex, a sharp corner is bevelled instead of mitred. */
export const MITER_LIMIT = 4;

/** The parameter of a point on an arc's circle, measured from the arc's start in its direction, allowing a little before the start and beyond the end. */
function arcParam(s: Extract<Seg, { k: 'arc' }>, p: Vec2): number {
  const g = arcGeometry(s.a, s.b, s.bulge);
  let delta = angleOf(sub(p, g.center)) - g.start;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta / g.sweep;
}

/** Candidate meeting points of the curves two segments lie on. */
function meetings(a: Seg, b: Seg): Vec2[] {
  if (a.k === 'line' && b.k === 'line') {
    const da = sub(a.b, a.a);
    const db = sub(b.b, b.a);
    const denom = cross(da, db);
    if (Math.abs(denom) < 1e-12) return [];
    const t = cross(sub(b.a, a.a), db) / denom;
    return [add(a.a, scale(da, t))];
  }
  if (a.k === 'arc' && b.k === 'arc') {
    const ga = arcGeometry(a.a, a.b, a.bulge);
    const gb = arcGeometry(b.a, b.b, b.bulge);
    return circleCircle(ga.center, ga.radius, gb.center, gb.radius);
  }
  const line = (a.k === 'line' ? a : b) as Extract<Seg, { k: 'line' }>;
  const arc = (a.k === 'arc' ? a : b) as Extract<Seg, { k: 'arc' }>;
  const g = arcGeometry(arc.a, arc.b, arc.bulge);
  return lineCircle(line.a, normalize(sub(line.b, line.a)), g.center, g.radius);
}

/** The segment ending at p instead (lines move their end; arcs keep their circle and change their sweep). */
function endAt(s: Seg, p: Vec2): Seg | null {
  if (s.k === 'line') return { k: 'line', a: s.a, b: p };
  if (s.k !== 'arc') return null;
  const t = arcParam(s, p);
  if (t <= 1e-9) return null;
  const g = arcGeometry(s.a, s.b, s.bulge);
  return { k: 'arc', a: s.a, b: p, bulge: bulgeOf(g.sweep * t) };
}

function startAt(s: Seg, p: Vec2): Seg | null {
  if (s.k === 'line') return { k: 'line', a: p, b: s.b };
  if (s.k !== 'arc') return null;
  const t = arcParam(s, p);
  if (t >= 1 - 1e-9) return null;
  const g = arcGeometry(s.a, s.b, s.bulge);
  return { k: 'arc', a: p, b: s.b, bulge: bulgeOf(g.sweep * (1 - t)) };
}

/** A path as vertices again: each segment's start, with its arc bulge; an open path ends with the last point. */
export function segmentsToPath(segs: readonly Seg[], closed: boolean): Path {
  const v: Vertex[] = segs.map((s) => (s.k === 'arc' ? { p: s.a, s: { k: 'arc', bulge: s.bulge } } : { p: s.a }));
  if (!closed && segs.length) v.push({ p: segs[segs.length - 1].b });
  return { closed, v };
}

/**
 * The path moved `d` mm to its left (looking along it; negative moves it right), exactly: lines shift,
 * arcs keep their centre and change radius, and neighbours are trimmed or extended to meet. Sharp
 * corners beyond the miter limit are bevelled. Returns null when it cannot be done exactly: Bézier
 * segments, an arc whose radius would vanish, or a segment that would flip; the caller then falls
 * back to a flattened offset. Vertex i of the result corresponds to vertex i of the resolved path
 * (bevels add vertices after the corner they belong to).
 */
export function offsetPath(path: Path, d: number): Path | null {
  const { segs } = resolvePath(path);
  if (!segs.length || segs.some((s) => s.k === 'cubic')) return null;
  if (Math.abs(d) < 1e-9) return segmentsToPath(segs, path.closed);
  const moved: Seg[] = [];
  for (const s of segs) {
    if (s.k === 'line') {
      const n = perp(normalize(sub(s.b, s.a)));
      moved.push({ k: 'line', a: add(s.a, scale(n, d)), b: add(s.b, scale(n, d)) });
    } else if (s.k === 'arc') {
      const g = arcGeometry(s.a, s.b, s.bulge);
      // The left of a counter-clockwise arc is towards its centre.
      const radius = g.sweep > 0 ? g.radius - d : g.radius + d;
      if (radius <= 1e-6) return null;
      const k = radius / g.radius;
      moved.push({ k: 'arc', a: add(g.center, scale(sub(s.a, g.center), k)), b: add(g.center, scale(sub(s.b, g.center), k)), bulge: s.bulge });
    }
  }
  const n = moved.length;
  const joins = path.closed ? n : n - 1;
  const bevel: (Seg | null)[] = new Array(n).fill(null);
  const limit = MITER_LIMIT * Math.abs(d);
  for (let j = 0; j < joins; j++) {
    const i = j;
    const k = (j + 1) % n;
    const vertex = segs[i].b;
    const a = moved[i];
    const b = moved[k];
    if (distance(a.b, b.a) < 1e-9) continue; // tangent continuation: already joined
    const point = meetings(a, b).sort((p, q) => distance(p, vertex) - distance(q, vertex))[0];
    if (point && distance(point, vertex) <= limit + Math.abs(d)) {
      const trimmedA = endAt(a, point);
      const trimmedB = startAt(b, point);
      if (trimmedA && trimmedB) {
        moved[i] = trimmedA;
        moved[k] = trimmedB;
        continue;
      }
    }
    bevel[i] = { k: 'line', a: a.b, b: b.a };
  }
  // A segment that turned around or vanished means the offset does not exist on this side.
  for (let i = 0; i < n; i++) {
    const s = moved[i];
    const o = segs[i];
    if (s.k === 'line') {
      if (dot(sub(s.b, s.a), sub(o.b, o.a)) <= 1e-9) return null;
    } else if (s.k === 'arc') {
      const g = arcGeometry(s.a, s.b, s.bulge);
      const og = arcGeometry(o.a, o.b, (o as Extract<Seg, { k: 'arc' }>).bulge);
      if (Math.sign(g.sweep) !== Math.sign(og.sweep) || Math.abs(g.sweep) > Math.abs(og.sweep) * 1.5 + 1e-9) return null;
    }
  }
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    out.push(moved[i]);
    if (bevel[i]) out.push({ k: 'line', a: moved[i].b, b: moved[(i + 1) % n].a });
  }
  return segmentsToPath(out, path.closed);
}

/** An open path with one end carried on by `by` mm along its end tangent (a line end moves; an arc end gets a straight piece). */
export function extendPathEnd(path: Path, end: 'start' | 'end', by: number): Path {
  const { segs } = resolvePath(path);
  if (path.closed || !segs.length || by <= 0) return path;
  const list = [...segs];
  if (end === 'end') {
    const last = list[list.length - 1];
    const t = tangentOut(last, 1);
    if (last.k === 'line') list[list.length - 1] = { k: 'line', a: last.a, b: add(last.b, scale(t, by)) };
    else list.push({ k: 'line', a: last.b, b: add(last.b, scale(t, by)) });
  } else {
    const first = list[0];
    const t = tangentOut(first, 0);
    if (first.k === 'line') list[0] = { k: 'line', a: sub(first.a, scale(t, by)), b: first.b };
    else list.unshift({ k: 'line', a: sub(first.a, scale(t, by)), b: first.a });
  }
  return segmentsToPath(list, false);
}

function tangentOut(s: Seg, t: number): Vec2 {
  if (s.k === 'line') return normalize(sub(s.b, s.a));
  if (s.k === 'arc') {
    const g = arcGeometry(s.a, s.b, s.bulge);
    const angle = g.start + g.sweep * t;
    return scale([-Math.sin(angle), Math.cos(angle)], Math.sign(g.sweep));
  }
  return normalize(sub(s.b, s.a));
}

export { arcPoint };
