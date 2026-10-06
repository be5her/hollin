import { describe, expect, it } from 'vitest';
import { perpendicularFoot, segmentIntersections, tangentPoints, withinSegment } from './intersect';
import type { Seg } from './path';

const line = (a: [number, number], b: [number, number]): Seg => ({ k: 'line', a, b });
const semi: Seg = { k: 'arc', a: [0, 0], b: [2000, 0], bulge: 1 }; // centre (1000, 0), radius 1000, below the chord

describe('segment intersections', () => {
  it('crosses lines, and only within the segments unless extended', () => {
    expect(segmentIntersections(line([0, 0], [1000, 1000]), line([0, 1000], [1000, 0]))).toEqual([[500, 500]]);
    expect(segmentIntersections(line([0, 0], [100, 100]), line([0, 1000], [1000, 0]))).toEqual([]);
    expect(segmentIntersections(line([0, 0], [100, 100]), line([0, 1000], [1000, 0]), true)).toEqual([[500, 500]]);
    expect(segmentIntersections(line([0, 0], [1000, 0]), line([0, 100], [1000, 100]))).toEqual([]);
  });

  it('meets arcs with lines and arcs', () => {
    const hits = segmentIntersections(line([1000, -2000], [1000, 2000]), semi);
    expect(hits.length).toBe(1);
    expect(hits[0][0]).toBeCloseTo(1000, 6);
    expect(hits[0][1]).toBeCloseTo(-1000, 6);
    // The upper half of a circle centred (1000, -1500) with radius 1000: it crosses the lower half-circle twice at y = -750.
    const other: Seg = { k: 'arc', a: [0, -1500], b: [2000, -1500], bulge: -1 };
    const both = segmentIntersections(semi, other);
    expect(both.length).toBe(2);
    for (const p of both) {
      expect(p[1]).toBeCloseTo(-750, 6);
      expect(withinSegment(semi, p) && withinSegment(other, p)).toBe(true);
    }
    expect(segmentIntersections(semi, { k: 'arc', a: [1000, 1000], b: [1000, -3000], bulge: 1 })).toEqual([]);
  });

  it('finds perpendicular feet and tangent points', () => {
    expect(perpendicularFoot(line([0, 0], [1000, 0]), [300, 500])).toEqual([300, 0]);
    const foot = perpendicularFoot(semi, [1000, 5000])!;
    expect(foot[0]).toBeCloseTo(1000, 6);
    expect(foot[1]).toBeCloseTo(1000, 6);
    const tangents = tangentPoints(semi, [1000, -3000]);
    expect(tangents.length).toBe(2);
    for (const t of tangents) expect(Math.hypot(t[0] - 1000, t[1])).toBeCloseTo(1000, 6);
    expect(tangentPoints(semi, [1000, 0])).toEqual([]);
  });
});
