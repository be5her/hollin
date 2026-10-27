import { describe, expect, it } from 'vitest';
import type { Entity } from '../doc/schema';
import { dimensionGeometry, resolveDimension, type Dimension } from './dimensions';
import { changedFields, transformEntity, transformer, type Transform } from './transform';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';

describe('transformer', () => {
  it('moves, rotates about a pivot and mirrors across a line', () => {
    expect(transformer({ translate: [10, 20] }).point([1, 2])).toEqual([11, 22]);
    const r = transformer({ rotate: { angle: 90, pivot: [1000, 0] } });
    const p = r.point([2000, 0]);
    expect(p[0]).toBeCloseTo(1000, 9);
    expect(p[1]).toBeCloseTo(1000, 9);
    expect(r.angle(10)).toBeCloseTo(100, 9);
    expect(r.flips).toBe(false);
    const m = transformer({ mirror: { a: [0, 0], b: [1000, 1000] } });
    const q = m.point([2000, 0]);
    expect(q[0]).toBeCloseTo(0, 9);
    expect(q[1]).toBeCloseTo(2000, 9);
    expect(m.flips).toBe(true);
    // A direction along +x mirrors to +y: 0° becomes 90°.
    expect(m.angle(0)).toBeCloseTo(90, 9);
  });

  it('applies mirror, then rotation, then the move', () => {
    const m = transformer({ mirror: { a: [0, 0], b: [1, 0] }, rotate: { angle: 90, pivot: [0, 0] }, translate: [100, 0] });
    // (0, 1) mirrors to (0, -1), rotates to (1, 0), moves to (101, 0).
    const p = m.point([0, 1]);
    expect(p[0]).toBeCloseTo(101, 9);
    expect(p[1]).toBeCloseTo(0, 9);
  });
});

describe('transformEntity', () => {
  const wall: Entity = { id: 'wal_0000000000000001', type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [0, 0], s: { k: 'arc', bulge: 0.5 } }, { p: [1000, 0] }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 };

  it('moves a wall and flips its arcs when mirrored', () => {
    const moved = transformEntity(wall, { translate: [0, 500] }) as typeof wall;
    expect(moved.path.v[1].p).toEqual([1000, 500]);
    expect(moved.path.v[0].s).toEqual({ k: 'arc', bulge: 0.5 });
    const mirrored = transformEntity(wall, { mirror: { a: [0, 0], b: [1, 0] } }) as typeof wall;
    expect(mirrored.path.v[0].s).toEqual({ k: 'arc', bulge: -0.5 });
    expect(changedFields(wall, moved)).toEqual({ path: moved.path });
    expect(changedFields(wall, wall)).toEqual({});
  });

  it('moves a shape and keeps its corners', () => {
    const shape: Entity = { id: 'shp_0000000000000001', type: 'shape', levelId: lv, layerId: layer, path: { closed: true, v: [{ p: [0, 0] }, { p: [1000, 0], c: { k: 'fillet', r: 100 } }, { p: [1000, 1000] }] }, filled: true };
    const moved = transformEntity(shape, { translate: [500, 500] }) as typeof shape;
    expect(moved.path.v.map((v) => v.p)).toEqual([[500, 500], [1500, 500], [1500, 1500]]);
    expect(moved.path.v[1].c).toEqual({ k: 'fillet', r: 100 });
    expect(moved.filled).toBe(true);
  });

  it('leaves openings in place but swaps a mirrored swing side', () => {
    const door: Entity = { id: 'opn_0000000000000001', type: 'opening', levelId: lv, layerId: layer, kind: 'door', wallId: wall.id, along: 300, width: 900, height: 2100, sill: 0, swing: { hinge: 'start', side: 'left' } };
    expect(transformEntity(door, { translate: [100, 0] })).toBe(door);
    expect((transformEntity(door, { mirror: { a: [0, 0], b: [1, 0] } }) as typeof door).swing).toEqual({ hinge: 'start', side: 'right' });
  });

  it('rotates placed things and their rotation fields, and keeps heights', () => {
    const column: Entity = { id: 'col_0000000000000001', type: 'column', levelId: lv, layerId: layer, at: [1000, 0], shape: { k: 'rect', w: 300, d: 500 }, rotation: 0 };
    const turned = transformEntity(column, { rotate: { angle: 90, pivot: [0, 0] } }) as typeof column;
    expect(turned.at[0]).toBeCloseTo(0, 9);
    expect(turned.at[1]).toBeCloseTo(1000, 9);
    expect(turned.rotation).toBeCloseTo(90, 9);
    const item: Entity = { id: 'itm_0000000000000001', type: 'item', levelId: lv, layerId: layer, asset: 'chair', at: [100, 200, 450], rotation: [0, 0, 30], scale: [1, 1, 1], materials: {} };
    const movedItem = transformEntity(item, { translate: [10, 10] }) as typeof item;
    expect(movedItem.at).toEqual([110, 210, 450]);
    expect(movedItem.rotation[2]).toBe(30);
    const dim: Entity = { id: 'dim_0000000000000001', type: 'dimension', levelId: lv, layerId: layer, kind: 'aligned', from: [0, 0], to: [1000, 0], offset: 500 };
    expect((transformEntity(dim, { mirror: { a: [0, 0], b: [1, 0] } }) as typeof dim).offset).toBe(-500);
    const angle: Entity = { ...dim, kind: 'angular', vertex: [500, 500], offset: 300 };
    const shifted = transformEntity(angle, { translate: [10, 0] }) as typeof angle;
    expect(shifted.vertex).toEqual([510, 500]);
    expect(shifted.offset).toBe(300);
    expect((transformEntity(angle, { mirror: { a: [0, 0], b: [1, 0] } }) as typeof angle).offset).toBe(300);
    const room: Entity = { id: 'rom_0000000000000001', type: 'room', levelId: lv, layerId: layer, name: 'Hall', boundary: { k: 'detect', seed: [10, 10] } };
    expect((transformEntity(room, { translate: [5, 5] }) as typeof room).boundary).toEqual({ k: 'detect', seed: [15, 15] });
  });

  it('mirrors a wall with its sides: alignment and face finishes swap', () => {
    const lined = { ...wall, alignment: 'left' as const, materials: { left: 'paint:#ff0000' } };
    const mirrored = transformEntity(lined, { mirror: { a: [0, 0], b: [1, 0] } }) as typeof lined;
    expect(mirrored.alignment).toBe('right');
    expect(mirrored.materials).toEqual({ right: 'paint:#ff0000' });
    const centred = transformEntity({ ...wall, materials: { left: 'paint:#ff0000', right: 'paint:#0000ff' } }, { mirror: { a: [0, 0], b: [0, 1] } }) as typeof lined;
    expect(centred.alignment).toBe('center');
    expect(centred.materials).toEqual({ left: 'paint:#0000ff', right: 'paint:#ff0000' });
    // Moved or turned, nothing swaps.
    expect((transformEntity(lined, { rotate: { angle: 180, pivot: [0, 0] } }) as typeof lined).alignment).toBe('left');
  });

  it('keeps horizontal and vertical dimensions where the transform sends their line', () => {
    const dim: Dimension = { id: 'dim_0000000000000002', type: 'dimension', levelId: lv, layerId: layer, kind: 'horizontal', from: [0, 0], to: [1000, 300], offset: 500 };
    // The dimension line as drawn, transformed, against the line the transformed dimension draws.
    const check = (xf: Transform, kind: Dimension['kind']) => {
      const m = transformer(xf);
      const before = dimensionGeometry(dim, resolveDimension(dim, {}), null);
      const moved = transformEntity(dim, xf) as Dimension;
      expect(moved.kind).toBe(kind);
      const after = dimensionGeometry(moved, resolveDimension(moved, {}), null);
      if (kind === 'aligned') {
        // Turned off the axes: an aligned dimension between the same points, on the same side.
        const mid = m.point(before.textAt);
        const n = [-(moved.to[1] - moved.from[1]), moved.to[0] - moved.from[0]];
        const side = (p: readonly number[]) => Math.sign((p[0] - moved.from[0]) * n[0] + (p[1] - moved.from[1]) * n[1]);
        expect(side(after.textAt)).toBe(side(mid));
        return;
      }
      expect(after.value).toBeCloseTo(before.value, 6);
      const [a, b] = before.lines[0].map((p) => m.point(p));
      const [c, d] = after.lines[0];
      const same = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
      expect((same(a, c) && same(b, d)) || (same(a, d) && same(b, c))).toBe(true);
    };
    check({ mirror: { a: [0, 0], b: [0, 1] } }, 'horizontal');
    check({ mirror: { a: [0, 0], b: [1, 0] } }, 'horizontal');
    check({ rotate: { angle: 180, pivot: [200, 100] } }, 'horizontal');
    check({ rotate: { angle: 90, pivot: [0, 0] } }, 'vertical');
    check({ rotate: { angle: -90, pivot: [500, 0] }, translate: [10, 20] }, 'vertical');
    check({ mirror: { a: [0, 0], b: [1, 1] } }, 'vertical');
    check({ rotate: { angle: 30, pivot: [0, 0] } }, 'aligned');
    const vertical = transformEntity({ ...dim, kind: 'vertical' }, { rotate: { angle: 90, pivot: [0, 0] } }) as Dimension;
    expect(vertical.kind).toBe('horizontal');
    // A quarter turn used to read 0: the measured axis turns with it.
    expect(dimensionGeometry(transformEntity(dim, { rotate: { angle: 90, pivot: [0, 0] } }) as Dimension, resolveDimension(transformEntity(dim, { rotate: { angle: 90, pivot: [0, 0] } }) as Dimension, {}), null).value).toBeCloseTo(1000, 6);
  });

  it('swaps the faces a mirrored dimension is tied to', () => {
    const dim: Dimension = { id: 'dim_0000000000000003', type: 'dimension', levelId: lv, layerId: layer, kind: 'aligned', from: [0, 100], to: [1000, 100], offset: 300, anchors: { from: { entityId: wall.id, vertex: 0, side: 'left' }, to: { entityId: wall.id, vertex: 1, side: 'axis' } } };
    const mirrored = transformEntity(dim, { mirror: { a: [0, 0], b: [1, 0] } }) as Dimension;
    expect(mirrored.anchors).toEqual({ from: { entityId: wall.id, vertex: 0, side: 'right' }, to: { entityId: wall.id, vertex: 1, side: 'axis' } });
    expect((transformEntity(dim, { translate: [5, 5] }) as Dimension).anchors).toEqual(dim.anchors);
  });
});
