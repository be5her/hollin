import { describe, expect, it } from 'vitest';
import {
  arcGeometry,
  bulgeOf,
  bulgeThrough,
  circlePath,
  flatten,
  nearestPoint,
  pathBox,
  pathLength,
  pointAt,
  rectPath,
  regionArea,
  regionContains,
  resolvePath,
  reversePath,
  signedArea,
  transformPath,
  type Path,
} from './path';

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe('arcs by bulge', () => {
  it('finds centre, radius and sweep', () => {
    const half = arcGeometry([0, 0], [2, 0], 1);
    close(half.radius, 1);
    expect(half.center[0]).toBeCloseTo(1);
    expect(half.center[1]).toBeCloseTo(0);
    close(half.sweep, Math.PI);
    const quarter = arcGeometry([1, 0], [0, 1], bulgeOf(Math.PI / 2));
    close(quarter.radius, 1);
    expect(Math.abs(quarter.center[0]) + Math.abs(quarter.center[1])).toBeLessThan(1e-9);
  });

  it('turns three points into a bulge', () => {
    close(bulgeThrough([0, 0], [1, -1], [2, 0])!, 1);
    close(bulgeThrough([0, 0], [1, 1], [2, 0])!, -1);
    close(bulgeThrough([1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1])!, Math.tan(Math.PI / 8));
    expect(bulgeThrough([0, 0], [1, 0], [2, 0])).toBeNull();
  });
});

describe('measures', () => {
  it('measures a rectangle', () => {
    const r = rectPath(0, 0, 4000, 3000);
    close(signedArea(r), 12_000_000);
    close(pathLength(r), 14000);
    expect(pathBox(r)).toEqual({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 });
    close(signedArea(reversePath(r)), -12_000_000);
  });

  it('measures circles and arcs exactly', () => {
    const c = circlePath([100, 50], 1000);
    close(signedArea(c), Math.PI * 1e6, 3);
    close(pathLength(c), 2 * Math.PI * 1000, 6);
    const box = pathBox(c);
    close(box.minX, -900);
    close(box.maxY, 1050);
    // A D-shape: a semicircle closed by its diameter.
    const d: Path = { closed: true, v: [{ p: [0, 0], s: { k: 'arc', bulge: 1 } }, { p: [2000, 0] }] };
    close(signedArea(d), (Math.PI * 1e6) / 2, 3);
  });

  it('measures cubics', () => {
    // A straight cubic is a line.
    const straight: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'cubic', c1: [100, 0], c2: [-100, 0] } }, { p: [300, 0] }] };
    close(pathLength(straight), 300, 4);
    // A closed shape made of a cubic and a line: area by Green's theorem.
    const lens: Path = { closed: true, v: [{ p: [0, 0], s: { k: 'cubic', c1: [0, 300], c2: [0, 300] } }, { p: [300, 0] }] };
    // Area under the Bézier (0,0)-(0,300)-(300,300)-(300,0): ∫y dx = 1 620 000 ∫t²(1−t)² dt = 54 000.
    close(Math.abs(signedArea(lens)), 54000, 3);
  });

  it('follows the path to a distance', () => {
    const r = rectPath(0, 0, 4000, 3000);
    expect(pointAt(r, 5000).point).toEqual([4000, 1000]);
    expect(pointAt(r, 5000).tangent).toEqual([0, 1]);
    const c = circlePath([0, 0], 1000);
    const quarter = pointAt(c, (Math.PI * 1000) / 2).point;
    close(quarter[0], 0, 6);
    close(quarter[1], 1000, 6);
  });

  it('finds the nearest point', () => {
    const r = rectPath(0, 0, 4000, 3000);
    const n = nearestPoint(r, [2000, -500]);
    expect(n.point).toEqual([2000, 0]);
    close(n.distance, 500);
    close(n.along, 2000);
    const c = nearestPoint(circlePath([0, 0], 1000), [0, 2000]);
    close(c.distance, 1000, 4);
  });

  it('tests containment with holes', () => {
    const region = { outer: rectPath(0, 0, 10, 10), holes: [rectPath(4, 4, 2, 2)] };
    expect(regionContains(region, [1, 1])).toBe(true);
    expect(regionContains(region, [5, 5])).toBe(false);
    expect(regionContains(region, [11, 5])).toBe(false);
    close(regionArea(region), 96);
  });

  it('flattens within tolerance', () => {
    const pts = flatten(circlePath([0, 0], 1000), 0.5);
    for (const [x, y] of pts) close(Math.hypot(x, y), 1000, 6);
    // Chords sag at most 0.5 mm.
    const step = (2 * Math.PI) / pts.length;
    expect(1000 * (1 - Math.cos(step / 2))).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

describe('corners', () => {
  it('fillets a square exactly', () => {
    const r = 500;
    const square = rectPath(0, 0, 4000, 4000);
    square.v.forEach((v) => (v.c = { k: 'fillet', r }));
    const { segs, diagnostics } = resolvePath(square);
    expect(diagnostics).toEqual([]);
    expect(segs.filter((s) => s.k === 'arc')).toHaveLength(4);
    close(signedArea(square), 4000 * 4000 - (4 - Math.PI) * r * r, 3);
    close(pathLength(square), 4 * (4000 - 2 * r) + 2 * Math.PI * r, 6);
  });

  it('chamfers with two distances', () => {
    const square = rectPath(0, 0, 1000, 1000);
    square.v[2].c = { k: 'chamfer', d1: 200, d2: 100 };
    close(signedArea(square), 1_000_000 - (200 * 100) / 2, 6);
    // Reversing swaps which side each distance is measured on, so the shape stays the same.
    close(signedArea(reversePath(square)), -(1_000_000 - (200 * 100) / 2), 6);
  });

  it('shrinks a fillet that does not fit and says so', () => {
    const thin = rectPath(0, 0, 1000, 200);
    thin.v.forEach((v) => (v.c = { k: 'fillet', r: 500 }));
    const { diagnostics } = resolvePath(thin);
    expect(diagnostics.some((d) => d.code === 'corner-clamped')).toBe(true);
    expect(signedArea(thin)).toBeGreaterThan(0);
    expect(signedArea(thin)).toBeLessThan(200_000);
  });

  it('fillets a line meeting an arc', () => {
    // A line along x, then an arc that leaves at 30° to the left.
    const path: Path = {
      closed: false,
      v: [{ p: [0, 0] }, { p: [2000, 0], s: { k: 'arc', bulge: 0.3 }, c: { k: 'fillet', r: 200 } }, { p: [2500, 1000] }],
    };
    const { segs, diagnostics } = resolvePath(path);
    expect(diagnostics).toEqual([]);
    expect(segs.map((s) => s.k)).toEqual(['line', 'arc', 'arc']);
    // The pieces join without gaps.
    for (let i = 1; i < segs.length; i++) {
      close(segs[i].a[0], segs[i - 1].b[0], 6);
      close(segs[i].a[1], segs[i - 1].b[1], 6);
    }
  });

  it('leaves a tangent join alone', () => {
    const path: Path = { closed: false, v: [{ p: [0, 0] }, { p: [2000, 0], s: { k: 'arc', bulge: bulgeOf(Math.PI / 2) }, c: { k: 'fillet', r: 200 } }, { p: [3000, 1000] }] };
    expect(resolvePath(path).segs.map((s) => s.k)).toEqual(['line', 'arc']);
  });

  it('draws corners next to Bézier curves sharp, with a diagnostic', () => {
    const path: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'cubic', c1: [100, 100], c2: [-100, 100] } }, { p: [1000, 0], c: { k: 'fillet', r: 100 } }, { p: [1000, 1000] }] };
    expect(resolvePath(path).diagnostics.map((d) => d.code)).toEqual(['corner-unsupported']);
  });
});

describe('editing', () => {
  it('reverses open paths with arcs and handles', () => {
    const p: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'arc', bulge: 0.5 } }, { p: [1000, 0], s: { k: 'cubic', c1: [100, 50], c2: [-100, 50] } }, { p: [2000, 0] }] };
    const r = reversePath(p);
    expect(r.v.map((v) => v.p)).toEqual([
      [2000, 0],
      [1000, 0],
      [0, 0],
    ]);
    expect(r.v[0].s).toEqual({ k: 'cubic', c1: [-100, 50], c2: [100, 50] });
    expect(r.v[1].s).toEqual({ k: 'arc', bulge: -0.5 });
    close(pathLength(r), pathLength(p), 6);
    expect(reversePath(r)).toEqual(p);
  });

  it('transforms, keeping arcs correct when mirrored', () => {
    const d: Path = { closed: true, v: [{ p: [0, 0], s: { k: 'arc', bulge: 1 } }, { p: [2000, 0] }] };
    const moved = transformPath(d, { dx: 500, rotate: 90, scale: 2 });
    close(signedArea(moved), signedArea(d) * 4, 2);
    const mirrored = transformPath(d, { mirror: true });
    close(signedArea(mirrored), -signedArea(d), 3);
  });
});
