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
