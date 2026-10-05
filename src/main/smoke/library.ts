import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { newId, type LibraryInfo, type OpenProject, type ProjectDoc, type ProjectSummary, type SnapshotInfo } from '@studio/core';
import { wait, type Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

/** Adds a label to the ground floor of an open project, straight through its session (the editors come later). */
export function addLabel(smoke: Smoke, projectId: string, label: string): ProjectDoc {
  const session = smoke.host.projects.session(projectId);
  if (!session) throw new Error(`project ${projectId} is not open`);
  const doc = session.doc;
  const levelId = doc.building.stack[0];
  const layerId = Object.values(doc.layers).find((l) => l.levelId === levelId && l.kind === 'interior')!.id;
  const id = newId('lbl');
  const next: ProjectDoc = { ...doc, levelData: { ...doc.levelData, [levelId]: { entities: { ...doc.levelData[levelId].entities, [id]: { id, type: 'label', levelId, layerId, text: label } } } } };
  session.setDoc(next);
  return next;
}

/** The labels stored on disk for a project's ground floor. */
async function labelsOnDisk(smoke: Smoke, projectId: string): Promise<string[]> {
  const dir = smoke.host.projects.library.projectDir(projectId);
  const project = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')) as { building: { stack: string[] }; levelFiles: Record<string, string> };
  const file = project.levelFiles[project.building.stack[0]];
  const level = JSON.parse(await fs.readFile(path.join(dir, 'levels', file), 'utf8')) as { entities: { text?: string }[] };
  return level.entities.map((e) => e.text ?? '');
}

/** The project library through commands and MCP. */
export async function smokeLibrary(smoke: Smoke): Promise<{ houseId: string }> {
  const { host } = smoke;
  smoke.section('library');
  const info = await smoke.run<LibraryInfo>('library.info');
  smoke.check('the library starts empty in the data folder', info.projects === 0 && info.path.startsWith(host.opts.userDataDir) && info.isDefault, info);
  for (const dir of ['projects', 'trash', 'catalog']) {
    smoke.check(`the library has its ${dir} folder`, Boolean(await fs.stat(path.join(info.path, dir)).catch(() => null)));
  }

  const house = await smoke.run<ProjectSummary>('project.create', { name: 'Smoke House', tags: ['residential', 'smoke'], open: false });
  const dir = host.projects.library.projectDir(house.id);
  const levelFiles = await fs.readdir(path.join(dir, 'levels'));
  smoke.check('a new project is written as project.json plus one content-hashed level file', Boolean(await fs.stat(path.join(dir, 'project.json')).catch(() => null)) && levelFiles.length === 1 && /^lvl_[0-9a-z]{16}\.[0-9a-f]{12}\.json$/.test(levelFiles[0]), levelFiles);
  smoke.check('a new project has one ground floor', house.levelCount === 1);
  await smoke.run('project.create', { name: 'Office Block', tags: ['commercial'], open: false });
  smoke.check('projects are searchable by name', (await smoke.run<ProjectSummary[]>('project.list', { query: 'smoke' })).map((p) => p.name).join() === 'Smoke House');
  smoke.check('projects filter by tag', (await smoke.run<ProjectSummary[]>('project.list', { tags: ['commercial'] })).map((p) => p.name).join() === 'Office Block');

  const from = smoke.events.length;
  const opened = await smoke.run<OpenProject>('project.open', { id: house.id });
  smoke.check('opening a project announces it with focus', smoke.eventsSince(from, 'project.changed').some((e) => e.projectId === house.id && e.kind === 'opened' && e.focus));
  smoke.check('the opened project is current', opened.save.state === 'saved' && (await smoke.run<OpenProject | null>('project.current'))?.id === house.id);
  smoke.check('open projects are remembered for the next start', host.config.get().session.openProjects.includes(house.id) && host.config.get().session.activeProjectId === house.id);
  smoke.check('project tools run against the project on screen', (await smoke.run<{ project: string }>('smoke.where', {}, { projectId: house.id })).project === house.id);

  smoke.section('autosave');
  addLabel(smoke, house.id, 'kitchen');
  smoke.check('an edit marks the project unsaved', host.projects.session(house.id)?.isDirty === true);
  smoke.check('the edit is saved shortly after', await smoke.until(() => host.projects.session(house.id)?.saveState.state === 'saved', 4000));
  smoke.check('the saved level file holds the edit', (await labelsOnDisk(smoke, house.id)).includes('kitchen'));
  smoke.check('saving is announced', smoke.eventsSince(from, 'project.changed').some((e) => e.kind === 'save' && e.save?.state === 'saved'));
  smoke.check('only the current level file is kept', (await fs.readdir(path.join(dir, 'levels'))).length === 1);
  addLabel(smoke, house.id, 'pantry');
  await smoke.run('project.close', { id: house.id });
  smoke.check('closing a project saves pending edits at once', (await labelsOnDisk(smoke, house.id)).includes('pantry'));
  smoke.check('a closed project is no longer current', (await smoke.run('project.current')) === null && !host.config.get().session.openProjects.includes(house.id));
  await smoke.run('project.open', { id: house.id });

  smoke.section('snapshots');
  const v1 = await smoke.run<SnapshotInfo>('project.snapshot.create', { name: 'Two rooms' }, { projectId: house.id });
  addLabel(smoke, house.id, 'garage');
  const restored = await smoke.run<{ backup: SnapshotInfo }>('project.snapshot.restore', { snapshotId: v1.id }, { projectId: house.id });
  const labels = Object.values(host.projects.session(house.id)!.doc.levelData).flatMap((l) => Object.values(l.entities).map((e) => (e as { text?: string }).text));
  smoke.check('restoring a snapshot brings its design back', labels.includes('kitchen') && labels.includes('pantry') && !labels.includes('garage'), labels);
  const snaps = await smoke.run<SnapshotInfo[]>('project.snapshot.list', {}, { projectId: house.id });
  smoke.check('the design before the restore is kept as an automatic snapshot', snaps.some((s) => s.id === restored.backup.id && s.kind === 'auto') && snaps.some((s) => s.id === v1.id && s.createdBy === 'You'));
  await smoke.expectError('deleting a snapshot is gated for agents', 'project.snapshot.delete', { snapshotId: restored.backup.id }, 'MUTATION_BLOCKED', { caller: 'mcp', projectId: house.id });

  smoke.section('trash and duplicates');
  const copy = await smoke.run<ProjectSummary>('project.duplicate', { id: house.id });
  smoke.check('duplicating gives a new project with "copy" in its name', copy.id !== house.id && copy.name === 'Smoke House copy');
  await smoke.run('project.trash', { id: copy.id });
  smoke.check('trashed projects leave the list and appear in the trash', !(await smoke.run<ProjectSummary[]>('project.list')).some((p) => p.id === copy.id) && (await smoke.run<ProjectSummary[]>('project.list', { trashed: true })).some((p) => p.id === copy.id));
  smoke.check('a trashed project folder moves to trash/', Boolean(await fs.stat(path.join(info.path, 'trash', copy.id, 'project.json')).catch(() => null)));
  await smoke.expectError('a trashed project cannot be opened', 'project.open', { id: copy.id }, 'CONFLICT');
  await smoke.expectError('emptying the trash is gated for agents', 'library.trash.empty', {}, 'MUTATION_BLOCKED', { caller: 'mcp' });
  await smoke.expectError('deleting permanently is gated for agents', 'project.delete', { id: copy.id }, 'MUTATION_BLOCKED', { caller: 'mcp' });
  await smoke.run('project.restore', { id: copy.id });
  smoke.check('restoring brings it back', (await smoke.run<ProjectSummary[]>('project.list')).some((p) => p.id === copy.id));

  smoke.section('packages');
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-smoke-export-'));
  const file = path.join(out, 'smoke-house.psp');
  await smoke.expectError('exporting is gated for agents (it writes outside the library)', 'project.export', { id: house.id, path: file }, 'MUTATION_BLOCKED', { caller: 'mcp' });
  const exported = await smoke.run<{ bytes: number }>('project.export', { id: house.id, path: file, includeSnapshots: true });
  smoke.check('a project exports to one package file', exported.bytes > 0 && Boolean(await fs.stat(file).catch(() => null)));
  const imported = await smoke.run<OpenProject>('project.import', { path: file });
  smoke.check('importing a copy into the same library gives it a new id and marks its name', imported.id !== house.id && imported.name === 'Smoke House (imported)');
  smoke.check('the imported project opens with its design', (await smoke.run<SnapshotInfo[]>('project.snapshot.list', {}, { projectId: imported.id })).length >= 1);
  await smoke.run('project.close', { id: imported.id });
  await fs.writeFile(path.join(out, 'broken.psp'), 'not a zip');
  await smoke.expectError('a damaged package is refused', 'project.import', { path: path.join(out, 'broken.psp') }, 'INVALID_INPUT');
  await fs.rm(out, { recursive: true, force: true });

  smoke.section('library over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-architect', version: '3.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.url)));
  const tools = new Set((await client.listTools()).tools.map((t) => t.name));
  smoke.check('the library is available to agents', ['project_list', 'project_create', 'project_open', 'project_current', 'project_snapshot_create'].every((t) => tools.has(t)) && !tools.has('project_focus'));
  const listed = text(await client.callTool({ name: 'project_list', arguments: { query: 'office' } })) as unknown as ProjectSummary[];
  smoke.check('an agent can search the library', listed.length === 1 && listed[0].name === 'Office Block');
  const agentProject = text(await client.callTool({ name: 'project_create', arguments: { name: 'Agent Cabin' } })) as unknown as OpenProject;
  smoke.check('an agent can create and open a project', agentProject.name === 'Agent Cabin' && host.projects.current()?.id === agentProject.id);
  const where = text(await client.callTool({ name: 'smoke_where', arguments: {} }));
  smoke.check("an agent's project tools follow the project on screen", where.project === agentProject.id, where);
  const office = listed[0];
  const named = text(await client.callTool({ name: 'smoke_where', arguments: { projectId: office.id } }));
  smoke.check('naming a closed project opens it for the call', named.project === office.id && host.projects.openProjects().some((p) => p.id === office.id));
  const snapshot = text(await client.callTool({ name: 'project_snapshot_create', arguments: { name: 'Agent checkpoint' } })) as unknown as SnapshotInfo;
  smoke.check('snapshots by agents are attributed to them', snapshot.createdBy === 'via MCP: smoke-architect 3.0', snapshot);
  await client.close();
  await smoke.run('project.close', { id: office.id });
  await smoke.run('project.close', { id: agentProject.id });
  await smoke.run('project.focus', { id: house.id });
  await wait(50);
  return { houseId: house.id };
}
