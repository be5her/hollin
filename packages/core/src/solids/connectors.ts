import type { RuleLimits } from '../config';
import { deriveLevels, levelCeiling, type DerivedLevel } from '../doc/derive';
import type { Connector, ConnectorKind, ProjectDoc } from '../doc/schema';
import { ESCALATOR_LANDING, deriveConnector, type ConnectorGeometry, type EscalatorGeometry, type LadderGeometry, type RampGeometry, type StairGeometry } from '../geometry/connectors';
import { flatten, nearestPoint, pointAt, type Path } from '../geometry/path';
import { orient, type Polygon } from '../geometry/polygon';
import { add, distance, normalize, perp, scale, sub, type Vec2 } from '../geometry/vec';
import type { SolidPart } from './building';
import { MeshBuilder, type Vec3 } from './mesh';

/**
 * A surface you can stand on: a polygon on the plan and the plane its height follows,
 * z = plane[0] + plane[1]·x + plane[2]·y (flat when both slopes are 0).
 */
export interface WalkSurface {
  polygon: Polygon;
  plane: readonly [number, number, number];
}

/** A connector in 3D, with the level it starts from (its lowest stop for an elevator). */
export interface ConnectorSolids {
  id: string;
  kind: ConnectorKind;
  levelId: string;
  bottom: number;
  top: number;
  parts: SolidPart[];
  /** Treads, landings, ramp and escalator surfaces, and an elevator's car floor at each stop. */
  surfaces: WalkSurface[];
  /** An elevator's car on the plan and the elevations it stops at, bottom to top. */
  car?: { polygon: Polygon; stops: { levelId: string; elevation: number }[] };
}

/** How far below its tread a stair's step reaches (beyond its riser), and how thick ramps, landings and escalators are, mm. */
const SLAB = 200;
const HANDRAIL_HEIGHT = 900;
const RAIL = 50;
const LADDER_RAIL = 60;
const RUNG = 30;
const CAR_HEIGHT = 2300;
/** Ramp and escalator surfaces are sampled at least this often along their axis, mm. */
const SAMPLE = 250;

const flat = (polygon: Polygon, z: number): WalkSurface => ({ polygon, plane: [z, 0, 0] });

/** The plane through three points, as z = c + gx·x + gy·y; null when they are in a vertical plane. */
function planeThrough(a: Vec3, b: Vec3, c: Vec3): WalkSurface['plane'] | null {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (Math.abs(nz) < 1e-9) return null;
  const gx = -nx / nz;
  const gy = -ny / nz;
  return [a[2] - gx * a[0] - gy * a[1], gx, gy];
}

/**
 * A strip along a path between `from` and `to` (distances along it), `width` wide, its top at
 * `zAt(along)` and its underside `thickness` below: a ramp's flight, an escalator. Sampled at every
 * vertex of its flattened path and at most `SAMPLE` apart; returns its top as walk surfaces.
 */
function strip(mesh: MeshBuilder, path: Path, from: number, to: number, width: number, zAt: (along: number) => number, thickness: number): WalkSurface[] {
  if (to - from < 1e-6) return [];
  const count = Math.max(1, Math.ceil((to - from) / SAMPLE));
  const rows = Array.from({ length: count + 1 }, (_, i) => {
    const along = from + ((to - from) * i) / count;
    const { point, tangent } = pointAt(path, along);
    const left = scale(perp(tangent), width / 2);
    const z = zAt(along);
    return { l: add(point, left), r: sub(point, left), z };
  });
  const surfaces: WalkSurface[] = [];
  const v = (p: Vec2, z: number): Vec3 => [p[0], p[1], z];
  for (let i = 0; i < count; i++) {
    const p = rows[i];
    const q = rows[i + 1];
    // Top (seen from above: right, next right, next left, left is counter-clockwise), underside, and both sides.
    mesh.quad(v(p.r, p.z), v(q.r, q.z), v(q.l, q.z), v(p.l, p.z));
    mesh.quad(v(p.l, p.z - thickness), v(q.l, q.z - thickness), v(q.r, q.z - thickness), v(p.r, p.z - thickness));
    mesh.quad(v(p.r, p.z - thickness), v(q.r, q.z - thickness), v(q.r, q.z), v(p.r, p.z));
    mesh.quad(v(q.l, q.z - thickness), v(p.l, p.z - thickness), v(p.l, p.z), v(q.l, q.z));
    for (const t of [
      [v(p.r, p.z), v(q.r, q.z), v(q.l, q.z)],
      [v(p.r, p.z), v(q.l, q.z), v(p.l, p.z)],
    ] as const) {
      const plane = planeThrough(t[0], t[1], t[2]);
      if (plane) surfaces.push({ polygon: orient([[t[0][0], t[0][1]], [t[1][0], t[1][1]], [t[2][0], t[2][1]]], true), plane });
    }
  }
  const first = rows[0];
  const last = rows[count];
  mesh.quad(v(first.l, first.z - thickness), v(first.r, first.z - thickness), v(first.r, first.z), v(first.l, first.z));
  mesh.quad(v(last.r, last.z - thickness), v(last.l, last.z - thickness), v(last.l, last.z), v(last.r, last.z));
  return surfaces;
}

/** A bar along a flattened path whose height follows `zAt` of each point (a handrail), sampled at most `SAMPLE` apart. */
function railAlong(mesh: MeshBuilder, points: readonly Vec2[], zAt: (p: Vec2) => number): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const n = Math.max(1, Math.ceil(distance(points[i], points[i + 1]) / SAMPLE));
    const dir = normalize(sub(points[i + 1], points[i]));
    if (dir[0] === 0 && dir[1] === 0) continue;
    const side: Vec3 = [-dir[1], dir[0], 0];
    for (let k = 0; k < n; k++) {
      const p = add(points[i], scale(sub(points[i + 1], points[i]), k / n));
      const q = add(points[i], scale(sub(points[i + 1], points[i]), (k + 1) / n));
      mesh.bar([p[0], p[1], zAt(p)], [q[0], q[1], zAt(q)], side, [0, 0, 1], RAIL, RAIL);
    }
  }
}

function stairSolids(c: Extract<Connector, { kind: 'stair' }>, g: StairGeometry): { parts: SolidPart[]; surfaces: WalkSurface[] } {
  const body = new MeshBuilder();
  const surfaces: WalkSurface[] = [];
  const h = g.riserHeight;
  // Each tread spans from its nosing line to the next one in the same flight, at its riser's height; a step reaches a riser and a slab below it.
  for (const f of g.flights) {
    const lines = g.treads.filter((t) => t.along >= f.from - 1e-6 && t.along <= f.to + 1e-6);
    for (let k = 0; k + 1 < lines.length; k++) {
      const top = g.bottom + lines[k].riser * h;
      const tread = orient([lines[k].a, lines[k].b, lines[k + 1].b, lines[k + 1].a], true);
      body.prism([tread], Math.max(g.bottom, top - h - SLAB), top);
      surfaces.push(flat(tread, top));
    }
  }
  for (const l of g.landings) {
    const z = g.bottom + l.height;
    body.prism(l.polygons, Math.max(g.bottom, z - SLAB), z);
    for (const p of l.polygons) surfaces.push(flat(p, z));
  }
  // Handrails follow the line through the nosings, 900 mm above it, and cross the landings on a straight slope.
  const pitch = g.treads.map((t) => ({ along: t.along, z: g.bottom + t.riser * h }));
  const zAlong = (along: number): number => {
    if (!pitch.length) return g.bottom;
    if (along <= pitch[0].along) return pitch[0].z;
    for (let i = 1; i < pitch.length; i++) {
      const p = pitch[i - 1];
      const q = pitch[i];
      if (along <= q.along) return q.along - p.along < 1e-6 ? q.z : p.z + ((q.z - p.z) * (along - p.along)) / (q.along - p.along);
    }
    return pitch[pitch.length - 1].z;
  };
  const rails = new MeshBuilder();
  for (const rail of g.handrails) railAlong(rails, flatten(rail, 1), (p) => zAlong(nearestPoint(c.axis, p).along) + HANDRAIL_HEIGHT);
  const parts: SolidPart[] = [];
  if (!body.empty) parts.push({ kind: 'connector', mesh: body.build(), ids: [c.id] });
  if (!rails.empty) parts.push({ kind: 'rail', mesh: rails.build(), ids: [c.id] });
  return { parts, surfaces };
}

function rampSolids(c: Extract<Connector, { kind: 'ramp' }>, g: RampGeometry): { parts: SolidPart[]; surfaces: WalkSurface[] } {
  const mesh = new MeshBuilder();
  const surfaces: WalkSurface[] = [];
  const landings = [...g.landings].sort((a, b) => a.from - b.from);
  // The height along the axis: rising on the flights, level on the landings (each at the height the slope has reached).
  const knots = [{ along: 0, z: g.bottom }, ...landings.flatMap((l) => [{ along: l.from, z: g.bottom + l.height }, { along: l.to, z: g.bottom + l.height }]), { along: g.walkLength, z: g.top }];
  const zAt = (along: number) => {
    for (let i = 1; i < knots.length; i++) {
      const p = knots[i - 1];
      const q = knots[i];
      if (along <= q.along + 1e-9) return q.along - p.along < 1e-9 ? q.z : p.z + ((q.z - p.z) * (along - p.along)) / (q.along - p.along);
    }
    return g.top;
  };
  let from = 0;
  for (const l of landings) {
    surfaces.push(...strip(mesh, c.axis, from, l.from, c.width, zAt, SLAB));
    const z = g.bottom + l.height;
    mesh.prism(l.polygons, z - SLAB, z);
    for (const p of l.polygons) surfaces.push(flat(p, z));
    from = l.to;
  }
  surfaces.push(...strip(mesh, c.axis, from, g.walkLength, c.width, zAt, SLAB));
  return { parts: mesh.empty ? [] : [{ kind: 'connector', mesh: mesh.build(), ids: [c.id] }], surfaces };
}

function ladderSolids(c: Extract<Connector, { kind: 'ladder' }>, g: LadderGeometry): { parts: SolidPart[]; surfaces: WalkSurface[] } {
  const mesh = new MeshBuilder();
  const along = normalize(sub(g.head, g.foot));
  const dir: Vec2 = along[0] === 0 && along[1] === 0 ? [Math.cos((c.direction * Math.PI) / 180), Math.sin((c.direction * Math.PI) / 180)] : along;
  const side: Vec3 = [-dir[1], dir[0], 0];
  // Rails rise from the foot to the head; their section lies across the ladder and along the floor.
  for (const [foot, head] of g.rails) mesh.bar([foot[0], foot[1], g.bottom], [head[0], head[1], g.top], side, [dir[0], dir[1], 0], LADDER_RAIL, LADDER_RAIL);
  g.rungs.forEach(([a, b], i) => {
    const z = g.bottom + (g.rise * (i + 1)) / (g.rungs.length + 1);
    mesh.bar([a[0], a[1], z], [b[0], b[1], z], [dir[0], dir[1], 0], [0, 0, 1], RUNG, RUNG);
  });
  return { parts: mesh.empty ? [] : [{ kind: 'rail', mesh: mesh.build(), ids: [c.id] }], surfaces: [] };
}

function escalatorSolids(c: Extract<Connector, { kind: 'escalator' }>, g: EscalatorGeometry): { parts: SolidPart[]; surfaces: WalkSurface[] } {
  const mesh = new MeshBuilder();
  const path: Path = { closed: false, v: [{ p: g.foot }, { p: g.head }] };
  const inclined = g.run - 2 * ESCALATOR_LANDING;
  const zAt = (along: number) => g.bottom + g.rise * Math.min(1, Math.max(0, (along - ESCALATOR_LANDING) / Math.max(inclined, 1e-9)));
  const surfaces = [...strip(mesh, path, 0, ESCALATOR_LANDING, c.width, zAt, SLAB), ...strip(mesh, path, ESCALATOR_LANDING, ESCALATOR_LANDING + inclined, c.width, zAt, SLAB), ...strip(mesh, path, ESCALATOR_LANDING + inclined, g.run, c.width, zAt, SLAB)];
  return { parts: mesh.empty ? [] : [{ kind: 'connector', mesh: mesh.build(), ids: [c.id] }], surfaces };
}

/**
 * A connector in 3D from its derived geometry: a stair's steps (each tread a block reaching one
 * riser and a slab below it), landings and handrails; a ramp's sloped flights and level landings; a
 * ladder's rails and rungs; an escalator's landings and incline; an elevator's glass shaft from its
 * lowest stop to the ceiling of its highest and its car at the lowest stop. Null when the connector
 * has no extent (no stops, levels missing).
 */
export function deriveConnectorSolids(connector: Connector, levels: readonly DerivedLevel[], limits: RuleLimits): ConnectorSolids | null {
  const g: ConnectorGeometry = deriveConnector(connector, levels, limits);
  if (!Number.isFinite(g.bottom) || !Number.isFinite(g.top)) return null;
  const base = { id: connector.id, kind: connector.kind, bottom: g.bottom, top: g.top };
  if (connector.kind === 'elevator' && g.kind === 'elevator') {
    if (!g.stops.length) return null;
    const highest = levels.find((l) => l.id === g.stops[g.stops.length - 1].levelId);
    // The shaft runs up to the ceiling of its highest stop, and at least a car's height above it.
    const shaftTop = Math.max(g.top + CAR_HEIGHT, highest ? levelCeiling(highest, levels) : -Infinity);
    const shaft = new MeshBuilder().prism([orient(g.shaft, true)], g.bottom, shaftTop);
    const car = new MeshBuilder().prism([orient(g.car, true)], g.bottom, g.bottom + CAR_HEIGHT);
    return {
      ...base,
      levelId: g.stops[0].levelId,
      parts: [
        { kind: 'glass', mesh: shaft.build(), ids: [connector.id] },
        { kind: 'car', mesh: car.build(), ids: [connector.id] },
      ],
      surfaces: g.stops.map((s) => flat(orient(g.car, true), s.elevation)),
      car: { polygon: orient(g.car, true), stops: g.stops.map((s) => ({ levelId: s.levelId, elevation: s.elevation })) },
    };
  }
  if (connector.kind === 'elevator') return null;
  const levelId = connector.bottom.levelId;
  const built =
    connector.kind === 'stair' && g.kind === 'stair'
      ? stairSolids(connector, g)
      : connector.kind === 'ramp' && g.kind === 'ramp'
        ? rampSolids(connector, g)
        : connector.kind === 'ladder' && g.kind === 'ladder'
          ? ladderSolids(connector, g)
          : connector.kind === 'escalator' && g.kind === 'escalator'
            ? escalatorSolids(connector, g)
            : { parts: [], surfaces: [] };
  return { ...base, levelId, ...built };
}

/** Every connector in 3D (see `deriveConnectorSolids`). */
export function deriveConnectorsSolids(doc: Pick<ProjectDoc, 'building' | 'levels' | 'connectors'>, limits: RuleLimits, levels: readonly DerivedLevel[] = deriveLevels(doc)): ConnectorSolids[] {
  return Object.values(doc.connectors)
    .map((c) => deriveConnectorSolids(c, levels, limits))
    .filter((s): s is ConnectorSolids => s !== null);
}
