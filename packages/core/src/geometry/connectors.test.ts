import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import type { DerivedLevel } from '../doc/derive';
import type { Connector } from '../doc/schema';
import { connectorCutsLevel, connectorRole, deriveConnector, type ElevatorGeometry, type EscalatorGeometry, type LadderGeometry, type RampGeometry, type StairGeometry } from './connectors';
import { bulgeOf, type Path } from './path';
import { polygonArea } from './polygon';
import { distance, type Vec2 } from './vec';

const level = (id: string, elevation: number, height = 3000, placement: 'stack' | 'offset' = 'stack'): DerivedLevel => ({
  id,
  name: id,
  elevation,
  height,
  top: elevation + height,
  slabThickness: 200,
  placement,
  isGround: elevation === 0 && placement === 'stack',
  isBasement: elevation < 0,
  stackIndex: 0,
});
const G = level('G', 0);
const L1 = level('L1', 3000);
const L2 = level('L2', 6000);
const levels = [G, L1, L2];

const line = (...points: Vec2[]): Path => ({ closed: false, v: points.map((p) => ({ p })) });
type StairInput = Partial<Extract<Connector, { kind: 'stair' }>>;
const stair = (axis: Path, over: StairInput = {}): Extract<Connector, { kind: 'stair' }> => ({
  id: 'str_1',
  kind: 'stair',
  shape: 'straight',
  bottom: { levelId: 'G', offset: 0 },
  top: { levelId: 'L1', offset: 0 },
  axis,
  width: 1000,
  riser: {},
  tread: {},
  handrails: { left: true, right: true },
  ...over,
});
const derive = (c: Connector, on: DerivedLevel[] = levels) => deriveConnector(c, on, DEFAULT_RULE_LIMITS);
const area = (polys: Vec2[][]) => polys.reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0);
const rules = (g: { broken: { rule: string }[] }) => g.broken.map((b) => b.rule).sort();

describe('stairs', () => {
  it('derives a straight flight: 3000 mm over 3750 mm gives 16 risers of 187.5 and treads of 250', () => {
    const g = derive(stair(line([0, 0], [0, 3750]))) as StairGeometry;
    expect(g.rise).toBe(3000);
    expect(g.risers).toBe(16);
    expect(g.riserHeight).toBeCloseTo(187.5, 6);
    expect(g.treadDepth).toBeCloseTo(250, 6);
    expect(g.flights).toEqual([{ from: 0, to: 3750, risers: 16, treads: 15, tread: 250 }]);
    expect(g.treads).toHaveLength(16);
    expect(g.treads[0]).toMatchObject({ along: 0, riser: 1, a: [-500, 0], b: [500, 0] });
    expect(g.treads[15].along).toBeCloseTo(3750, 6);
    expect(g.broken).toEqual([]);
    expect(area(g.footprint)).toBeCloseTo(1000 * 3750, -1);
    expect(g.landings).toEqual([]);
  });

  it('regenerates when a level gets taller, and reports the limits it then breaks', () => {
    const tall = [G, level('L1', 3400), level('L2', 6400)];
    const g = derive(stair(line([0, 0], [0, 3750])), tall) as StairGeometry;
    // 3400 / 190 = 17.9, so 18 risers of 188.9; 17 treads of 3750 / 17 = 220.6.
    expect(g.risers).toBe(18);
    expect(g.riserHeight).toBeCloseTo(3400 / 18, 6);
    expect(g.treadDepth).toBeCloseTo(3750 / 17, 6);
    expect(rules(g)).toEqual(['comfort', 'tread-short']);
    expect(g.broken.find((b) => b.rule === 'tread-short')).toMatchObject({ limit: 250 });
  });

  it('takes a riser count, a riser limit and a tread limit of its own', () => {
    const fixed = derive(stair(line([0, 0], [0, 3750]), { riser: { count: 12 } })) as StairGeometry;
    expect(fixed.riserHeight).toBe(250);
    expect(fixed.treadDepth).toBeCloseTo(3750 / 11, 6);
    expect(rules(fixed)).toEqual(['comfort', 'riser-high']);
    const own = derive(stair(line([0, 0], [0, 3750]), { riser: { maxHeight: 200 }, tread: { minDepth: 260 } })) as StairGeometry;
    // 3000 / 200 = 15 risers of 200; 14 treads of 267.9; 2R + T = 667.9.
    expect(own.risers).toBe(15);
    expect(rules(own)).toEqual(['comfort']);
    const narrow = derive(stair(line([0, 0], [0, 3750]), { width: 700 })) as StairGeometry;
    expect(rules(narrow)).toEqual(['too-narrow']);
  });

  it('puts handrails 50 mm inside each side it asks for', () => {
    const g = derive(stair(line([0, 0], [0, 3750]), { handrails: { left: true, right: false } })) as StairGeometry;
    expect(g.handrails).toHaveLength(1);
    expect(g.handrails[0].v.map((v) => v.p)).toEqual([
      [-450, 0],
      [-450, 3750],
    ]);
  });

  it('gives an L stair a square landing at its corner and shares the risers between the flights', () => {
    const g = derive(stair(line([0, 0], [0, 2250], [2250, 2250]), { shape: 'l' })) as StairGeometry;
    // Walk line 4500, landing 1000 at the corner: two flights of 1750; 16 risers, 14 treads, 7 each of 250.
    expect(g.flights.map((f) => [f.from, f.to, f.risers, f.treads])).toEqual([
      [0, 1750, 8, 7],
      [2750, 4500, 8, 7],
    ]);
    expect(g.treadDepth).toBeCloseTo(250, 6);
    expect(g.landings).toHaveLength(1);
    expect(g.landings[0]).toMatchObject({ from: 1750, to: 2750, height: 1500 });
    expect(area(g.landings[0].polygons)).toBeCloseTo(1000 * 1000, -1);
    expect(g.treads).toHaveLength(16);
    expect(g.broken).toEqual([]);
    expect(area(g.footprint)).toBeCloseTo(1000 * 2750 + 1000 * 1750, -1);
  });

  it('gives a U stair one half-landing across both corners', () => {
    const g = derive(stair(line([0, 0], [0, 2250], [1000, 2250], [1000, 0]), { shape: 'u' })) as StairGeometry;
    expect(g.flights.map((f) => [f.from, f.to, f.risers])).toEqual([
      [0, 1750, 8],
      [3750, 5500, 8],
    ]);
    expect(g.landings).toHaveLength(1);
    expect(area(g.landings[0].polygons)).toBeCloseTo(2000 * 1000, -1);
    expect(g.broken).toEqual([]);
  });

  it('winds a winder stair around its corner: the treads near it fan from the inside corner', () => {
    const g = derive(stair(line([0, 0], [0, 2500], [2500, 2500]), { shape: 'winder' })) as StairGeometry;
    // One flight of 5000 with 15 treads of 333.3.
    expect(g.flights).toHaveLength(1);
    expect(g.treadDepth).toBeCloseTo(5000 / 15, 6);
    expect(g.landings).toEqual([]);
    // A right turn: the inside is the right side, whose corner is at (500, 2000).
    const fanned = g.treads.filter((t) => Math.abs(t.along - 2500) < 500);
    expect(fanned.length).toBeGreaterThanOrEqual(2);
    for (const t of fanned) expect(Math.min(distance(t.a, [500, 2000]), distance(t.b, [500, 2000]))).toBeLessThan(1e-6);
    // Away from the corner they are straight across.
    expect(g.treads[0]).toMatchObject({ a: [-500, 0], b: [500, 0] });
  });

  it('draws spiral and curved stairs with radial treads measured on the walk line', () => {
    const half: Path = { closed: false, v: [{ p: [1000, 0], s: { k: 'arc', bulge: bulgeOf(Math.PI) } }, { p: [-1000, 0] }] };
    const g = derive(stair(half, { shape: 'spiral' })) as StairGeometry;
    expect(g.walkLength).toBeCloseTo(Math.PI * 1000, 3);
    expect(g.treadDepth).toBeCloseTo((Math.PI * 1000) / 15, 3);
    for (const t of g.treads) {
      // Counter-clockwise, so the left end is the inner one.
      expect(Math.hypot(...t.a)).toBeCloseTo(500, 3);
      expect(Math.hypot(...t.b)).toBeCloseTo(1500, 3);
    }
    // 209.4 mm treads: too shallow, and 2R + T = 584 mm.
    expect(rules(g)).toEqual(['comfort', 'tread-short']);
    expect(rules(derive(stair(half, { shape: 'straight' })))).toContain('shape-mismatch');
    expect(rules(derive(stair(line([0, 0], [0, 3750]), { shape: 'curved' })))).toEqual(['shape-mismatch']);
  });

  it('finds the plan cut: the riser 1200 mm above the floor', () => {
    const g = derive(stair(line([0, 0], [0, 3750]))) as StairGeometry;
    // 1200 / 187.5 = 6.4, so the cut falls at the 7th riser line.
    expect(g.cutAlong).toBeCloseTo(6 * 250, 6);
  });

  it('reports a walk line that crosses itself, a mislabelled shape and a stair turned upside down', () => {
    const crossing = derive(stair(line([0, 0], [0, 3000], [1500, 1500], [-1500, 1500]), { shape: 'winder' }));
    expect(rules(crossing)).toContain('self-intersecting');
    expect(rules(derive(stair(line([0, 0], [0, 2000], [2000, 2000]), { shape: 'straight' })))).toContain('shape-mismatch');
    const down = derive(stair(line([0, 0], [0, 3750]), { bottom: { levelId: 'L1', offset: 0 }, top: { levelId: 'G', offset: 0 } }));
    expect(rules(down)).toContain('inverted');
  });
});

describe('ramps, ladders, escalators', () => {
  const ramp = (axis: Path, top = 'L1', over: Partial<Extract<Connector, { kind: 'ramp' }>> = {}): Connector => ({ id: 'rmp_1', kind: 'ramp', bottom: { levelId: 'G', offset: 0 }, top: { levelId: top, offset: 0 }, axis, width: 1500, maxSlope: 8.33, ...over });
  const low = [G, level('R', 1000, 3000)];

  it('works out a ramp slope from its length and rise', () => {
    const g = derive(ramp(line([0, 0], [0, 12000]), 'R'), low) as RampGeometry;
    expect(g.slope).toBeCloseTo((1000 / 12000) * 100, 6);
    expect(g.broken).toEqual([]);
    const steep = derive(ramp(line([0, 0], [0, 10000]), 'R'), low) as RampGeometry;
    expect(steep.slope).toBeCloseTo(10, 6);
    expect(steep.broken).toEqual([{ rule: 'too-steep', message: 'Its slope of 10.0 % is steeper than 8.33 %.', value: 10, limit: 8.33 }]);
  });

  it('leaves the landing at a ramp corner flat', () => {
    const g = derive(ramp(line([0, 0], [0, 6000], [6000, 6000]), 'R', { maxSlope: 10 }), [G, level('R', 900)]) as RampGeometry;
    // 12000 of axis, a 1500 landing: 10500 sloped.
    expect(g.run).toBeCloseTo(10500, 6);
    expect(g.slope).toBeCloseTo((900 / 10500) * 100, 6);
    expect(g.landings).toHaveLength(1);
    expect(g.landings[0].height).toBeCloseTo(900 * (5250 / 10500), 6);
  });

  it('lays a ladder along its direction at its angle', () => {
    const g = derive({ id: 'lad_1', kind: 'ladder', bottom: { levelId: 'G', offset: 0 }, top: { levelId: 'L1', offset: 0 }, at: [0, 0], direction: 90, width: 500, angle: 75 }) as LadderGeometry;
    const run = 3000 / Math.tan((75 * Math.PI) / 180);
    expect(g.run).toBeCloseTo(run, 6);
    expect(g.head[0]).toBeCloseTo(0, 6);
    expect(g.head[1]).toBeCloseTo(run, 6);
    expect(g.rungs).toHaveLength(10);
    expect(area(g.footprint)).toBeCloseTo(500 * run, 0);
  });

  it('gives an escalator a 30° incline and a landing at each end', () => {
    const g = derive({ id: 'esc_1', kind: 'escalator', bottom: { levelId: 'G', offset: 0 }, top: { levelId: 'L1', offset: 0 }, at: [0, 0], direction: 0, width: 1000 }) as EscalatorGeometry;
    expect(g.run).toBeCloseTo(3000 / Math.tan(Math.PI / 6) + 2400, 6);
    expect(g.head[0]).toBeCloseTo(g.run, 6);
    expect(area(g.footprint)).toBeCloseTo(1000 * g.run, 0);
  });
});

describe('elevators', () => {
  const elevator = (stops: { levelId: string; door?: 'front' | 'back' | 'left' | 'right' }[], over: Partial<Extract<Connector, { kind: 'elevator' }>> = {}): Connector => ({
    id: 'elv_1',
    kind: 'elevator',
    at: [0, 0],
    rotation: 0,
    shaft: { w: 2000, d: 2200 },
    car: { w: 1100, d: 1400 },
    stops: stops.map((s) => ({ levelId: s.levelId, door: s.door ?? 'front' })),
    ...over,
  });

  it('orders its stops by elevation and marks each door on its side of the shaft', () => {
    const g = derive(elevator([{ levelId: 'L2', door: 'back' }, { levelId: 'G' }, { levelId: 'L1', door: 'right' }])) as ElevatorGeometry;
    expect(g.stops.map((s) => s.levelId)).toEqual(['G', 'L1', 'L2']);
    expect(g.bottom).toBe(0);
    expect(g.top).toBe(6000);
    expect(g.stops[0].door).toEqual([
      [-440, -1100],
      [440, -1100],
    ]);
    expect(g.stops[1].door.every((p) => p[0] === 1000)).toBe(true);
    expect(g.stops[2].door.every((p) => p[1] === 1100)).toBe(true);
    expect(area([g.shaft])).toBeCloseTo(2000 * 2200, 6);
    expect(g.broken).toEqual([]);
  });

  it('reports stops off the level stack, stops at one elevation and a car that does not fit', () => {
    const mezz = level('M', 1500, 1500, 'offset');
    const same = level('S', 3000, 1500, 'offset');
    const g = derive(elevator([{ levelId: 'G' }, { levelId: 'M' }, { levelId: 'L1' }, { levelId: 'S' }], { car: { w: 2100, d: 1400 } }), [...levels, mezz, same]);
    expect(rules(g)).toEqual(['car-too-big', 'stop-off-stack', 'stop-off-stack', 'stops-same-elevation']);
  });

  it('shows on the levels it stops at, faintly on those it passes, and cuts every slab above its lowest stop', () => {
    const lift = elevator([{ levelId: 'G' }, { levelId: 'L2' }]);
    expect(connectorRole(lift, G, levels)).toBe('stop');
    expect(connectorRole(lift, L1, levels)).toBe('crosses');
    expect(levels.filter((l) => connectorCutsLevel(lift, l, levels)).map((l) => l.id)).toEqual(['L1', 'L2']);
  });
});

describe('levels a stair reaches', () => {
  it('starts on its bottom level, ends on its top, crosses a mezzanine in between and cuts the slabs above its bottom', () => {
    const gallery = level('M', 1500, 1500, 'offset');
    const all = [G, gallery, L1, L2];
    const s = stair(line([0, 0], [0, 3750]));
    expect(all.map((l) => connectorRole(s, l, all))).toEqual(['bottom', 'crosses', 'top', null]);
    expect(all.filter((l) => connectorCutsLevel(s, l, all)).map((l) => l.id)).toEqual(['M', 'L1']);
  });
});
