import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config';
import type { Entity } from '../doc/schema';
import { anchorPoint, dimensionGeometry, dimensionOutline, offsetTowards, pruneAnchors, remapAnchors, resolveDimension, untiedFields, type Dimension } from './dimensions';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const units = defaultConfig().units;
const wall = (x: number): Entity => ({ id: 'wal_0000000000000001', type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [x, 0] }, { p: [x + 4000, 0] }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 });
const shape: Entity = { id: 'shp_0000000000000001', type: 'shape', levelId: lv, layerId: layer, path: { closed: true, v: [{ p: [0, 5000] }, { p: [3000, 5000] }, { p: [3000, 7000] }] }, filled: true };

describe('dimension anchors', () => {
  it('names a vertex of a wall line, a wall face or a shape, and nothing when it is gone', () => {
    const w = wall(0);
    expect(anchorPoint({ entityId: w.id, vertex: 1, side: 'axis' }, w)).toEqual([4000, 0]);
    expect(anchorPoint({ entityId: w.id, vertex: 1, side: 'left' }, w)).toEqual([4000, 100]);
    expect(anchorPoint({ entityId: w.id, vertex: 0, side: 'right' }, w)).toEqual([0, -100]);
    expect(anchorPoint({ entityId: w.id, vertex: 5, side: 'axis' }, w)).toBeNull();
    expect(anchorPoint({ entityId: shape.id, vertex: 2, side: 'axis' }, shape)).toEqual([3000, 7000]);
    expect(anchorPoint({ entityId: shape.id, vertex: 2, side: 'left' }, shape)).toBeNull();
    expect(anchorPoint({ entityId: w.id, vertex: 0, side: 'axis' }, undefined)).toBeNull();
  });

  it('follows the wall it is tied to and falls back to its stored points', () => {
    const w = wall(0);
    const dim: Dimension = { id: 'dim_0000000000000001', type: 'dimension', levelId: lv, layerId: layer, kind: 'aligned', from: [0, -100], to: [4000, -100], offset: -500, anchors: { from: { entityId: w.id, vertex: 0, side: 'right' }, to: { entityId: w.id, vertex: 1, side: 'right' } } };
    expect(resolveDimension(dim, { [w.id]: w })).toEqual({ from: [0, -100], to: [4000, -100] });
    const moved = wall(1000);
    expect(resolveDimension(dim, { [w.id]: moved })).toEqual({ from: [1000, -100], to: [5000, -100] });
    expect(resolveDimension(dim, {})).toEqual({ from: [0, -100], to: [4000, -100] });
  });

  it('measures aligned, horizontal, vertical, angular and radius dimensions', () => {
    const aligned = dimensionGeometry({ kind: 'aligned', offset: 500 }, { from: [0, 0], to: [3000, 0] }, units, 60);
    expect(aligned.lines[0]).toEqual([[0, 500], [3000, 500]]);
    expect(aligned.lines[1]).toEqual([[0, 0], [0, 560]]);
    expect(aligned.value).toBe(3000);
    expect(aligned.text).toBe('3000 mm');
    expect(aligned.textAt).toEqual([1500, 500]);
    expect(aligned.textAngle).toBe(0);
    const below = dimensionGeometry({ kind: 'aligned', offset: -500 }, { from: [0, 0], to: [0, 2000] }, units, 60);
    // Along +y the left normal is -x; a negative offset puts the line at +x, and the extensions overshoot that way.
    expect(below.lines[0][0]).toEqual([500, 0]);
    expect(below.lines[1][1]).toEqual([560, 0]);
    expect(below.textAngle).toBe(90);
    const horizontal = dimensionGeometry({ kind: 'horizontal', offset: -300 }, { from: [0, 0], to: [2000, 1000] }, units);
    expect(horizontal.lines[0]).toEqual([[0, -300], [2000, -300]]);
    expect(horizontal.value).toBe(2000);
    expect(horizontal.textAngle).toBe(0);
    const vertical = dimensionGeometry({ kind: 'vertical', offset: 300 }, { from: [0, 0], to: [2000, 1000] }, units);
    expect(vertical.lines[0]).toEqual([[300, 0], [300, 1000]]);
    expect(vertical.value).toBe(1000);
    expect(vertical.textAngle).toBe(90);
    const angular = dimensionGeometry({ kind: 'angular', offset: 400 }, { from: [1000, 0], to: [0, 1000], vertex: [0, 0] }, units);
    expect(angular.value).toBeCloseTo(90, 9);
    expect(angular.text).toBe('90°');
    expect(angular.arc).toMatchObject({ center: [0, 0], radius: 400 });
    expect(angular.arc!.sweep).toBeCloseTo(Math.PI / 2, 9);
    expect(angular.ticks[0][0]).toBeCloseTo(400, 9);
    expect(angular.lines[0]).toEqual([[0, 0], [1000, 0]]);
    expect(angular.textAt[0]).toBeCloseTo(400 * Math.SQRT1_2, 9);
    expect(dimensionOutline(angular).length).toBe(3);
    const radius = dimensionGeometry({ kind: 'radius', offset: 0 }, { from: [0, 0], to: [0, 500] }, units);
    expect(radius.value).toBe(500);
    expect(radius.text).toBe('R 500 mm');
    expect(radius.arrow).toEqual({ at: [0, 500], direction: [0, 1] });
  });

  it('remaps anchors when vertices are inserted or removed, and drops those whose target goes', () => {
    const dim: Dimension = { id: 'dim_0000000000000001', type: 'dimension', levelId: lv, layerId: layer, kind: 'aligned', from: [0, 0], to: [4000, 0], offset: 500, anchors: { from: { entityId: 'wal_a', vertex: 0, side: 'axis' }, to: { entityId: 'wal_a', vertex: 1, side: 'axis' } } };
    expect(remapAnchors(dim, 'wal_a', (v) => (v > 0 ? v + 1 : v))).toEqual({ from: { entityId: 'wal_a', vertex: 0, side: 'axis' }, to: { entityId: 'wal_a', vertex: 2, side: 'axis' } });
    expect(remapAnchors(dim, 'wal_a', (v) => (v === 1 ? null : v))).toEqual({ from: { entityId: 'wal_a', vertex: 0, side: 'axis' } });
    expect(remapAnchors(dim, 'wal_a', () => null)).toBeNull();
    expect(remapAnchors(dim, 'wal_b', () => null)).toBeUndefined();
    expect(remapAnchors(dim, 'wal_a', (v) => v)).toBeUndefined();
    expect(pruneAnchors(dim, (id) => id === 'wal_a')).toBeUndefined();
    expect(pruneAnchors(dim, () => false)).toBeNull();
    const mixed: Dimension = { ...dim, anchors: { from: { entityId: 'wal_a', vertex: 0, side: 'axis' }, to: { entityId: 'wal_b', vertex: 0, side: 'axis' } } };
    expect(pruneAnchors(mixed, (id) => id === 'wal_b')).toEqual({ to: { entityId: 'wal_b', vertex: 0, side: 'axis' } });
    expect(pruneAnchors({ ...dim, anchors: undefined }, () => false)).toBeUndefined();
    // An end that loses its tie keeps the point it showed.
    expect(untiedFields(mixed, { from: [10, 10], to: [20, 20] }, { to: mixed.anchors!.to })).toEqual({ set: { from: [10, 10], anchors: { to: mixed.anchors!.to } }, unset: [] });
    expect(untiedFields(mixed, { from: [10, 10], to: [20, 20] }, null)).toEqual({ set: { from: [10, 10], to: [20, 20] }, unset: ['anchors'] });
  });

  it('places the dimension line through a cursor', () => {
    const pts = { from: [0, 0] as const, to: [3000, 0] as const };
    expect(offsetTowards('aligned', pts, [1000, -400])).toBe(-400);
    expect(offsetTowards('horizontal', pts, [1000, 250])).toBe(250);
    expect(offsetTowards('vertical', pts, [-700, 250])).toBe(-700);
    expect(offsetTowards('angular', { ...pts, vertex: [0, 0] }, [300, 400])).toBe(500);
    expect(offsetTowards('radius', pts, [1, 1])).toBe(0);
    expect(dimensionGeometry({ kind: 'aligned', offset: 0 }, pts, null).text).toBe('');
  });
});
