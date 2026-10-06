import type { Entity } from '../doc/schema';
import { arcGeometry, bulgeOf, bulgeThrough, rawSegments, segmentCount, type Corner, type Path, type Segment, type Vertex } from './path';
import { angleOf, sub, type Vec2 } from './vec';

/** Which path of an entity: a wall's own path, or a region's outline or one of its holes. */
export type WhichPath = 'outer' | { hole: number };

/** The path an entity is drawn from, or null when it has none (points, labels, openings). */
export function pathOfEntity(entity: Entity, which: WhichPath = 'outer'): Path | null {
  const region = regionOfEntity(entity);
  if (entity.type === 'wall') return which === 'outer' ? entity.path : null;
  if (!region) return null;
  return which === 'outer' ? region.outer : (region.holes[which.hole] ?? null);
}

function regionOfEntity(entity: Entity) {
  switch (entity.type) {
    case 'column':
      return entity.shape.k === 'region' ? entity.shape.region : null;
    case 'slab':
      return entity.source.k === 'region' ? entity.source.region : null;
    case 'void':
    case 'shaft':
      return entity.region;
    case 'room':
      return entity.boundary.k === 'region' ? entity.boundary.region : null;
    default:
      return null;
  }
}

/** The entity with one of its paths replaced. */
export function withPath(entity: Entity, which: WhichPath, path: Path): Entity {
  if (entity.type === 'wall') return { ...entity, path };
  const region = regionOfEntity(entity);
  if (!region) return entity;
  const next = which === 'outer' ? { ...region, outer: path } : { ...region, holes: region.holes.map((h, i) => (i === which.hole ? path : h)) };
  switch (entity.type) {
    case 'column':
      return { ...entity, shape: { k: 'region', region: next } };
    case 'slab':
      return { ...entity, source: { k: 'region', region: next } };
    case 'void':
    case 'shaft':
      return { ...entity, region: next };
    case 'room':
      return { ...entity, boundary: { k: 'region', region: next } };
    default:
      return entity;
  }
}

const vertexAt = (path: Path, index: number): Vertex => {
  const v = path.v[index];
  if (!v) throw new RangeError(`No vertex ${index}`);
  return v;
};

export function moveVertex(path: Path, index: number, to: Vec2): Path {
  vertexAt(path, index);
  return { ...path, v: path.v.map((v, i) => (i === index ? { ...v, p: to } : v)) };
}

/**
 * Splits segment `index` at `at` with a new vertex. An arc is split into two arcs on the same
 * circle (by the angle of the new point around its centre); a Bézier's handles stay on the ends.
 */
export function insertVertex(path: Path, index: number, at: Vec2): Path {
  if (index < 0 || index >= segmentCount(path)) throw new RangeError(`No segment ${index}`);
  const from = path.v[index];
  const seg = rawSegments(path)[index];
  const v = [...path.v];
  if (seg.k === 'arc') {
    const g = arcGeometry(seg.a, seg.b, seg.bulge);
    let delta = angleOf(sub(at, g.center)) - g.start;
    if (g.sweep > 0) while (delta < 0) delta += 2 * Math.PI;
    else while (delta > 0) delta -= 2 * Math.PI;
    const t = Math.min(1, Math.max(0, delta / g.sweep));
    v[index] = { ...from, s: { k: 'arc', bulge: bulgeOf(g.sweep * t) } };
    v.splice(index + 1, 0, { p: at, s: { k: 'arc', bulge: bulgeOf(g.sweep * (1 - t)) } });
  } else {
    const { s: _s, ...rest } = from;
    v[index] = seg.k === 'cubic' ? { ...from } : rest;
    v.splice(index + 1, 0, { p: at });
  }
  return { ...path, v };
}

/** Removes a vertex; the segment before it runs straight to the next one. A path keeps at least two vertices (three when closed). */
export function removeVertex(path: Path, index: number): Path {
  vertexAt(path, index);
  if (path.v.length <= (path.closed ? 3 : 2)) throw new RangeError('A path cannot lose more vertices');
  const v = path.v.filter((_, i) => i !== index);
  const prev = path.closed ? (index - 1 + path.v.length) % path.v.length : index - 1;
  if (prev >= 0 && prev < path.v.length && index !== 0) {
    const k = prev > index ? prev - 1 : prev;
    const { s: _s, ...rest } = v[k];
    v[k] = rest;
  }
  return { ...path, v };
}

export type SegmentChange = { k: 'line' } | { k: 'arc'; bulge: number } | { k: 'arc'; through: Vec2 };

/** Makes segment `index` straight or an arc (by bulge, or through a point). */
export function setSegment(path: Path, index: number, change: SegmentChange): Path {
  if (index < 0 || index >= segmentCount(path)) throw new RangeError(`No segment ${index}`);
  const a = path.v[index].p;
  const b = path.v[(index + 1) % path.v.length].p;
  let s: Segment | undefined;
  if (change.k === 'line') s = undefined;
  else if ('through' in change) {
    const bulge = bulgeThrough(a, change.through, b);
    s = bulge === null || Math.abs(bulge) < 1e-9 ? undefined : { k: 'arc', bulge };
  } else s = Math.abs(change.bulge) < 1e-9 ? undefined : { k: 'arc', bulge: change.bulge };
  return { ...path, v: path.v.map((v, i) => (i !== index ? v : s ? { ...v, s } : (({ s: _s, ...rest }) => rest)(v))) };
}

/** Sets or clears the corner at a vertex. The ends of an open path have no corner. */
export function setCorner(path: Path, index: number, corner: Corner | null): Path {
  vertexAt(path, index);
  if (!path.closed && (index === 0 || index === path.v.length - 1) && corner) throw new RangeError('The ends of an open path have no corner');
  return { ...path, v: path.v.map((v, i) => (i !== index ? v : corner ? { ...v, c: corner } : (({ c: _c, ...rest }) => rest)(v))) };
}
