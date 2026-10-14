import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommandRegistry, testHost, type CommandContext, type HostApi, type Warning } from '@studio/core';
import { ProjectService } from '@studio/core/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mainModules } from '../main';
import { rulesModule } from './main';

let root: string;
let service: ProjectService;
let registry: CommandRegistry;
let host: HostApi & { events: { event: string; payload: unknown }[] };
let projectId: string;
/** How long the modules before rules take to close a project: the hooks run one after another, after the project has left the open list. */
let closeDelayMs = 0;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-rules-'));
  registry = new CommandRegistry();
  for (const mod of mainModules) registry.registerModule(mod);
  const base = testHost();
  host = {
    ...base,
    execute: (id, input, ctx) => registry.execute(id, input, ctx),
    meta: (id) => registry.meta(id),
  } as typeof base;
  service = new ProjectService({
    libraryRoot: root,
    defaultLibraryRoot: root,
    appVersion: 'test',
    emit: host.emit,
    rememberSession: async () => {},
    rememberLibrary: async () => {},
    session: { debounceMs: 20, maxWaitMs: 100 },
    onProjectOpen: (project) => rulesModule.onProjectOpen?.(project, host),
    onProjectClose: async (project) => {
      if (closeDelayMs) await new Promise((resolve) => setTimeout(resolve, closeDelayMs));
      await rulesModule.onProjectClose?.(project, host);
    },
  });
  Object.defineProperty(host, 'projects', { value: service });
  await rulesModule.onStart?.(host);
  await service.start({ openProjects: [], activeProjectId: null });
  const created = await service.create({ name: 'Rules' });
  projectId = (await service.open(created.id)).id;
});

afterEach(async () => {
  closeDelayMs = 0;
  vi.restoreAllMocks();
  await rulesModule.onStop?.(host);
  await service.stop();
  await fs.rm(root, { recursive: true, force: true });
});

const ctx = (): CommandContext => ({ host, project: service.api(service.session(projectId)!), caller: { kind: 'user' } }) as unknown as CommandContext;
const run = <T = unknown>(id: string, input: unknown = {}) => registry.execute(id, input, ctx()) as Promise<T>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 450));
type Result = { warnings: Warning[]; count: number; byLevel: Record<string, number> };
const changes = () => host.events.filter((e) => e.event === 'rules.changed').map((e) => e.payload as { projectId: string; count: number });

describe('rules.check and the watcher', () => {
  it('reports warnings live after a change, only when the set changes, and filters by level and rule', async () => {
    const ground = service.session(projectId)!.doc.building.groundLevelId;
    const upper = (await run<{ id: string }>('building.level.add', { name: 'Upper' })).id;
    expect(await run<Result>('rules.check')).toMatchObject({ warnings: [], count: 0 });
    const stair = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: { closed: false, v: [{ p: [2000, 1000] }, { p: [2000, 4750] }] }, width: 1000, riser: { count: 8 } } })).id;
    await settle();
    // The stair arrives on an upper floor with no slab, and eight risers over 3 m are too high and uncomfortable.
    const after = await run<Result>('rules.check');
    expect(after.count).toBe(3);
    expect(after.warnings.map((w) => w.rule).sort()).toEqual(['opening-uncovered', 'stair-limits', 'stair-limits']);
    expect(after.byLevel).toEqual({ [ground]: 2, [upper]: 1 });
    expect(changes().at(-1)).toEqual({ projectId, count: 3 });
    expect((await run<Result>('rules.check', { levelId: upper })).warnings.map((w) => w.rule)).toEqual(['opening-uncovered']);
    expect((await run<Result>('rules.check', { rule: 'stair-limits' })).warnings.map((w) => w.id)).toEqual([`${stair}:riser-high`, `${stair}:comfort`]);
    expect((await run<Result>('rules.check', { rule: 'stair-limits' })).warnings[0]).toMatchObject({ target: { kind: 'connector', id: stair }, levelId: ground });
    // A change that leaves the warnings as they are announces nothing.
    const announced = changes().length;
    await run('plan.entity.add', { levelId: ground, entity: { type: 'label', at: [500, 500], text: 'Hi', size: 250 } });
    await settle();
    expect(changes().length).toBe(announced);
    // Fixing the risers removes one warning, and the count follows.
    await run('building.connector.update', { id: stair, set: { riser: {} } });
    await settle();
    expect(changes().at(-1)).toEqual({ projectId, count: 1 });
    expect((await run<Result>('rules.check')).warnings.map((w) => w.rule)).toEqual(['opening-uncovered']);
  });

  it('lets a project go quietly when it closes before a pending check runs', async () => {
    const ground = service.session(projectId)!.doc.building.groundLevelId;
    const warn = vi.spyOn(console, 'warn');
    const announced = changes().length;
    await run('plan.wall.add', { levelId: ground, from: [0, 0], to: [3000, 0] });
    // The check is due 250 ms after the change; the other modules' close hooks are still running then.
    closeDelayMs = 400;
    await service.close(projectId);
    await settle();
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('[rules]'))).toEqual([]);
    expect(changes().length).toBe(announced);
  });

  it('follows a level height change and the limits in the settings', async () => {
    const ground = service.session(projectId)!.doc.building.groundLevelId;
    const upper = (await run<{ id: string }>('building.level.add', { name: 'Upper' })).id;
    for (const levelId of [ground, upper]) await run('plan.entity.add', { levelId, entity: { type: 'slab', source: { k: 'region', region: { outer: { closed: true, v: [{ p: [0, 0] }, { p: [10000, 0] }, { p: [10000, 8000] }, { p: [0, 8000] }] }, holes: [] } } } });
    await run('building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: { closed: false, v: [{ p: [2000, 1000] }, { p: [2000, 4750] }] }, width: 1000 } });
    await settle();
    expect((await run<Result>('rules.check')).count).toBe(0);
    await run('building.level.update', { levelId: ground, height: 4500 });
    await settle();
    expect((await run<Result>('rules.check')).warnings.map((w) => w.id.split(':')[1])).toContain('tread-short');
    await run('edit.undo');
    await host.config.update({ rules: { maxRiser: 150 } });
    host.emit('config.changed', { config: host.config.get() });
    await settle();
    expect((await run<Result>('rules.check')).warnings.map((w) => w.id.split(':')[1])).toContain('tread-short');
    // A 150 mm riser limit makes 20 risers: treads of 197 mm, short and uncomfortable.
    expect(changes().at(-1)?.count).toBe(2);
  });
});
