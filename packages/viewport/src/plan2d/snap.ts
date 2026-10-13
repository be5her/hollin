import RBush from 'rbush';
import { DEG, add, angleOf, arcGeometry, columnPolygon, distance, dot, formatAngle, length, normalize, openingFrame, perp, perpendicularFoot, resolvePath, scale, segmentBox, segmentIntersections, segmentPoint, sub, tangentPoints, withinSegment, type Box, type Entity, type LevelWalls, type Seg, type Vec2 } from '@studio/core';

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'center' | 'perpendicular' | 'tangent' | 'on' | 'extension' | 'angle' | 'grid';

/** The wall or shape vertex an endpoint snap found, which a dimension's end can follow. */
export interface SnapAnchor {
  entityId: string;
  vertex: number;
  side: 'axis' | 'left' | 'right';
}

/** The segment a snapped point lies on: its direction there, so a run can track parallel or perpendicular to it. */
export interface SnapTangent {
  direction: Vec2;
  entityId: string;
}

/** A direction the segment being drawn may run parallel or perpendicular to, named for the footer ("previous", "wall", "line", "reference"). */
export interface TrackReference {
  direction: Vec2;
  name: string;
}

/** A snapped point, what it snapped to, and guide lines to draw. */
export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  label: string;
  guides: { from: Vec2; to: Vec2 }[];
  anchor?: SnapAnchor;
  tangent?: SnapTangent;
  /** A tracked point's distance from the start, written next to its angle. */
  length?: number;
}

export interface SnapSettings {
  enabled: boolean;
  endpoint: boolean;
  midpoint: boolean;
  center: boolean;
  intersection: boolean;
  perpendicular: boolean;
  extension: boolean;
  grid: boolean;
  gridSpacing: number;
  /** Track the direction from `from`: multiples of `angleStep`, the main angles (every 45°) and parallels and perpendiculars to the references given; Shift forces 45° steps. */
  angle: boolean;
  angleStep: number;
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = { enabled: true, endpoint: true, midpoint: true, center: true, intersection: true, perpendicular: true, extension: true, grid: false, gridSpacing: 100, angle: true, angleStep: 15 };

export interface SnapOptions {
  /** The start of the segment being drawn: perpendicular, tangent and angle snaps need it. */
  from?: Vec2;
  /** Entities not snapped to (the one being dragged). */
  exclude?: ReadonlySet<string>;
  /** Shift held: the direction from `from` is constrained to 45° steps and nothing else snaps. */
  ortho?: boolean;
  /** Directions the segment from `from` may run parallel or perpendicular to: the previous segment of the run, the wall it started on. */
  relativeTo?: readonly TrackReference[];
}

/** A segment something can snap to; a plain segment of a path also knows which vertices it joins, for anchors. */
interface SnapSeg extends Box {
  seg: Seg;
  id: string;
  side?: SnapAnchor['side'];
  va?: number;
  vb?: number;
}

/** How a path's segments map to its vertices: only when no corner added segments. */
interface PathVertices {
  side: SnapAnchor['side'];
  closed: boolean;
  count: number;
}

/** A point something can snap to that is not a segment end (column and arc centres). */
interface SnapPoint extends Box {
  point: Vec2;
  id: string;
  kind: 'center';
}

/** Points you aim at win; the tracked direction beats a line merely under the cursor. */
const PRIORITY: Record<SnapKind, number> = { endpoint: 0, intersection: 1, midpoint: 2, center: 3, perpendicular: 4, tangent: 4, angle: 5, on: 6, extension: 7, grid: 8 };
const LABELS: Record<SnapKind, string> = { endpoint: 'Endpoint', intersection: 'Intersection', midpoint: 'Midpoint', center: 'Centre', perpendicular: 'Perpendicular', tangent: 'Tangent', on: 'On line', extension: 'Extension', angle: '', grid: 'Grid' };

/** Everything on a level that can be snapped to, in an R-tree: wall reference lines and faces, outlines, opening jambs, centres. */
export class SnapIndex {
  private readonly segs = new RBush<SnapSeg>();
  private readonly points = new RBush<SnapPoint>();

  /** Rebuilds from a level's entities; wall faces come from the derived walls. */
  build(entities: Record<string, Entity>, walls: LevelWalls | null): void {
    const segs: SnapSeg[] = [];
    const points: SnapPoint[] = [];
    const addPath = (id: string, segsOf: Seg[], vertices?: PathVertices) => {
      const plain = vertices && segsOf.length === (vertices.closed ? vertices.count : vertices.count - 1);
      segsOf.forEach((seg, i) => {
        if (seg.k === 'cubic') return;
        segs.push({ ...segmentBox(seg), seg, id, ...(plain ? { side: vertices.side, va: i, vb: vertices.closed ? (i + 1) % vertices.count : i + 1 } : {}) });
        if (seg.k === 'arc') {
          const c = arcGeometry(seg.a, seg.b, seg.bulge).center;
          points.push({ minX: c[0], minY: c[1], maxX: c[0], maxY: c[1], point: c, id, kind: 'center' });
        }
      });
    };
    const verticesOf = (path: { closed: boolean; v: { c?: unknown }[] }, side: SnapAnchor['side']): PathVertices | undefined => (path.v.some((v) => v.c) ? undefined : { side, closed: path.closed, count: path.v.length });
    for (const id in entities) {
      const e = entities[id];
      switch (e.type) {
        case 'wall': {
          addPath(id, resolvePath(e.path).segs, verticesOf(e.path, 'axis'));
          const body = walls?.bodies.get(id);
          for (const [side, face] of [['left', body?.faces.left], ['right', body?.faces.right]] as const) {
            if (!face) continue;
            addPath(id, resolvePath(face).segs, face.v.length === e.path.v.length ? verticesOf(face, side) : undefined);
          }
          break;
        }
        case 'opening': {
          const wall = entities[e.wallId];
          if (wall?.type !== 'wall') break;
          const f = openingFrame(wall, e);
          for (const jamb of f.jambs) addPath(id, [{ k: 'line', a: add(jamb, scale(f.normal, f.across.right)), b: add(jamb, scale(f.normal, f.across.left)) }]);
          break;
        }
        case 'column': {
          const poly = columnPolygon(e);
          addPath(id, poly.map((p, i): Seg => ({ k: 'line', a: p, b: poly[(i + 1) % poly.length] })));
          points.push({ minX: e.at[0], minY: e.at[1], maxX: e.at[0], maxY: e.at[1], point: e.at, id, kind: 'center' });
          break;
        }
        case 'slab':
        case 'void':
        case 'shaft':
        case 'room': {
          const region = e.type === 'slab' ? (e.source.k === 'region' ? e.source.region : null) : e.type === 'room' ? (e.boundary.k === 'region' ? e.boundary.region : null) : e.region;
          if (region) for (const path of [region.outer, ...region.holes]) addPath(id, resolvePath(path).segs);
          break;
        }
        case 'separator':
          addPath(id, resolvePath(e.path).segs);
          break;
        case 'shape':
          addPath(id, resolvePath(e.path).segs, verticesOf(e.path, 'axis'));
          break;
        case 'dimension':
          addPath(id, [{ k: 'line', a: e.from, b: e.to }]);
          break;
        default:
          break;
      }
    }
    this.segs.clear();
    this.segs.load(segs);
    this.points.clear();
    this.points.load(points);
  }

  /** The segments whose box meets the given box. */
  near(box: Box, exclude?: ReadonlySet<string>): SnapSeg[] {
    const found = this.segs.search(box);
    return exclude?.size ? found.filter((s) => !exclude.has(s.id)) : found;
  }

  centres(box: Box, exclude?: ReadonlySet<string>): SnapPoint[] {
    const found = this.points.search(box);
    return exclude?.size ? found.filter((s) => !exclude.has(s.id)) : found;
  }
}

const around = (p: Vec2, r: number): Box => ({ minX: p[0] - r, minY: p[1] - r, maxX: p[0] + r, maxY: p[1] + r });

/** The unit direction of a segment where a point of it lies (a line's direction, an arc's tangent there). */
function tangentAt(seg: Seg, p: Vec2): Vec2 | null {
  if (seg.k === 'line') return normalize(sub(seg.b, seg.a));
  if (seg.k === 'arc') {
    const g = arcGeometry(seg.a, seg.b, seg.bulge);
    const r = sub(p, g.center);
    if (length(r) < 1e-9) return null;
    return scale(normalize(perp(r)), Math.sign(g.sweep) || 1);
  }
  return null;
}

/** The unit vector at an angle in degrees, exact on the axes and diagonals so a tracked wall is exactly straight. */
function unitAt(degrees: number): Vec2 {
  const d = ((degrees % 360) + 360) % 360;
  if (d % 90 === 0) return d === 0 ? [1, 0] : d === 90 ? [0, 1] : d === 180 ? [-1, 0] : [0, -1];
  if (d % 45 === 0) return [d < 90 || d > 270 ? Math.SQRT1_2 : -Math.SQRT1_2, d < 180 ? Math.SQRT1_2 : -Math.SQRT1_2];
  return [Math.cos(d * DEG), Math.sin(d * DEG)];
}

const norm360 = (degrees: number) => ((degrees % 360) + 360) % 360;

/** How far off a tracked direction, in degrees, the cursor is still held on it, however far it is from the start. */
export const TRACK_DEGREES = 3;

interface Tracked {
  point: Vec2;
  direction: Vec2;
  angle: number;
  label: string;
  length: number;
}

/**
 * Polar tracking: among the directions offered (multiples of `step`, every 45° when `main`, and the
 * parallels and perpendiculars of each reference), the ray from `from` nearest to the cursor, as
 * long as the cursor is within `tolerance` of it or within `TRACK_DEGREES` of its direction (a
 * quarter of the step when that is less, so the free directions between steps stay reachable), and
 * further than `tolerance` from the start. The angular window keeps tracking as easy to catch far
 * from the start as near it. A relative direction that coincides with an absolute one keeps the
 * angle as its label.
 */
export function trackDirection(from: Vec2, cursor: Vec2, tolerance: number, step: number | null, references: readonly TrackReference[], main = true): Tracked | null {
  const d = sub(cursor, from);
  const len = length(d);
  if (len < 1e-9 || (Number.isFinite(tolerance) && len <= tolerance)) return null;
  const candidates: { angle: number; label?: string }[] = [];
  if (step && step > 0) for (let a = 0; a < 360 - 1e-9; a += step) candidates.push({ angle: norm360(a) });
  if (main) for (let a = 0; a < 360; a += 45) candidates.push({ angle: a });
  for (const ref of references) {
    if (length(ref.direction) < 1e-9) continue;
    const base = angleOf(ref.direction) / DEG;
    for (const [offset, relation] of [[0, 'Parallel'], [180, 'Parallel'], [90, 'Perpendicular'], [270, 'Perpendicular']] as const) candidates.push({ angle: norm360(base + offset), label: `${relation} to ${ref.name}` });
  }
  const cursorAngle = angleOf(d) / DEG;
  let best: { angle: number; label?: string } | null = null;
  let bestDeviation = Infinity;
  for (const c of candidates) {
    const deviation = Math.abs(norm360(cursorAngle - c.angle + 180) - 180);
    // Strictly nearer only: an absolute direction listed first keeps its angle label over a relative one at the same angle.
    if (deviation < bestDeviation - 1e-9) {
      best = c;
      bestDeviation = deviation;
    }
  }
  if (!best) return null;
  const direction = unitAt(best.angle);
  const along = dot(d, direction);
  if (along <= 0) return null;
  const point = add(from, scale(direction, along));
  const window = step && step > 0 ? Math.min(TRACK_DEGREES, step / 4) : TRACK_DEGREES;
  if (distance(point, cursor) > tolerance && bestDeviation > window + 1e-9) return null;
  return { point, direction, angle: best.angle, label: best.label ?? formatAngle(best.angle, { precision: 1 }), length: along };
}

/**
 * Snaps a cursor position: within `tolerance` mm, candidates are ranked by kind (endpoint,
 * intersection, midpoint, centre, perpendicular or tangent, the tracked direction, on a line, an
 * extension) then by distance; grid snap applies when nothing else does. While a direction is
 * tracked, where its ray crosses a nearby segment counts as an intersection. Returns null when
 * nothing is within reach (the cursor stays free).
 */
export function snapPoint(index: SnapIndex, cursor: Vec2, tolerance: number, settings: SnapSettings, options: SnapOptions = {}): SnapResult | null {
  const { from, exclude } = options;
  const trackedResult = (t: Tracked): SnapResult => ({ point: t.point, kind: 'angle', label: t.label, guides: [{ from: from!, to: add(t.point, scale(t.direction, tolerance * 6)) }], length: t.length });
  if (options.ortho && from) {
    const t = trackDirection(from, cursor, Infinity, 45, [], false);
    return t ? trackedResult(t) : null;
  }
  if (!settings.enabled) return null;
  const candidates: SnapResult[] = [];
  const consider = (point: Vec2, kind: SnapKind, guides: SnapResult['guides'] = [], label = LABELS[kind], anchor?: SnapAnchor, tangent?: SnapTangent | null, len?: number) => {
    if (distance(point, cursor) <= tolerance) candidates.push({ point, kind, label, guides, ...(anchor ? { anchor } : {}), ...(tangent ? { tangent } : {}), ...(len !== undefined ? { length: len } : {}) });
  };
  const anchorOf = (s: SnapSeg, vertex: number | undefined): SnapAnchor | undefined => (s.side && vertex !== undefined ? { entityId: s.id, vertex, side: s.side } : undefined);
  const tangentOf = (s: SnapSeg, p: Vec2): SnapTangent | null => {
    const direction = tangentAt(s.seg, p);
    return direction ? { direction, entityId: s.id } : null;
  };
  const nearby = index.near(around(cursor, tolerance), exclude);
  for (const s of nearby) {
    const { seg } = s;
    if (settings.endpoint) {
      consider(seg.a, 'endpoint', [], undefined, anchorOf(s, s.va), tangentOf(s, seg.a));
      consider(seg.b, 'endpoint', [], undefined, anchorOf(s, s.vb), tangentOf(s, seg.b));
    }
    if (settings.midpoint) {
      const mid = segmentPoint(seg, 0.5);
      consider(mid, 'midpoint', [], undefined, undefined, tangentOf(s, mid));
    }
    if (from && settings.perpendicular) {
      const foot = perpendicularFoot(seg, from);
      if (foot && withinSegment(seg, foot)) consider(foot, 'perpendicular', [], undefined, undefined, tangentOf(s, foot));
      for (const t of tangentPoints(seg, from)) if (withinSegment(seg, t)) consider(t, 'tangent', [], undefined, undefined, tangentOf(s, t));
    }
    const foot = perpendicularFoot(seg, cursor);
    if (foot && withinSegment(seg, foot)) consider(foot, 'on', [], undefined, undefined, tangentOf(s, foot));
  }
  if (settings.intersection) {
    for (let i = 0; i < nearby.length; i++) {
      for (let j = i + 1; j < nearby.length; j++) {
        for (const p of segmentIntersections(nearby[i].seg, nearby[j].seg)) consider(p, 'intersection');
      }
    }
  }
  if (settings.center) for (const c of index.centres(around(cursor, tolerance), exclude)) consider(c.point, 'center');
  const extensions: { seg: Seg; point: Vec2; near: Vec2; id: string }[] = [];
  if (settings.extension) {
    // A line segment's extension: the cursor projected on its line, off the segment but within a few lengths of it.
    const reach = tolerance * 40;
    for (const s of index.near(around(cursor, reach), exclude)) {
      if (s.seg.k !== 'line') continue;
      const foot = perpendicularFoot(s.seg, cursor);
      if (!foot || withinSegment(s.seg, foot) || distance(foot, cursor) > tolerance) continue;
      const nearEnd = distance(foot, s.seg.a) < distance(foot, s.seg.b) ? s.seg.a : s.seg.b;
      if (distance(foot, nearEnd) > reach) continue;
      extensions.push({ seg: s.seg, point: foot, near: nearEnd, id: s.id });
    }
    for (const x of extensions) consider(x.point, 'extension', [{ from: x.near, to: x.point }], undefined, undefined, { direction: normalize(sub(x.seg.b, x.seg.a)), entityId: x.id });
    for (let i = 0; i < extensions.length; i++) {
      for (let j = i + 1; j < extensions.length; j++) {
        for (const p of segmentIntersections(extensions[i].seg, extensions[j].seg, true)) consider(p, 'intersection', [{ from: extensions[i].near, to: p }, { from: extensions[j].near, to: p }], 'Apparent intersection');
      }
    }
  }
  if (from && settings.angle) {
    const t = trackDirection(from, cursor, tolerance, settings.angleStep, options.relativeTo ?? []);
    if (t) {
      const tracked = trackedResult(t);
      candidates.push(tracked);
      if (settings.intersection) {
        // Where the tracking ray crosses what is near the cursor: the point a wall drawn towards another wall should end at. A point already found by its own name (a perpendicular, an endpoint) keeps it.
        const ray: Seg = { k: 'line', a: from, b: add(from, scale(t.direction, t.length + tolerance * 2)) };
        const fresh = (p: Vec2) => !candidates.some((c) => distance(c.point, p) < 1e-6);
        for (const s of nearby) for (const p of segmentIntersections(ray, s.seg)) if (fresh(p)) consider(p, 'intersection', tracked.guides, undefined, undefined, undefined, distance(from, p));
        for (const x of extensions) for (const p of segmentIntersections(ray, x.seg, true)) if (fresh(p)) consider(p, 'intersection', [...tracked.guides, { from: x.near, to: p }], 'Apparent intersection', undefined, undefined, distance(from, p));
      }
    }
  }
  if (candidates.length) {
    candidates.sort((x, y) => PRIORITY[x.kind] - PRIORITY[y.kind] || distance(x.point, cursor) - distance(y.point, cursor));
    return candidates[0];
  }
  if (settings.grid && settings.gridSpacing > 0) {
    const g = settings.gridSpacing;
    const point: Vec2 = [Math.round(cursor[0] / g) * g, Math.round(cursor[1] / g) * g];
    return { point, kind: 'grid', label: LABELS.grid, guides: [] };
  }
  return null;
}

/** The reference a run keeps from the snap its start point took: the segment's direction, named by what it belongs to. */
export function referenceFrom(snap: { tangent?: SnapTangent } | null | undefined, entities: Record<string, Entity>): TrackReference | null {
  if (!snap?.tangent) return null;
  const type = entities[snap.tangent.entityId]?.type;
  return { direction: snap.tangent.direction, name: type === 'wall' ? 'wall' : type === 'dimension' ? 'dimension' : 'line' };
}

export const unitDirection = (from: Vec2, to: Vec2): Vec2 => normalize(sub(to, from));
