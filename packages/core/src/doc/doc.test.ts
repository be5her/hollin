import { describe, expect, it } from 'vitest';
import { rectPath } from '../geometry/path';
import {
  addConnectorOps,
  addEntityOps,
  addLayerOps,
  addLevelOps,
  deleteEntitiesOps,
  duplicateLevelOps,
  moveLayerOps,
  moveLevelOps,
  removeLayerOps,
  removeLevelOps,
  updateEntityOps,
  updateLevelOps,
} from './builders';
import { newProjectDoc } from './defaults';
import { deriveLevels, entitiesOnLevel } from './derive';
import { DocumentEngine, type Author, type DocPatch } from './engine';
import { Transaction, applyPatch, type Op } from './ops';
import { refsOf } from './refs';
import type { ProjectDoc } from './schema';

const you: Author = { kind: 'user', name: 'You' };
const agent: Author = { kind: 'mcp', name: 'claude-code 2.1' };

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

/** Ground floor plus `above` levels on top and `below` basements, all 3000 mm. */
function building(above = 2, below = 1): { doc: ProjectDoc; ids: string[] } {
  let doc = newProjectDoc({ name: 'Test' });
  const ground = doc.building.groundLevelId;
  for (let i = 0; i < above; i++) doc = commit(doc, addLevelOps(doc, { position: 'top' }).ops);
  for (let i = 0; i < below; i++) doc = commit(doc, addLevelOps(doc, { position: 'bottom' }).ops);
  return { doc, ids: [...doc.building.stack, ground] };
}

const elevations = (doc: ProjectDoc) => deriveLevels(doc).map((l) => [l.name, l.elevation]);

describe('levels and elevations', () => {
  it('stacks levels up from the ground and basements down', () => {
    const { doc } = building(2, 2);
    expect(elevations(doc)).toEqual([
      ['Basement 2', -6000],
      ['Basement 1', -3000],
      ['Ground floor', 0],
      ['Level 1', 3000],
      ['Level 2', 6000],
    ]);
    const derived = deriveLevels(doc);
    expect(derived.find((l) => l.name === 'Basement 1')).toMatchObject({ isBasement: true, top: 0 });
    expect(derived.find((l) => l.name === 'Ground floor')).toMatchObject({ isGround: true });
  });

  it('shifts every level above when a height changes, and deepens basements below', () => {
    let { doc } = building(2, 1);
    const ground = doc.building.groundLevelId;
    doc = commit(doc, updateLevelOps(doc, ground, { height: 4500 }));
    expect(elevations(doc)).toEqual([
      ['Basement 1', -3000],
      ['Ground floor', 0],
      ['Level 1', 4500],
      ['Level 2', 7500],
    ]);
    const basement = doc.building.stack[0];
    doc = commit(doc, updateLevelOps(doc, basement, { height: 4000 }));
    expect(elevations(doc)[0]).toEqual(['Basement 1', -4000]);
    expect(elevations(doc)[1]).toEqual(['Ground floor', 0]);
  });

  it('sets an elevation by changing the value that produces it', () => {
    let { doc } = building(2, 1);
    const [basement, ground, l1, l2] = doc.building.stack;
    doc = commit(doc, updateLevelOps(doc, l2, { elevation: 7000 }));
    expect(doc.levels[l1].place).toMatchObject({ height: 4000 });
    expect(elevations(doc).at(-1)).toEqual(['Level 2', 7000]);
    doc = commit(doc, updateLevelOps(doc, basement, { elevation: -3500 }));
    expect(doc.levels[basement].place).toMatchObject({ height: 3500 });
    doc = commit(doc, updateLevelOps(doc, ground, { elevation: 450 }));
    expect(doc.building.datum).toBe(450);
    expect(elevations(doc).map(([, e]) => e)).toEqual([-3050, 450, 3450, 7450]);
    expect(() => updateLevelOps(doc, l1, { elevation: 0 })).toThrow(/cannot be at or below/);
  });

  it('places mezzanines at an offset from a host level', () => {
    let { doc } = building(1, 0);
    const ground = doc.building.groundLevelId;
    const { ops, levelId } = addLevelOps(doc, { name: 'Gallery', offsetFrom: { levelId: ground, offset: 1500 }, height: 1500 });
    doc = commit(doc, ops);
    expect(elevations(doc)).toEqual([
      ['Ground floor', 0],
      ['Gallery', 1500],
      ['Level 1', 3000],
    ]);
    doc = commit(doc, updateLevelOps(doc, ground, { height: 3300 }));
    expect(deriveLevels(doc).find((l) => l.id === levelId)?.elevation).toBe(1500);
    doc = commit(doc, updateLevelOps(doc, levelId, { elevation: 1800 }));
    expect(doc.levels[levelId].place).toMatchObject({ k: 'offset', offset: 1800 });
    expect(() => removeLevelOps(doc, ground)).toThrow(/re-host "Gallery"/);
  });

  it('reorders the stack', () => {
    let { doc } = building(2, 0);
    const [ground, l1, l2] = doc.building.stack;
    doc = commit(doc, moveLevelOps(doc, l2, 1));
    expect(doc.building.stack).toEqual([ground, l2, l1]);
    expect(elevations(doc).map(([n]) => n)).toEqual(['Ground floor', 'Level 2', 'Level 1']);
  });

  it('removes a level with its content; levels above drop, connectors to it go', () => {
    let { doc } = building(2, 0);
    const [ground, l1, l2] = doc.building.stack;
    const wall = addEntityOps(doc, { levelId: l1, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }, { p: [4000, 0] }] }, thickness: 200 } });
    doc = commit(doc, wall.ops);
    const stair = addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: l1 }, axis: { closed: false, v: [{ p: [0, 0] }, { p: [0, 4000] }] }, width: 1000 });
    const lift = addConnectorOps({ kind: 'elevator', at: [5000, 5000], shaft: { w: 2000, d: 2000 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground }, { levelId: l1 }, { levelId: l2 }] });
    doc = commit(doc, [...stair.ops, ...lift.ops]);
    const removed = commit(doc, removeLevelOps(doc, l1));
    expect(removed.levels[l1]).toBeUndefined();
    expect(removed.levelData[l1]).toBeUndefined();
    expect(Object.values(removed.layers).some((l) => l.levelId === l1)).toBe(false);
    expect(removed.connectors[stair.id]).toBeUndefined();
    expect((removed.connectors[lift.id] as { stops: { levelId: string }[] }).stops.map((s) => s.levelId)).toEqual([ground, l2]);
    expect(elevations(removed)).toEqual([
      ['Ground floor', 0],
      ['Level 2', 3000],
    ]);
    // Removing the ground floor makes the next level up the ground, at the same datum.
    const noGround = commit(removed, removeLevelOps(removed, ground));
    expect(noGround.building.groundLevelId).toBe(l2);
    expect(elevations(noGround)).toEqual([['Level 2', 0]]);
    expect(() => removeLevelOps(noGround, l2)).toThrow(/at least one level/);
  });

  it('duplicates a level with its layout under new ids, references remapped', () => {
    let { doc } = building(1, 0);
    const ground = doc.building.groundLevelId;
    const w = addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }, { p: [4000, 0] }] }, thickness: 200 } });
    doc = commit(doc, w.ops);
    const door = addEntityOps(doc, { levelId: ground, entity: { type: 'opening', kind: 'door', wallId: w.id, along: 1000, width: 900, height: 2100 } });
    doc = commit(doc, door.ops);
    const { ops, levelId } = duplicateLevelOps(doc, ground);
    doc = commit(doc, ops);
    expect(doc.building.stack.indexOf(levelId)).toBe(1);
    expect(elevations(doc).map(([n]) => n)).toEqual(['Ground floor', 'Ground floor copy', 'Level 1']);
    const copies = Object.values(doc.levelData[levelId].entities);
    expect(copies).toHaveLength(2);
    const copyWall = copies.find((e) => e.type === 'wall')!;
    const copyDoor = copies.find((e) => e.type === 'opening')! as { wallId: string; layerId: string };
    expect(copyWall.id).not.toBe(w.id);
    expect(copyDoor.wallId).toBe(copyWall.id);
    expect(doc.layers[copyDoor.layerId].levelId).toBe(levelId);
  });
});

describe('transactions', () => {
  it('validates every touched record and rounds lengths', () => {
    const { doc } = building(0, 0);
    const ground = doc.building.groundLevelId;
    const { ops, id } = addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [0.00049, 0] }, { p: [1234.5678, 0] }] }, thickness: 200.0004 } });
    const next = commit(doc, ops);
    const wall = next.levelData[ground].entities[id] as { path: { v: { p: number[] }[] }; thickness: number; alignment: string; height: null };
    expect(wall.path.v[0].p).toEqual([0, 0]);
    expect(wall.path.v[1].p).toEqual([1234.568, 0]);
    expect(wall.thickness).toBe(200);
    expect(wall.alignment).toBe('center');
    expect(wall.height).toBeNull();
    const bad = addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }] }, thickness: -1 } });
    expect(() => commit(doc, bad.ops)).toThrow(/is not valid: path.v: .*; thickness/);
  });

  it('is all or nothing', () => {
    const { doc } = building(1, 0);
    const ground = doc.building.groundLevelId;
    const good = addEntityOps(doc, { levelId: ground, entity: { type: 'label', text: 'A', at: [0, 0] } });
    const tx = new Transaction(doc);
    tx.apply(good.ops);
    tx.apply([{ t: 'upd', c: 'level', id: ground, set: { slabThickness: -5 } }]);
    expect(() => tx.commit()).toThrow();
    expect(doc.levelData[ground].entities).toEqual({});
  });

  it('keeps references intact', () => {
    const { doc } = building(1, 0);
    const [ground, l1] = doc.building.stack;
    const structure = Object.values(doc.layers).find((l) => l.levelId === ground && l.kind === 'structure')!.id;
    const interior = Object.values(doc.layers).find((l) => l.levelId === ground && l.kind === 'interior')!.id;
    const upstairsLayer = Object.values(doc.layers).find((l) => l.levelId === l1 && l.kind === 'interior')!.id;
    expect(() => commit(doc, addEntityOps(doc, { levelId: ground, layerId: interior, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }, { p: [1, 0] }] }, thickness: 100 } }).ops)).toThrow(/belongs on a structure layer/);
    expect(() => commit(doc, addEntityOps(doc, { levelId: ground, layerId: upstairsLayer, entity: { type: 'label', text: 'x', at: [0, 0] } }).ops)).toThrow(/layer belongs to another level/);
    expect(() => commit(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'opening', kind: 'door', wallId: 'wal_0000000000000000', along: 0, width: 900, height: 2100 } }).ops)).toThrow(/does not exist/);
    expect(() => commit(doc, [{ t: 'del', c: 'layer', id: structure }, { t: 'del', c: 'layer', id: interior }, ...removeLayerOps(doc, Object.values(doc.layers).find((l) => l.levelId === ground && l.kind === 'decor')!.id)])).not.toThrow();
    const withLabel = commit(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'label', text: 'x', at: [0, 0] } }).ops);
    expect(() => commit(withLabel, [{ t: 'del', c: 'layer', id: interior }])).toThrow(/still refers to layer/);
    expect(() => removeLayerOps(withLabel, interior)).toThrow(/holds 1 item/);
    const stair = addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: l1 }, top: { levelId: ground }, axis: { closed: false, v: [{ p: [0, 0] }, { p: [0, 3000] }] }, width: 1000 });
    expect(() => commit(doc, stair.ops)).toThrow(/top of stair .* must be above its bottom/);
  });

  it('deletes openings with their wall', () => {
    let { doc } = building(0, 0);
    const ground = doc.building.groundLevelId;
    const w = addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }, { p: [4000, 0] }] }, thickness: 200 } });
    doc = commit(doc, w.ops);
    const door = addEntityOps(doc, { levelId: ground, entity: { type: 'opening', kind: 'window', wallId: w.id, along: 2000, width: 1200, height: 1200, sill: 900 } });
    doc = commit(doc, door.ops);
    doc = commit(doc, deleteEntitiesOps(doc, [w.id]));
    expect(doc.levelData[ground].entities).toEqual({});
  });

  it('applies the same patch on the mirror as in main', () => {
    let { doc } = building(1, 1);
    const patches: DocPatch[] = [];
    const engine = new DocumentEngine(doc, { onChange: (_d, p) => patches.push(p) });
    let mirror = doc;
    return (async () => {
      await engine.transact('Add level', you, (tx) => tx.apply(addLevelOps(tx.doc).ops));
      await engine.transact('Duplicate', you, (tx) => tx.apply(duplicateLevelOps(tx.doc, tx.doc.building.groundLevelId).ops));
      await engine.transact('Remove', you, (tx) => tx.apply(removeLevelOps(tx.doc, tx.doc.building.stack[0])));
      engine.undo();
      engine.redo();
      for (const p of patches) mirror = applyPatch(mirror, p.ops);
      expect(mirror).toEqual(engine.doc);
      expect(patches.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5]);
      doc = engine.doc;
      expect(Object.keys(doc.levels)).toHaveLength(Object.keys(doc.levelData).length);
    })();
  });
});

describe('history', () => {
  it('undoes and redoes back to the exact same documents', async () => {
    const { doc: start } = building(1, 0);
    const engine = new DocumentEngine(start, { onChange: () => {} });
    const states: ProjectDoc[] = [engine.doc];
    const ground = start.building.groundLevelId;
    await engine.transact('Add wall', you, (tx) => tx.apply(addEntityOps(tx.doc, { levelId: ground, entity: { type: 'wall', path: rectPath(0, 0, 5000, 4000), thickness: 200 } }).ops));
    states.push(engine.doc);
    await engine.transact('Taller ground floor', agent, (tx) => tx.apply(updateLevelOps(tx.doc, ground, { height: 3600, name: 'Lobby' })));
    states.push(engine.doc);
    await engine.transact('Add layer', you, (tx) => tx.apply(addLayerOps(tx.doc, { levelId: ground, kind: 'decor', name: 'Option B' }).ops));
    states.push(engine.doc);
    await engine.transact('Remove upstairs', you, (tx) => tx.apply(removeLevelOps(tx.doc, tx.doc.building.stack[1])));
    states.push(engine.doc);
    expect(engine.history().undo).toMatchObject({ label: 'Remove upstairs', author: you });
    for (let i = states.length - 2; i >= 0; i--) {
      engine.undo();
      expect(engine.doc).toEqual(states[i]);
    }
    expect(() => engine.undo()).toThrow(/nothing to undo/);
    for (let i = 1; i < states.length; i++) {
      engine.redo();
      expect(engine.doc).toEqual(states[i]);
    }
    expect(() => engine.redo()).toThrow(/nothing to redo/);
  });

  it('only undoes the newest change when asked for a specific one', async () => {
    const engine = new DocumentEngine(building(0, 0).doc, { onChange: () => {} });
    const ground = engine.doc.building.groundLevelId;
    const mine = await engine.transact('Agent edit', agent, (tx) => tx.apply(updateLevelOps(tx.doc, ground, { name: 'A' })));
    await engine.transact('User edit', you, (tx) => tx.apply(updateLevelOps(tx.doc, ground, { name: 'B' })));
    expect(() => engine.undo(mine.txId!)).toThrow(/not the one you meant/);
    expect(engine.doc.levels[ground].name).toBe('B');
  });

  it('merges rapid edits with the same key into one step, per author', async () => {
    let now = 0;
    const engine = new DocumentEngine(building(0, 0).doc, { onChange: () => {}, now: () => now });
    const ground = engine.doc.building.groundLevelId;
    const original = engine.doc;
    for (let i = 1; i <= 5; i++) {
      now += 200;
      await engine.transact('Opacity', you, (tx) => tx.apply([{ t: 'upd', c: 'layer', id: Object.values(tx.doc.layers)[0].id, set: { opacity: 1 - i / 10 } }]), { coalesce: 'opacity' });
    }
    expect(engine.entries().undo).toHaveLength(1);
    now += 5000;
    await engine.transact('Opacity', you, (tx) => tx.apply([{ t: 'upd', c: 'layer', id: Object.values(tx.doc.layers)[0].id, set: { opacity: 0.2 } }]), { coalesce: 'opacity' });
    expect(engine.entries().undo).toHaveLength(2);
    engine.undo();
    engine.undo();
    expect(engine.doc).toEqual(original);
    void ground;
  });

  it('caps the history', async () => {
    const engine = new DocumentEngine(building(0, 0).doc, { onChange: () => {}, maxEntries: 3 });
    const ground = engine.doc.building.groundLevelId;
    for (let i = 0; i < 5; i++) await engine.transact(`Rename ${i}`, you, (tx) => tx.apply(updateLevelOps(tx.doc, ground, { name: `N${i}` })));
    expect(engine.entries().undo.map((e) => e.label)).toEqual(['Rename 4', 'Rename 3', 'Rename 2']);
  });

  it('records nothing for a change that changes nothing', async () => {
    const engine = new DocumentEngine(building(0, 0).doc, { onChange: () => {} });
    const ground = engine.doc.building.groundLevelId;
    const result = await engine.transact('Same name', you, (tx) => tx.apply(updateLevelOps(tx.doc, ground, { name: 'Ground floor' })));
    expect(result.changed).toBe(false);
    expect(engine.history().undo).toBeNull();
  });

  it('replaces the whole document with a new epoch and no history', async () => {
    const patches: DocPatch[] = [];
    const engine = new DocumentEngine(building(0, 0).doc, { onChange: (_d, p) => patches.push(p) });
    await engine.transact('Edit', you, (tx) => tx.apply(updateLevelOps(tx.doc, tx.doc.building.groundLevelId, { name: 'X' })));
    engine.replace(building(1, 0).doc, 'Restore', you);
    expect(engine.epoch).toBe(2);
    expect(engine.history()).toEqual({ undo: null, redo: null });
    expect(patches.at(-1)?.tx.kind).toBe('replace');
  });
});

describe('layers and spans', () => {
  it('reorders layers and keeps orders dense', () => {
    let { doc } = building(0, 0);
    const ground = doc.building.groundLevelId;
    const extra = addLayerOps(doc, { levelId: ground, kind: 'interior' });
    doc = commit(doc, extra.ops);
    expect(doc.layers[extra.layerId].name).toBe('Interior 2');
    doc = commit(doc, moveLayerOps(doc, extra.layerId, 0));
    const ordered = Object.values(doc.layers).filter((l) => l.levelId === ground).sort((a, b) => a.order - b.order);
    expect(ordered.map((l) => l.order)).toEqual([0, 1, 2, 3]);
    expect(ordered[0].id).toBe(extra.layerId);
  });

  it('shows spanning entities on the levels they pass through', () => {
    let { doc } = building(2, 0);
    const [ground, l1, l2] = doc.building.stack;
    const column = addEntityOps(doc, { levelId: ground, entity: { type: 'column', at: [0, 0], shape: { k: 'rect', w: 300, d: 300 }, span: { topLevelId: l2 } } });
    doc = commit(doc, column.ops);
    expect(entitiesOnLevel(doc, ground).map((e) => e.id)).toEqual([column.id]);
    expect(entitiesOnLevel(doc, l1).map((e) => e.id)).toEqual([column.id]);
    expect(entitiesOnLevel(doc, l2)).toEqual([]);
    doc = commit(doc, updateEntityOps(doc, column.id, { span: { topLevelId: l2, topOffset: 3000 } }));
    expect(entitiesOnLevel(doc, l2).map((e) => e.id)).toEqual([column.id]);
    // Removing the top level makes the column a single-level column.
    doc = commit(doc, removeLevelOps(doc, l2));
    expect('span' in doc.levelData[ground].entities[column.id]).toBe(false);
  });
});

describe('references', () => {
  it('declares every field that holds an id', () => {
    let { doc } = building(2, 1);
    const [, ground, l1] = doc.building.stack;
    const w = addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }, { p: [4000, 0] }] }, thickness: 200 } });
    doc = commit(doc, w.ops);
    const extras: Op[] = [
      ...addEntityOps(doc, { levelId: ground, entity: { type: 'opening', kind: 'door', wallId: w.id, along: 500, width: 900, height: 2100 } }).ops,
      ...addEntityOps(doc, { levelId: ground, entity: { type: 'shaft', region: { outer: rectPath(0, 0, 2000, 2000) }, span: { topLevelId: l1 } } }).ops,
      ...addLevelOps(doc, { offsetFrom: { levelId: ground, offset: 1500 } }).ops,
      ...addConnectorOps({ kind: 'elevator', at: [0, 0], shaft: { w: 2000, d: 2000 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground }, { levelId: l1 }] }).ops,
      ...addConnectorOps({ kind: 'ramp', bottom: { levelId: ground }, top: { levelId: l1 }, axis: { closed: false, v: [{ p: [0, 0] }, { p: [36000, 0] }] }, width: 1500 }).ops,
    ];
    doc = commit(doc, extras);
    const ids = new Set<string>([...Object.keys(doc.levels), ...Object.keys(doc.layers), ...Object.keys(doc.connectors), ...Object.values(doc.levelData).flatMap((d) => Object.keys(d.entities))]);
    const records: [Parameters<typeof refsOf>[0], unknown, string][] = [
      ['building', doc.building, 'building'],
      ...Object.values(doc.levels).map((v) => ['level', v, v.id] as [Parameters<typeof refsOf>[0], unknown, string]),
      ...Object.values(doc.layers).map((v) => ['layer', v, v.id] as [Parameters<typeof refsOf>[0], unknown, string]),
      ...Object.values(doc.connectors).map((v) => ['connector', v, v.id] as [Parameters<typeof refsOf>[0], unknown, string]),
      ...Object.values(doc.levelData).flatMap((d) => Object.values(d.entities)).map((v) => ['entity', v, v.id] as [Parameters<typeof refsOf>[0], unknown, string]),
    ];
    for (const [coll, value, ownId] of records) {
      const declared = new Set(refsOf(coll, value).map((r) => r.path));
      const walk = (v: unknown, path: string[]) => {
        if (typeof v === 'string' && ids.has(v) && v !== ownId) expect(declared, `${coll} ${ownId} ${path.join('.')}`).toContain(path.join('.'));
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
      };
      walk(value, []);
    }
  });
});
