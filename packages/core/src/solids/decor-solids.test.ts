import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addEntityOps, type NewEntity } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { deriveLevels } from '../doc/derive';
import { Transaction } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { rectPath } from '../geometry/path';
import { deriveBuildingSolids, deriveLevelSolids, type LevelSolids, type SolidKind } from './building';
import { meshBox, meshVolume } from './mesh';
import { walkRelative, walkWorld, type Walker } from './walk';

/** A 4 × 3 m room (one closed wall 200 thick, centred on the rectangle, its inside on the left of the path) and what is added to it. */
function room(...extra: ((doc: ProjectDoc, ground: string, wallId: string) => NewEntity)[]): { doc: ProjectDoc; ground: string; ids: string[] } {
  let doc = newProjectDoc({ name: 'Room' });
  const ground = doc.building.groundLevelId;
  const add = (entity: NewEntity) => {
    const { ops, id } = addEntityOps(doc, { levelId: ground, entity });
    const tx = new Transaction(doc);
    tx.apply(ops);
    doc = tx.commit()!.doc;
    return id;
  };
  const wallId = add({ type: 'wall', path: rectPath(0, 0, 4000, 3000), thickness: 200 });
  add({ type: 'slab', source: { k: 'auto' } });
  const ids = extra.map((make) => add(make(doc, ground, wallId)));
  return { doc, ground, ids };
}

const parts = (level: LevelSolids, kind: SolidKind) => level.parts.filter((p) => p.kind === kind);
const box = (level: LevelSolids, kind: SolidKind) => {
  const b = meshBox(parts(level, kind)[0].mesh)!;
  return [...b.min, ...b.max].map((v) => Math.round(v));
};
/** A door 900 wide, 2100 high, 1000 along the bottom wall (centre x = 1000, y = 0). */
const door = (swing?: { hinge: 'start' | 'end'; side: 'left' | 'right' }, style?: string) => (_doc: ProjectDoc, _ground: string, wallId: string): NewEntity => ({ type: 'opening', kind: 'door', wallId, along: 1000, width: 900, height: 2100, ...(swing ? { swing } : {}), ...(style ? { style } : {}) });

describe('doors and windows in 3D', () => {
  it('lines a door with a frame and hangs its leaf open at 90° on its swing side', () => {
    const { doc, ground } = room(door());
    const solids = deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS });
    // The flush style: a 50 mm frame standing 10 mm proud of both faces, the jambs and the head.
    expect(box(solids, 'frame')).toEqual([550, -110, 0, 1450, 110, 2100]);
    expect(meshVolume(parts(solids, 'frame')[0].mesh)).toBeCloseTo(2 * 50 * 220 * 2100 + 800 * 220 * 50, -2);
    expect(parts(solids, 'frame')[0].material).toBe('builtin:paint-white');
    // Hinged at the start jamb's inner edge (x = 600), opening to the left of the wall (inside the room, +y): 800 clear, 40 thick, under the head.
    expect(box(solids, 'leaf')).toEqual([600, 100, 0, 640, 900, 2050]);
    expect(parts(solids, 'leaf')[0].material).toBe('builtin:oak');
  });

  it('turns the leaf with the hinge and the swing side', () => {
    const { doc, ground } = room(door({ hinge: 'end', side: 'right' }));
    expect(box(deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS }), 'leaf')).toEqual([1360, -900, 0, 1400, -100, 2050]);
  });

  it('glazes a glazed door, and the cutaway cuts the leaf and leaves the head out', () => {
    const { doc, ground } = room(door(undefined, 'builtin:door-glazed'));
    const solids = deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS });
    expect(parts(solids, 'glass')).toHaveLength(1);
    expect(parts(solids, 'leaf')[0].material).toBe('builtin:black-metal');
    const cut = deriveLevelSolids(doc, ground, { limits: DEFAULT_RULE_LIMITS, cutHeight: 1200 });
    expect(box(cut, 'leaf')[5]).toBe(1200);
    expect(box(cut, 'frame')[5]).toBe(1200);
    expect(meshVolume(parts(cut, 'frame')[0].mesh)).toBeCloseTo(2 * 50 * 220 * 1200, -2);
  });

  it('frames a window all round, with casements and mullions from its style', () => {
    const window = (style?: string) => (_doc: ProjectDoc, _ground: string, wallId: string): NewEntity => ({ type: 'opening', kind: 'window', wallId, along: 2000, width: 1200, height: 1200, sill: 900, ...(style ? { style } : {}) });
    const plain = room(window());
    const solids = deriveLevelSolids(plain.doc, plain.ground, { limits: DEFAULT_RULE_LIMITS });
    // A fixed window: the lining only (jambs, head and sill board), flush with the faces.
    expect(box(solids, 'frame')).toEqual([1400, -100, 900, 2600, 100, 2100]);
    expect(meshVolume(parts(solids, 'frame')[0].mesh)).toBeCloseTo(2 * 60 * 200 * 1200 + 2 * 1080 * 200 * 60, -2);
    expect(parts(solids, 'leaf')).toEqual([]);
    const double = room(window('builtin:window-double'));
    const sashes = deriveLevelSolids(double.doc, double.ground, { limits: DEFAULT_RULE_LIMITS });
    expect(meshVolume(parts(sashes, 'frame')[0].mesh)).toBeGreaterThan(meshVolume(parts(solids, 'frame')[0].mesh));
    // A plain opening has no frame.
    const open = room((_d, _g, wallId) => ({ type: 'opening', kind: 'opening', wallId, along: 2000, width: 1000, height: 2100 }));
    expect(parts(deriveLevelSolids(open.doc, open.ground, { limits: DEFAULT_RULE_LIMITS }), 'frame')).toEqual([]);
  });
});

describe('furniture and the walk camera', () => {
  it('stops the walker at a sofa, but walks under a pendant', () => {
    const sofa = (): NewEntity => ({ type: 'item', asset: 'builtin:sofa-3', at: [2000, 2000, 0] });
    const pendant = (): NewEntity => ({ type: 'item', asset: 'builtin:pendant', at: [2000, 1000, 2200] });
    const { doc } = room(sofa, pendant);
    const levels = deriveLevels(doc);
    const solids = deriveBuildingSolids(doc, { limits: DEFAULT_RULE_LIMITS, levels });
    expect(solids.levels[0].obstacles).toHaveLength(2);
    const world = walkWorld(solids, levels);
    // From the south, walking north under the pendant (at 2200) and into the sofa (its front edge at y = 1550).
    let walker: Walker = { at: [2000, 400, 0], yaw: 90 };
    for (let i = 0; i < 30; i++) walker = walkRelative(world, walker, 100, 0);
    expect(walker.at[1]).toBeGreaterThan(1000);
    expect(walker.at[1]).toBeLessThanOrEqual(1550 - 250 + 1);
    expect(walker.at[1]).toBeGreaterThan(1550 - 250 - 101);
  });
});
