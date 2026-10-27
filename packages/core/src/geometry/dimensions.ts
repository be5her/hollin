import type { Entity, EntityOf } from '../doc/schema';
import type { UnitSettings } from '../config';
import { formatAngle, formatLength } from '../units';
import { DEG, add, angleOf, distance, dot, lerp, normalize, perp, scale, sub, type Vec2 } from './vec';
import { wallBody, type WallBody } from './walls';

export type Dimension = EntityOf<'dimension'>;
export type DimensionKind = Dimension['kind'];
export type DimensionAnchors = NonNullable<Dimension['anchors']>;
export type Anchor = NonNullable<DimensionAnchors['from']>;

/**
 * The point an anchor names now: a vertex of a wall's reference line or of one of its faces, or a
 * vertex of a shape's outline. Null when it no longer exists (the entity is gone, the vertex was
 * removed, or the face gained vertices at a bevelled corner and no longer matches the line).
 */
export function anchorPoint(anchor: Anchor, target: Entity | undefined, body?: WallBody | null): Vec2 | null {
  if (!target) return null;
  if (target.type === 'shape') return anchor.side === 'axis' ? (target.path.v[anchor.vertex]?.p ?? null) : null;
  if (target.type !== 'wall') return null;
  if (anchor.side === 'axis') return target.path.v[anchor.vertex]?.p ?? null;
  const faces = (body ?? wallBody(target)).faces;
  const face = anchor.side === 'left' ? faces.left : faces.right;
  if (!face || face.v.length !== target.path.v.length) return null;
  return face.v[anchor.vertex]?.p ?? null;
}

export interface DimensionPoints {
  from: Vec2;
  to: Vec2;
  /** An angular dimension's corner. */
  vertex?: Vec2;
}

/** Entities by id: a level's record, or a lookup (the renderer's scene). */
export type EntityLookup = Record<string, Entity> | ((id: string) => Entity | undefined);

/** Where the dimension's points are now: an anchored end follows its wall or shape, the others are as stored. */
export function resolveDimension(e: Dimension, entities: EntityLookup, bodyOf: (wall: EntityOf<'wall'>) => WallBody = wallBody): DimensionPoints {
  const get = typeof entities === 'function' ? entities : (id: string) => entities[id];
  const at = (end: 'from' | 'to'): Vec2 => {
    const a = e.anchors?.[end];
    if (!a) return e[end];
    const target = get(a.entityId);
    return anchorPoint(a, target, target?.type === 'wall' ? bodyOf(target) : undefined) ?? e[end];
  };
  return { from: at('from'), to: at('to'), ...(e.vertex ? { vertex: e.vertex } : {}) };
}

export interface DimensionGeometry {
  kind: DimensionKind;
  /** Lines to stroke: the dimension line and its extension lines; an angle's rays; a radius line. */
  lines: [Vec2, Vec2][];
  /** Where the tick marks sit: the ends of the dimension line or arc. */
  ticks: Vec2[];
  /** An angular dimension's arc (angles in radians, counter-clockwise positive). */
  arc?: { center: Vec2; radius: number; start: number; sweep: number };
  /** A radius dimension's arrow head, pointing along `direction`. */
  arrow?: { at: Vec2; direction: Vec2 };
  /** What it measures: millimetres, or degrees for an angle. */
  value: number;
  text: string;
  textAt: Vec2;
  /** The text's direction, degrees counter-clockwise. */
  textAngle: number;
}

const ANGULAR_DEFAULT_RADIUS = 500;

/**
 * The lines, arc and text of a dimension from its points. Aligned: the line parallel to from–to at
 * `offset`; horizontal and vertical: the points projected on a line `offset` away along the other
 * axis; angular: an arc of radius `offset` about `vertex` between the rays through the points;
 * radius: the line from the centre (`from`) to a point on the arc (`to`). `over` is how far the
 * extension lines overshoot the dimension line, in mm (a few pixels when drawn).
 */
export function dimensionGeometry(e: Pick<Dimension, 'kind' | 'offset'>, points: DimensionPoints, units: UnitSettings | null, over = 0): DimensionGeometry {
  const { from, to } = points;
  const kind = e.kind;
  if (kind === 'radius') {
    const r = distance(from, to);
    const u: Vec2 = r > 1e-9 ? normalize(sub(to, from)) : [1, 0];
    return { kind, lines: [[from, to]], ticks: [], arrow: { at: to, direction: u }, value: r, text: units ? `R ${formatLength(r, units)}` : '', textAt: lerp(from, to, 0.5), textAngle: angleOf(u) / DEG };
  }
  if (kind === 'angular') {
    const v = points.vertex ?? from;
    const d1 = sub(from, v);
    const d2 = sub(to, v);
    const a1 = angleOf(d1);
    const a2 = angleOf(d2);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const r = Math.abs(e.offset) > 1e-9 ? Math.abs(e.offset) : ANGULAR_DEFAULT_RADIUS;
    const end1: Vec2 = add(v, [Math.cos(a1) * r, Math.sin(a1) * r]);
    const end2: Vec2 = add(v, [Math.cos(a2) * r, Math.sin(a2) * r]);
    // Each ray reaches the arc (and a little beyond), or the point itself when it lies farther out.
    const ray = (p: Vec2, end: Vec2, len: number): [Vec2, Vec2] => [v, len >= r + over ? p : len > 1e-9 ? add(end, scale(normalize(sub(end, v)), over)) : end];
    const mid = a1 + sweep / 2;
    const degrees = Math.abs(sweep) / DEG;
    return {
      kind,
      lines: [ray(from, end1, distance(from, v)), ray(to, end2, distance(to, v))],
      ticks: [end1, end2],
      arc: { center: v, radius: r, start: a1, sweep },
      value: degrees,
      text: units ? formatAngle(degrees, units) : '',
      textAt: add(v, [Math.cos(mid) * r, Math.sin(mid) * r]),
      textAngle: mid / DEG + 90,
    };
  }
  let a: Vec2;
  let b: Vec2;
  let n: Vec2;
  let value: number;
  let textAngle: number;
  if (kind === 'horizontal') {
    const y = from[1] + e.offset;
    a = [from[0], y];
    b = [to[0], y];
    n = [0, 1];
    value = Math.abs(to[0] - from[0]);
    textAngle = 0;
  } else if (kind === 'vertical') {
    const x = from[0] + e.offset;
    a = [x, from[1]];
    b = [x, to[1]];
    n = [1, 0];
    value = Math.abs(to[1] - from[1]);
    textAngle = 90;
  } else {
    const d = distance(from, to);
    const u: Vec2 = d > 1e-9 ? normalize(sub(to, from)) : [1, 0];
    n = perp(u);
    a = add(from, scale(n, e.offset));
    b = add(to, scale(n, e.offset));
    value = d;
    textAngle = angleOf(u) / DEG;
  }
  const dir = scale(n, Math.sign(e.offset) || 1);
  return {
    kind,
    lines: [
      [a, b],
      [from, add(a, scale(dir, over))],
      [to, add(b, scale(dir, over))],
    ],
    ticks: [a, b],
    value,
    text: units ? formatLength(value, units) : '',
    textAt: lerp(a, b, 0.5),
    textAngle,
  };
}

/**
 * The offset that puts the dimension line through `cursor`: the signed distance from the points' line
 * (aligned), along the other axis (horizontal, vertical) or the distance from the corner (angular).
 */
export function offsetTowards(kind: DimensionKind, points: DimensionPoints, cursor: Vec2): number {
  if (kind === 'radius') return 0;
  if (kind === 'angular') return distance(cursor, points.vertex ?? points.from);
  if (kind === 'horizontal') return cursor[1] - points.from[1];
  if (kind === 'vertical') return cursor[0] - points.from[0];
  const d = distance(points.from, points.to);
  if (d < 1e-9) return 0;
  return dot(sub(cursor, points.from), perp(normalize(sub(points.to, points.from))));
}

/**
 * The fields to write when some of a dimension's anchors go (`anchors`: what is left, null for none):
 * an end that was tied gets the point it showed stored, so the dimension stays where it was.
 */
export function untiedFields(e: Dimension, points: DimensionPoints, anchors: DimensionAnchors | null): { set: Record<string, unknown>; unset: string[] } {
  const set: Record<string, unknown> = {};
  for (const end of ['from', 'to'] as const) if (e.anchors?.[end] && !anchors?.[end]) set[end] = points[end];
  if (anchors) set['anchors'] = anchors;
  return { set, unset: anchors ? [] : ['anchors'] };
}

/** The dimension's lines and arc as polylines, for hit-testing and selection outlines. */
export function dimensionOutline(g: DimensionGeometry): Vec2[][] {
  const out: Vec2[][] = g.lines.map(([p, q]) => [p, q]);
  if (g.arc) {
    const { center, radius, start, sweep } = g.arc;
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
    const pts: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = start + (sweep * i) / steps;
      pts.push([center[0] + Math.cos(t) * radius, center[1] + Math.sin(t) * radius]);
    }
    out.push(pts);
  }
  return out;
}

/**
 * The anchors after a vertex of `entityId` was inserted or removed: `map` gives a vertex's new index,
 * or null when it is gone. Returns the new anchors, null when none are left, or undefined when nothing
 * changes.
 */
export function remapAnchors(e: Dimension, entityId: string, map: (vertex: number) => number | null): DimensionAnchors | null | undefined {
  if (!e.anchors) return undefined;
  let changed = false;
  const next: DimensionAnchors = {};
  for (const end of ['from', 'to'] as const) {
    const a = e.anchors[end];
    if (!a) continue;
    if (a.entityId !== entityId) {
      next[end] = a;
      continue;
    }
    const v = map(a.vertex);
    if (v === null) changed = true;
    else if (v !== a.vertex) {
      changed = true;
      next[end] = { ...a, vertex: v };
    } else next[end] = a;
  }
  if (!changed) return undefined;
  return next.from || next.to ? next : null;
}

/** The anchors with those whose target `keep` rejects dropped; null when none are left, undefined when nothing changes. */
export function pruneAnchors(e: Dimension, keep: (entityId: string) => boolean): DimensionAnchors | null | undefined {
  if (!e.anchors) return undefined;
  let changed = false;
  const next: DimensionAnchors = {};
  for (const end of ['from', 'to'] as const) {
    const a = e.anchors[end];
    if (!a) continue;
    if (keep(a.entityId)) next[end] = a;
    else changed = true;
  }
  if (!changed) return undefined;
  return next.from || next.to ? next : null;
}

/**
 * A dimension's marks as line pieces: a slash at 45° to the line (or to the arc's radius) of
 * half-length `tick` at each end, and a radius's open arrow head `head` long. Sizes are in mm (the
 * plan passes a few pixels' worth, an export a fraction of its text height).
 */
export function dimensionMarks(g: DimensionGeometry, tick: number, head: number): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  if (g.ticks.length === 2) {
    const [a, b] = g.ticks;
    for (const p of g.ticks) {
      const dir = g.arc ? normalize(sub(p, g.arc.center)) : normalize(sub(b, a));
      const slash = normalize(add(dir, perp(dir)));
      out.push([sub(p, scale(slash, tick)), add(p, scale(slash, tick))]);
    }
  }
  if (g.arrow) {
    const back = scale(g.arrow.direction, -head);
    const side = scale(perp(g.arrow.direction), head * 0.35);
    const tip = g.arrow.at;
    for (const s of [side, scale(side, -1)]) out.push([tip, add(add(tip, back), s)]);
  }
  return out;
}
