import { describe, expect, it } from 'vitest';
import { deriveLevelGeometry, type Entity } from '@studio/core';
import { LevelGeometryCache } from './geometry-cache';
import { hitTest } from './hit';
import { createLevelScene, searchScene, syncLevelScene } from './scene';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';

/** 5,000 short walls on a 1 m grid (71 across), none touching another. */
function stressLevel(count = 5000): Record<string, Entity> {
  const entities: Record<string, Entity> = {};
  const columns = 71;
  for (let i = 0; i < count; i++) {
    const x = (i % columns) * 1000;
    const y = Math.floor(i / columns) * 1000;
    const vertical = (i + Math.floor(i / columns)) % 2 === 1;
    const id = `wal_${String(i).padStart(16, '0')}`;
    entities[id] = { id, type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [x, y] }, vertical ? { p: [x, y + 700] } : { p: [x + 700, y] }] }, thickness: 150, height: null, alignment: 'center', baseOffset: 0 };
  }
  return entities;
}

describe('5,000 entities on a level', () => {
  it('derives the level geometry and builds the scene index within a loose bound', () => {
    const entities = stressLevel();
    const t0 = performance.now();
    const geometry = deriveLevelGeometry(entities);
    const derived = performance.now() - t0;
    expect(geometry.walls.bodies.size).toBe(5000);
    const t1 = performance.now();
    const scene = createLevelScene(lv);
    syncLevelScene(scene, entities);
    const indexed = performance.now() - t1;
    expect(scene.items.size).toBe(5000);
    const t2 = performance.now();
    const cache = new LevelGeometryCache();
    const walls = cache.walls(entities);
    const visible = searchScene(scene, { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 });
    for (let i = 0; i < 100; i++) hitTest(scene, [1000 + i * 100, 50], { tolerance: 60, layers: {}, walls });
    const queried = performance.now() - t2;
    expect(visible.length).toBeGreaterThan(90);
    // eslint-disable-next-line no-console
    console.log(`5,000 walls: geometry ${derived.toFixed(0)} ms, index ${indexed.toFixed(0)} ms, 100 hits + a culling query ${queried.toFixed(0)} ms`);
    expect(derived).toBeLessThan(2000);
    expect(indexed).toBeLessThan(500);
    expect(queried).toBeLessThan(500);
    // The cache hands back the same derived walls for the same record.
    expect(cache.walls(entities)).toBe(walls);
  });
});
