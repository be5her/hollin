import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MeshBuilder, meshToGlb, writeGlb, type OpenProject, type ProjectDoc } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as unknown;

interface Entry {
  ref: string;
  name: string;
  source: string;
  category: string;
  size: [number, number, number];
  added?: boolean;
}

/** A model the way an exporter would write one: a 1200 × 600 × 750 mm table top on a block, made by core's GLB writer. */
export function smokeTableGlb(): Uint8Array {
  const rect = (w: number, d: number) => [
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as [number, number][],
  ];
  const top = new MeshBuilder().prism(rect(1200, 600), 700, 750).build();
  const base = new MeshBuilder().prism(rect(800, 400), 0, 700).build();
  return writeGlb([meshToGlb(top, [0.55, 0.35, 0.2, 1], 'top'), meshToGlb(base, [0.2, 0.2, 0.22, 1], 'base')], { generator: 'studio smoke' });
}

/** The furniture catalog through commands and MCP, and a project carrying an imported model in a package. */
export async function smokeDecor(smoke: Smoke): Promise<{ decorId: string; tableRef: string }> {
  const { host } = smoke;
  smoke.section('decor catalog');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-smoke-decor-'));
  const bytes = smokeTableGlb();
  const source = path.join(dir, 'Smoke_dining-table.glb');
  await fs.writeFile(source, bytes);
  const from = smoke.events.length;
  const imported = await smoke.run<Entry>('catalog.import', { path: source });
  const sha = createHash('sha256').update(bytes).digest('hex');
  smoke.check('a GLB imports under its hash, named from the file and measured in mm', imported.added === true && imported.ref === `asset:${sha}.glb` && imported.name === 'Smoke dining table' && imported.size.join() === '1200,600,750', imported);
  const catalogDir = path.join(host.projects.library.root, 'catalog', 'furniture');
  const index = JSON.parse(await fs.readFile(path.join(catalogDir, 'index.json'), 'utf8')) as { models: { file: string; size: number[] }[] };
  smoke.check('the model is stored in the catalog with an index entry', index.models.some((m) => m.file === `${sha}.glb` && m.size.join() === '1200,600,750') && Boolean(await fs.stat(path.join(catalogDir, `${sha}.glb`)).catch(() => null)));
  smoke.check('the import is announced', smoke.eventsSince(from, 'catalog.changed').some((e) => e.reason === 'imported' && e.file === `${sha}.glb`));
  smoke.check('importing the same model again lists it once', (await smoke.run<Entry>('catalog.import', { path: source })).added === false && (await smoke.run<Entry[]>('catalog.search', {})).length === 1);
  await fs.writeFile(path.join(dir, 'broken.glb'), bytes.subarray(0, 200));
  await smoke.expectError('a damaged model is refused', 'catalog.import', { path: path.join(dir, 'broken.glb') }, 'INVALID_INPUT');
  await fs.writeFile(path.join(dir, 'chair.fbx'), 'Kaydara FBX Binary');
  await smoke.expectError('a file that is not glTF is refused', 'catalog.import', { path: path.join(dir, 'chair.fbx') }, 'INVALID_INPUT');

  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-decorator', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.url)));
  const tools = new Set((await client.listTools()).tools.map((t) => t.name));
  smoke.check('the catalog tools are available to agents, the thumbnail plumbing is not', ['catalog_search', 'catalog_get', 'catalog_import', 'catalog_remove', 'decor_item_place'].every((t) => tools.has(t)) && !tools.has('catalog_thumbnail_set'));
  const found = text(await client.callTool({ name: 'catalog_search', arguments: { query: 'dining table' } })) as Entry[];
  smoke.check('an agent finds the imported model by name over MCP', found.length === 1 && found[0].ref === imported.ref && found[0].source === 'library', found);
  smoke.check('a search for something else finds nothing', (text(await client.callTool({ name: 'catalog_search', arguments: { query: 'piano' } })) as Entry[]).length === 0);
  const removal = await client.callTool({ name: 'catalog_remove', arguments: { ref: imported.ref } });
  smoke.check('removing a model is gated for agents', removal.isError === true && (text(removal) as { code: string }).code === 'MUTATION_BLOCKED', text(removal));

  smoke.section('decor assets in a project');
  const project = await smoke.run<OpenProject>('project.create', { name: 'Decor Flat' });
  const doc = () => host.projects.session(project.id)!.doc as ProjectDoc;
  const ground = doc().building.groundLevelId;
  const placed = text(await client.callTool({ name: 'decor_item_place', arguments: { levelId: ground, ref: imported.ref, at: [1000, 2000], rotation: 90, size: [1800, 900, 750] } })) as { id: string };
  await client.close();
  const item = doc().levelData[ground].entities[placed.id];
  smoke.check('an agent places the model: the item refers to the asset, sized by scale', item?.type === 'item' && item.asset === imported.ref && item.rotation[2] === 90 && item.scale.map((s) => Math.round(s * 100) / 100).join() === '1.5,1.5,1', item);
  smoke.check("the project's registry lists the model", doc().assets[`${sha}.glb`]?.size.join() === '1200,600,750', doc().assets);
  const projectDir = host.projects.library.projectDir(project.id);
  smoke.check('the model is copied into the project assets', createHash('sha256').update(await fs.readFile(path.join(projectDir, 'assets', `${sha}.glb`))).digest('hex') === sha);
  await smoke.expectError('an unknown model is refused', 'decor.item.place', { levelId: ground, ref: `asset:${'0'.repeat(64)}.glb`, at: [0, 0] }, 'NOT_FOUND', { projectId: project.id });
  await smoke.expectError('a reference that is no model is refused', 'plan.entity.add', { levelId: ground, entity: { type: 'item', asset: 'table.glb', at: [0, 0, 0] } }, 'INVALID_INPUT', { projectId: project.id });

  const file = path.join(dir, 'decor-flat.psp');
  await smoke.run('project.export', { id: project.id, path: file });
  await smoke.run('project.close', { id: project.id });
  // The catalog loses the model; the package still carries it.
  await smoke.run('catalog.remove', { ref: imported.ref });
  smoke.check('removing a model from the catalog leaves the project its copy', (await smoke.run<Entry[]>('catalog.search', {})).length === 0 && Boolean(await fs.stat(path.join(projectDir, 'assets', `${sha}.glb`)).catch(() => null)));
  const copy = await smoke.run<OpenProject>('project.import', { path: file });
  const copyDoc = host.projects.session(copy.id)!.doc as ProjectDoc;
  const copied = await fs.readFile(path.join(host.projects.library.projectDir(copy.id), 'assets', `${sha}.glb`)).catch(() => null);
  smoke.check('a package carries the model: the imported project has the asset intact and registered', Boolean(copied) && createHash('sha256').update(copied!).digest('hex') === sha && Boolean(copyDoc.assets[`${sha}.glb`]) && Object.values(copyDoc.levelData[copyDoc.building.groundLevelId].entities).some((e) => e.type === 'item' && e.asset === imported.ref));
  const listed = await smoke.run<Entry[]>('catalog.search', {}, { projectId: copy.id });
  smoke.check("the project's own model is offered while the catalog lacks it", listed.length === 1 && listed[0].source === 'project' && listed[0].name === 'Smoke dining table', listed);
  await smoke.run('project.close', { id: copy.id });

  // The model goes back into the catalog for the UI sections.
  const back = await smoke.run<Entry>('catalog.import', { path: source });
  await fs.rm(dir, { recursive: true, force: true });
  return { decorId: project.id, tableRef: back.ref };
}

/** The renderer reads project assets and catalog models through `library://`, and nothing else of the library. */
export async function smokeDecorProtocol(smoke: Smoke, decorId: string, tableRef: string): Promise<void> {
  smoke.section('library:// for decor');
  const file = tableRef.slice('asset:'.length);
  const fetchBytes = (url: string) => smoke.js<number>(`fetch(${JSON.stringify(url)}).then((r) => (r.ok ? r.arrayBuffer().then((b) => b.byteLength) : -r.status), () => -1)`);
  const size = (await fs.stat(path.join(smoke.host.projects.library.projectDir(decorId), 'assets', file))).size;
  smoke.check('a project asset is served to the window', (await fetchBytes(`library://project/${decorId}/assets/${file}`)) === size);
  smoke.check('a catalog model is served to the window', (await fetchBytes(`library://catalog/furniture/${file}`)) === size);
  smoke.check('the project file and the catalog index are not', (await fetchBytes(`library://project/${decorId}/project.json`)) === -404 && (await fetchBytes('library://catalog/furniture/index.json')) === -404);
  smoke.check('a path that climbs out is not', (await fetchBytes(`library://project/${decorId}/assets/%2e%2e%2fproject.json`)) === -404);
}
