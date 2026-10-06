import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addConnectorOps, addEntityOps, addLevelOps, updateLevelOps } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { applyPatch } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { rectPath } from '../geometry/path';
import { checkConnectorRules, checkLevelRules, checkRules } from './check';

const limits = DEFAULT_RULE_LIMITS;

/** A two-storey box with an automatic slab on each floor. */
function house(): { doc: ProjectDoc; ground: string; upper: string } {
  let doc = newProjectDoc({ name: 'Rules' });
  const ground = doc.building.groundLevelId;
  const upper = addLevelOps(doc, { name: 'Upper' });
  doc = applyPatch(doc, upper.ops);
  for (const levelId of [ground, upper.levelId]) {
    doc = applyPatch(doc, addEntityOps(doc, { levelId, entity: { type: 'wall', path: rectPath(0, 0, 10000, 8000), thickness: 200 } }).ops);
    doc = applyPatch(doc, addEntityOps(doc, { levelId, entity: { type: 'slab', source: { k: 'auto' } } }).ops);
  }
  return { doc, ground, upper: upper.levelId };
}

const stair = (ground: string, upper: string, extra: Record<string, unknown> = {}) => ({ kind: 'stair' as const, shape: 'straight' as const, bottom: { levelId: ground, offset: 0 }, top: { levelId: upper, offset: 0 }, axis: { closed: false, v: [{ p: [2000, 1000] }, { p: [2000, 4750] }] }, width: 1000, riser: {}, tread: {}, handrails: { left: true, right: true }, ...extra });

describe('checkRules', () => {
  it('finds nothing wrong with a sound house', () => {
    const { doc, ground, upper } = house();
    const sound = applyPatch(doc, addConnectorOps(stair(ground, upper)).ops);
    expect(checkRules(sound, limits)).toEqual([]);
  });

  it('reports a stair outside its limits on the level it starts from, and a ramp too steep', () => {
    const { doc, ground, upper } = house();
    const steep = addConnectorOps(stair(ground, upper, { riser: { count: 8 } }));
    let d = applyPatch(doc, steep.ops);
    const ramp = addConnectorOps({ kind: 'ramp', bottom: { levelId: ground, offset: 0 }, top: { levelId: upper, offset: 0 }, axis: { closed: false, v: [{ p: [5000, 1000] }, { p: [5000, 7000] }] }, width: 1200, maxSlope: 8.33 });
    d = applyPatch(d, ramp.ops);
    const warnings = checkConnectorRules(d, limits);
    expect(warnings.map((w) => [w.rule, w.target.id, w.levelId])).toEqual(expect.arrayContaining([['stair-limits', steep.id, ground], ['ramp-slope', ramp.id, ground]]));
    expect(warnings.find((w) => w.target.id === steep.id)).toMatchObject({ id: `${steep.id}:riser-high`, severity: 'warning', target: { kind: 'connector' } });
    expect(warnings.find((w) => w.target.id === ramp.id)?.message).toMatch(/Ramp/);
    // The same stair reads fine with a riser count that fits.
    expect(checkConnectorRules(applyPatch(doc, addConnectorOps(stair(ground, upper, { riser: { count: 16 } })).ops), limits)).toEqual([]);
  });

  it('reports an elevator stopping twice at one elevation, as an error on its lowest stop', () => {
    const { doc, ground, upper } = house();
    const mezz = addLevelOps(doc, { name: 'Mezzanine', height: 1500, offsetFrom: { levelId: ground, offset: 0 } });
    let d = applyPatch(doc, mezz.ops);
    const lift = addConnectorOps({ kind: 'elevator', at: [7000, 5000], rotation: 0, shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground, door: 'front' }, { levelId: mezz.levelId, door: 'front' }, { levelId: upper, door: 'front' }] });
    d = applyPatch(d, lift.ops);
    const w = checkConnectorRules(d, limits).find((x) => x.target.id === lift.id);
    expect(w).toMatchObject({ rule: 'elevator-stops', severity: 'error', levelId: ground });
  });

  it('reports a door that does not fit, a room that is not enclosed and a wall that crosses itself', () => {
    const { doc, ground } = house();
    const wallId = Object.values(doc.levelData[ground].entities).find((e) => e.type === 'wall')!.id;
    let d = applyPatch(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'opening', kind: 'door', wallId, along: 200, width: 900, height: 2100, sill: 0 } }).ops);
    const room = addEntityOps(d, { levelId: ground, entity: { type: 'room', name: 'Lost', boundary: { k: 'detect', seed: [20000, 20000] } } });
    d = applyPatch(d, room.ops);
    const bowtie = addEntityOps(d, { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [12000, 0] }, { p: [14000, 2000] }, { p: [14000, 0] }, { p: [12000, 2000] }] }, thickness: 100 } });
    d = applyPatch(d, bowtie.ops);
    const warnings = checkLevelRules(d, ground, limits);
    expect(warnings.map((w) => w.rule).sort()).toEqual(['opening-misfit', 'room-open', 'self-intersecting']);
    expect(warnings.find((w) => w.rule === 'room-open')).toMatchObject({ target: { kind: 'entity', id: room.id }, message: 'Room "Lost" on Ground floor is not enclosed', levelId: ground });
    expect(warnings.find((w) => w.rule === 'self-intersecting')).toMatchObject({ severity: 'error', target: { id: bowtie.id } });
    expect(warnings.find((w) => w.rule === 'opening-misfit')?.message).toMatch(/^Door does not fit/);
  });

  it('reports a stairwell outside the slab of the floor it arrives at, and a floor without a slab', () => {
    const { doc, ground, upper } = house();
    // A stair that arrives outside the 10 × 8 m box.
    const outside = addConnectorOps(stair(ground, upper, { axis: { closed: false, v: [{ p: [12000, 1000] }, { p: [12000, 4750] }] } }));
    let d = applyPatch(doc, outside.ops);
    expect(checkLevelRules(d, upper, limits)).toMatchObject([{ rule: 'opening-uncovered', target: { kind: 'connector', id: outside.id }, levelId: upper }]);
    expect(checkLevelRules(d, ground, limits)).toEqual([]);
    // The same stair inside the box is fine; without any slab on the upper floor it is reported again.
    const inside = addConnectorOps(stair(ground, upper));
    d = applyPatch(doc, inside.ops);
    expect(checkLevelRules(d, upper, limits)).toEqual([]);
    const slabId = Object.values(d.levelData[upper].entities).find((e) => e.type === 'slab')!.id;
    const bare = applyPatch(d, [{ t: 'del', c: 'entity', id: slabId, lv: upper }]);
    expect(checkLevelRules(bare, upper, limits)[0]?.message).toMatch(/has no slab/);
  });

  it('follows a level height change: a taller storey makes the same stair break its tread limit', () => {
    const { doc, ground, upper } = house();
    let d = applyPatch(doc, addConnectorOps(stair(ground, upper)).ops);
    expect(checkRules(d, limits)).toEqual([]);
    d = applyPatch(d, updateLevelOps(d, ground, { height: 4500 }));
    expect(checkRules(d, limits).map((w) => w.id.split(':')[1])).toContain('tread-short');
  });
});
