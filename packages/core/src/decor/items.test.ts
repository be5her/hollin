import { describe, expect, it } from 'vitest';
import { addEntityOps } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction } from '../doc/ops';
import type { Asset } from '../doc/schema';
import { describeDesign } from '../describe/describe';
import { defaultConfig } from '../config';
import { polygonArea } from '../geometry/polygon';
import { transformEntity } from '../geometry/transform';
import { footprintArea, itemFootprint, itemMatrix, itemModel, itemSize, type Item } from './items';

const file = `${'c'.repeat(64)}.glb`;
const asset: Asset = { id: file, kind: 'model', name: 'Crate', category: 'imported', size: [1000, 600, 400], min: [200, -100, 50] };
const assets = { [file]: asset };
const item = (fields: Partial<Item> = {}): Item => ({ id: 'itm_0000000000000001', type: 'item', levelId: 'lvl_0000000000000001', layerId: 'lay_0000000000000001', asset: 'builtin:sofa-3', at: [1000, 2000, 0], rotation: [0, 0, 0], scale: [1, 1, 1], materials: {}, ...fields });

const box = (polys: [number, number][][] | readonly (readonly [number, number])[][]) => {
  const pts = polys.flat();
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map((v) => Math.round(v));
};

describe('items', () => {
  it('knows a built-in by its recipe and an imported model by the registry', () => {
    expect(itemModel('builtin:sofa-3', {})).toMatchObject({ name: 'Sofa, 3 seats', size: [2200, 900, 800], offset: [0, 0, 0] });
    expect(itemModel('builtin:sofa-3', {}).slots).toEqual(['fabric', 'legs']);
    // An imported model's extent is moved so its bottom centre is the origin.
    expect(itemModel(`asset:${file}`, assets)).toMatchObject({ name: 'Crate', size: [1000, 600, 400], offset: [-700, -200, -50] });
    expect(itemModel(`asset:${file}`, {}, { name: 'Library crate', size: [800, 800, 800] })).toMatchObject({ name: 'Library crate', size: [800, 800, 800] });
    expect(itemModel('builtin:nothing', {}).name).toBe('Missing model');
  });

  it('places the footprint: scaled, turned and moved, counter-clockwise', () => {
    const model = itemModel(`asset:${file}`, assets);
    expect(box(itemFootprint(item({ asset: `asset:${file}` }), model))).toEqual([500, 1700, 1500, 2300]);
    const turned = itemFootprint(item({ asset: `asset:${file}`, rotation: [0, 0, 90], scale: [2, 1, 1] }), model);
    expect(box(turned)).toEqual([700, 1000, 1300, 3000]);
    expect(polygonArea(turned[0])).toBeGreaterThan(0);
    expect(footprintArea(turned)).toBeCloseTo(2000 * 600, 0);
    expect(itemSize(item({ scale: [-1.5, 1, 0.5] }), itemModel('builtin:sofa-3', {}))).toEqual([3300, 900, 400]);
  });

  it('places the model in 3D: offset, scale, turn, then the floor and height', () => {
    const model = itemModel(`asset:${file}`, assets);
    const m = itemMatrix(item({ asset: `asset:${file}`, at: [1000, 2000, 300], rotation: [0, 0, 90], scale: [2, 1, 1] }), model, 3000);
    const apply = (p: number[]) => [0, 1, 2].map((i) => Math.round(m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]));
    // The model's low corner centre (its own 700, 200, 50) lands at the item's point, 3300 up.
    expect(apply([700, 200, 50])).toEqual([1000, 2000, 3300]);
    // Its own +x (scaled 2) turns to +y.
    expect(apply([800, 200, 50])).toEqual([1000, 2200, 3300]);
  });

  it('mirrors an item by flipping it along its own x, and its footprint mirrors with it', () => {
    const e = item({ rotation: [0, 0, 30], at: [1000, 500, 100] });
    const model = itemModel(e.asset, {});
    const mirrored = transformEntity(e, { mirror: { a: [0, 0], b: [0, 1000] } }) as Item;
    expect(mirrored.scale).toEqual([-1, 1, 1]);
    expect(mirrored.at).toEqual([-1000, 500, 100]);
    const before = box(itemFootprint(e, model));
    const after = box(itemFootprint(mirrored, model));
    expect(after).toEqual([-before[2], before[1], -before[0], before[3]]);
    expect(polygonArea(itemFootprint(mirrored, model)[0])).toBeGreaterThan(0);
    // Mirrored twice, it is back as it was.
    const back = transformEntity(mirrored, { mirror: { a: [0, 0], b: [0, 1000] } }) as Item;
    expect(back.scale).toEqual([1, 1, 1]);
    expect(box(itemFootprint(back, model))).toEqual(before);
  });

  it('is described in the room it stands in', () => {
    let doc = newProjectDoc({ name: 'Flat' });
    const ground = doc.building.groundLevelId;
    const commit = (ops: ReturnType<typeof addEntityOps>['ops']) => {
      const tx = new Transaction(doc);
      tx.apply(ops);
      doc = tx.commit()!.doc;
    };
    commit(addEntityOps(doc, { levelId: ground, entity: { type: 'room', name: 'Living', boundary: { k: 'region', region: { outer: { closed: true, v: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [5000, 4000] }, { p: [0, 4000] }] }, holes: [] } } } }).ops);
    commit(addEntityOps(doc, { levelId: ground, entity: { type: 'item', asset: 'builtin:sofa-3', at: [2500, 1000, 0], rotation: [0, 0, 180] } }).ops);
    commit(addEntityOps(doc, { levelId: ground, entity: { type: 'item', asset: 'builtin:tree', at: [9000, 1000, 0] } }).ops);
    commit(addEntityOps(doc, { levelId: ground, entity: { type: 'light', kind: 'point', at: [2500, 2000, 2400] } }).ops);
    const level = describeDesign(doc, defaultConfig().rules).levels[0];
    expect(level.rooms[0].furniture).toEqual([expect.objectContaining({ name: 'Sofa, 3 seats', ref: 'builtin:sofa-3', at: [2500, 1000, 0], rotation: 180, size: [2200, 900, 800] })]);
    expect(level.rooms[0].furniture[0].footprint).toBeGreaterThan(1_500_000);
    expect(level.rooms[0].lights).toEqual([{ id: expect.any(String), kind: 'point', at: [2500, 2000, 2400], lumens: 800, color: '#ffffff' }]);
    expect(level.outside.furniture.map((f) => f.name)).toEqual(['Tree']);
  });
});
