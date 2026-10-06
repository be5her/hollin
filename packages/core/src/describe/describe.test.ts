import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addConnectorOps, addEntityOps, addLevelOps } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction, type Op } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { rectPath } from '../geometry/path';
import { describeDesign } from './describe';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

const line = (a: [number, number], b: [number, number]) => ({ closed: false, v: [{ p: a }, { p: b }] });

/**
 * Two storeys of a 9 × 6 m house. The ground floor is split at x = 4500 into a living room (left) and a
 * kitchen (right) with a door between them and a window in the kitchen's outer wall; a straight stair
 * climbs from the living room to the landing upstairs, an elevator in the kitchen stops on both floors.
 */
function house() {
  let doc = newProjectDoc({ name: 'House' });
  const ground = doc.building.groundLevelId;
  const added = addLevelOps(doc, { position: 'top', name: 'Upper' });
  doc = commit(doc, added.ops);
  const upper = added.levelId;
  type Key = 'partition' | 'door' | 'window' | 'living' | 'kitchen' | 'landing';
  const ids = {} as Record<Key, string>;
  const add = (levelId: string, entity: Record<string, unknown>, key?: Key) => {
    const r = addEntityOps(doc, { levelId, entity: entity as { type: 'wall' } });
    doc = commit(doc, r.ops);
    if (key) ids[key] = r.id;
    return r.id;
  };
  for (const levelId of [ground, upper]) {
    add(levelId, { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 200 });
  }
  add(ground, { type: 'wall', path: line([4500, 0], [4500, 6000]), thickness: 100 }, 'partition');
  add(ground, { type: 'opening', kind: 'door', wallId: ids.partition, along: 3000, width: 900, height: 2100 }, 'door');
  const outer = Object.values(doc.levelData[ground].entities).find((e) => e.type === 'wall' && e.id !== ids.partition)!;
  add(ground, { type: 'opening', kind: 'window', wallId: outer.id, along: 7000, width: 1200, height: 1200, sill: 900 }, 'window');
  add(ground, { type: 'room', name: 'Living', boundary: { k: 'detect', seed: [2000, 3000] } }, 'living');
  add(ground, { type: 'room', name: 'Kitchen', boundary: { k: 'detect', seed: [7000, 3000] } }, 'kitchen');
  add(upper, { type: 'room', name: 'Landing', boundary: { k: 'detect', seed: [4500, 3000] } }, 'landing');
  const stair = addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: line([1000, 1000], [1000, 4750]), width: 1000 });
  doc = commit(doc, stair.ops);
  const lift = addConnectorOps({ kind: 'elevator', at: [7500, 4500], shaft: { w: 1800, d: 2000 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground, door: 'front' }, { levelId: upper, door: 'front' }] });
  doc = commit(doc, lift.ops);
  return { doc, ground, upper, ids: { ...ids, stair: stair.id, lift: lift.id } };
}

describe('describeDesign', () => {
  const { doc, ground, upper, ids } = house();
  const design = describeDesign(doc, DEFAULT_RULE_LIMITS);
  const level = (id: string) => design.levels.find((l) => l.id === id)!;
  const room = (levelId: string, roomId: string) => level(levelId).rooms.find((r) => r.id === roomId)!;

  it('lists the levels bottom to top with their rooms and areas', () => {
    expect(design.levels.map((l) => [l.name, l.elevation])).toEqual([
      ['Ground floor', 0],
      ['Upper', 3000],
    ]);
    expect(level(ground).counts).toMatchObject({ wall: 2, opening: 2, room: 2 });
    expect(room(ground, ids.living).area).toBeCloseTo((4450 - 100) * 5800, -3);
    expect(room(ground, ids.kitchen).area).toBeCloseTo((8900 - 4550) * 5800, -3);
    expect(design.summary).toMatchObject({ levels: 2, rooms: 3, connectors: 2 });
    expect(design.summary.floorArea).toBe(design.levels.flatMap((l) => l.rooms).reduce((n, r) => n + r.area, 0));
  });

  it('knows which rooms share a wall and which a door connects, and where a window leads', () => {
    const living = room(ground, ids.living);
    const kitchen = room(ground, ids.kitchen);
    expect(living.adjacent).toEqual([{ roomId: ids.kitchen, via: expect.arrayContaining(['wall', 'door']) }]);
    expect(kitchen.adjacent[0].roomId).toBe(ids.living);
    expect(living.openings).toEqual([{ id: ids.door, kind: 'door', width: 900, wallId: ids.partition, to: ids.kitchen }]);
    expect(kitchen.openings.map((o) => [o.kind, o.to])).toEqual(expect.arrayContaining([['door', ids.living], ['window', 'outside']]));
    const window = level(ground).openings.find((o) => o.id === ids.window)!;
    expect(window.between).toContain(ids.kitchen);
    expect(window.between).toContain(null);
  });

  it('follows each connector to the room it opens into on every level', () => {
    const stair = design.circulation.find((c) => c.id === ids.stair)!;
    expect(stair.stops).toEqual([
      { levelId: ground, roomId: ids.living },
      { levelId: upper, roomId: ids.landing },
    ]);
    expect(stair.cuts).toEqual([upper]);
    expect(stair.derived).toMatchObject({ risers: 16, riserHeight: 187.5 });
    const lift = design.circulation.find((c) => c.id === ids.lift)!;
    expect(lift.stops).toEqual([
      { levelId: ground, roomId: ids.kitchen, door: 'front' },
      { levelId: upper, roomId: ids.landing, door: 'front' },
    ]);
    expect(room(ground, ids.living).connectors).toEqual([{ id: ids.stair, kind: 'stair', role: 'bottom' }]);
    expect(room(upper, ids.landing).connectors.map((c) => c.role)).toEqual(['top', 'stop']);
    expect(level(upper).connectors.find((c) => c.id === ids.lift)).toMatchObject({ role: 'stop', roomId: ids.landing });
  });

  it('counts enclosed spaces no room names yet', () => {
    const bare = newProjectDoc({ name: 'Bare' });
    const lv = bare.building.groundLevelId;
    const withWalls = commit(bare, addEntityOps(bare, { levelId: lv, entity: { type: 'wall', path: rectPath(0, 0, 5000, 4000), thickness: 200 } }).ops);
    const d = describeDesign(withWalls, DEFAULT_RULE_LIMITS);
    expect(d.levels[0].rooms).toEqual([]);
    expect(d.levels[0].unnamedSpaces).toHaveLength(1);
    expect(d.levels[0].unnamedSpaces[0].area).toBeCloseTo(4800 * 3800, -3);
    expect(describeDesign(bare, DEFAULT_RULE_LIMITS).levels[0].unnamedSpaces).toEqual([]);
  });
});
