import { addConnectorOps, addEntityOps, addLevelOps, type NewEntity } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction, type Op } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { rectPath, type Path } from '../geometry/path';

/* The house the exchange tests draw and write; not part of the package's exports. */

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });

/**
 * A 9 × 6 m house on two floors (200 mm walls on the rectangle). The ground floor is split at
 * x = 4500 by a 100 mm partition with a 900 mm door; the outer wall has a 1200 mm window at 7000 along
 * the bottom; a living room and a kitchen; a straight stair up from the living room; an elevator in
 * the kitchen; an automatic slab; a dimension under the house; a label; a table; a light; a column rising to the upper
 * floor; and a closed shape with an arc.
 */
export function drawingHouse() {
  let doc = newProjectDoc({ name: 'House' });
  const ground = doc.building.groundLevelId;
  const added = addLevelOps(doc, { position: 'top', name: 'Upper' });
  doc = commit(doc, added.ops);
  const upper = added.levelId;
  const ids: Record<string, string> = {};
  const add = (levelId: string, entity: NewEntity, key?: string) => {
    const r = addEntityOps(doc, { levelId, entity });
    doc = commit(doc, r.ops);
    if (key) ids[key] = r.id;
    return r.id;
  };
  add(ground, { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 200 }, 'outer');
  add(upper, { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 200 });
  add(ground, { type: 'wall', path: line([4500, 0], [4500, 6000]), thickness: 100 }, 'partition');
  add(ground, { type: 'opening', kind: 'door', wallId: ids.partition, along: 3000, width: 900, height: 2100 }, 'door');
  add(ground, { type: 'opening', kind: 'window', wallId: ids.outer, along: 7000, width: 1200, height: 1200, sill: 900 }, 'window');
  add(ground, { type: 'room', name: 'Living', boundary: { k: 'detect', seed: [2000, 3000] } }, 'living');
  add(ground, { type: 'room', name: 'Kitchen', boundary: { k: 'detect', seed: [7000, 3000] } }, 'kitchen');
  add(ground, { type: 'dimension', kind: 'aligned', from: [0, 0], to: [9000, 0], offset: -800 }, 'dimension');
  add(ground, { type: 'label', text: 'Entrance', at: [2000, -1500], size: 250 }, 'label');
  add(ground, { type: 'item', asset: 'builtin:coffee-table', at: [2500, 4500, 0] }, 'table');
  add(ground, { type: 'light', kind: 'point', at: [3000, 2000, 2400] }, 'light');
  add(ground, { type: 'column', at: [6000, 1500], shape: { k: 'circle', r: 150 }, span: { topLevelId: upper, topOffset: 3000 } }, 'column');
  add(ground, { type: 'slab', source: { k: 'auto' } }, 'slab');
  add(ground, { type: 'shape', path: { closed: true, v: [{ p: [10000, 0] }, { p: [12000, 0], s: { k: 'arc', bulge: 0.5 } }, { p: [12000, 2000] }, { p: [10000, 2000] }] } }, 'shape');
  add(upper, { type: 'room', name: 'Landing', boundary: { k: 'detect', seed: [4500, 3000] } }, 'landing');
  const stair = addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: line([1000, 1000], [1000, 4750]), width: 1000 });
  doc = commit(doc, stair.ops);
  const lift = addConnectorOps({ kind: 'elevator', at: [7500, 4500], shaft: { w: 1800, d: 2000 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground, door: 'front' }, { levelId: upper, door: 'front' }] });
  doc = commit(doc, lift.ops);
  return { doc, ground, upper, ids: { ...ids, stair: stair.id, lift: lift.id } };
}
