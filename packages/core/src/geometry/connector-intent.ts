import type { RuleLimits } from '../config';
import { deriveLevels, type DerivedLevel } from '../doc/derive';
import type { Connector, ProjectDoc } from '../doc/schema';
import { StudioError } from '../errors';
import { bulgeOf, type Path, type Vertex } from './path';
import { add, angleOf, cross, distance, normalize, perp, roundMm, scale, sub, type Vec2 } from './vec';

type Stair = Extract<Connector, { kind: 'stair' }>;

/** A stair asked for by where it starts and ends: the axis is laid out from the rise and the limits. */
export interface StairIntent {
  kind: 'stair';
  shape: Stair['shape'];
  /** The start of the walk line (a spiral's centre). */
  from: Vec2;
  /** The end of the walk line (a U's direction, a spiral's first step). */
  to: Vec2;
  bottomLevelId: string;
  topLevelId: string;
  width?: number;
  /** Which way the stair turns: an L's corner, a U's second flight, a curve's or spiral's sense. */
  turn?: 'left' | 'right';
  name?: string;
}

export interface RampIntent {
  kind: 'ramp';
  from: Vec2;
  to: Vec2;
  bottomLevelId: string;
  topLevelId: string;
  width?: number;
  maxSlope?: number;
  name?: string;
}

/** An elevator asked for by its shaft centre and the lowest and highest level it serves: it stops at every stacked level between. */
export interface ElevatorIntent {
  kind: 'elevator';
  at: Vec2;
  fromLevelId: string;
  toLevelId: string;
  shaft?: { w: number; d: number };
  car?: { w: number; d: number };
  rotation?: number;
  door?: 'front' | 'back' | 'left' | 'right';
  name?: string;
}

/** An escalator asked for by its foot, the direction it rises towards and its levels: its run is derived from the rise (30°, with landings). */
export interface EscalatorIntent {
  kind: 'escalator';
  /** The foot: the middle of its bottom edge. */
  at: Vec2;
  /** Degrees counter-clockwise from +x, the way it rises (default 0). */
  direction?: number;
  bottomLevelId: string;
  topLevelId: string;
  width?: number;
  name?: string;
}

export type ConnectorIntent = StairIntent | RampIntent | ElevatorIntent | EscalatorIntent;

/** A connector record without its id, per kind (the `Omit` taken inside the union). */
export type ConnectorRecord = { [K in Connector['kind']]: Omit<Extract<Connector, { kind: K }>, 'id'> }[Connector['kind']];

export const DEFAULT_STAIR_WIDTH = 1000;
export const DEFAULT_RAMP_WIDTH = 1200;
export const DEFAULT_ESCALATOR_WIDTH = 1000;
export const DEFAULT_SHAFT = { w: 2000, d: 2200 };
export const DEFAULT_CAR = { w: 1100, d: 1400 };

/** Whether a connector input is an intent form rather than a full record. */
export function isConnectorIntent(input: { kind: string }): input is ConnectorIntent {
  return 'bottomLevelId' in input || 'fromLevelId' in input;
}

/** The steps a stair of this rise gets from the limits: the riser count, the riser height and a comfortable tread (the middle of the comfort range, never under the minimum). */
export function stairSteps(rise: number, limits: RuleLimits): { risers: number; riserHeight: number; tread: number } {
  const risers = Math.max(2, Math.ceil(Math.max(rise, 0) / limits.maxRiser));
  const riserHeight = rise / risers;
  const tread = Math.max(limits.minTread, roundMm((limits.comfortMin + limits.comfortMax) / 2 - 2 * riserHeight));
  return { risers, riserHeight, tread };
}

const open = (v: Vertex[]): Path => ({ closed: false, v });
const round = (p: Vec2): Vec2 => [roundMm(p[0]), roundMm(p[1])];

/**
 * Lays out a stair's walk line from its start and end for a shape:
 * - straight: from → to;
 * - l and winder: a corner at the right angle on the turn's side, the flights along the axes;
 * - u: two parallel flights `width` apart from `from` towards `to`, each as long as its share of the treads needs;
 * - curved: a quarter-circle arc from → to turning to the side asked;
 * - spiral: `from` is the centre and `to` the first step; the sweep is what the treads need at the walk line, in arcs of at most 180°.
 * Null when the points allow no such stair (an L with its end on an axis of its start, a spiral without a radius).
 */
export function stairAxisFrom(form: Pick<StairIntent, 'shape' | 'from' | 'to' | 'width' | 'turn'>, rise: number, limits: RuleLimits): Path | null {
  const { from, to } = form;
  const width = form.width ?? DEFAULT_STAIR_WIDTH;
  const left = (form.turn ?? 'left') === 'left';
  switch (form.shape) {
    case 'straight':
      return distance(from, to) < 1 ? null : open([{ p: from }, { p: to }]);
    case 'l':
    case 'winder': {
      if (Math.abs(to[0] - from[0]) < 1 || Math.abs(to[1] - from[1]) < 1) return null;
      const a: Vec2 = [to[0], from[1]];
      const b: Vec2 = [from[0], to[1]];
      const turnsLeft = (corner: Vec2) => cross(sub(corner, from), sub(to, corner)) > 0;
      return open([{ p: from }, { p: turnsLeft(a) === left ? a : b }, { p: to }]);
    }
    case 'u': {
      const d = distance(from, to) < 1 ? ([1, 0] as Vec2) : normalize(sub(to, from));
      const across = scale(perp(d), left ? 1 : -1);
      const { risers, tread } = stairSteps(rise, limits);
      const first = Math.ceil(risers / 2);
      const second = risers - first;
      // A flight of n risers has n − 1 treads; the half-landing takes width/2 of the axis on each side of its corners.
      const c1 = add(from, scale(d, (first - 1) * tread + width / 2));
      const c2 = add(c1, scale(across, width));
      const end = add(c2, scale(d, -((second - 1) * tread + width / 2)));
      return open([{ p: from }, { p: round(c1) }, { p: round(c2) }, { p: round(end) }]);
    }
    case 'curved':
      return distance(from, to) < 1 ? null : open([{ p: from, s: { k: 'arc', bulge: (left ? 1 : -1) * bulgeOf(Math.PI / 2) } }, { p: to }]);
    case 'spiral': {
      const r = distance(from, to);
      if (r < 1) return null;
      const { risers, tread } = stairSteps(rise, limits);
      const sweep = (((risers - 1) * tread) / r) * (left ? 1 : -1);
      const parts = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI));
      const each = sweep / parts;
      const start = angleOf(sub(to, from));
      const v: Vertex[] = [];
      for (let i = 0; i <= parts; i++) {
        const angle = start + each * i;
        const p = round(add(from, [r * Math.cos(angle), r * Math.sin(angle)]));
        v.push(i < parts ? { p, s: { k: 'arc', bulge: bulgeOf(each) } } : { p });
      }
      return open(v);
    }
  }
}

const levelOf = (levels: DerivedLevel[], id: string, what: string): DerivedLevel => levels.find((l) => l.id === id) ?? fail(`No level ${id} for the ${what}`);
const fail = (message: string): never => {
  throw new StudioError('INVALID_INPUT', message);
};

/** The full record an intent stands for, laid out against the levels of the document and the rule limits. */
export function connectorFromIntent(intent: ConnectorIntent, doc: Pick<ProjectDoc, 'building' | 'levels'>, limits: RuleLimits): ConnectorRecord {
  const levels = deriveLevels(doc);
  const name = intent.name !== undefined ? { name: intent.name } : {};
  switch (intent.kind) {
    case 'stair': {
      const bottom = levelOf(levels, intent.bottomLevelId, 'bottom of the stair');
      const top = levelOf(levels, intent.topLevelId, 'top of the stair');
      const axis = stairAxisFrom(intent, top.elevation - bottom.elevation, limits) ?? fail(intent.shape === 'spiral' ? 'A spiral stair needs its first step away from its centre' : intent.shape === 'l' || intent.shape === 'winder' ? 'An L stair needs its end off both axes through its start' : 'A stair needs two different points');
      return { ...name, kind: 'stair', shape: intent.shape, bottom: { levelId: bottom.id, offset: 0 }, top: { levelId: top.id, offset: 0 }, axis, width: intent.width ?? DEFAULT_STAIR_WIDTH, riser: {}, tread: {}, handrails: { left: true, right: true } };
    }
    case 'ramp': {
      const bottom = levelOf(levels, intent.bottomLevelId, 'bottom of the ramp');
      const top = levelOf(levels, intent.topLevelId, 'top of the ramp');
      if (distance(intent.from, intent.to) < 1) fail('A ramp needs two different points');
      return { ...name, kind: 'ramp', bottom: { levelId: bottom.id, offset: 0 }, top: { levelId: top.id, offset: 0 }, axis: open([{ p: intent.from }, { p: intent.to }]), width: intent.width ?? DEFAULT_RAMP_WIDTH, maxSlope: intent.maxSlope ?? limits.maxRampSlope };
    }
    case 'elevator': {
      const from = levelOf(levels, intent.fromLevelId, 'lowest stop');
      const to = levelOf(levels, intent.toLevelId, 'highest stop');
      const [low, high] = from.elevation <= to.elevation ? [from.elevation, to.elevation] : [to.elevation, from.elevation];
      const stops = doc.building.stack.map((id) => levels.find((l) => l.id === id)!).filter((l) => l && l.elevation >= low && l.elevation <= high);
      if (stops.length < 2) fail('An elevator needs two stacked levels to stop at');
      return { ...name, kind: 'elevator', at: intent.at, rotation: intent.rotation ?? 0, shaft: intent.shaft ?? { ...DEFAULT_SHAFT }, car: intent.car ?? { ...DEFAULT_CAR }, stops: stops.map((l) => ({ levelId: l.id, door: intent.door ?? 'front' })) };
    }
    case 'escalator': {
      const bottom = levelOf(levels, intent.bottomLevelId, 'bottom of the escalator');
      const top = levelOf(levels, intent.topLevelId, 'top of the escalator');
      if (top.elevation <= bottom.elevation) fail('An escalator needs its top level above its bottom level');
      return { ...name, kind: 'escalator', bottom: { levelId: bottom.id, offset: 0 }, top: { levelId: top.id, offset: 0 }, at: intent.at, direction: intent.direction ?? 0, width: intent.width ?? DEFAULT_ESCALATOR_WIDTH };
    }
  }
}
