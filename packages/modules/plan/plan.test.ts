import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommandRegistry, deriveLevels, testHost, type CommandContext, type HostApi, type ProjectDoc } from '@studio/core';
import { ProjectService } from '@studio/core/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mainModules } from '../main';

let root: string;
let service: ProjectService;
let registry: CommandRegistry;
let host: HostApi & { events: { event: string; payload: unknown }[] };
let projectId: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-plan-'));
  registry = new CommandRegistry();
  for (const mod of mainModules) registry.registerModule(mod);
  const base = testHost();
  host = {
    ...base,
    execute: (id, input, ctx) => registry.execute(id, input, ctx),
    meta: (id) => registry.meta(id),
  } as typeof base;
  service = new ProjectService({ libraryRoot: root, defaultLibraryRoot: root, appVersion: 'test', emit: host.emit, rememberSession: async () => {}, rememberLibrary: async () => {}, session: { debounceMs: 20, maxWaitMs: 100 } });
  Object.defineProperty(host, 'projects', { value: service });
  await service.start({ openProjects: [], activeProjectId: null });
  const created = await service.create({ name: 'House' });
  projectId = (await service.open(created.id)).id;
});
afterEach(async () => {
  await service.stop();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
});

async function run<T = unknown>(id: string, input: unknown, caller: CommandContext['caller'] = 'ui', agent?: string): Promise<T> {
  const project = await service.resolve(projectId);
  return registry.execute<T>(id, input, { caller, agent, host, project });
}

const doc = (): ProjectDoc => service.session(projectId)!.doc;

describe('editing commands', () => {
  it('builds a floor in one batch, with names for what earlier steps created', async () => {
    const ground = doc().building.groundLevelId;
    const result = await run<{ ids: Record<string, string>; applied: boolean }>('plan.apply', {
      label: 'Draw the ground floor',
      steps: [
        { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'wall', path: { closed: true, v: [{ p: [0, 0] }, { p: [6000, 0] }, { p: [6000, 4000] }, { p: [0, 4000] }] }, thickness: 200 } }, as: 'outer' },
        { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'opening', kind: 'door', wallId: '$outer', along: 1500, width: 900, height: 2100 } } },
        { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'room', name: 'Living', boundary: { k: 'detect', seed: [3000, 2000] } } } },
        { command: 'building.level.add', input: { name: 'First floor' }, as: 'first' },
        { command: 'building.connector.add', input: { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: '$first' }, axis: { closed: false, v: [{ p: [500, 500] }, { p: [500, 4000] }] }, width: 1000 } } },
      ],
    });
    expect(result.applied).toBe(true);
    const entities = Object.values(doc().levelData[ground].entities);
    expect(entities.map((e) => e.type).sort()).toEqual(['opening', 'room', 'wall']);
    expect((entities.find((e) => e.type === 'opening') as { wallId: string }).wallId).toBe(result.ids['outer']);
    expect(deriveLevels(doc()).map((l) => l.name)).toEqual(['Ground floor', 'First floor']);
    expect(Object.values(doc().connectors)).toHaveLength(1);
    // One batch is one undo step.
    const history = await run<{ undo: { label: string }[] }>('edit.history', {});
    expect(history.undo.map((h) => h.label)).toEqual(['Draw the ground floor']);
    await run('edit.undo', {});
    expect(doc().levelData[ground].entities).toEqual({});
    expect(Object.keys(doc().levels)).toHaveLength(1);
  });

  it('changes nothing when a step fails, and checks without applying in a dry run', async () => {
    const ground = doc().building.groundLevelId;
    const steps = [
      { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'label', text: 'ok', at: [0, 0] } } },
      { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [0, 0] }] }, thickness: 100 } } },
    ];
    await expect(run('plan.apply', { label: 'Broken', steps })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/Step 2 \(plan.entity.add\) failed, so nothing was changed/) });
    expect(doc().levelData[ground].entities).toEqual({});
    const dry = await run<{ applied: boolean; changed: boolean }>('plan.apply', { label: 'Try', steps: steps.slice(0, 1), dryRun: true });
    expect(dry).toMatchObject({ applied: false, changed: true });
    expect(doc().levelData[ground].entities).toEqual({});
    await expect(run('plan.apply', { label: 'Nested', steps: [{ command: 'plan.apply', input: { label: 'x', steps: [] } }] })).rejects.toMatchObject({ message: /cannot run in a batch/ });
    await expect(run('plan.apply', { label: 'Bad ref', steps: [{ command: 'plan.entity.delete', input: { ids: ['$nothing'] } }] })).rejects.toMatchObject({ message: /does not name an earlier step/ });
    await expect(run('plan.apply', { label: 'Not editing', steps: [{ command: 'project.trash', input: { id: projectId } }] })).rejects.toMatchObject({ message: /cannot run in a batch/ });
  });

  it('attributes changes and lets an agent undo only its own newest change', async () => {
    const ground = doc().building.groundLevelId;
    const agentEdit = await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'label', text: 'agent', at: [0, 0] } }, 'mcp', 'claude-code 2.1');
    const history = await run<{ undo: { id: string; author: { kind: string; name: string } }[] }>('edit.history', {});
    expect(history.undo[0].author).toEqual({ kind: 'mcp', name: 'claude-code 2.1' });
    await run('building.level.update', { levelId: ground, name: 'Lobby' });
    await expect(run('edit.undo', { ifTop: history.undo[0].id }, 'mcp', 'claude-code 2.1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(doc().levels[ground].name).toBe('Lobby');
    await run('edit.undo', {});
    await run('edit.undo', { ifTop: history.undo[0].id }, 'mcp', 'claude-code 2.1');
    expect(doc().levelData[ground].entities[agentEdit.id]).toBeUndefined();
    await run('edit.redo', {});
    expect(doc().levelData[ground].entities[agentEdit.id]).toBeDefined();
  });

  it('announces every change as a patch the mirror can apply', async () => {
    const ground = doc().building.groundLevelId;
    const from = host.events.length;
    await run('building.level.add', { name: 'Roof' });
    await run('plan.layer.update', { layerId: Object.values(doc().layers).find((l) => l.levelId === ground && l.kind === 'structure')!.id, visible: false });
    const patches = host.events.slice(from).filter((e) => e.event === 'doc.patched') as { payload: { seq: number; tx: { label: string } } }[];
    expect(patches.map((p) => p.payload.tx.label)).toEqual(['Add level "Roof"', 'Hide "Structure"']);
    expect(patches[1].payload.seq).toBe(patches[0].payload.seq + 1);
  });

  it('keeps the design as it was before the first edit of a session', async () => {
    const ground = doc().building.groundLevelId;
    await run('plan.entity.add', { levelId: ground, entity: { type: 'label', text: 'first', at: [0, 0] } });
    await run('plan.entity.add', { levelId: ground, entity: { type: 'label', text: 'second', at: [0, 0] } });
    const snapshots = await run<{ name: string; kind: string }[]>('project.snapshot.list', {});
    expect(snapshots.filter((s) => s.name.startsWith('Before editing'))).toHaveLength(1);
  });

  it('describes the building with derived elevations', async () => {
    await run('building.level.add', { position: 'bottom' });
    const building = await run<{ levels: { name: string; elevation: number; isBasement: boolean; layers: unknown[] }[] }>('building.get', {});
    expect(building.levels.map((l) => [l.name, l.elevation, l.isBasement])).toEqual([
      ['Basement 1', -3000, true],
      ['Ground floor', 0, false],
    ]);
    expect(building.levels[0].layers).toHaveLength(3);
  });
});

describe('connectors on the plan', () => {
  async function twoStoreys() {
    const ground = doc().building.groundLevelId;
    const upper = (await run<{ id: string }>('building.level.add', { name: 'Upper' })).id;
    const stair = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'stair', shape: 'l', bottom: { levelId: ground }, top: { levelId: upper }, axis: { closed: false, v: [{ p: [0, 0] }, { p: [0, 2250] }, { p: [2250, 2250] }] }, width: 1000, handrails: { left: true, right: false } } })).id;
    const lift = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'elevator', at: [6000, 2000], shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground }, { levelId: upper, door: 'front' }] } })).id;
    return { ground, upper, stair, lift };
  }
  type Stair = { axis: { v: { p: number[]; c?: { k: string } }[] }; handrails: { left: boolean; right: boolean } };

  it('lays a stair, a ramp and an elevator out from an intent form', async () => {
    const { ground, upper } = await twoStoreys();
    const l = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'stair', shape: 'l', from: [0, 0], to: [3000, 2000], bottomLevelId: ground, topLevelId: upper, turn: 'right' } })).id;
    expect((doc().connectors[l] as unknown as Stair).axis.v.map((v) => v.p)).toEqual([[0, 0], [0, 2000], [3000, 2000]]);
    expect(doc().connectors[l]).toMatchObject({ kind: 'stair', shape: 'l', width: 1000, bottom: { levelId: ground, offset: 0 }, top: { levelId: upper, offset: 0 } });
    const u = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'stair', shape: 'u', from: [5000, 0], to: [5000, 3000], bottomLevelId: ground, topLevelId: upper, width: 1100 } })).id;
    expect((doc().connectors[u] as unknown as Stair).axis.v.length).toBe(4);
    const risers = (await run<{ connectors: { id: string; derived: { risers: number; broken: unknown[] } }[] }>('building.get', {})).connectors.find((c) => c.id === u)!.derived;
    expect(risers.risers).toBe(16);
    expect(risers.broken).toEqual([]);
    const ramp = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'ramp', from: [0, 5000], to: [9000, 5000], bottomLevelId: ground, topLevelId: upper } })).id;
    expect(doc().connectors[ramp]).toMatchObject({ kind: 'ramp', width: 1200, maxSlope: 8.33 });
    const lift = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'elevator', at: [8000, 8000], fromLevelId: upper, toLevelId: ground } })).id;
    expect((doc().connectors[lift] as unknown as { stops: { levelId: string; door: string }[] }).stops).toEqual([{ levelId: ground, door: 'front' }, { levelId: upper, door: 'front' }]);
    await expect(run('building.connector.add', { connector: { kind: 'stair', shape: 'l', from: [0, 0], to: [3000, 0], bottomLevelId: ground, topLevelId: upper } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(run('building.connector.add', { connector: { kind: 'elevator', at: [0, 0], fromLevelId: ground, toLevelId: ground } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('edits a stair axis with the path commands, and refuses a stale edit naming who changed it', async () => {
    const { stair } = await twoStoreys();
    const { seq, epoch } = await run<{ seq: number; epoch: number }>('edit.history', {});
    const moved = await run<Stair>('plan.path.vertex.move', { id: stair, index: 2, to: [2500, 2250], baseSeq: seq, epoch });
    expect(moved.axis.v[2].p).toEqual([2500, 2250]);
    await run('plan.path.vertex.move', { id: stair, index: 2, to: [2600, 2250] }, 'mcp', 'claude-code 2.1');
    await expect(run('plan.path.vertex.move', { id: stair, index: 2, to: [3000, 2250], baseSeq: seq + 1, epoch })).rejects.toMatchObject({ code: 'CONFLICT', details: { by: { kind: 'mcp', name: 'claude-code 2.1' } } });
    const rounded = await run<Stair>('plan.path.corner.set', { id: stair, index: 1, corner: { k: 'fillet', r: 500 } });
    expect(rounded.axis.v[1].c?.k).toBe('fillet');
    await expect(run('plan.path.vertex.move', { id: 'elv_0000000000000000', index: 0, to: [0, 0] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const history = await run<{ undo: { label: string }[] }>('edit.history', {});
    expect(history.undo[0].label).toBe('Round corner of stair');
  });

  it('moves, mirrors, copies and deletes connectors with entities, and lists them on the levels they reach', async () => {
    const { ground, upper, stair, lift } = await twoStoreys();
    const label = (await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'label', text: 'Hall', at: [0, 0] } })).id;
    await run('plan.transform', { ids: [stair, lift, label], translate: [1000, 0] });
    expect((doc().connectors[stair] as unknown as Stair).axis.v[0].p).toEqual([1000, 0]);
    expect((doc().connectors[lift] as unknown as { at: number[] }).at).toEqual([7000, 2000]);
    expect((await run<{ undo: { label: string }[] }>('edit.history', {})).undo[0].label).toBe('Move 3 items');
    await run('plan.transform', { ids: [stair, lift], mirror: { a: [0, 0], b: [0, 1000] } });
    const mirrored = doc().connectors[stair] as unknown as Stair;
    expect(mirrored.axis.v[2].p).toEqual([-3250, 2250]);
    expect(mirrored.handrails).toEqual({ left: false, right: true });
    expect((doc().connectors[lift] as { stops: { door: string }[] }).stops.map((s) => s.door)).toEqual(['back', 'back']);
    const copied = await run<{ ids: string[] }>('plan.transform', { ids: [stair], translate: [0, 5000], copy: true });
    expect(copied.ids).toHaveLength(1);
    expect(copied.ids[0]).toMatch(/^str_/);
    expect(Object.keys(doc().connectors)).toHaveLength(3);

    const onGround = await run<{ type: string; id: string; role?: string }[]>('plan.query', { levelId: ground });
    expect(onGround.filter((e) => e.type === 'connector').map((e) => e.role).sort()).toEqual(['bottom', 'bottom', 'stop']);
    expect((await run<{ role: string }[]>('plan.query', { levelId: upper, type: 'connector' })).map((c) => c.role).sort()).toEqual(['stop', 'top', 'top']);

    await run('plan.entity.delete', { ids: [copied.ids[0], label] });
    expect(doc().connectors[copied.ids[0]]).toBeUndefined();
    expect(doc().levelData[ground].entities[label]).toBeUndefined();
    await run('plan.entity.delete', { ids: [lift] });
    expect((await run<{ undo: { label: string }[] }>('edit.history', {})).undo[0].label).toBe('Delete elevator');
  });
});

describe('path edits and conflicts', () => {
  it('moves, splits, curves and rounds a wall by index, and refuses a stale edit', async () => {
    const ground = doc().building.groundLevelId;
    const { id } = await run<{ id: string }>('plan.wall.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [5000, 4000] }], single: true });
    const seq = (await run<{ seq: number; epoch: number }>('edit.history', {})).seq;
    const epoch = (await run<{ seq: number; epoch: number }>('edit.history', {})).epoch;
    const moved = await run<{ path: { v: { p: number[]; s?: unknown; c?: unknown }[] } }>('plan.path.vertex.move', { id, index: 2, to: [5000, 3000], baseSeq: seq, epoch });
    expect(moved.path.v[2].p).toEqual([5000, 3000]);
    // The same base is stale now: the wall changed since.
    await expect(run('plan.path.vertex.move', { id, index: 2, to: [5000, 2000], baseSeq: seq, epoch })).rejects.toMatchObject({ code: 'CONFLICT', details: { kind: 'stale', by: { kind: 'user' } } });
    expect((doc().levelData[ground].entities[id] as { path: { v: { p: readonly number[] }[] } }).path.v[2].p).toEqual([5000, 3000]);
    await expect(run('plan.path.vertex.move', { id, index: 2, to: [5000, 2000], baseSeq: seq + 1, epoch: epoch + 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const split = await run<{ path: { v: unknown[] } }>('plan.path.vertex.insert', { id, index: 0, at: [2500, 100] });
    expect(split.path.v.length).toBe(4);
    const curved = await run<{ path: { v: { s?: { k: string } }[] } }>('plan.path.segment.set', { id, index: 0, segment: { k: 'arc', through: [1250, -500] } });
    expect(curved.path.v[0].s?.k).toBe('arc');
    const rounded = await run<{ path: { v: { c?: { k: string } }[] } }>('plan.path.corner.set', { id, index: 2, corner: { k: 'fillet', r: 300 } });
    expect(rounded.path.v[2].c?.k).toBe('fillet');
    await expect(run('plan.path.corner.set', { id, index: 0, corner: { k: 'fillet', r: 300 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const removed = await run<{ path: { v: unknown[] } }>('plan.path.vertex.remove', { id, index: 1 });
    expect(removed.path.v.length).toBe(3);
    await expect(run('plan.path.vertex.move', { id: 'wal_0000000000000000', index: 0, to: [0, 0] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const history = await run<{ undo: { label: string }[] }>('edit.history', {});
    expect(history.undo[0].label).toBe('Remove corner of wall');
  });

  it('adds shapes from points or a path, on any layer, and chamfers their corners', async () => {
    const ground = doc().building.groundLevelId;
    const { id } = await run<{ id: string }>('plan.shape.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [3000, 0] }, { p: [3000, 2000] }, { p: [0, 2000] }], name: 'Terrace' });
    const shape = doc().levelData[ground].entities[id] as { type: string; filled: boolean; name?: string; layerId: string; path: { closed: boolean; v: { c?: unknown }[] } };
    expect(shape.type).toBe('shape');
    expect(shape.filled).toBe(true);
    expect(shape.name).toBe('Terrace');
    expect(shape.path.closed).toBe(true);
    expect(doc().layers[shape.layerId].kind).toBe('interior');
    const chamfered = await run<{ path: { v: { c?: { k: string; d1: number } }[] } }>('plan.path.corner.set', { id, index: 1, corner: { k: 'chamfer', d1: 300 } });
    expect(chamfered.path.v[1].c).toEqual({ k: 'chamfer', d1: 300 });
    const structure = Object.values(doc().layers).find((l) => l.levelId === ground && l.kind === 'structure')!;
    const open = await run<{ id: string }>('plan.shape.add', { levelId: ground, layerId: structure.id, points: [{ p: [0, 0], bulge: 0.5 }, { p: [2000, 0] }], closed: false, filled: false });
    const line = doc().levelData[ground].entities[open.id] as { filled: boolean; layerId: string; path: { closed: boolean; v: { s?: { k: string } }[] } };
    expect(line.filled).toBe(false);
    expect(line.layerId).toBe(structure.id);
    expect(line.path.closed).toBe(false);
    expect(line.path.v[0].s?.k).toBe('arc');
    await expect(run('plan.shape.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [2000, 0] }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(run('plan.shape.add', { levelId: ground })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const circle = await run<{ id: string }>('plan.shape.add', { levelId: ground, points: [{ p: [1000, 0], bulge: 1 }, { p: [-1000, 0], bulge: 1 }] });
    expect((doc().levelData[ground].entities[circle.id] as { path: { v: unknown[] } }).path.v.length).toBe(2);
  });

  it('ties dimensions to walls, follows their vertices, and lets go when the wall is deleted or the dimension moved alone', async () => {
    const ground = doc().building.groundLevelId;
    const wall = await run<{ id: string }>('plan.wall.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [5000, 4000] }], single: true });
    const dim = await run<{ id: string }>('plan.dimension.add', { levelId: ground, from: [0, 0], to: [5000, 0], offset: -600, anchors: { from: { entityId: wall.id, vertex: 0 }, to: { entityId: wall.id, vertex: 1 } } });
    type Listed = { id: string; from: number[]; to: number[]; value: number; text: string; anchors: unknown };
    const listed = async () => (await run<Listed[]>('plan.dimensions', { levelId: ground })).find((d) => d.id === dim.id)!;
    let d = await listed();
    expect(d.to).toEqual([5000, 0]);
    expect(d.value).toBe(5000);
    expect(d.text).toBe('5000 mm');
    // The wall's corner moves: the dimension's end follows.
    await run('plan.path.vertex.move', { id: wall.id, index: 1, to: [6000, 0] });
    d = await listed();
    expect(d.to).toEqual([6000, 0]);
    expect(d.value).toBe(6000);
    // A vertex inserted before the tied one shifts its index; removing the tied one unties that end.
    await run('plan.path.vertex.insert', { id: wall.id, index: 0, at: [3000, 0] });
    d = await listed();
    expect((d.anchors as { to: { vertex: number } }).to.vertex).toBe(2);
    expect(d.to).toEqual([6000, 0]);
    await run('plan.path.vertex.remove', { id: wall.id, index: 2 });
    d = await listed();
    expect((d.anchors as { to?: unknown }).to).toBeUndefined();
    // Untied where it was shown, even though the wall corner is gone.
    expect(d.to).toEqual([6000, 0]);
    expect((doc().levelData[ground].entities[dim.id] as unknown as { to: number[] }).to).toEqual([6000, 0]);
    // Moved with its wall it stays tied; moved alone it lets go.
    await run('plan.transform', { ids: [wall.id, dim.id], translate: [0, 1000] });
    d = await listed();
    expect((d.anchors as { from: unknown }).from).toBeTruthy();
    expect(d.from).toEqual([0, 1000]);
    await run('plan.transform', { ids: [dim.id], translate: [0, -1000] });
    d = await listed();
    expect(d.anchors).toBeNull();
    expect(d.from).toEqual([0, 0]);
    // A copy of a tied dimension with its wall keeps the tie to the copy; alone it is untied.
    const retied = await run<{ id: string }>('plan.dimension.add', { levelId: ground, from: [0, 1000], to: [3000, 1000], anchors: { from: { entityId: wall.id, vertex: 0 } } });
    const both = await run<{ ids: string[] }>('plan.transform', { ids: [wall.id, retied.id], translate: [20000, 0], copy: true });
    const copiedDim = doc().levelData[ground].entities[both.ids[1]] as { anchors?: { from?: { entityId: string } } };
    expect(copiedDim.anchors?.from?.entityId).toBe(both.ids[0]);
    const alone = await run<{ ids: string[] }>('plan.transform', { ids: [retied.id], translate: [0, 20000], copy: true });
    expect((doc().levelData[ground].entities[alone.ids[0]] as { anchors?: unknown }).anchors).toBeUndefined();
    // Deleting the wall unties what was tied to it, in the same change.
    await run('plan.entity.delete', { ids: [wall.id] });
    expect((doc().levelData[ground].entities[retied.id] as { anchors?: unknown }).anchors).toBeUndefined();
    expect(doc().levelData[ground].entities[retied.id]).toBeTruthy();
    await run('edit.undo', {});
    expect((doc().levelData[ground].entities[retied.id] as { anchors?: { from?: unknown } }).anchors?.from).toBeTruthy();
    await expect(run('plan.dimension.add', { levelId: ground, kind: 'angular', from: [1, 0], to: [0, 1] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(run('plan.dimension.add', { levelId: ground, from: [0, 0], to: [0, 0] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const angle = await run<{ id: string }>('plan.dimension.add', { levelId: ground, kind: 'angular', vertex: [0, 0], from: [1000, 0], to: [0, 1000], offset: 400 });
    const listedAngle = (await run<Listed[]>('plan.dimensions', { levelId: ground })).find((x) => x.id === angle.id)!;
    expect(listedAngle.value).toBeCloseTo(90, 6);
    expect(listedAngle.text).toBe('90°');
  });

  it('names the agent whose change made a field edit stale', async () => {
    const ground = doc().building.groundLevelId;
    const { id } = await run<{ id: string }>('plan.wall.add', { levelId: ground, from: [0, 0], to: [3000, 0] });
    const base = await run<{ seq: number }>('edit.history', {});
    await run('plan.entity.update', { id, set: { thickness: 300 } }, 'mcp', 'Claude Desktop');
    await expect(run('plan.entity.update', { id, set: { thickness: 150 }, baseSeq: base.seq })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('via MCP: Claude Desktop') });
    expect((doc().levelData[ground].entities[id] as { thickness: number }).thickness).toBe(300);
    const fresh = await run<{ seq: number }>('edit.history', {});
    await run('plan.entity.update', { id, set: { thickness: 150 }, baseSeq: fresh.seq });
    expect((doc().levelData[ground].entities[id] as { thickness: number }).thickness).toBe(150);
  });
});

describe('view.snapshot', () => {
  /** Runs the command and answers the window's part: the request it emitted, and what the command returned. */
  async function snapshot(input: unknown): Promise<{ request: Record<string, unknown>; result: Record<string, unknown> }> {
    const from = host.events.length;
    const result = run<Record<string, unknown>>('view.snapshot', input);
    let request: { id: string } | undefined;
    for (let i = 0; i < 100 && !request; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      request = host.events.slice(from).find((e) => e.event === 'view.snapshot.request')?.payload as { id: string } | undefined;
    }
    await run('view.snapshot.reply', { id: request!.id, png: 'cG5n' });
    return { request: request as unknown as Record<string, unknown>, result: await result };
  }

  it('asks the window for the plan of the ground level by default', async () => {
    const { request, result } = await snapshot({});
    expect(request).toMatchObject({ projectId, view: 'plan', levelId: doc().building.groundLevelId, width: 800, height: 600 });
    expect(result).toMatchObject({ mimeType: 'image/png', data: 'cG5n', view: 'plan', levelName: 'Ground floor' });
  });

  it('asks for the building in 3D from the south-west, above, with every level shown', async () => {
    const { request, result } = await snapshot({ view: '3d' });
    expect(request).toMatchObject({ view: '3d', azimuth: 225, elevation: 30, display: 'all', explode: 0, levelId: doc().building.groundLevelId });
    expect(result).toMatchObject({ view: '3d', data: 'cG5n' });
    const { request: cut } = await snapshot({ view: '3d', azimuth: 270, elevation: 60, display: 'cutaway', explode: 0.5, width: 400, height: 300 });
    expect(cut).toMatchObject({ azimuth: 270, elevation: 60, display: 'cutaway', explode: 0.5, width: 400, height: 300 });
  });

  it('refuses a view from past the poles or an explode beyond 1', async () => {
    await expect(run('view.snapshot', { view: '3d', elevation: 90 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(run('view.snapshot', { view: '3d', explode: 2 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
