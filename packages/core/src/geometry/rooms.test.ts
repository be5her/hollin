import { describe, expect, it } from 'vitest';
import type { Entity } from '../doc/schema';
import { deriveLevelGeometry, deriveWalls } from './level-geometry';
import { rectPath, type Path } from './path';
import { polygonContains } from './polygon';
import { autoSlab, cavitiesOf, cavityAt, roomSolids, unclaimedCavities } from './rooms';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });
const wall = (id: string, path: Path, thickness = 200): Entity => ({ id, type: 'wall', levelId: lv, layerId: layer, path, thickness, height: null, alignment: 'center', baseOffset: 0 });
const room = (id: string, seed: [number, number]): Entity => ({ id, type: 'room', levelId: lv, layerId: layer, name: id, boundary: { k: 'detect', seed } });
const record = (list: Entity[]) => Object.fromEntries(list.map((e) => [e.id, e]));

/** A 9 × 6 m box of four walls, 200 thick, centred on the lines x = 0, 9000 and y = 0, 6000. */
const box = [wall('a', line([0, 0], [9000, 0])), wall('b', line([9000, 0], [9000, 6000])), wall('c', line([9000, 6000], [0, 6000])), wall('d', line([0, 6000], [0, 0]))];

describe('rooms', () => {
  it('finds the space inside closed walls and its net area', () => {
    const g = deriveLevelGeometry(record([...box, room('r1', [4500, 3000])]));
    expect(g.cavities.length).toBe(1);
    const r = g.rooms.get('r1')!;
    expect(r.enclosed).toBe(true);
    expect(r.area).toBeCloseTo(8800 * 5800, -2);
    expect(r.perimeter).toBeCloseTo(2 * (8800 + 5800), 0);
    expect(polygonContains(r.polygon!, [4500, 3000])).toBe(true);
  });

  it('splits the space with a partition, keeps room identity by seed, and marks a seed outside', () => {
    const partition = wall('p', line([4500, 0], [4500, 6000]), 100);
    const g = deriveLevelGeometry(record([...box, partition, room('left', [2000, 3000]), room('right', [7000, 3000]), room('outside', [20_000, 0])]));
    expect(g.cavities.length).toBe(2);
    expect(g.rooms.get('left')!.area).toBeCloseTo((4450 - 100) * 5800, -2);
    expect(g.rooms.get('right')!.area).toBeCloseTo((8900 - 4550) * 5800, -2);
    expect(g.rooms.get('outside')!.enclosed).toBe(false);
    expect(g.rooms.get('outside')!.area).toBe(0);
  });

  it('closes a hair of a gap, and a wall ending on a face encloses too', () => {
    // The partition stops 1.5 mm short of the bottom face and starts on the top face exactly.
    const partition = wall('p', line([4500, 101.5], [4500, 5900]), 100);
    const g = deriveLevelGeometry(record([...box, partition, room('left', [2000, 3000]), room('right', [7000, 3000])]));
    expect(g.cavities.length).toBe(2);
    expect(g.rooms.get('left')!.polygon).not.toBe(g.rooms.get('right')!.polygon);
  });

  it('subtracts a freestanding column and treats a divider as a split', () => {
    const column: Entity = { id: 'col', type: 'column', levelId: lv, layerId: layer, at: [2000, 2000], shape: { k: 'rect', w: 400, d: 400 }, rotation: 0 };
    const divider: Entity = { id: 'sep', type: 'separator', levelId: lv, layerId: layer, path: line([4500, 100], [4500, 5900]) };
    const g = deriveLevelGeometry(record([...box, column, divider, room('left', [1000, 3000]), room('right', [7000, 3000])]));
    expect(g.cavities.length).toBe(2);
    const left = g.rooms.get('left')!;
    expect(left.holes.length).toBe(1);
    // The divider is half a millimetre wide on each side: about 3,000 mm² on a 5.8 m line.
    expect(left.area).toBeCloseTo(4400 * 5800 - 400 * 400, -4);
    expect(g.rooms.get('right')!.area).toBeCloseTo(4400 * 5800, -4);
  });

  it('reports a second seed in the same space as shared, without counting its area twice', () => {
    const g = deriveLevelGeometry(record([...box, room('one', [2000, 3000]), room('two', [7000, 3000])]));
    expect(g.rooms.get('one')!.shared).toBeUndefined();
    expect(g.rooms.get('two')!.shared).toBe('one');
    expect(g.rooms.get('two')!.area).toBe(0);
    expect(g.rooms.get('two')!.enclosed).toBe(true);
  });

  it('lists unclaimed spaces for detection, skipping slivers and shafts', () => {
    const partition = wall('p', line([4500, 0], [4500, 6000]), 100);
    const sliver = wall('s', line([4600, 0], [4600, 6000]), 100);
    const shaftWalls = [wall('e', line([1000, 1000], [2000, 1000])), wall('f', line([2000, 1000], [2000, 2000])), wall('g', line([2000, 2000], [1000, 2000])), wall('h', line([1000, 2000], [1000, 1000]))];
    const shaft: Entity = { id: 'sft', type: 'shaft', levelId: lv, layerId: layer, region: { outer: rectPath(1000, 1000, 1000, 1000), holes: [] }, span: { topLevelId: lv, baseOffset: 0, topOffset: 0 } };
    const g = deriveLevelGeometry(record([...box, partition, sliver, ...shaftWalls, shaft, room('left', [500, 3000])]));
    const free = unclaimedCavities(g.cavities, g.rooms, record([shaft]));
    // The right half only: the left half is claimed, the sliver between the two partitions is under 0.5 m², the shaft is skipped.
    expect(free.length).toBe(1);
    expect(polygonContains(free[0].polygon, [7000, 3000])).toBe(true);
  });

  it('makes the automatic slab from walls that enclose something, holes filled', () => {
    const walls = deriveWalls(box.slice(0, 4) as Extract<Entity, { type: 'wall' }>[]);
    const slab = autoSlab(walls);
    expect(slab.length).toBe(1);
    expect(polygonContains(slab[0], [4500, 3000])).toBe(true);
    const open = deriveWalls([box[0], box[1]] as Extract<Entity, { type: 'wall' }>[]);
    expect(autoSlab(open)).toEqual([]);
    const cavities = cavitiesOf(roomSolids(walls, [], []));
    expect(cavityAt(cavities, [4500, 3000])).not.toBeNull();
    expect(cavityAt(cavities, [-500, -500])).toBeNull();
  });
});
