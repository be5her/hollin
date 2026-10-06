import RBush from 'rbush';
import { DEG, add, arcGeometry, columnPolygon, distance, normalize, openingFrame, perpendicularFoot, rawSegments, resolvePath, scale, segmentBox, segmentIntersections, segmentPoint, sub, tangentPoints, withinSegment, type Box, type Entity, type LevelWalls, type Seg, type Vec2 } from '@studio/core';

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'center' | 'perpendicular' | 'tangent' | 'on' | 'extension' | 'angle' | 'grid';

/** The wall or shape vertex an endpoint snap found, which a dimension's end can follow. */
export interface SnapAnchor {
  entityId: string;
  vertex: number;
  side: 'axis' | 'left' | 'right';
}

/** A snapped point, what it snapped to, and guide lines to draw. */
export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  label: string;
  guides: { from: Vec2; to: Vec2 }[];
  anchor?: SnapAnchor;
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
  /** Snap the direction from `from` to multiples of `angleStep`; Shift forces 45° steps. */
  angle: boolean;
  angleStep: number;
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = { enabled: true, endpoint: true, midpoint: true, center: true, intersection: true, perpendicular: true, extension: true, grid: false, gridSpacing: 100, angle: false, angleStep: 15 };

export interface SnapOptions {
  /** The start of the segment being drawn: perpendicular, tangent and angle snaps need it. */
  from?: Vec2;
  /** Entities not snapped to (the one being dragged). */
  exclude?: ReadonlySet<string>;
  /** Shift held: the direction from `from` is constrained to 45° steps and nothing else snaps. */
  ortho?: boolean;
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

const PRIORITY: Record<SnapKind, number> = { endpoint: 0, intersection: 1, midpoint: 2, center: 3, perpendicular: 4, tangent: 4, on: 5, extension: 6, angle: 7, grid: 8 };
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

/** The point on the ray from `from` at the step angle nearest to the cursor's direction. */
function angleSnap(from: Vec2, cursor: Vec2, step: number): { point: Vec2; angle: number } | null {
  const d = sub(cursor, from);
  const len = distance(cursor, from);
  if (len < 1e-9) return null;
  const angle = Math.atan2(d[1], d[0]) / DEG;
  const snapped = Math.round(angle / step) * step;
  const dir: Vec2 = [Math.cos(snapped * DEG), Math.sin(snapped * DEG)];
  const along = d[0] * dir[0] + d[1] * dir[1];
  return { point: add(from, scale(dir, along)), angle: ((snapped % 360) + 360) % 360 };
}

/**
 * Snaps a cursor position: within `tolerance` mm, candidates are ranked by kind (endpoint,
 * intersection, midpoint, centre, perpendicular or tangent, on a line, an extension, an angle
 * step) then by distance; grid snap applies when nothing else does. Returns null when nothing is
 * within reach (the cursor stays free).
 */
export function snapPoint(index: SnapIndex, cursor: Vec2, tolerance: number, settings: SnapSettings, options: SnapOptions = {}): SnapResult | null {
  const { from, exclude } = options;
  if (options.ortho && from) {
    const a = angleSnap(from, cursor, 45);
    return a ? { point: a.point, kind: 'angle', label: `${a.angle}°`, guides: [{ from, to: a.point }] } : null;
  }
  if (!settings.enabled) return null;
  const candidates: SnapResult[] = [];
  const consider = (point: Vec2, kind: SnapKind, guides: SnapResult['guides'] = [], label = LABELS[kind], anchor?: SnapAnchor) => {
    if (distance(point, cursor) <= tolerance) candidates.push({ point, kind, label, guides, ...(anchor ? { anchor } : {}) });
  };
  const anchorOf = (s: SnapSeg, vertex: number | undefined): SnapAnchor | undefined => (s.side && vertex !== undefined ? { entityId: s.id, vertex, side: s.side } : undefined);
  const nearby = index.near(around(cursor, tolerance), exclude);
  for (const s of nearby) {
    const { seg } = s;
    if (settings.endpoint) {
      consider(seg.a, 'endpoint', [], undefined, anchorOf(s, s.va));
      consider(seg.b, 'endpoint', [], undefined, anchorOf(s, s.vb));
    }
    if (settings.midpoint) consider(segmentPoint(seg, 0.5), 'midpoint');
    if (from && settings.perpendicular) {
      const foot = perpendicularFoot(seg, from);
      if (foot && withinSegment(seg, foot)) consider(foot, 'perpendicular');
      for (const t of tangentPoints(seg, from)) if (withinSegment(seg, t)) consider(t, 'tangent');
    }
    const foot = perpendicularFoot(seg, cursor);
    if (foot && withinSegment(seg, foot)) consider(foot, 'on');
  }
  if (settings.intersection) {
    for (let i = 0; i < nearby.length; i++) {
      for (let j = i + 1; j < nearby.length; j++) {
        for (const p of segmentIntersections(nearby[i].seg, nearby[j].seg)) consider(p, 'intersection');
      }
    }
  }
  if (settings.center) for (const c of index.centres(around(cursor, tolerance), exclude)) consider(c.point, 'center');
  if (settings.extension) {
    // A line segment's extension: the cursor projected on its line, off the segment but within a few lengths of it.
    const reach = tolerance * 40;
    const extensions: { seg: Seg; point: Vec2; near: Vec2 }[] = [];
    for (const s of index.near(around(cursor, reach), exclude)) {
      if (s.seg.k !== 'line') continue;
      const foot = perpendicularFoot(s.seg, cursor);
      if (!foot || withinSegment(s.seg, foot) || distance(foot, cursor) > tolerance) continue;
      const nearEnd = distance(foot, s.seg.a) < distance(foot, s.seg.b) ? s.seg.a : s.seg.b;
      if (distance(foot, nearEnd) > reach) continue;
      extensions.push({ seg: s.seg, point: foot, near: nearEnd });
    }
    for (const x of extensions) consider(x.point, 'extension', [{ from: x.near, to: x.point }]);
    for (let i = 0; i < extensions.length; i++) {
      for (let j = i + 1; j < extensions.length; j++) {
        for (const p of segmentIntersections(extensions[i].seg, extensions[j].seg, true)) consider(p, 'intersection', [{ from: extensions[i].near, to: p }, { from: extensions[j].near, to: p }], 'Apparent intersection');
      }
    }
  }
  if (from && settings.angle) {
    const a = angleSnap(from, cursor, settings.angleStep);
    if (a) consider(a.point, 'angle', [{ from, to: a.point }], `${a.angle}°`);
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

export const unitDirection = (from: Vec2, to: Vec2): Vec2 => normalize(sub(to, from));
