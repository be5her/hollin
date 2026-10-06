import type { Entity } from '../doc/schema';
import type { Path, Region, Segment, Vertex } from './path';
import { DEG, add, angleOf, dot, normalize, rotate, scale, sub, type Vec2 } from './vec';

/** A rigid transform: a mirror across the line a–b, then a rotation (degrees, counter-clockwise) about a pivot, then a move. */
export interface Transform {
  translate?: Vec2;
  rotate?: { angle: number; pivot: Vec2 };
  mirror?: { a: Vec2; b: Vec2 };
}

/** The transform as functions: points, free vectors (handles, directions) and angles. */
export interface PointMap {
  point(p: Vec2): Vec2;
  vector(v: Vec2): Vec2;
  /** True when the transform mirrors, which flips arc directions and swing sides. */
  flips: boolean;
  /** A rotation field (degrees) after the transform. */
  angle(degrees: number): number;
}

export function transformer(xf: Transform): PointMap {
  const points: ((p: Vec2) => Vec2)[] = [];
  const vectors: ((v: Vec2) => Vec2)[] = [];
  let flips = false;
  if (xf.mirror) {
    const a = xf.mirror.a;
    const d = normalize(sub(xf.mirror.b, a));
    if (d[0] !== 0 || d[1] !== 0) {
      const reflect = (v: Vec2): Vec2 => {
        const along = scale(d, dot(v, d));
        return sub(scale(along, 2), v);
      };
      points.push((p) => add(a, reflect(sub(p, a))));
      vectors.push(reflect);
      flips = true;
    }
  }
  if (xf.rotate && xf.rotate.angle) {
    const r = xf.rotate.angle * DEG;
    const pivot = xf.rotate.pivot;
    points.push((p) => add(pivot, rotate(sub(p, pivot), r)));
    vectors.push((v) => rotate(v, r));
  }
  if (xf.translate && (xf.translate[0] || xf.translate[1])) {
    const t = xf.translate;
    points.push((p) => add(p, t));
  }
  const vector = (v: Vec2) => vectors.reduce((q, f) => f(q), v);
  return {
    point: (p) => points.reduce((q, f) => f(q), p),
    vector,
    flips,
    angle: (degrees) => {
      if (!vectors.length) return degrees;
      const r = degrees * DEG;
      return Math.round((angleOf(vector([Math.cos(r), Math.sin(r)])) / DEG) * 1e6) / 1e6;
    },
  };
}

export function transformPathBy(path: Path, m: PointMap): Path {
  const v: Vertex[] = path.v.map((vx) => {
    let s: Segment | undefined = vx.s;
    if (s?.k === 'arc' && m.flips) s = { k: 'arc', bulge: -s.bulge };
    else if (s?.k === 'cubic') s = { k: 'cubic', c1: m.vector(s.c1), c2: m.vector(s.c2) };
    return { p: m.point(vx.p), ...(s ? { s } : {}), ...(vx.c ? { c: vx.c } : {}) };
  });
  return { closed: path.closed, v };
}

export function transformRegionBy(region: Region, m: PointMap): Region {
  return { outer: transformPathBy(region.outer, m), holes: region.holes.map((h) => transformPathBy(h, m)) };
}

/**
 * The entity moved, rotated or mirrored. Openings stay as they are: they sit at a distance along
 * their wall and follow it (a mirror swaps their swing side). Heights and the third coordinate of
 * decor are untouched.
 */
export function transformEntity(entity: Entity, xf: Transform): Entity {
  const m = transformer(xf);
  switch (entity.type) {
    case 'wall':
      return { ...entity, path: transformPathBy(entity.path, m) };
    case 'opening':
      return m.flips && entity.swing ? { ...entity, swing: { ...entity.swing, side: entity.swing.side === 'left' ? 'right' : 'left' } } : entity;
    case 'column':
      return { ...entity, at: m.point(entity.at), rotation: m.angle(entity.rotation), shape: entity.shape.k === 'region' ? { k: 'region', region: transformRegionBy(entity.shape.region, m) } : entity.shape };
    case 'slab':
      return entity.source.k === 'region' ? { ...entity, source: { k: 'region', region: transformRegionBy(entity.source.region, m) } } : entity;
    case 'void':
    case 'shaft':
      return { ...entity, region: transformRegionBy(entity.region, m) };
    case 'room':
      return { ...entity, boundary: entity.boundary.k === 'detect' ? { k: 'detect', seed: m.point(entity.boundary.seed) } : { k: 'region', region: transformRegionBy(entity.boundary.region, m) } };
    case 'fixture':
      return { ...entity, at: m.point(entity.at), rotation: m.angle(entity.rotation), mirror: m.flips ? !entity.mirror : entity.mirror };
    case 'point':
      return { ...entity, at: m.point(entity.at), rotation: m.angle(entity.rotation) };
    case 'dimension':
      return { ...entity, from: m.point(entity.from), to: m.point(entity.to), offset: m.flips ? -entity.offset : entity.offset };
    case 'label':
      return { ...entity, at: m.point(entity.at), rotation: m.angle(entity.rotation) };
    case 'item': {
      const p = m.point([entity.at[0], entity.at[1]]);
      return { ...entity, at: [p[0], p[1], entity.at[2]], rotation: [entity.rotation[0], entity.rotation[1], m.angle(entity.rotation[2])] };
    }
    case 'light': {
      const p = m.point([entity.at[0], entity.at[1]]);
      const target = entity.target ? m.point([entity.target[0], entity.target[1]]) : null;
      return { ...entity, at: [p[0], p[1], entity.at[2]], ...(entity.target && target ? { target: [target[0], target[1], entity.target[2]] } : {}) };
    }
  }
}

/** The top-level fields that differ between two entities, for an update. */
export function changedFields(before: Entity, after: Entity): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  for (const key of Object.keys(b)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) set[key] = b[key];
  return set;
}
