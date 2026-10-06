import { describe, expect, it } from 'vitest';
import type { Entity } from '@studio/core';
import { createLevelScene, entityBox, sceneBox, searchScene, syncLevelScene } from './scene';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const wall = (id: string, x: number): Entity => ({ id, type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [x, 0] }, { p: [x, 5000] }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 });

describe('level scene', () => {
  it('indexes entities by their box and finds them by region', () => {
    const scene = createLevelScene(lv);
    const a = wall('wal_000000000000000a', 0);
    const b = wall('wal_000000000000000b', 9000);
    expect(syncLevelScene(scene, { [a.id]: a, [b.id]: b })).toBe(true);
    expect(scene.items.size).toBe(2);
    expect(searchScene(scene, { minX: -500, minY: 0, maxX: 500, maxY: 100 }).map((i) => i.id)).toEqual([a.id]);
    expect(searchScene(scene, { minX: 4000, minY: 0, maxX: 5000, maxY: 100 })).toEqual([]);
    const box = sceneBox(scene);
    expect(box.minX).toBe(-200);
    expect(box.maxX).toBe(9200);
  });

  it('rebuilds only the items whose entity object changed, and drops deleted ones', () => {
    const scene = createLevelScene(lv);
    const a = wall('wal_000000000000000a', 0);
    const b = wall('wal_000000000000000b', 9000);
    syncLevelScene(scene, { [a.id]: a, [b.id]: b });
    const itemA = scene.items.get(a.id)!;
    const version = scene.version;
    expect(syncLevelScene(scene, { [a.id]: a, [b.id]: b })).toBe(false);
    expect(scene.version).toBe(version);
    const b2 = wall(b.id, 3000);
    expect(syncLevelScene(scene, { [a.id]: a, [b.id]: b2 })).toBe(true);
    expect(scene.items.get(a.id)).toBe(itemA);
    expect(scene.items.get(b.id)!.minX).toBe(2800);
    expect(syncLevelScene(scene, { [a.id]: a })).toBe(true);
    expect(scene.items.has(b.id)).toBe(false);
    expect(searchScene(scene, { minX: 2000, minY: 0, maxX: 4000, maxY: 100 })).toEqual([]);
  });

  it('places an opening on its wall and follows the wall when it moves', () => {
    const scene = createLevelScene(lv);
    const w = wall('wal_000000000000000a', 0);
    const door: Entity = { id: 'opn_000000000000000a', type: 'opening', levelId: lv, layerId: layer, kind: 'door', wallId: w.id, along: 1000, width: 900, height: 2100, sill: 0 };
    syncLevelScene(scene, { [w.id]: w, [door.id]: door });
    const before = scene.items.get(door.id)!;
    expect(before.minX).toBeCloseTo(-650);
    expect(before.minY).toBeCloseTo(350);
    const moved = wall(w.id, 2000);
    syncLevelScene(scene, { [w.id]: moved, [door.id]: door });
    expect(scene.items.get(door.id)!.minX).toBeCloseTo(1350);
  });

  it('gives every entity type a finite box except an automatic slab', () => {
    const region = { outer: { closed: true, v: [{ p: [0, 0] as [number, number] }, { p: [1000, 0] as [number, number] }, { p: [1000, 1000] as [number, number] }, { p: [0, 1000] as [number, number] }] }, holes: [] };
    const base = { levelId: lv, layerId: layer };
    const entities: Entity[] = [
      { id: 'col_0000000000000001', type: 'column', ...base, at: [100, 100], shape: { k: 'rect', w: 300, d: 300 }, rotation: 0 },
      { id: 'slb_0000000000000001', type: 'slab', ...base, source: { k: 'region', region } },
      { id: 'vod_0000000000000001', type: 'void', ...base, region },
      { id: 'rom_0000000000000001', type: 'room', ...base, name: 'Hall', boundary: { k: 'detect', seed: [500, 500] } },
      { id: 'fix_0000000000000001', type: 'fixture', ...base, symbol: 'wc', at: [0, 0], rotation: 0, mirror: false },
      { id: 'pnt_0000000000000001', type: 'point', ...base, service: 'electrical', kind: 'socket', at: [0, 0], height: 300, rotation: 0 },
      { id: 'dim_0000000000000001', type: 'dimension', ...base, from: [0, 0], to: [3000, 0], offset: 500 },
      { id: 'lbl_0000000000000001', type: 'label', ...base, text: 'Hello', at: [0, 0], size: 250, rotation: 0 },
      { id: 'itm_0000000000000001', type: 'item', ...base, asset: 'chair', at: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], materials: {} },
      { id: 'lgt_0000000000000001', type: 'light', ...base, kind: 'point', at: [0, 0, 2000], color: '#ffffff', intensity: 800 },
    ];
    const record = Object.fromEntries(entities.map((e) => [e.id, e]));
    for (const e of entities) expect(Number.isFinite(entityBox(e, record).minX), e.type).toBe(true);
    const auto: Entity = { id: 'slb_0000000000000002', type: 'slab', ...base, source: { k: 'auto' } };
    expect(Number.isFinite(entityBox(auto, record).minX)).toBe(false);
    const scene = createLevelScene(lv);
    syncLevelScene(scene, { ...record, [auto.id]: auto });
    expect(scene.items.size).toBe(entities.length);
  });
});
