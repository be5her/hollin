import { describe, expect, it } from 'vitest';
import { deriveWalls, type Entity } from '@studio/core';
import { DEFAULT_SNAP_SETTINGS, SnapIndex, snapPoint } from './snap';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const wall = (id: string, a: [number, number], b: [number, number]): Entity => ({ id, type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: a }, { p: b }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 });

function index() {
  const a = wall('wal_000000000000000a', [0, 0], [5000, 0]);
  const b = wall('wal_000000000000000b', [2000, -3000], [2000, 3000]);
  const entities = { [a.id]: a, [b.id]: b };
  const idx = new SnapIndex();
  idx.build(entities, deriveWalls([a, b] as Extract<Entity, { type: 'wall' }>[]));
  return { idx, a, b };
}

const settings = DEFAULT_SNAP_SETTINGS;

describe('snapping', () => {
  it('prefers endpoints, then intersections, then midpoints, within the tolerance', () => {
    const { idx } = index();
    expect(snapPoint(idx, [4960, 30], 100, settings)).toMatchObject({ point: [5000, 0], kind: 'endpoint' });
    expect(snapPoint(idx, [2040, 30], 100, settings)).toMatchObject({ point: [2000, 0], kind: 'intersection' });
    expect(snapPoint(idx, [2480, -20], 100, settings)).toMatchObject({ point: [2500, 0], kind: 'midpoint' });
    expect(snapPoint(idx, [1000, 1500], 100, settings)).toBeNull();
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
    const stepped = snapPoint(idx, [1000, 1520], 60, { ...settings, angle: true }, { from: [0, 1500] })!;
    expect(stepped.kind).toBe('angle');
    expect(stepped.point[1]).toBeCloseTo(1500, 6);
  });

  it('falls back to the grid when nothing else is near, and respects the toggles', () => {
    const { idx } = index();
    expect(snapPoint(idx, [1230, 1570], 60, { ...settings, grid: true })).toMatchObject({ point: [1200, 1600], kind: 'grid' });
    expect(snapPoint(idx, [4960, 30], 100, { ...settings, endpoint: false })).toMatchObject({ kind: 'on' });
    expect(snapPoint(idx, [4960, 30], 100, { ...settings, enabled: false })).toBeNull();
    expect(snapPoint(idx, [4960, 30], 100, settings, { exclude: new Set(['wal_000000000000000a']) })).toBeNull();
  });
});
