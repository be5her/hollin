import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import type { Connector, ProjectDoc } from '../doc/schema';
import { deriveLevels } from '../doc/derive';
import { connectorFromIntent, stairAxisFrom, stairSteps } from './connector-intent';
import { deriveConnector, type StairGeometry } from './connectors';
import { arcGeometry, resolvePath, segmentTangent } from './path';
import { cross, distance, dot, sub, type Vec2 } from './vec';

const limits = DEFAULT_RULE_LIMITS;
const ground = 'lvl_0000000000000001';
const upper = 'lvl_0000000000000002';
const attic = 'lvl_0000000000000003';
const mezz = 'lvl_0000000000000004';
const building: Pick<ProjectDoc, 'building' | 'levels'> = {
  building: { datum: 0, groundLevelId: ground, stack: [ground, upper, attic] },
  levels: {
    [ground]: { id: ground, name: 'Ground', place: { k: 'stack', height: 3000 }, slabThickness: 200 },
    [upper]: { id: upper, name: 'Upper', place: { k: 'stack', height: 3000 }, slabThickness: 200 },
    [attic]: { id: attic, name: 'Attic', place: { k: 'stack', height: 2600 }, slabThickness: 200 },
    [mezz]: { id: mezz, name: 'Mezzanine', place: { k: 'offset', hostLevelId: ground, offset: 1500, height: 1500 }, slabThickness: 150 },
  },
} as unknown as Pick<ProjectDoc, 'building' | 'levels'>;

/** The stair an axis makes between the ground and the upper floor, derived. */
const derive = (shape: Extract<Connector, { kind: 'stair' }>['shape'], axis: NonNullable<ReturnType<typeof stairAxisFrom>>, width = 1000) =>
  deriveConnector({ id: 'str_0000000000000001', kind: 'stair', shape, bottom: { levelId: ground, offset: 0 }, top: { levelId: upper, offset: 0 }, axis, width, riser: {}, tread: {}, handrails: { left: true, right: true } }, deriveLevels(building), limits) as StairGeometry;

describe('stairSteps', () => {
  it('counts the risers from the limit and picks a comfortable tread, never under the minimum', () => {
    expect(stairSteps(3000, limits)).toEqual({ risers: 16, riserHeight: 187.5, tread: 250 });
    expect(stairSteps(2600, limits).risers).toBe(14);
    expect(stairSteps(2600, limits).tread).toBeCloseTo(625 - 2 * (2600 / 14), 2);
    expect(stairSteps(1500, limits)).toEqual({ risers: 8, riserHeight: 187.5, tread: 250 });
    expect(stairSteps(0, limits).risers).toBe(2);
  });
});

describe('stairAxisFrom', () => {
  it('runs a straight stair from one point to the other', () => {
    const axis = stairAxisFrom({ shape: 'straight', from: [0, 0], to: [0, 3750] }, 3000, limits)!;
    expect(axis.v.map((v) => v.p)).toEqual([[0, 0], [0, 3750]]);
    expect(derive('straight', axis).broken).toEqual([]);
    expect(stairAxisFrom({ shape: 'straight', from: [0, 0], to: [0, 0] }, 3000, limits)).toBeNull();
  });

  it('puts the corner of an L (and a winder) at the right angle on the side of the turn', () => {
    const left = stairAxisFrom({ shape: 'l', from: [0, 0], to: [3000, 2000], turn: 'left' }, 3000, limits)!;
    const right = stairAxisFrom({ shape: 'l', from: [0, 0], to: [3000, 2000], turn: 'right' }, 3000, limits)!;
    expect(left.v.map((v) => v.p)).toEqual([[0, 0], [3000, 0], [3000, 2000]]);
    expect(right.v.map((v) => v.p)).toEqual([[0, 0], [0, 2000], [3000, 2000]]);
    const turn = (axis: typeof left) => cross(sub(axis.v[1].p, axis.v[0].p), sub(axis.v[2].p, axis.v[1].p));
    expect(turn(left)).toBeGreaterThan(0);
    expect(turn(right)).toBeLessThan(0);
    expect(derive('l', left).broken.map((b) => b.rule)).not.toContain('shape');
    expect(stairAxisFrom({ shape: 'winder', from: [0, 0], to: [-2000, 2500], turn: 'left' }, 3000, limits)!.v[1].p).toEqual([0, 2500]);
    expect(stairAxisFrom({ shape: 'l', from: [0, 0], to: [3000, 0] }, 3000, limits)).toBeNull();
  });

  it('lays a U out as two parallel flights a width apart, as long as their treads need', () => {
    const axis = stairAxisFrom({ shape: 'u', from: [0, 0], to: [0, 5000], width: 1200, turn: 'left' }, 3000, limits)!;
    const p = axis.v.map((v) => v.p);
    expect(p.length).toBe(4);
    // 16 risers: 8 per flight, 7 treads of 250 each plus half the landing.
    expect(p[1]).toEqual([0, 1750 + 600]);
    expect(p[2]).toEqual([-1200, 2350]);
    expect(p[3]).toEqual([-1200, 0]);
    const g = derive('u', axis, 1200);
    expect(g.broken).toEqual([]);
    expect(g.flights.length).toBe(2);
    expect(g.landings.length).toBe(1);
    expect(stairAxisFrom({ shape: 'u', from: [0, 0], to: [0, 5000], width: 1200, turn: 'right' }, 3000, limits)!.v[2].p).toEqual([1200, 2350]);
  });

  it('curves a quarter circle to the side of the turn', () => {
    const left = stairAxisFrom({ shape: 'curved', from: [0, 0], to: [3000, 3000], turn: 'left' }, 3000, limits)!;
    const seg = resolvePath(left).segs[0];
    expect(seg.k).toBe('arc');
    if (seg.k !== 'arc') return;
    expect(Math.abs(arcGeometry(seg.a, seg.b, seg.bulge).sweep)).toBeCloseTo(Math.PI / 2, 9);
    // Turning left: the direction of travel rotates counter-clockwise from the start to the end.
    expect(cross(segmentTangent(seg, 0), segmentTangent(seg, 1))).toBeGreaterThan(0);
    const right = resolvePath(stairAxisFrom({ shape: 'curved', from: [0, 0], to: [3000, 3000], turn: 'right' }, 3000, limits)!).segs[0];
    if (right.k === 'arc') expect(cross(segmentTangent(right, 0), segmentTangent(right, 1))).toBeLessThan(0);
    expect(derive('curved', left).broken.map((b) => b.rule)).not.toContain('shape');
  });

  it('sweeps a spiral around its centre as far as the treads need, in arcs of at most 180°', () => {
    const axis = stairAxisFrom({ shape: 'spiral', from: [0, 0], to: [900, 0], turn: 'left' }, 3000, limits)!;
    const segs = resolvePath(axis).segs;
    // 15 treads of 250 mm at the walk line of radius 900: a sweep of 3750 / 900 rad (about 239°), in two arcs.
    expect(segs.length).toBe(2);
    for (const s of segs) {
      expect(s.k).toBe('arc');
      if (s.k === 'arc') {
        const g = arcGeometry(s.a, s.b, s.bulge);
        expect(g.radius).toBeCloseTo(900, 3);
        expect(Math.abs(g.sweep)).toBeLessThanOrEqual(Math.PI + 1e-9);
        expect(g.sweep).toBeGreaterThan(0);
      }
    }
    const walk = derive('spiral', axis, 800);
    expect(walk.walkLength).toBeCloseTo(3750, 0);
    expect(walk.broken.map((b) => b.rule)).not.toContain('shape');
    expect(stairAxisFrom({ shape: 'spiral', from: [0, 0], to: [0, 0] }, 3000, limits)).toBeNull();
  });
});

describe('connectorFromIntent', () => {
  it('lays out a stair between two levels with the default width', () => {
    const stair = connectorFromIntent({ kind: 'stair', shape: 'l', from: [0, 0], to: [3000, 2000], bottomLevelId: ground, topLevelId: upper, turn: 'right' }, building, limits);
    expect(stair).toMatchObject({ kind: 'stair', shape: 'l', bottom: { levelId: ground, offset: 0 }, top: { levelId: upper, offset: 0 }, width: 1000 });
    expect((stair as unknown as { axis: { v: { p: Vec2 }[] } }).axis.v.map((v) => v.p)).toEqual([[0, 0], [0, 2000], [3000, 2000]]);
    // A mezzanine is a level too: a stair from the ground to it rises 1500.
    const short = connectorFromIntent({ kind: 'stair', shape: 'u', from: [0, 0], to: [0, 3000], bottomLevelId: ground, topLevelId: mezz, width: 1000 }, building, limits) as unknown as { axis: { v: { p: Vec2 }[] } };
    expect(distance(short.axis.v[0].p, short.axis.v[1].p)).toBe(3 * 250 + 500);
    expect(() => connectorFromIntent({ kind: 'stair', shape: 'l', from: [0, 0], to: [3000, 0], bottomLevelId: ground, topLevelId: upper }, building, limits)).toThrow(/L stair/);
    expect(() => connectorFromIntent({ kind: 'stair', shape: 'straight', from: [0, 0], to: [3000, 0], bottomLevelId: ground, topLevelId: 'lvl_0000000000000009' }, building, limits)).toThrow(/No level/);
  });

  it('runs a ramp between its points and gives an elevator a stop at every stacked level in its range', () => {
    expect(connectorFromIntent({ kind: 'ramp', from: [0, 0], to: [12000, 0], bottomLevelId: ground, topLevelId: mezz, name: 'Ramp' }, building, limits)).toMatchObject({ kind: 'ramp', name: 'Ramp', width: 1200, maxSlope: 8.33, axis: { v: [{ p: [0, 0] }, { p: [12000, 0] }] } });
    const lift = connectorFromIntent({ kind: 'elevator', at: [5000, 5000], fromLevelId: attic, toLevelId: ground, door: 'back' }, building, limits);
    expect(lift).toMatchObject({ kind: 'elevator', at: [5000, 5000], rotation: 0, shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 } });
    expect((lift as unknown as { stops: { levelId: string; door: string }[] }).stops).toEqual([{ levelId: ground, door: 'back' }, { levelId: upper, door: 'back' }, { levelId: attic, door: 'back' }]);
    // The mezzanine is not in the stack, so it is not a stop; a range of one level is refused.
    expect(() => connectorFromIntent({ kind: 'elevator', at: [0, 0], fromLevelId: ground, toLevelId: ground }, building, limits)).toThrow(/two stacked levels/);
    expect(dot([1, 0], [1, 0])).toBe(1);
  });
});
