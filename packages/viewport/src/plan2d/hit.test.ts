import { describe, expect, it } from 'vitest';
import { deriveWalls, type Entity, type Layer } from '@studio/core';
import { hitAll, hitTest, marqueeSelect } from './hit';
import { createLevelScene, syncLevelScene } from './scene';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const locked = 'lyr_0000000000000002';
const layers: Record<string, Layer> = {
  [layer]: { id: layer, levelId: lv, kind: 'structure', name: 'Structure', order: 0, visible: true, locked: false, opacity: 1 },
  [locked]: { id: locked, levelId: lv, kind: 'interior', name: 'Interior', order: 1, visible: true, locked: true, opacity: 1 },
};
const wall: Entity = { id: 'wal_0000000000000001', type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [0, 0] }, { p: [5000, 0] }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 };
const door: Entity = { id: 'opn_0000000000000001', type: 'opening', levelId: lv, layerId: layer, kind: 'door', wallId: wall.id, along: 1000, width: 900, height: 2100, sill: 0 };
const room: Entity = { id: 'rom_0000000000000001', type: 'room', levelId: lv, layerId: locked, name: 'Hall', boundary: { k: 'region', region: { outer: { closed: true, v: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [5000, 4000] }, { p: [0, 4000] }] }, holes: [] } } };
const label: Entity = { id: 'lbl_0000000000000001', type: 'label', levelId: lv, layerId: layer, text: 'Hi', at: [2500, 2000], size: 250, rotation: 0 };

function scene() {
  const s = createLevelScene(lv);
  const entities = { [wall.id]: wall, [door.id]: door, [room.id]: room, [label.id]: label };
  syncLevelScene(s, entities);
  const walls = deriveWalls([wall as Extract<Entity, { type: 'wall' }>]);
  return { s, options: { tolerance: 50, layers, walls } };
}

describe('hit-testing', () => {
  it('picks the door before the wall it sits in, and the wall by its body', () => {
    const { s, options } = scene();
    expect(hitTest(s, [1000, 0], options)?.id).toBe(door.id);
    expect(hitTest(s, [3000, 50], options)?.id).toBe(wall.id);
    expect(hitTest(s, [3000, 140], options)?.id).toBe(wall.id); // within tolerance of the face
    expect(hitTest(s, [3000, 200], options)).toBeNull();
    expect(hitAll(s, [1000, 0], options).map((h) => h.id)).toEqual([door.id, wall.id]);
  });

  it('skips locked layers and finds labels by their text box', () => {
    const { s, options } = scene();
    expect(hitTest(s, [2500, 3000], options)).toBeNull(); // the room is on the locked layer
    expect(hitTest(s, [2500, 2000], options)?.id).toBe(label.id);
  });

  it('selects by window and by crossing', () => {
    const { s, options } = scene();
    expect(marqueeSelect(s, { minX: -500, minY: -700, maxX: 5500, maxY: 700 }, 'window', options).sort()).toEqual([door.id, wall.id].sort());
    expect(marqueeSelect(s, { minX: 2000, minY: -500, maxX: 3000, maxY: 500 }, 'window', options)).toEqual([]);
    expect(marqueeSelect(s, { minX: 2000, minY: -500, maxX: 3000, maxY: 500 }, 'crossing', options)).toEqual([wall.id]);
  });
});
