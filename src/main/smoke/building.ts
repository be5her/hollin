import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { applyPatch, rectPath, stableStringify, type DerivedLevel, type DocPatch, type OpenProject, type ProjectDoc } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

type Building = { levels: (DerivedLevel & { layers: { id: string; kind: string }[] })[]; connectors: { kind: string }[] };

const names = (levels: DerivedLevel[]) => levels.map((l) => `${l.name}@${l.elevation}`).join(', ');
/** Key order differs between memory and files, so compare with keys sorted. */
const comparable = (doc: ProjectDoc) => stableStringify({ ...doc, meta: { ...doc.meta, updatedAt: '' } });

/** The document model through commands and MCP: levels, connectors, batches, undo, the live patches, saving. */
export async function smokeBuilding(smoke: Smoke): Promise<{ towerId: string }> {
  const { host } = smoke;
  smoke.section('building');
  const tower = await smoke.run<OpenProject>('project.create', { name: 'Tower' });
  const projectId = tower.id;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const patchesFrom = smoke.events.length;
  const startDoc = host.projects.session(projectId)!.doc;
  const ground = startDoc.building.groundLevelId;

  const l1 = (await run<{ id: string }>('building.level.add', { name: 'Level 1' })).id;
  const l2 = (await run<{ id: string }>('building.level.add', { name: 'Level 2' })).id;
  const b1 = (await run<{ id: string }>('building.level.add', { name: 'Basement', position: { below: ground } })).id;
  const mezz = (await run<{ id: string }>('building.level.add', { name: 'Gallery', mezzanineOf: { levelId: ground, offset: 1500 }, height: 1500 })).id;
  let building = await run<Building>('building.get');
  smoke.check('levels stack up from the ground, basements go below, mezzanines sit at their offset', names(building.levels) === 'Basement@-3000, Ground floor@0, Gallery@1500, Level 1@3000, Level 2@6000', names(building.levels));
  smoke.check('every new level gets structure, interior and decor layers', building.levels.every((l) => l.layers.map((x) => x.kind).join() === 'structure,interior,decor'));

  await run('building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: l1 }, axis: { closed: false, v: [{ p: [500, 500] }, { p: [500, 5000] }] }, width: 1100 } });
  await run('building.connector.add', { connector: { kind: 'elevator', at: [8000, 2000], shaft: { w: 2100, d: 2100 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground }, { levelId: l1 }, { levelId: l2 }] } });
  smoke.check('stairs and elevators are stored between levels', (await run<Building>('building.get')).connectors.map((c) => c.kind).join() === 'stair,elevator');
  await smoke.expectError('a stair must go up', 'building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: l2 }, top: { levelId: ground }, axis: { closed: false, v: [{ p: [0, 0] }, { p: [0, 3000] }] }, width: 1000 } }, 'CONFLICT', { projectId });

  await run('building.level.update', { levelId: ground, height: 3600 });
  building = await run<Building>('building.get');
  smoke.check('a taller ground floor lifts every level above it; the mezzanine keeps its offset', names(building.levels) === 'Basement@-3000, Ground floor@0, Gallery@1500, Level 1@3600, Level 2@6600', names(building.levels));
  await run('building.level.update', { levelId: l2, elevation: 7000 });
  smoke.check('setting an elevation changes the height of the level below', (await run<Building>('building.get')).levels.find((l) => l.id === l1)?.height === 3400);
  await run('edit.undo');
  smoke.check('undo puts it back', (await run<Building>('building.get')).levels.find((l) => l.id === l2)?.elevation === 6600);
  void b1;
  void mezz;

  smoke.section('batches over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-architect', version: '2.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${projectId}`)));
  const tools = new Set((await client.listTools()).tools.map((t) => t.name));
  smoke.check('the editing tools are available to agents', ['plan_apply', 'plan_entity_add', 'building_level_add', 'building_connector_add', 'edit_undo', 'edit_history', 'building_get'].every((t) => tools.has(t)) && !tools.has('doc_get'));
  const floor = text(
    await client.callTool({
      name: 'plan_apply',
      arguments: {
        label: 'Lay out the ground floor',
        steps: [
          { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 250 } }, as: 'outer' },
          { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'opening', kind: 'door', wallId: '$outer', along: 4000, width: 1000, height: 2100 } } },
          { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'room', name: 'Lobby', boundary: { k: 'detect', seed: [4500, 3000] } } } },
          { command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'label', text: 'Entrance', at: [4500, -800] } } },
        ],
      },
    }),
  ) as { applied: boolean; ids: Record<string, string> };
  const groundEntities = Object.values(host.projects.session(projectId)!.doc.levelData[ground].entities);
  smoke.check('an agent draws a floor in one batch', floor.applied && groundEntities.length === 4 && groundEntities.some((e) => e.type === 'opening' && (e as { wallId: string }).wallId === floor.ids['outer']), floor);
  const history = text(await client.callTool({ name: 'edit_history', arguments: {} })) as { undo: { id: string; label: string; author: { kind: string; name: string } }[] };
  smoke.check('the batch is one change, attributed to the agent', history.undo[0].label === 'Lay out the ground floor' && history.undo[0].author.kind === 'mcp' && history.undo[0].author.name === 'smoke-architect 2.0', history.undo[0]);
  const failed = await client.callTool({ name: 'plan_apply', arguments: { label: 'Broken', steps: [{ command: 'plan.entity.add', input: { levelId: ground, entity: { type: 'label', text: 'x', at: [0, 0] } } }, { command: 'plan.entity.add', input: { levelId: 'lvl_0000000000000000', entity: { type: 'label', text: 'y', at: [0, 0] } } }] } });
  smoke.check('a failing batch changes nothing', failed.isError === true && Object.values(host.projects.session(projectId)!.doc.levelData[ground].entities).length === 4, text(failed));
  await run('building.level.update', { levelId: ground, name: 'Lobby level' });
  const refused = text(await client.callTool({ name: 'edit_undo', arguments: { ifTop: history.undo[0].id } }));
  smoke.check("an agent's guarded undo leaves the user's newer change alone", refused.code === 'CONFLICT' && host.projects.session(projectId)!.doc.levels[ground].name === 'Lobby level', refused);
  await run('edit.undo');
  await client.callTool({ name: 'edit_undo', arguments: { ifTop: history.undo[0].id } });
  smoke.check('then it can undo its own batch', Object.keys(host.projects.session(projectId)!.doc.levelData[ground].entities).length === 0);
  await run('edit.redo');
  smoke.check('and redo brings the floor back', Object.keys(host.projects.session(projectId)!.doc.levelData[ground].entities).length === 4);
  await client.close();

  smoke.section('live patches');
  const patches = smoke.eventsSince(patchesFrom, 'doc.patched').filter((p) => p.projectId === projectId) as (DocPatch & { projectId: string })[];
  smoke.check('every change was announced with consecutive change numbers', patches.length > 10 && patches.every((p, i) => i === 0 || p.seq === patches[i - 1].seq + 1));
  const mirror = patches.reduce((doc, p) => applyPatch(doc, p.ops), startDoc);
  smoke.check("applying the announced patches rebuilds main's document exactly", comparable(mirror) === comparable(host.projects.session(projectId)!.doc));

  smoke.section('saving the model');
  await run('project.save');
  const dir = host.projects.library.projectDir(projectId);
  const projectJson = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')) as { levelFiles: Record<string, string> };
  const files = (await fs.readdir(path.join(dir, 'levels'))).sort();
  smoke.check('one content-hashed file per level, all listed in project.json', files.length === 5 && Object.values(projectJson.levelFiles).sort().join() === files.join());
  const before = host.projects.session(projectId)!.doc;
  await smoke.run('project.close', { id: projectId });
  await smoke.run('project.open', { id: projectId });
  smoke.check('closing and reopening gives the same document', comparable(host.projects.session(projectId)!.doc) === comparable(before));
  const snapshot = await run<{ id: string }>('project.snapshot.create', { name: 'Full building' });
  await run('building.level.remove', { levelId: l2 });
  const epochFrom = smoke.events.length;
  await run('project.snapshot.restore', { snapshotId: snapshot.id });
  const replace = smoke.eventsSince(epochFrom, 'doc.patched').find((p) => p.tx.kind === 'replace');
  smoke.check('restoring a snapshot replaces the document under a new epoch', Boolean(replace && replace.epoch > 1) && Boolean(host.projects.session(projectId)!.doc.levels[l2]));
  smoke.check('and starts a fresh history', (await run<{ undo: unknown[] }>('edit.history')).undo.length === 0);
  return { towerId: projectId };
}
