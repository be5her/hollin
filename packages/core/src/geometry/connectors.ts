import type { RuleLimits } from '../config';
import { deriveLevels, type DerivedLevel } from '../doc/derive';
import type { Connector, ProjectDoc } from '../doc/schema';
import { segmentIntersections } from './intersect';
import { offsetPath, segmentsToPath } from './offset';
import { resolvePath, segmentLength, segmentPoint, segmentTangent, trim, type Path, type Seg } from './path';
import type { Polygon } from './polygon';
import { add, cross, distance, dot, normalize, perp, scale, sub, type Vec2 } from './vec';
import { wallBody } from './walls';

/*
 * Vertical connectors as drawn and checked: everything here is derived from the connector and the
 * levels' elevations, never stored, so a level's height change regenerates every connector on it.
 */

export type ConnectorRule =
  | 'riser-high'
  | 'riser-low'
  | 'tread-short'
  | 'comfort'
  | 'too-narrow'
  | 'too-few-risers'
  | 'shape-mismatch'
  | 'self-intersecting'
  | 'too-steep'
  | 'inverted'
  | 'stop-off-stack'
  | 'stops-same-elevation'
  | 'car-too-big';

/** A limit a connector breaks. `value` and `limit` are in mm, or percent for slopes. */
export interface RuleBreak {
  rule: ConnectorRule;
  message: string;
  value?: number;
  limit?: number;
}

/** A line across a stair at a riser: the nosing of the step whose top is `riser` × riser height above the bottom. */
export interface TreadLine {
  a: Vec2;
  b: Vec2;
  /** Distance along the walk line. */
  along: number;
  /** 1 for the first riser; the last line (the top floor's edge) is the riser count. */
  riser: number;
}

export interface Flight {
  /** Distance along the walk line where it starts and ends. */
  from: number;
  to: number;
  risers: number;
  /** Treads (goings) in it: one fewer than its risers. */
  treads: number;
  /** Its tread depth on the walk line, mm. */
  tread: number;
}

export interface Landing {
  from: number;
  to: number;
  polygons: Polygon[];
  /** Height above the stair's bottom, mm. */
  height: number;
}

interface GeometryBase {
  id: string;
  /** Elevation of its bottom and top, mm. */
  bottom: number;
  top: number;
  rise: number;
  /** Its outline on the plan: what it cuts out of the slabs it passes through. */
  footprint: Polygon[];
  broken: RuleBreak[];
}

export interface StairGeometry extends GeometryBase {
  kind: 'stair';
  risers: number;
  riserHeight: number;
  /** The shallowest flight's tread depth, mm (all flights' when they are equal). */
  treadDepth: number;
  walkLength: number;
  flights: Flight[];
  landings: Landing[];
  treads: TreadLine[];
  handrails: Path[];
  /** Distance along the walk line where the plan's cut falls on the bottom level, or null when the whole stair lies below the cut. */
  cutAlong: number | null;
  axis: Seg[];
}

export interface RampGeometry extends GeometryBase {
  kind: 'ramp';
  /** Percent. */
  slope: number;
  maxSlope: number;
  /** Sloped length on the axis, landings excluded. */
  run: number;
  walkLength: number;
  landings: Landing[];
  axis: Seg[];
}

export interface LadderGeometry extends GeometryBase {
  kind: 'ladder';
  run: number;
  foot: Vec2;
  head: Vec2;
  rails: [Vec2, Vec2][];
  rungs: [Vec2, Vec2][];
}

export interface ElevatorStop {
  levelId: string;
  elevation: number;
  side: 'front' | 'back' | 'left' | 'right';
  /** The door mark on the shaft's side. */
  door: [Vec2, Vec2];
}

export interface ElevatorGeometry extends GeometryBase {
  kind: 'elevator';
  shaft: Polygon;
  car: Polygon;
  /** Bottom to top. */
  stops: ElevatorStop[];
}

export interface EscalatorGeometry extends GeometryBase {
  kind: 'escalator';
  /** Total length on the plan: the landings at both ends and the inclined part. */
  run: number;
  foot: Vec2;
  head: Vec2;
  steps: [Vec2, Vec2][];
}

export type ConnectorGeometry = StairGeometry | RampGeometry | LadderGeometry | ElevatorGeometry | EscalatorGeometry;

const CORNER = (5 * Math.PI) / 180;
const HANDRAIL_INSET = 50;
const RUNG_SPACING = 300;
const ESCALATOR_ANGLE = (30 * Math.PI) / 180;
const ESCALATOR_LANDING = 1200;
const ESCALATOR_STEP = 400;
const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;

// ---------- walking along an axis ----------

interface Walk {
  segs: Seg[];
  /** Cumulative length at the start of each segment. */
  starts: number[];
  total: number;
}

function walkOf(path: Path): Walk {
  const segs = resolvePath(path).segs;
  const starts: number[] = [];
  let total = 0;
  for (const s of segs) {
    starts.push(total);
    total += segmentLength(s);
  }
  return { segs, starts, total };
}

/** Point and unit direction at a distance along the walk (by arc length; cubics approximately). */
function at(walk: Walk, along: number): { point: Vec2; tangent: Vec2 } {
  const { segs, starts } = walk;
  let i = segs.length - 1;
  while (i > 0 && starts[i] > along) i--;
  const len = segmentLength(segs[i]);
  const t = len > 0 ? Math.min(1, Math.max(0, (along - starts[i]) / len)) : 0;
  return { point: segmentPoint(segs[i], t), tangent: normalize(segmentTangent(segs[i], t)) };
}

/** The part of the walk between two distances, as a path. */
function subPath(walk: Walk, from: number, to: number): Path | null {
  const out: Seg[] = [];
  walk.segs.forEach((s, i) => {
    const len = segmentLength(s);
    const a = walk.starts[i];
    const b = a + len;
    if (b <= from + 1e-9 || a >= to - 1e-9 || len <= 0) return;
    const t0 = Math.max(0, (from - a) / len);
    const t1 = Math.min(1, (to - a) / len);
    out.push(t0 === 0 && t1 === 1 ? s : trim(s, t0, t1));
  });
  return out.length ? segmentsToPath(out, false) : null;
}

/** Where the walk turns sharply between two segments: its distance, the turn (radians, + = left) and the vertex. */
function cornersOf(walk: Walk): { along: number; turn: number; point: Vec2 }[] {
  const corners: { along: number; turn: number; point: Vec2 }[] = [];
  for (let i = 1; i < walk.segs.length; i++) {
    const tin = normalize(segmentTangent(walk.segs[i - 1], 1));
    const tout = normalize(segmentTangent(walk.segs[i], 0));
    const turn = Math.atan2(cross(tin, tout), dot(tin, tout));
    if (Math.abs(turn) > CORNER) corners.push({ along: walk.starts[i], turn, point: walk.segs[i].a });
  }
  return corners;
}

/** Whether any two segments that do not follow each other cross or touch. */
export function segmentsSelfIntersect(segs: readonly Seg[], closed = false): boolean {
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      if (closed && i === 0 && j === segs.length - 1) continue;
      if (segmentIntersections(segs[i], segs[j]).length) return true;
    }
  }
  return false;
}

/** Landing intervals around the corners (each takes half the width on either side; overlapping ones merge) and the flights between them. */
function splitFlights(walk: Walk, corners: { along: number }[], width: number): { flights: [number, number][]; landings: [number, number][] } {
  const landings: [number, number][] = [];
  for (const c of corners) {
    const from = Math.max(0, c.along - width / 2);
    const to = Math.min(walk.total, c.along + width / 2);
    const last = landings[landings.length - 1];
    if (last && from <= last[1] + 1e-6) last[1] = Math.max(last[1], to);
    else landings.push([from, to]);
  }
  const flights: [number, number][] = [];
  let start = 0;
  for (const [from, to] of landings) {
    if (from - start > 1) flights.push([start, from]);
    start = to;
  }
  if (walk.total - start > 1) flights.push([start, walk.total]);
  return { flights, landings };
}

/** Shares `total` out in proportion to `weights`, by largest remainder, giving each at least one when there are enough. */
function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const ideal = weights.map((w) => (w / sum) * total);
  const out = ideal.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = ideal.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  if (total >= weights.length) {
    for (let i = 0; i < out.length; i++) {
      if (out[i] > 0) continue;
      const donor = out.indexOf(Math.max(...out));
      out[donor]--;
      out[i]++;
    }
  }
  return out;
}

function body(path: Path, width: number): Polygon[] {
  return wallBody({ path, thickness: width, alignment: 'center' }).polygons;
}

// ---------- elevations ----------

type LevelRef = { levelId: string; offset: number };

function refElevation(levels: ReadonlyMap<string, DerivedLevel>, ref: LevelRef): number {
  const level = levels.get(ref.levelId);
  return level ? level.elevation + ref.offset : NaN;
}

function indexLevels(levels: readonly DerivedLevel[]): Map<string, DerivedLevel> {
  return new Map(levels.map((l) => [l.id, l]));
}

/** The elevations a connector runs between: its bottom and top, or an elevator's lowest and highest stop. */
export function connectorRange(connector: Connector, levels: readonly DerivedLevel[] | ReadonlyMap<string, DerivedLevel>): { bottom: number; top: number } {
  const byId = levels instanceof Map ? levels : indexLevels(levels as readonly DerivedLevel[]);
  if (connector.kind === 'elevator') {
    const stops = connector.stops.map((s) => byId.get(s.levelId)?.elevation ?? NaN).filter((e) => !Number.isNaN(e));
    return stops.length ? { bottom: Math.min(...stops), top: Math.max(...stops) } : { bottom: NaN, top: NaN };
  }
  return { bottom: refElevation(byId, connector.bottom), top: refElevation(byId, connector.top) };
}

// ---------- stairs ----------

function deriveStair(c: Extract<Connector, { kind: 'stair' }>, bottom: number, top: number, limits: RuleLimits): StairGeometry {
  const rise = top - bottom;
  const broken: RuleBreak[] = [];
  const walk = walkOf(c.axis);
  const width = c.width;
  const corners = cornersOf(walk);
  const winder = c.shape === 'winder';
  const split = winder ? { flights: walk.total > 1 ? ([[0, walk.total]] as [number, number][]) : [], landings: [] as [number, number][] } : splitFlights(walk, corners, width);

  if (rise <= 0) broken.push({ rule: 'inverted', message: `Its top is not above its bottom (it rises ${mm(rise)}).`, value: rise, limit: 0 });
  const maxRiser = c.riser.maxHeight ?? limits.maxRiser;
  const minTread = c.tread.minDepth ?? limits.minTread;
  const risers = Math.max(2, c.riser.count ?? Math.ceil(Math.max(rise, 0) / maxRiser - 1e-9));
  const riserHeight = rise / risers;
  const lengths = split.flights.map(([a, b]) => b - a);
  const treadsTotal = risers - split.flights.length;
  const treadCounts = apportion(lengths, Math.max(0, treadsTotal));
  if (treadsTotal < split.flights.length) broken.push({ rule: 'too-few-risers', message: `${risers} risers are too few for ${split.flights.length} flights.`, value: risers, limit: split.flights.length * 2 });

  const flights: Flight[] = split.flights.map(([from, to], i) => ({ from, to, treads: treadCounts[i], risers: treadCounts[i] + 1, tread: treadCounts[i] ? (to - from) / treadCounts[i] : 0 }));
  const treadDepth = flights.length ? Math.min(...flights.map((f) => (f.treads ? f.tread : Infinity))) : 0;

  // Tread lines: straight across, perpendicular to the walk line (radial on arcs); on a winder, fanned from the inside corner near a turn.
  const innerFace = (turn: number) => offsetPath(c.axis, Math.sign(turn) * (width / 2));
  const faces = new Map<number, { inner: Path | null; outer: Seg[] }>();
  if (winder) {
    corners.forEach((corner, i) => {
      const outer = offsetPath(c.axis, -Math.sign(corner.turn) * (width / 2));
      faces.set(i, { inner: innerFace(corner.turn), outer: outer ? resolvePath(outer).segs : [] });
    });
  }
  const treads: TreadLine[] = [];
  let riser = 0;
  for (const f of flights) {
    for (let k = 0; k <= f.treads; k++) {
      const along = f.treads ? f.from + k * f.tread : f.to;
      riser++;
      treads.push({ ...treadLine(walk, along, width, winder ? corners : [], faces), along, riser });
    }
  }

  const landings: Landing[] = [];
  let climbed = 0;
  let flightIndex = 0;
  for (const [from, to] of split.landings) {
    while (flightIndex < flights.length && flights[flightIndex].to <= from + 1e-6) climbed += flights[flightIndex++].risers;
    const part = subPath(walk, from, to);
    landings.push({ from, to, polygons: part ? body(part, width) : [], height: climbed * riserHeight });
  }

  const handrails: Path[] = [];
  const inset = Math.max(0, width / 2 - HANDRAIL_INSET);
  if (c.handrails.left) {
    const rail = offsetPath(c.axis, inset);
    if (rail) handrails.push(rail);
  }
  if (c.handrails.right) {
    const rail = offsetPath(c.axis, -inset);
    if (rail) handrails.push(rail);
  }

  const cutRiser = riserHeight > 0 ? Math.ceil(limits.stairCutHeight / riserHeight) : risers;
  const cutAlong = cutRiser < risers && treads[cutRiser - 1] ? treads[cutRiser - 1].along : null;

  if (rise > 0) {
    if (riserHeight > maxRiser + 0.05) broken.push({ rule: 'riser-high', message: `Risers of ${mm(riserHeight)} are higher than ${mm(maxRiser)}.`, value: riserHeight, limit: maxRiser });
    if (riserHeight < limits.minRiser - 0.05) broken.push({ rule: 'riser-low', message: `Risers of ${mm(riserHeight)} are lower than ${mm(limits.minRiser)}.`, value: riserHeight, limit: limits.minRiser });
    if (Number.isFinite(treadDepth) && treadDepth < minTread - 0.05) broken.push({ rule: 'tread-short', message: `Treads of ${mm(treadDepth)} are shallower than ${mm(minTread)}.`, value: treadDepth, limit: minTread });
    const step = 2 * riserHeight + treadDepth;
    if (Number.isFinite(step) && (step < limits.comfortMin - 0.05 || step > limits.comfortMax + 0.05)) {
      const limit = step < limits.comfortMin ? limits.comfortMin : limits.comfortMax;
      broken.push({ rule: 'comfort', message: `2 × riser + tread is ${mm(step)}, outside ${limits.comfortMin}–${limits.comfortMax} mm.`, value: step, limit });
    }
  }
  if (width < limits.minStairWidth - 0.05) broken.push({ rule: 'too-narrow', message: `It is ${mm(width)} wide, narrower than ${mm(limits.minStairWidth)}.`, value: width, limit: limits.minStairWidth });
  const mismatch = shapeMismatch(c.shape, walk, corners);
  if (mismatch) broken.push({ rule: 'shape-mismatch', message: mismatch });
  if (segmentsSelfIntersect(walk.segs)) broken.push({ rule: 'self-intersecting', message: 'Its walk line crosses itself.' });

  return {
    kind: 'stair',
    id: c.id,
    bottom,
    top,
    rise,
    footprint: walk.segs.length ? body(c.axis, width) : [],
    broken,
    risers,
    riserHeight,
    treadDepth: Number.isFinite(treadDepth) ? treadDepth : 0,
    walkLength: walk.total,
    flights,
    landings,
    treads,
    handrails,
    cutAlong,
    axis: walk.segs,
  };
}

function treadLine(walk: Walk, along: number, width: number, corners: { along: number; turn: number; point: Vec2 }[], faces: Map<number, { inner: Path | null; outer: Seg[] }>): { a: Vec2; b: Vec2 } {
  const { point, tangent } = at(walk, along);
  const left = perp(tangent);
  const straight = { a: add(point, scale(left, width / 2)), b: sub(point, scale(left, width / 2)) };
  const i = corners.findIndex((c) => Math.abs(c.along - along) < width / 2 - 1e-6);
  if (i < 0) return straight;
  const face = faces.get(i);
  if (!face?.inner) return straight;
  // The inside corner: the inner face's vertex nearest the walk line's corner.
  const innerVertices = face.inner.v.map((v) => v.p);
  const inner = innerVertices.reduce((best, p) => (distance(p, corners[i].point) < distance(best, corners[i].point) ? p : best), innerVertices[0]);
  const dir = sub(point, inner);
  if (Math.hypot(dir[0], dir[1]) < 1e-6) return straight;
  const ray: Seg = { k: 'line', a: inner, b: add(inner, scale(normalize(dir), width * 3)) };
  let outer: Vec2 | null = null;
  for (const s of face.outer) for (const p of segmentIntersections(ray, s)) if (!outer || distance(inner, p) < distance(inner, outer)) outer = p;
  if (!outer) return straight;
  return corners[i].turn > 0 ? { a: inner, b: outer } : { a: outer, b: inner };
}

function shapeMismatch(shape: Extract<Connector, { kind: 'stair' }>['shape'], walk: Walk, corners: { turn: number }[]): string | null {
  const arcs = walk.segs.some((s) => s.k !== 'line');
  const turned = Math.abs(corners.reduce((sum, c) => sum + c.turn, 0)) / (Math.PI / 180);
  switch (shape) {
    case 'straight':
      return corners.length || arcs ? 'A straight stair runs along one straight line, but its walk line turns.' : null;
    case 'l':
      return corners.length === 1 ? null : `An L stair turns once, but its walk line turns ${corners.length} times.`;
    case 'u':
      return corners.length === 2 && Math.abs(turned - 180) < 15 ? null : 'A U stair turns back on itself in two corners.';
    case 'winder':
      return corners.length ? null : 'A winder stair needs a corner to wind around.';
    case 'curved':
    case 'spiral':
      return arcs ? null : `A ${shape} stair follows an arc, but its walk line is straight.`;
  }
}

// ---------- ramps ----------

function deriveRamp(c: Extract<Connector, { kind: 'ramp' }>, bottom: number, top: number): RampGeometry {
  const rise = top - bottom;
  const walk = walkOf(c.axis);
  const corners = cornersOf(walk);
  const split = splitFlights(walk, corners, c.width);
  const run = split.flights.reduce((sum, [a, b]) => sum + (b - a), 0);
  const slope = run > 0 ? (rise / run) * 100 : Infinity;
  const broken: RuleBreak[] = [];
  if (rise <= 0) broken.push({ rule: 'inverted', message: `Its top is not above its bottom (it rises ${mm(rise)}).`, value: rise, limit: 0 });
  else if (slope > c.maxSlope + 0.005) broken.push({ rule: 'too-steep', message: `Its slope of ${slope.toFixed(1)} % is steeper than ${c.maxSlope} %.`, value: slope, limit: c.maxSlope });
  if (segmentsSelfIntersect(walk.segs)) broken.push({ rule: 'self-intersecting', message: 'Its axis crosses itself.' });
  // Landings sit at the height the slope has reached.
  const landings: Landing[] = split.landings.map(([from, to]) => {
    const before = split.flights.filter(([, b]) => b <= from + 1e-6).reduce((sum, [a, b]) => sum + (b - a), 0);
    const part = subPath(walk, from, to);
    return { from, to, polygons: part ? body(part, c.width) : [], height: run > 0 ? (before / run) * rise : 0 };
  });
  return { kind: 'ramp', id: c.id, bottom, top, rise, footprint: walk.segs.length ? body(c.axis, c.width) : [], broken, slope: Number.isFinite(slope) ? slope : 0, maxSlope: c.maxSlope, run, walkLength: walk.total, landings, axis: walk.segs };
}

// ---------- ladders, escalators, elevators ----------

const direction = (degrees: number): Vec2 => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];

function rect(origin: Vec2, along: Vec2, length: number, width: number): Polygon {
  const side = scale(perp(along), width / 2);
  const end = add(origin, scale(along, length));
  return [sub(origin, side), sub(end, side), add(end, side), add(origin, side)];
}

function deriveLadder(c: Extract<Connector, { kind: 'ladder' }>, bottom: number, top: number): LadderGeometry {
  const rise = top - bottom;
  const broken: RuleBreak[] = [];
  if (rise <= 0) broken.push({ rule: 'inverted', message: `Its top is not above its bottom (it rises ${mm(rise)}).`, value: rise, limit: 0 });
  const along = direction(c.direction);
  const run = rise > 0 ? rise / Math.tan((c.angle * Math.PI) / 180) : 0;
  const side = scale(perp(along), c.width / 2);
  const head = add(c.at, scale(along, run));
  const rungs: [Vec2, Vec2][] = [];
  const count = rise > 0 ? Math.max(1, Math.floor(rise / RUNG_SPACING)) : 0;
  for (let j = 1; j <= count; j++) {
    const p = add(c.at, scale(along, (run * j) / (count + 1)));
    rungs.push([sub(p, side), add(p, side)]);
  }
  // A vertical ladder still needs room to stand on: draw it at least 100 mm deep.
  const depth = Math.max(run, 100);
  return { kind: 'ladder', id: c.id, bottom, top, rise, footprint: [rect(c.at, along, depth, c.width)], broken, run, foot: c.at, head, rails: [[sub(c.at, side), sub(head, side)], [add(c.at, side), add(head, side)]], rungs };
}

function deriveEscalator(c: Extract<Connector, { kind: 'escalator' }>, bottom: number, top: number): EscalatorGeometry {
  const rise = top - bottom;
  const broken: RuleBreak[] = [];
  if (rise <= 0) broken.push({ rule: 'inverted', message: `Its top is not above its bottom (it rises ${mm(rise)}).`, value: rise, limit: 0 });
  const along = direction(c.direction);
  const inclined = rise > 0 ? rise / Math.tan(ESCALATOR_ANGLE) : 0;
  const run = inclined + 2 * ESCALATOR_LANDING;
  const side = scale(perp(along), c.width / 2);
  const steps: [Vec2, Vec2][] = [];
  for (let d = ESCALATOR_LANDING; d <= ESCALATOR_LANDING + inclined + 1e-6; d += ESCALATOR_STEP) {
    const p = add(c.at, scale(along, d));
    steps.push([sub(p, side), add(p, side)]);
  }
  return { kind: 'escalator', id: c.id, bottom, top, rise, footprint: [rect(c.at, along, run, c.width)], broken, run, foot: c.at, head: add(c.at, scale(along, run)), steps };
}

function deriveElevator(c: Extract<Connector, { kind: 'elevator' }>, levels: ReadonlyMap<string, DerivedLevel>): ElevatorGeometry {
  const ux = direction(c.rotation);
  const uy = perp(ux);
  const box = (w: number, d: number): Polygon => [
    add(add(c.at, scale(ux, -w / 2)), scale(uy, -d / 2)),
    add(add(c.at, scale(ux, w / 2)), scale(uy, -d / 2)),
    add(add(c.at, scale(ux, w / 2)), scale(uy, d / 2)),
    add(add(c.at, scale(ux, -w / 2)), scale(uy, d / 2)),
  ];
  const shaft = box(c.shaft.w, c.shaft.d);
  const car = box(c.car.w, c.car.d);
  const doorOf = (side: ElevatorStop['side']): [Vec2, Vec2] => {
    const across = side === 'front' || side === 'back';
    const normal = side === 'front' ? scale(uy, -1) : side === 'back' ? uy : side === 'left' ? scale(ux, -1) : ux;
    const along = across ? ux : uy;
    const centre = add(c.at, scale(normal, (across ? c.shaft.d : c.shaft.w) / 2));
    const half = (Math.min(across ? c.car.w : c.car.d, across ? c.shaft.w : c.shaft.d) * 0.8) / 2;
    return [sub(centre, scale(along, half)), add(centre, scale(along, half))];
  };
  const broken: RuleBreak[] = [];
  const stops: ElevatorStop[] = [];
  for (const s of c.stops) {
    const level = levels.get(s.levelId);
    if (!level) continue;
    if (level.placement !== 'stack') broken.push({ rule: 'stop-off-stack', message: `It stops at "${level.name}", a mezzanine that is not on the level stack.` });
    stops.push({ levelId: s.levelId, elevation: level.elevation, side: s.door, door: doorOf(s.door) });
  }
  stops.sort((a, b) => a.elevation - b.elevation);
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i].elevation - stops[i - 1].elevation) < 1) broken.push({ rule: 'stops-same-elevation', message: `Two of its stops are at the same elevation (${mm(stops[i].elevation)}).`, value: stops[i].elevation });
  }
  if (c.car.w > c.shaft.w || c.car.d > c.shaft.d) broken.push({ rule: 'car-too-big', message: `Its car (${mm(c.car.w)} × ${mm(c.car.d)}) does not fit its shaft (${mm(c.shaft.w)} × ${mm(c.shaft.d)}).` });
  const bottom = stops.length ? stops[0].elevation : NaN;
  const top = stops.length ? stops[stops.length - 1].elevation : NaN;
  return { kind: 'elevator', id: c.id, bottom, top, rise: top - bottom, footprint: [shaft], broken, shaft, car, stops };
}

// ---------- the whole building ----------

/** A connector's geometry against the levels' current elevations. */
export function deriveConnector(connector: Connector, levels: readonly DerivedLevel[] | ReadonlyMap<string, DerivedLevel>, limits: RuleLimits): ConnectorGeometry {
  const byId = levels instanceof Map ? levels : indexLevels(levels as readonly DerivedLevel[]);
  if (connector.kind === 'elevator') return deriveElevator(connector, byId);
  const bottom = refElevation(byId, connector.bottom);
  const top = refElevation(byId, connector.top);
  switch (connector.kind) {
    case 'stair':
      return deriveStair(connector, bottom, top, limits);
    case 'ramp':
      return deriveRamp(connector, bottom, top);
    case 'ladder':
      return deriveLadder(connector, bottom, top);
    case 'escalator':
      return deriveEscalator(connector, bottom, top);
  }
}

export type ConnectorRole = 'bottom' | 'top' | 'stop' | 'crosses';

/** How a connector shows on a level: where it starts, ends or stops (drawn in full), or a level it only passes (drawn faintly). Null when it does not reach the level. */
export function connectorRole(connector: Connector, level: DerivedLevel, levels: readonly DerivedLevel[] | ReadonlyMap<string, DerivedLevel>): ConnectorRole | null {
  const { bottom, top } = connectorRange(connector, levels);
  if (connector.kind === 'elevator') {
    if (connector.stops.some((s) => s.levelId === level.id)) return 'stop';
    return level.elevation > bottom && level.elevation < top ? 'crosses' : null;
  }
  if (connector.bottom.levelId === level.id) return 'bottom';
  if (connector.top.levelId === level.id) return 'top';
  return level.elevation > bottom && level.elevation < top ? 'crosses' : null;
}

/** Whether a connector cuts the slab of a level: every level whose floor lies above its bottom and up to its top. */
export function connectorCutsLevel(connector: Connector, level: DerivedLevel, levels: readonly DerivedLevel[] | ReadonlyMap<string, DerivedLevel>): boolean {
  const { bottom, top } = connectorRange(connector, levels);
  return level.elevation > bottom + 0.5 && level.elevation <= top + 0.5;
}

/** The connectors on a level, with how they show there. */
export function connectorsOnLevel(doc: Pick<ProjectDoc, 'building' | 'levels' | 'connectors'>, levelId: string, levels: readonly DerivedLevel[] = deriveLevels(doc)): { connector: Connector; role: ConnectorRole }[] {
  const byId = indexLevels(levels);
  const level = byId.get(levelId);
  if (!level) return [];
  const out: { connector: Connector; role: ConnectorRole }[] = [];
  for (const connector of Object.values(doc.connectors)) {
    const role = connectorRole(connector, level, byId);
    if (role) out.push({ connector, role });
  }
  return out;
}

/** What the connectors cut out of a level's slab: the footprints of every connector that passes through its floor. */
export function connectorCuts(doc: Pick<ProjectDoc, 'building' | 'levels' | 'connectors'>, levelId: string, limits: RuleLimits, levels: readonly DerivedLevel[] = deriveLevels(doc)): Polygon[] {
  const byId = indexLevels(levels);
  const level = byId.get(levelId);
  if (!level) return [];
  const cuts: Polygon[] = [];
  for (const connector of Object.values(doc.connectors)) if (connectorCutsLevel(connector, level, byId)) cuts.push(...deriveConnector(connector, byId, limits).footprint);
  return cuts;
}

/** The ids of the levels a connector cuts, bottom to top. */
export function connectorCutLevels(connector: Connector, levels: readonly DerivedLevel[]): string[] {
  const byId = indexLevels(levels);
  return levels.filter((l) => connectorCutsLevel(connector, l, byId)).map((l) => l.id);
}
