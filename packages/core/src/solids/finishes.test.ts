import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addEntityOps, type NewEntity } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { deriveLevelGeometry } from '../geometry/level-geometry';
import { rectPath, type Path } from '../geometry/path';
import { polygonContains } from '../geometry/polygon';
import { deriveLevelSolids, type LevelSolids } from './building';
import { surfaceAt, wallSidesFacing } from './finishes';
import { meshVolume, type Mesh } from './mesh';

function build(...entities: ((ids: string[]) => NewEntity)[]): { doc: ProjectDoc; ground: string; ids: string[] } {
  let doc = newProjectDoc({ name: 'Finishes' });
  const ground = doc.building.groundLevelId;
  const ids: string[] = [];
  for (const make of entities) {
    const { ops, id } = addEntityOps(doc, { levelId: ground, entity: make(ids) });
    const tx = new Transaction(doc);
    tx.apply(ops);
    doc = tx.commit()!.doc;
    ids.push(id);
  }
  return { doc, ground, ids };
}

const finish = (level: LevelSolids, material: string): Mesh | undefined => level.parts.find((p) => p.kind === 'finish' && p.material === material)?.mesh;
const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });

/** The area of a mesh's triangles whose outward normal, pushed a little from their centre, lands inside `region` (and are vertical or horizontal as asked). */
function facingArea(mesh: Mesh, region: [number, number][], vertical: boolean): number {
  const p = mesh.positions;
  let total = 0;
  for (let i = 0; i < p.length; i += 9) {
    const u = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
    const v = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!len) continue;
    if (vertical !== Math.abs(n[2]) / len < 0.5) continue;
    const c = [(p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3];
    if (polygonContains(region, [c[0] + (n[0] / len) * 5, c[1] + (n[1] / len) * 5])) total += len / 2;
  }
  return total;
}

/** True when a face of the mesh turned up lies over the point. */
function coversFromAbove(mesh: Mesh, at: [number, number]): boolean {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 9) {
    const tri: [number, number][] = [
      [p[i], p[i + 1]],
      [p[i + 3], p[i + 4]],
      [p[i + 6], p[i + 7]],
    ];
    const up = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
    if (up > 0 && polygonContains(tri, at)) return true;
  }
  return false;
}

describe('finishes', () => {
  it("covers a painted face over its area, its door and window left open", () => {
    // A 4 × 3 m room (one closed wall, its inside on the left), painted inside, a door and a window in it.
    const { doc, ground } = build(
      () => ({ type: 'wall', path: rectPath(0, 0, 4000, 3000), thickness: 200, materials: { left: 'paint:#aabbcc' } }),
      (ids) => ({ type: 'opening', kind: 'door', wallId: ids[0], along: 1000, width: 900, height: 2100 }),
      (ids) => ({ type: 'opening', kind: 'window', wallId: ids[0], along: 5500, width: 1200, height: 1200, sill: 900 }),
    );
    const level = deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS });
    const skin = finish(level, 'paint:#aabbcc')!;
    expect(skin).toBeDefined();
    expect(level.parts.find((p) => p.kind === 'finish')!.ids).toEqual([Object.keys(doc.levelData[ground].entities)[0]]);
    // The skin's face towards the room: the inner face 2 mm in, less the openings (each narrowed by the 3 mm the skin reaches into it).
    const inside: [number, number][] = [
      [102, 102],
      [3898, 102],
      [3898, 2898],
      [102, 2898],
    ];
    const expected = 2 * (3796 + 2796) * 3000 - (900 - 6) * 2100 - (1200 - 6) * 1200;
    expect(facingArea(skin, inside, true) / expected).toBeCloseTo(1, 2);
    // A closed solid (built band by band with caps only where it changes), 2 mm thick over the face.
    const volume = meshVolume(skin);
    expect(meshVolume(skin, [9000, -4000, 5000]) / volume).toBeCloseTo(1, 4);
    expect(volume / (expected * 2)).toBeCloseTo(1, 1);
    // Nothing of it across the door.
    const p = skin.positions;
    for (let i = 0; i < p.length; i += 3) expect(p[i] > 560 && p[i] < 1440 && p[i + 1] > 99 && p[i + 1] < 104 && p[i + 2] < 2099).toBe(false);
    // The outside, unpainted, has no skin.
    expect(level.parts.filter((x) => x.kind === 'finish')).toHaveLength(1);
  });

  it('carries painted faces round an outer corner', () => {
    // An L: east, then north; their right faces are the outside.
    const { doc, ground } = build(
      () => ({ type: 'wall', path: line([0, 0], [4000, 0]), thickness: 200, materials: { right: 'builtin:brick-red' } }),
      () => ({ type: 'wall', path: line([4000, 0], [4000, 3000]), thickness: 200, materials: { right: 'builtin:brick-red' } }),
    );
    const skin = finish(deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS }), 'builtin:brick-red')!;
    // The outer corner is at (4100, −100): the skin's top covers the 2 mm square beyond it.
    expect(coversFromAbove(skin, [4101, -101])).toBe(true);
    expect(coversFromAbove(skin, [3000, -101])).toBe(true);
    expect(coversFromAbove(skin, [4101, 1500])).toBe(true);
    expect(coversFromAbove(skin, [3000, 101])).toBe(false);
  });

  it("covers a room's floor over its net area, and its ceiling under the floor above", () => {
    const { doc, ground, ids } = build(
      () => ({ type: 'wall', path: rectPath(0, 0, 4000, 3000), thickness: 200 }),
      () => ({ type: 'room', name: 'Living', boundary: { k: 'detect', seed: [2000, 1500] }, finish: { floor: 'builtin:oak-floor', ceiling: 'paint:#ffffff' } }),
    );
    const level = deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS });
    const room = deriveLevelGeometry(doc.levelData[ground].entities).rooms.get(ids[1])!;
    const floor = finish(level, 'builtin:oak-floor')!;
    const all: [number, number][] = [
      [-1e5, -1e5],
      [1e5, -1e5],
      [1e5, 1e5],
      [-1e5, 1e5],
    ];
    // Its top (facing up) and bottom faces each equal the room's net area.
    expect(facingArea(floor, all, false) / 2).toBeCloseTo(room.area, -2);
    expect(room.area).toBeCloseTo(3800 * 2800, -1);
    const ceiling = finish(level, 'paint:#ffffff')!;
    expect(Math.max(...[...ceiling.positions].filter((_, i) => i % 3 === 2))).toBeCloseTo(3000, 3);
  });

  it('finds the surface under a click in 3D, and the wall faces that look into a room', () => {
    const { doc, ground, ids } = build(
      () => ({ type: 'wall', path: rectPath(0, 0, 4000, 3000), thickness: 200 }),
      () => ({ type: 'room', name: 'Living', boundary: { k: 'detect', seed: [2000, 1500] } }),
      () => ({ type: 'wall', path: line([6000, 0], [6000, 3000]), thickness: 200 }),
    );
    const entities = doc.levelData[ground].entities;
    const rooms = deriveLevelGeometry(entities).rooms.values();
    const [ring, roomId, free] = ids;
    expect(surfaceAt(entities, [...rooms], [2000, 102, 1000], [0, 1, 0])).toEqual({ wallId: ring, side: 'left' });
    expect(surfaceAt(entities, deriveLevelGeometry(entities).rooms.values(), [2000, -102, 1000], [0, -1, 0])).toEqual({ wallId: ring, side: 'right' });
    expect(surfaceAt(entities, deriveLevelGeometry(entities).rooms.values(), [6102, 1500, 1000], [1, 0, 0])).toEqual({ wallId: free, side: 'right' });
    expect(surfaceAt(entities, deriveLevelGeometry(entities).rooms.values(), [2000, 1500, 0], [0, 0, 1])).toEqual({ roomId, surface: 'floor' });
    expect(surfaceAt(entities, deriveLevelGeometry(entities).rooms.values(), [2000, 1500, 3000], [0, 0, -1])).toEqual({ roomId, surface: 'ceiling' });
    expect(surfaceAt(entities, deriveLevelGeometry(entities).rooms.values(), [5000, 1500, 0], [0, 0, 1])).toBeNull();
    expect(wallSidesFacing(entities, deriveLevelGeometry(entities).rooms.values(), roomId)).toEqual([{ wallId: ring, side: 'left' }]);
  });
});
