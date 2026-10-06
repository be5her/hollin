import { describe, expect, it } from 'vitest';
import { extendPathEnd, offsetPath } from './offset';
import { circlePath, pathLength, rectPath, signedArea, type Path } from './path';

describe('offsetPath', () => {
  it('shrinks a counter-clockwise rectangle on its left (the inside) and grows it on its right', () => {
    const rect = rectPath(0, 0, 4000, 3000);
    const inner = offsetPath(rect, 100)!;
    expect(inner.v.length).toBe(4);
    expect(signedArea(inner)).toBeCloseTo(3800 * 2800, 6);
    expect(inner.v[0].p).toEqual([100, 100]);
    const outer = offsetPath(rect, -100)!;
    expect(signedArea(outer)).toBeCloseTo(4200 * 3200, 6);
  });

  it('mitres the corner of an open polyline so vertices correspond', () => {
    const l: Path = { closed: false, v: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [5000, 4000] }] };
    const left = offsetPath(l, 100)!;
    expect(left.v.length).toBe(3);
    expect(left.v[0].p).toEqual([0, 100]);
    // The inner miter of a right angle: 100 in from both edges.
    expect(left.v[1].p[0]).toBeCloseTo(4900, 9);
    expect(left.v[1].p[1]).toBeCloseTo(100, 9);
    const right = offsetPath(l, -100)!;
    expect(right.v[1].p[0]).toBeCloseTo(5100, 9);
    expect(right.v[1].p[1]).toBeCloseTo(-100, 9);
  });

  it('bevels a corner sharper than the miter limit', () => {
    const hairpin: Path = { closed: false, v: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [0, 500] }] };
    const outside = offsetPath(hairpin, -100)!;
    expect(outside.v.length).toBe(4);
    expect(pathLength(outside)).toBeLessThan(2 * 5000 + 1200);
  });

  it('keeps arcs concentric: a circle grows and shrinks, and vanishes past its radius', () => {
    const circle = circlePath([0, 0], 1000);
    const bigger = offsetPath(circle, -100)!; // the circle runs counter-clockwise; its right is outwards
    expect(signedArea(bigger)).toBeCloseTo(Math.PI * 1100 * 1100, 3);
    const smaller = offsetPath(circle, 100)!;
    expect(signedArea(smaller)).toBeCloseTo(Math.PI * 900 * 900, 3);
    expect(offsetPath(circle, 1000)).toBeNull();
  });

  it('joins a line to an arc exactly', () => {
    // A line along +x, then a quarter arc turning left (counter-clockwise) up to (6000, 1000).
    const p: Path = { closed: false, v: [{ p: [0, 0] }, { p: [5000, 0], s: { k: 'arc', bulge: Math.tan(Math.PI / 8) } }, { p: [6000, 1000] }] };
    const left = offsetPath(p, 100)!;
    expect(left.v.length).toBe(3);
    expect(left.v[1].p[1]).toBeCloseTo(100, 6);
    expect(left.v[1].p[0]).toBeCloseTo(5000, 6);
    // The arc keeps its centre (5000, 1000): the offset arc has radius 900.
    expect(Math.hypot(left.v[2].p[0] - 5000, left.v[2].p[1] - 1000)).toBeCloseTo(900, 6);
  });

  it('refuses Bézier segments and flipped segments', () => {
    const bezier: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'cubic', c1: [100, 100], c2: [-100, 100] } }, { p: [1000, 0] }] };
    expect(offsetPath(bezier, 50)).toBeNull();
    const tiny: Path = { closed: false, v: [{ p: [0, 0] }, { p: [1000, 0] }, { p: [1000, 50] }, { p: [0, 50] }] };
    expect(offsetPath(tiny, 100)).toBeNull();
  });

  it('extends an open path at either end along its tangent', () => {
    const l: Path = { closed: false, v: [{ p: [0, 0] }, { p: [1000, 0] }] };
    expect(extendPathEnd(l, 'end', 200).v[1].p).toEqual([1200, 0]);
    expect(extendPathEnd(l, 'start', 200).v[0].p).toEqual([-200, 0]);
    // A counter-clockwise semicircle from (0,0) to (2000,0) bulges downwards and ends heading up.
    const arc: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'arc', bulge: 1 } }, { p: [2000, 0] }] };
    const extended = extendPathEnd(arc, 'end', 300);
    expect(extended.v.length).toBe(3);
    expect(extended.v[2].p[0]).toBeCloseTo(2000, 6);
    expect(extended.v[2].p[1]).toBeCloseTo(300, 6);
  });
});
