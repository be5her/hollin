import { describe, expect, it } from 'vitest';
import { rectPath, type Path } from './path';
import { polygonArea, polygonContains, type Polygon } from './polygon';
import { joinWalls, junctionNodes, junctionPatches, wallBody, wallEnds, type WallLike } from './walls';
import { deriveWalls, type Wall } from './level-geometry';

const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });
const wall = (id: string, path: Path, thickness = 200, alignment: WallLike['alignment'] = 'center'): Wall => ({ id, type: 'wall', levelId: 'lvl_0000000000000001', layerId: 'lyr_0000000000000001', path, thickness, height: null, alignment, baseOffset: 0 });
const area = (polys: readonly Polygon[]) => polys.reduce((sum, p) => sum + polygonArea(p), 0);
const contains = (polys: readonly Polygon[], p: [number, number]) => polys.filter((poly) => polygonContains(poly, p)).length % 2 === 1;

describe('wall bodies', () => {
  it('is the strip between the faces, on the side the alignment says', () => {
    const centred = wallBody(wall('a', line([0, 0], [5000, 0])));
    expect(centred.exact).toBe(true);
    expect(area(centred.polygons)).toBeCloseTo(5000 * 200, 6);
    expect(contains(centred.polygons, [2500, 50])).toBe(true);
    expect(contains(centred.polygons, [2500, -50])).toBe(true);
    const left = wallBody(wall('a', line([0, 0], [5000, 0]), 200, 'left'));
    expect(contains(left.polygons, [2500, 150])).toBe(true);
    expect(contains(left.polygons, [2500, -50])).toBe(false);
    const right = wallBody(wall('a', line([0, 0], [5000, 0]), 200, 'right'));
    expect(contains(right.polygons, [2500, -150])).toBe(true);
    expect(contains(right.polygons, [2500, 50])).toBe(false);
  });

  it('is a ring for a closed wall and an exact arc strip for a curved one', () => {
    const ring = wallBody(wall('r', rectPath(0, 0, 9000, 6000), 250));
    expect(ring.polygons.length).toBe(2);
    expect(area(ring.polygons)).toBeCloseTo(9250 * 6250 - 8750 * 5750, 3);
    const quarter: Path = { closed: false, v: [{ p: [3000, 0], s: { k: 'arc', bulge: Math.tan(Math.PI / 8) } }, { p: [0, 3000] }] };
    const curved = wallBody(wall('c', quarter));
    expect(curved.exact).toBe(true);
    const expected = ((Math.PI / 2) * (3100 * 3100 - 2900 * 2900)) / 2;
    expect(Math.abs(area(curved.polygons) - expected) / expected).toBeLessThan(0.001);
  });

  it('falls back to a flattened offset for a Bézier wall', () => {
    const bezier: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'cubic', c1: [1000, 1000], c2: [-1000, 1000] } }, { p: [5000, 0] }] };
    const body = wallBody(wall('b', bezier));
    expect(body.exact).toBe(false);
    expect(body.polygons.length).toBe(1);
    expect(area(body.polygons)).toBeGreaterThan(5000 * 200);
  });
});

describe('junctions', () => {
  it('fills the outer corner of an L to its miter', () => {
    const a = wall('a', line([0, 0], [5000, 0]));
    const b = wall('b', line([5000, 0], [5000, 4000]));
    const { joined, patches, nodes } = deriveWalls([a, b]);
    expect(nodes.length).toBe(1);
    expect(patches.length).toBe(1);
    expect(joined.length).toBe(1);
    expect(area(joined)).toBeCloseTo(1_800_000, 0);
    expect(contains(joined, [5050, -50])).toBe(true);
    // Without the patch the notch stays open.
    expect(area(joinWalls([wallBody(a).polygons, wallBody(b).polygons], []))).toBeCloseTo(1_790_000, 0);
  });

  it('needs no patch at T and X junctions', () => {
    const a = wall('a', line([0, 0], [5000, 0]));
    const t = deriveWalls([a, wall('b', line([2500, 0], [2500, 3000]))]);
    expect(t.patches.length).toBe(0);
    expect(area(t.joined)).toBeCloseTo(1_000_000 + 600_000 - 20_000, 0);
    const x = deriveWalls([a, wall('c', line([2500, -2000], [2500, 2000]))]);
    expect(x.nodes.length).toBe(0);
    expect(x.joined.length).toBe(1);
    expect(area(x.joined)).toBeCloseTo(1_000_000 + 800_000 - 40_000, 0);
  });

  it('joins any angle and thickness mix, and bevels a hairpin', () => {
    const thick = wall('a', line([0, 0], [5000, 0]), 300);
    const thin = wall('b', line([5000, 0], [5000, 4000]), 150);
    const mixed = deriveWalls([thick, thin]);
    expect(mixed.joined.length).toBe(1);
    expect(contains(mixed.joined, [5050, -100])).toBe(true);
    const obtuse = deriveWalls([wall('a', line([0, 0], [5000, 0])), wall('b', line([5000, 0], [9000, 3000]))]);
    expect(obtuse.joined.length).toBe(1);
    // The outer miter point of a 143° corner lies past the node on the bisector.
    const u = [4000, 3000].map((v) => v / 5000);
    const outer: [number, number] = [5000 + ((100 * (1 - u[1])) / u[0]) * 0.5, -100];
    expect(contains(obtuse.joined, outer)).toBe(true);
    const hairpin = deriveWalls([wall('a', line([0, 0], [5000, 0])), wall('b', line([5000, 0], [0, 600]))]);
    expect(hairpin.joined.length).toBe(1);
    expect(hairpin.patches.length).toBe(1);
    // Bevelled: nothing sticks out far beyond the node.
    expect(contains(hairpin.joined, [5600, 0])).toBe(false);
  });

  it('joins left- and right-aligned walls and arc walls at their ends', () => {
    const a = wall('a', line([0, 0], [5000, 0]), 200, 'left');
    const b = wall('b', line([5000, 0], [5000, 4000]), 200, 'left');
    const corner = deriveWalls([a, b]);
    expect(corner.joined.length).toBe(1);
    expect(area(corner.joined)).toBeCloseTo(5000 * 200 + 4000 * 200 - 200 * 200, 0);
    const arc: Path = { closed: false, v: [{ p: [5000, 0], s: { k: 'arc', bulge: Math.tan(Math.PI / 8) } }, { p: [8000, 3000] }] };
    const curved = deriveWalls([wall('a', line([0, 0], [5000, 0])), wall('c', arc)]);
    expect(curved.joined.length).toBe(1);
    expect(curved.patches.length).toBe(1);
  });

  it('clusters ends that meet within a millimetre', () => {
    const ends = wallEnds([wall('a', line([0, 0], [5000, 0])), wall('b', line([5000.4, 0.3], [5000, 4000])), wall('c', line([5003, 0], [9000, 0]))]);
    const nodes = junctionNodes(ends);
    expect(nodes.length).toBe(1);
    expect(nodes[0].map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(junctionPatches(nodes, new Map([['a', wall('a', line([0, 0], [5000, 0]))]])).length).toBe(0);
  });

  it('leaves excluded walls out of the drawing but keeps the rest', () => {
    const a = wall('a', line([0, 0], [5000, 0]));
    const b = wall('b', line([5000, 0], [5000, 4000]));
    const { joined, patches } = deriveWalls([a, b], { exclude: new Set(['b']) });
    expect(patches.length).toBe(0);
    expect(area(joined)).toBeCloseTo(1_000_000, 0);
  });
});

describe('openings in the drawn walls', () => {
  it('cuts the openings out of what is drawn but not out of what encloses rooms', () => {
    const a = wall('a', line([0, 0], [5000, 0]));
    const door = { id: 'opn_000000000000000d', type: 'opening' as const, levelId: a.levelId, layerId: a.layerId, kind: 'door' as const, wallId: 'a', along: 2500, width: 1000, height: 2100, sill: 0 };
    const { joined, cut } = deriveWalls([a], { openings: [door] });
    expect(area(joined)).toBeCloseTo(1_000_000, 0);
    expect(cut.length).toBe(2);
    expect(area(cut)).toBeCloseTo(1_000_000 - 1000 * 200, -1);
  });
});
