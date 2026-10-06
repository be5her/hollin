import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Entity, OpenProject } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

type Wall = Extract<Entity, { type: 'wall' }>;

/** The editor's commands through the host and over MCP: walls in their forms. */
export async function smokePlan(smoke: Smoke): Promise<{ planId: string }> {
  const { host } = smoke;
  smoke.section('plan commands');
  const project = await smoke.run<OpenProject>('project.create', { name: 'Plan' });
  const projectId = project.id;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const doc = () => host.projects.session(projectId)!.doc;
  const ground = doc().building.groundLevelId;
  const walls = () => Object.values(doc().levelData[ground].entities).filter((e): e is Wall => e.type === 'wall');

  const one = await run<{ id: string; ids: string[] }>('plan.wall.add', { levelId: ground, from: [0, 0], to: [5000, 0], thickness: 250 });
  smoke.check('a wall from two points', one.ids.length === 1 && one.id === one.ids[0] && walls()[0].thickness === 250 && walls()[0].path.v.length === 2);
  const run4 = await run<{ ids: string[] }>('plan.wall.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [9000, 0] }, { p: [9000, 6000] }, { p: [0, 6000] }], closed: true });
  smoke.check('a closed run of points gives one wall per segment', run4.ids.length === 4 && walls().length === 5 && walls().every((w) => w.alignment === 'center'));
  const single = await run<{ ids: string[] }>('plan.wall.add', { levelId: ground, points: [{ p: [0, 8000] }, { p: [4000, 8000], bulge: 0.5 }, { p: [4000, 12000] }], closed: true, single: true, alignment: 'left' });
  const singleWall = walls().find((w) => w.id === single.ids[0])!;
  smoke.check('with single, the run is one closed wall with its arc', single.ids.length === 1 && singleWall.path.closed && singleWall.path.v.length === 3 && singleWall.path.v[1].s?.k === 'arc' && singleWall.alignment === 'left');
  const arc = await run<{ id: string }>('plan.wall.add', { levelId: ground, from: [10000, 0], to: [12000, 0], through: [11000, -1000] });
  const arcWall = walls().find((w) => w.id === arc.id)!;
  smoke.check('a wall through a point is an arc', arcWall.path.v[0].s?.k === 'arc' && Math.abs((arcWall.path.v[0].s as { bulge: number }).bulge - 1) < 1e-9);
  await smoke.expectError('a zero-length wall is refused', 'plan.wall.add', { levelId: ground, from: [0, 0], to: [0, 0] }, 'INVALID_INPUT', { projectId });
  const shape = await run<{ id: string }>('plan.shape.add', { levelId: ground, points: [{ p: [20000, 0] }, { p: [23000, 0], bulge: 0.3 }, { p: [23000, 2000] }, { p: [20000, 2000] }], name: 'Terrace' });
  const terrace = doc().levelData[ground].entities[shape.id] as Extract<Entity, { type: 'shape' }>;
  smoke.check('a shape from points is closed, filled and on an interior layer', terrace.type === 'shape' && terrace.path.closed && terrace.filled && terrace.path.v[1].s?.k === 'arc' && doc().layers[terrace.layerId].kind === 'interior' && terrace.name === 'Terrace', terrace);
  await smoke.expectError('a closed shape needs three points', 'plan.shape.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [1000, 0] }] }, 'INVALID_INPUT', { projectId });
  await run('edit.undo');
  const measured = await run<{ id: string }>('plan.dimension.add', { levelId: ground, from: [0, 6000], to: [9000, 6000], offset: 700, anchors: { from: { entityId: run4.ids[2], vertex: 1 }, to: { entityId: run4.ids[2], vertex: 0 } } });
  const reading = (await run<{ id: string; value: number; text: string; anchors: unknown }[]>('plan.dimensions', { levelId: ground })).find((d) => d.id === measured.id)!;
  smoke.check('a dimension tied to a wall reads its length', reading.value === 9000 && reading.text === '9000 mm' && reading.anchors !== null, reading);
  await smoke.expectError('an angle needs its corner', 'plan.dimension.add', { levelId: ground, kind: 'angular', from: [0, 0], to: [0, 1] }, 'INVALID_INPUT', { projectId });
  await run('edit.undo');
  await smoke.expectError('a wall needs points', 'plan.wall.add', { levelId: ground }, 'INVALID_INPUT', { projectId });
  const label = (await run<{ undo: { label: string }[] }>('edit.history')).undo[0].label;
  smoke.check('the history names the change', label === 'Add wall', label);
  await run('edit.undo');
  await run('edit.undo');
  smoke.check('undo removes a whole run at once', walls().length === 5);

  smoke.section('plan over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-drafter', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${projectId}`)));
  const tools = new Set((await client.listTools()).tools.map((t) => t.name));
  smoke.check('plan_wall_add is a tool', tools.has('plan_wall_add'));
  const batch = text(
    await client.callTool({
      name: 'plan_apply',
      arguments: {
        label: 'Partition',
        steps: [
          { command: 'plan.wall.add', input: { levelId: ground, from: [4500, 0], to: [4500, 6000], thickness: 100 }, as: 'partition' },
          { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'opening', kind: 'door', wallId: '$partition', along: 3000, width: 900, height: 2100 } } },
        ],
      },
    }),
  ) as { applied: boolean; ids: Record<string, string> };
  smoke.check('an agent adds a wall and a door in it by name', batch.applied && Object.values(doc().levelData[ground].entities).some((e) => e.type === 'opening' && (e as { wallId: string }).wallId === batch.ids['partition']), batch);
  await client.close();
  return { planId: projectId };
}
