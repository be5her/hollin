import { describe, expect, it } from 'vitest';
import { DEG, deriveWalls, dot, type Entity, type Vec2 } from '@studio/core';
import { DEFAULT_SNAP_SETTINGS, SnapIndex, referenceFrom, snapPoint } from './snap';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const wall = (id: string, a: [number, number], b: [number, number]): Entity => ({ id, type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: a }, { p: b }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 });

function index() {
  const a = wall('wal_000000000000000a', [0, 0], [5000, 0]);
  const b = wall('wal_000000000000000b', [2000, -3000], [2000, 3000]);
  // A wall at 37°, no multiple of any step.
  const c = wall('wal_000000000000000c', [0, -5000], [5000 * Math.cos(37 * DEG), -5000 + 5000 * Math.sin(37 * DEG)]);
  const entities = { [a.id]: a, [b.id]: b, [c.id]: c };
  const idx = new SnapIndex();
  idx.build(entities, deriveWalls([a, b, c] as Extract<Entity, { type: 'wall' }>[]));
  return { idx, a, b, c, entities };
}

const settings = DEFAULT_SNAP_SETTINGS;
/** A point `len` from `from` at `degrees`. */
const at = (from: Vec2, degrees: number, len: number): Vec2 => [from[0] + len * Math.cos(degrees * DEG), from[1] + len * Math.sin(degrees * DEG)];
const unit = (degrees: number): Vec2 => [Math.cos(degrees * DEG), Math.sin(degrees * DEG)];

describe('snapping', () => {
  it('prefers endpoints, then intersections, then midpoints, within the tolerance', () => {
    const { idx } = index();
    expect(snapPoint(idx, [4960, 30], 100, settings)).toMatchObject({ point: [5000, 0], kind: 'endpoint' });
    expect(snapPoint(idx, [2040, 30], 100, settings)).toMatchObject({ point: [2000, 0], kind: 'intersection' });
    expect(snapPoint(idx, [2480, -20], 100, settings)).toMatchObject({ point: [2500, 0], kind: 'midpoint' });
    expect(snapPoint(idx, [1000, 1500], 100, settings)).toBeNull();
  });

  it('says which wall vertex an endpoint is, on the line or a face, so a dimension can follow it', () => {
    const { idx, a } = index();
    expect(snapPoint(idx, [4960, 30], 100, settings)?.anchor).toEqual({ entityId: a.id, vertex: 1, side: 'axis' });
    expect(snapPoint(idx, [4960, 110], 60, settings)).toMatchObject({ point: [5000, 100], kind: 'endpoint', anchor: { entityId: a.id, vertex: 1, side: 'left' } });
    expect(snapPoint(idx, [20, -110], 40, settings)).toMatchObject({ point: [0, -100], anchor: { entityId: a.id, vertex: 0, side: 'right' } });
    expect(snapPoint(idx, [2480, -20], 100, settings)?.anchor).toBeUndefined();
  });

  it('snaps to faces too, and to the nearest point on a line', () => {
    const { idx } = index();
    // The wall's upper face is at y = 100.
    expect(snapPoint(idx, [1000, 110], 60, settings)).toMatchObject({ point: [1000, 100], kind: 'on' });
    expect(snapPoint(idx, [1000, 30], 60, settings)).toMatchObject({ point: [1000, 0], kind: 'on' });
  });

  it('finds the perpendicular from the drawing start, extensions and angle steps', () => {
    const { idx } = index();
    expect(snapPoint(idx, [3010, 20], 60, settings, { from: [3000, 2000] })).toMatchObject({ point: [3000, 0], kind: 'perpendicular' });
    const ext = snapPoint(idx, [6000, 20], 60, settings)!;
    expect(ext.kind).toBe('extension');
    expect(ext.point).toEqual([6000, 0]);
    expect(ext.guides[0].from).toEqual([5000, 0]);
    const ortho = snapPoint(idx, [1000, 1480], 60, settings, { from: [0, 1500], ortho: true })!;
    expect(ortho.kind).toBe('angle');
    expect(ortho.point).toEqual([1000, 1500]);
    const stepped = snapPoint(idx, [1000, 1520], 60, settings, { from: [0, 1500] })!;
    expect(stepped.kind).toBe('angle');
    expect(stepped.point[1]).toBeCloseTo(1500, 6);
    expect(stepped.length).toBe(1000);
  });

  it('falls back to the grid when nothing else is near, and respects the toggles', () => {
    const { idx } = index();
    expect(snapPoint(idx, [1230, 1570], 60, { ...settings, grid: true })).toMatchObject({ point: [1200, 1600], kind: 'grid' });
    expect(snapPoint(idx, [4960, 30], 100, { ...settings, endpoint: false })).toMatchObject({ kind: 'on' });
    expect(snapPoint(idx, [4960, 30], 100, { ...settings, enabled: false })).toBeNull();
    expect(snapPoint(idx, [4960, 30], 100, settings, { exclude: new Set(['wal_000000000000000a']) })).toBeNull();
  });

  it('names the direction of the segment a point snapped to', () => {
    const { idx, a, b, c, entities } = index();
    expect(snapPoint(idx, [4960, 30], 100, settings)?.tangent).toEqual({ direction: [1, 0], entityId: a.id });
    expect(snapPoint(idx, [2010, 1520], 60, settings)?.tangent).toEqual({ direction: [0, 1], entityId: b.id });
    const end = snapPoint(idx, at([0, -5000], 37, 5000), 60, settings)!;
    expect(end.kind).toBe('endpoint');
    expect(end.tangent!.direction[0]).toBeCloseTo(Math.cos(37 * DEG), 9);
    expect(referenceFrom(end, entities)).toMatchObject({ name: 'wall' });
    expect(referenceFrom(snapPoint(idx, at([0, -5000], 37, 5000), 60, settings), { ...entities, [c.id]: { ...c, type: 'separator' } as Entity })).toMatchObject({ name: 'line' });
    expect(referenceFrom(null, entities)).toBeNull();
  });
});

describe('angle tracking', () => {
  const from: Vec2 = [0, 1500];

  it('snaps a direction near a main angle to it exactly, within a pixel tolerance at any zoom', () => {
    const { idx } = index();
    // 10 px at scale 1 is 10 mm: 88° is 70 mm off the 90° ray at 2 m, too far; at scale 0.05 the tolerance is 200 mm.
    expect(snapPoint(idx, at(from, 88, 2000), 10, settings, { from })).toBeNull();
    const tracked = snapPoint(idx, at(from, 88, 2000), 200, settings, { from })!;
    expect(tracked.kind).toBe('angle');
    expect(tracked.point[0]).toBe(0);
    expect(tracked.point[1]).toBeCloseTo(1500 + 2000 * Math.cos(2 * DEG), 6);
    expect(tracked.label).toBe('90°');
    expect(tracked.length).toBeCloseTo(2000 * Math.cos(2 * DEG), 6);
    // The guide is a ray from the start through the point and beyond.
    expect(tracked.guides[0].from).toEqual(from);
    expect(tracked.guides[0].to[1]).toBeGreaterThan(tracked.point[1]);
    // Just off the ray by more than the tolerance: free.
    expect(snapPoint(idx, at(from, 80, 2000), 100, settings, { from })).toBeNull();
    // Too close to the start to have a direction.
    expect(snapPoint(idx, at(from, 88, 50), 100, settings, { from })).toBeNull();
  });

  it('offers the configured step and always the main angles', () => {
    const { idx } = index();
    expect(snapPoint(idx, at(from, 31, 2000), 100, { ...settings, angleStep: 30 }, { from })?.label).toBe('30°');
    expect(snapPoint(idx, at(from, 44, 2000), 100, { ...settings, angleStep: 30 }, { from })?.label).toBe('45°');
    expect(snapPoint(idx, at(from, 136, 2000), 100, { ...settings, angleStep: 30 }, { from })?.label).toBe('135°');
    expect(snapPoint(idx, at(from, 16, 1000), 100, { ...settings, angleStep: 5 }, { from })?.label).toBe('15°');
    expect(snapPoint(idx, at(from, 16, 1000), 100, { ...settings, angleStep: 30 }, { from })).toBeNull();
  });

  it('tracks parallel and perpendicular to the previous segment, keeping the angle when it is a main one', () => {
    const { idx } = index();
    const previous = [{ direction: unit(37), name: 'previous' }];
    const perpendicular = snapPoint(idx, at(from, 128, 2000), 100, settings, { from, relativeTo: previous })!;
    expect(perpendicular.kind).toBe('angle');
    expect(perpendicular.label).toBe('Perpendicular to previous');
    expect(Math.abs(dot(unit(37), [perpendicular.point[0] - from[0], perpendicular.point[1] - from[1]]))).toBeLessThan(1e-9);
    const parallel = snapPoint(idx, at(from, 38, 2000), 100, settings, { from, relativeTo: previous })!;
    expect(parallel.label).toBe('Parallel to previous');
    expect(snapPoint(idx, at(from, 216, 2000), 100, settings, { from, relativeTo: previous })?.label).toBe('Parallel to previous');
    // Perpendicular to a horizontal segment is 90°, a main angle: the angle is the better name.
    expect(snapPoint(idx, at(from, 89, 2000), 100, settings, { from, relativeTo: [{ direction: [1, 0], name: 'previous' }] })?.label).toBe('90°');
    // Without the reference, 128° is tracked by nothing.
    expect(snapPoint(idx, at(from, 128, 2000), 100, settings, { from })).toBeNull();
  });

  it('tracks perpendicular to the wall a run started on, through the tangent of its start snap', () => {
    const { idx, entities } = index();
    const start = snapPoint(idx, at([0, -5000], 37, 5000), 60, settings)!;
    const reference = referenceFrom(start, entities)!;
    const tracked = snapPoint(idx, at(start.point, 128, 2000), 100, settings, { from: start.point, relativeTo: [reference] })!;
    expect(tracked.label).toBe('Perpendicular to wall');
    expect(Math.abs(dot(reference.direction, [tracked.point[0] - start.point[0], tracked.point[1] - start.point[1]]))).toBeLessThan(1e-6);
  });

  it('ranks below the points aimed at, but above a line merely under the cursor', () => {
    const { idx } = index();
    // The 0° ray from (0, 100) passes 70 mm from the cursor; the wall end is 50 mm from it and wins.
    expect(snapPoint(idx, [4960, 30], 100, settings, { from: [0, 100] })).toMatchObject({ kind: 'endpoint', point: [5000, 0] });
    // Near the vertical wall at x = 2000, tracked at 45° from (1000, 500): where the ray crosses the wall, not the nearest point on it.
    const crossing = snapPoint(idx, [1990, 1520], 60, settings, { from: [1000, 500] })!;
    expect(crossing.kind).toBe('intersection');
    expect(crossing.point[0]).toBeCloseTo(2000, 6);
    expect(crossing.point[1]).toBeCloseTo(1500, 6);
    expect(crossing.length).toBeCloseTo(1000 * Math.SQRT2, 6);
    // With intersections off, the ray still beats the line under the cursor.
    const ray = snapPoint(idx, [1990, 1520], 60, { ...settings, intersection: false }, { from: [1000, 500] })!;
    expect(ray.kind).toBe('angle');
    expect(ray.point[0]).toBeCloseTo(2005, 6);
    expect(ray.point[1]).toBeCloseTo(1505, 6);
    // A ray crossing that is also the perpendicular keeps the perpendicular's name.
    expect(snapPoint(idx, [3010, 20], 60, settings, { from: [3000, 2000] })).toMatchObject({ kind: 'perpendicular', point: [3000, 0] });
  });

  it('is off with the setting, while Shift still locks to 45° steps', () => {
    const { idx } = index();
    expect(snapPoint(idx, at(from, 88, 2000), 200, { ...settings, angle: false }, { from })).toBeNull();
    expect(snapPoint(idx, at(from, 88, 2000), 200, { ...settings, enabled: false }, { from })).toBeNull();
    const shifted = snapPoint(idx, at(from, 60, 2000), 10, { ...settings, angle: false }, { from, ortho: true, relativeTo: [{ direction: unit(37), name: 'previous' }] })!;
    expect(shifted.kind).toBe('angle');
    expect(shifted.label).toBe('45°');
    expect(shifted.point[0] - from[0]).toBeCloseTo(shifted.point[1] - from[1], 9);
  });
});
