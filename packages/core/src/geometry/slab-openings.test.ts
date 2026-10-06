import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addConnectorOps, addLevelOps, updateLevelOps } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction, type Op } from '../doc/ops';
import type { Entity, ProjectDoc } from '../doc/schema';
import { connectorCuts } from './connectors';
import { cutSlabs, deriveLevelGeometry } from './level-geometry';
import { rectPath, type Path } from './path';
import { polygonArea, type Polygon } from './polygon';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });
const area = (polys: Polygon[]) => polys.reduce((sum, p) => sum + polygonArea(p), 0);

/** Ground floor, Level 1 and Level 2 (3000 each), with a gallery on the ground floor at 1500. */
function building() {
  let doc = newProjectDoc({ name: 'Test' });
  const ground = doc.building.groundLevelId;
  const l1 = addLevelOps(doc, { name: 'Level 1' });
  doc = commit(doc, l1.ops);
  const l2 = addLevelOps(doc, { name: 'Level 2' });
  doc = commit(doc, l2.ops);
  const gallery = addLevelOps(doc, { name: 'Gallery', offsetFrom: { levelId: ground, offset: 1500 }, height: 1500 });
  doc = commit(doc, gallery.ops);
  return { doc, ground, l1: l1.levelId, l2: l2.levelId, gallery: gallery.levelId };
}

const stairOps = (bottom: string, top: string) => addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: bottom }, top: { levelId: top }, axis: line([2000, 1000], [2000, 4750]), width: 1000 });

describe('slab openings', () => {
  it('cuts a stair out of the slab it arrives at, not the one it starts from', () => {
    const b = building();
    const doc = commit(b.doc, stairOps(b.ground, b.l1).ops);
    expect(connectorCuts(doc, b.ground, DEFAULT_RULE_LIMITS)).toEqual([]);
    expect(area(connectorCuts(doc, b.l1, DEFAULT_RULE_LIMITS))).toBeCloseTo(1000 * 3750, -1);
    expect(connectorCuts(doc, b.l2, DEFAULT_RULE_LIMITS)).toEqual([]);
  });

  it('cuts every floor a stair passes, a mezzanine included', () => {
    const b = building();
    const doc = commit(b.doc, stairOps(b.ground, b.l2).ops);
    expect(area(connectorCuts(doc, b.gallery, DEFAULT_RULE_LIMITS))).toBeCloseTo(1000 * 3750, -1);
    expect(area(connectorCuts(doc, b.l1, DEFAULT_RULE_LIMITS))).toBeCloseTo(1000 * 3750, -1);
    expect(area(connectorCuts(doc, b.l2, DEFAULT_RULE_LIMITS))).toBeCloseTo(1000 * 3750, -1);
    expect(connectorCuts(doc, b.ground, DEFAULT_RULE_LIMITS)).toEqual([]);
  });

  it('cuts an elevator shaft out of every slab above its lowest stop', () => {
    const b = building();
    const lift = addConnectorOps({ kind: 'elevator', at: [7000, 3000], shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: b.ground }, { levelId: b.l2 }] });
    const doc = commit(b.doc, lift.ops);
    expect(connectorCuts(doc, b.ground, DEFAULT_RULE_LIMITS)).toEqual([]);
    for (const level of [b.gallery, b.l1, b.l2]) expect(area(connectorCuts(doc, level, DEFAULT_RULE_LIMITS))).toBeCloseTo(2000 * 2200, -1);
  });

  it('takes the openings out of the automatic slab and out of drawn slabs', () => {
    const lv = 'lvl_0000000000000001';
    const layer = 'lyr_0000000000000001';
    const wall = (id: string, path: Path): Entity => ({ id, type: 'wall', levelId: lv, layerId: layer, path, thickness: 200, height: null, alignment: 'center', baseOffset: 0 });
    const walls = [wall('a', line([0, 0], [9000, 0])), wall('b', line([9000, 0], [9000, 6000])), wall('c', line([9000, 6000], [0, 6000])), wall('d', line([0, 6000], [0, 0]))];
    const auto: Entity = { id: 'slb_auto', type: 'slab', levelId: lv, layerId: layer, source: { k: 'auto' } };
    const drawn: Entity = { id: 'slb_drawn', type: 'slab', levelId: lv, layerId: layer, source: { k: 'region', region: { outer: rectPath(20000, 0, 5000, 5000), holes: [] } } };
    const entities = Object.fromEntries([...walls, auto, drawn].map((e) => [e.id, e]));
    const hole: Polygon = [
      [1500, 1000],
      [2500, 1000],
      [2500, 4750],
      [1500, 4750],
    ];
    const inDrawn: Polygon = [
      [21000, 1000],
      [22000, 1000],
      [22000, 2000],
      [21000, 2000],
    ];
    const whole = deriveLevelGeometry(entities);
    const cut = deriveLevelGeometry(entities, { cuts: [hole, inDrawn] });
    expect(area(whole.slab)).toBeCloseTo(9200 * 6200, -2);
    expect(area(cut.slab)).toBeCloseTo(9200 * 6200 - 1000 * 3750, -2);
    expect(area(cut.slabRegions.get('slb_drawn')!)).toBeCloseTo(5000 * 5000 - 1000 * 1000, -2);
    expect(cut.cuts).toHaveLength(2);
    // The rooms do not change: a stairwell is a hole in the floor, not in the room.
    expect(cutSlabs(whole, [hole]).cavities).toBe(whole.cavities);
  });

  it('follows a height change: an escalator taller between its floors opens a longer hole', () => {
    const b = building();
    const escalator = addConnectorOps({ kind: 'escalator', bottom: { levelId: b.ground }, top: { levelId: b.l1 }, at: [0, 0], direction: 0, width: 1000 });
    let doc = commit(b.doc, escalator.ops);
    const before = area(connectorCuts(doc, b.l1, DEFAULT_RULE_LIMITS));
    doc = commit(doc, updateLevelOps(doc, b.ground, { height: 4000 }));
    const after = area(connectorCuts(doc, b.l1, DEFAULT_RULE_LIMITS));
    expect(before).toBeCloseTo(1000 * (3000 / Math.tan(Math.PI / 6) + 2400), -1);
    expect(after - before).toBeCloseTo(1000 * (1000 / Math.tan(Math.PI / 6)), -1);
  });
});
