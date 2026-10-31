import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProjectDoc } from '../doc/defaults';
import type { EditContext } from '../doc/engine';
import { newId } from '../ids';
import { testHost } from '../test-host';
import { Library } from './library';
import { unsafeEntryName } from './package';
import { ProjectService } from './project-service';
import { readProjectDir, writeProjectDir } from './project-store';

let root: string;
let library: Library;
const changes: string[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-lib-'));
  changes.length = 0;
  library = new Library(path.join(root, 'Library'), { onChange: (reason) => changes.push(reason), appVersion: 'test' });
  await library.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await library.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('Library', () => {
  it('creates the folder layout and lists, searches and sorts projects', async () => {
    for (const dir of ['projects', 'trash', '.staging', 'catalog/furniture', 'catalog/materials', 'catalog/symbols']) {
      expect((await fs.stat(path.join(library.root, dir))).isDirectory()).toBe(true);
    }
    await library.create(newProjectDoc({ name: 'Villa Rosé', tags: ['residential', 'pool'], now: '2026-01-01T00:00:00.000Z' }));
    await library.create(newProjectDoc({ name: 'Office tower', tags: ['commercial'], now: '2026-02-01T00:00:00.000Z' }));
    await library.create(newProjectDoc({ name: 'Beach house', description: 'Two storeys by the sea', tags: ['residential'], now: '2026-03-01T00:00:00.000Z' }));
    expect(library.list().map((p) => p.name)).toEqual(['Beach house', 'Office tower', 'Villa Rosé']);
    expect(library.list({ sort: 'name' }).map((p) => p.name)).toEqual(['Beach house', 'Office tower', 'Villa Rosé']);
    expect(library.list({ query: 'rose' }).map((p) => p.name)).toEqual(['Villa Rosé']);
    expect(library.list({ query: 'SEA' }).map((p) => p.name)).toEqual(['Beach house']);
    expect(library.list({ tags: ['residential'] })).toHaveLength(2);
    expect(library.list({ tags: ['residential', 'pool'] }).map((p) => p.name)).toEqual(['Villa Rosé']);
    expect(library.tags()).toEqual([
      { tag: 'residential', count: 2 },
      { tag: 'commercial', count: 1 },
      { tag: 'pool', count: 1 },
    ]);
    expect(changes).toEqual(['created', 'created', 'created']);
  });

  it('rebuilds a missing or broken index from the folders, and drops projects that are gone', async () => {
    const a = await library.create(newProjectDoc({ name: 'A' }));
    const b = await library.create(newProjectDoc({ name: 'B' }));
    await library.trash(b.id);
    await library.close();
    await fs.rm(path.join(library.root, 'index.json'));
    library = new Library(library.root);
    await library.open();
    expect(library.list().map((p) => p.id)).toEqual([a.id]);
    expect(library.list({ trashed: true }).map((p) => p.id)).toEqual([b.id]);

    await library.close();
    await fs.writeFile(path.join(library.root, 'index.json'), 'garbage');
    await fs.rm(library.projectDir(a.id), { recursive: true });
    library = new Library(library.root);
    await library.open();
    expect(library.list()).toEqual([]);
    expect(library.list({ trashed: true })).toHaveLength(1);
  });

  it('picks up a project folder copied in by hand', async () => {
    const doc = newProjectDoc({ name: 'Copied in' });
    const staging = new Library(path.join(root, 'Other'));
    await staging.open();
    await staging.create(doc);
    await staging.close();
    await fs.cp(path.join(root, 'Other', 'projects', doc.meta.id), library.projectDir(doc.meta.id), { recursive: true });
    expect(await library.reconcile()).toMatchObject({ added: 1 });
    expect(library.get(doc.meta.id)?.name).toBe('Copied in');
  });

  it('trashes, restores and deletes for good', async () => {
    const p = await library.create(newProjectDoc({ name: 'Shed' }));
    await library.trash(p.id);
    expect(library.list()).toEqual([]);
    expect(library.get(p.id)?.trashedAt).toBeTruthy();
    expect(JSON.parse(await fs.readFile(path.join(library.trashDir, p.id, 'trashed.json'), 'utf8')).name).toBe('Shed');
    await expect(library.deleteForever(newId('prj'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await library.restore(p.id);
    expect(library.list().map((x) => x.id)).toEqual([p.id]);
    await expect(library.deleteForever(p.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await library.trash(p.id);
    expect(await library.emptyTrash()).toEqual({ deleted: 1 });
    expect(library.get(p.id)).toBeUndefined();
    expect(await fs.readdir(library.trashDir)).toEqual([]);
  });

  it('refuses a thumbnail that arrives while the project goes to the trash, and restores over a folder a late write left', async () => {
    const p = await library.create(newProjectDoc({ name: 'Shed' }));
    const trashing = library.trash(p.id);
    await expect(library.setThumbnail(p.id, PNG)).rejects.toMatchObject({ code: 'CONFLICT' });
    await trashing;
    expect(library.get(p.id)?.trashedAt).toBeTruthy();
    expect(await fs.stat(library.projectDir(p.id)).catch(() => null)).toBeNull();
    // A write that does not check the index (the view state) recreated the folder: restore clears it.
    await fs.mkdir(path.join(library.projectDir(p.id), '.local'), { recursive: true });
    await fs.writeFile(path.join(library.projectDir(p.id), '.local', 'ui.json'), '{}');
    await library.restore(p.id);
    expect(library.get(p.id)?.trashedAt).toBeNull();
    expect((await readProjectDir(library.projectDir(p.id))).doc.meta.name).toBe('Shed');
    expect(await library.setThumbnail(p.id, PNG)).toMatchObject({ trashedAt: null, thumbnail: expect.stringMatching(/^[0-9a-f]{10}$/) });
  });

  it('saves and announces the index when emptying the trash fails part way', async () => {
    const a = await library.create(newProjectDoc({ name: 'A', now: '2026-01-01T00:00:00.000Z' }));
    const b = await library.create(newProjectDoc({ name: 'B', now: '2026-02-01T00:00:00.000Z' }));
    await library.trash(a.id);
    await library.trash(b.id);
    const rm = fs.rm.bind(fs);
    let calls = 0;
    vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target).startsWith(library.trashDir) && ++calls === 2) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      return rm(target, options);
    });
    changes.length = 0;
    await expect(library.emptyTrash()).rejects.toThrow(/EBUSY/);
    expect(changes).toEqual(['deleted']);
    expect(library.list({ trashed: true })).toHaveLength(1);
    await library.close();
    const index = JSON.parse(await fs.readFile(path.join(library.root, 'index.json'), 'utf8')) as { projects: { id: string }[] };
    expect(index.projects).toHaveLength(1);
    await library.open();
  });

  it('duplicates a project under a new id with its thumbnail', async () => {
    const p = await library.create(newProjectDoc({ name: 'Original' }));
    await library.setThumbnail(p.id, PNG);
    const copy = await library.duplicate(p.id, 'Original copy');
    expect(copy.id).not.toBe(p.id);
    expect(copy.thumbnail).toBe(library.get(p.id)!.thumbnail);
    const { doc } = await readProjectDir(library.projectDir(copy.id));
    expect(doc.meta).toMatchObject({ id: copy.id, name: 'Original copy' });
    expect(await fs.readFile(path.join(library.projectDir(copy.id), 'thumbnail.png'))).toEqual(Buffer.from(PNG));
  });

  it('keeps named snapshots and the last ten automatic ones', async () => {
    const doc = newProjectDoc({ name: 'Snap' });
    await library.create(doc);
    const named = await library.createSnapshot(doc.meta.id, doc, { name: 'Concept', kind: 'named', createdBy: 'You' });
    for (let i = 0; i < 12; i++) await library.createSnapshot(doc.meta.id, doc, { name: `auto ${i}`, kind: 'auto', createdBy: 'App' });
    const list = await library.listSnapshots(doc.meta.id);
    expect(list.filter((s) => s.kind === 'auto')).toHaveLength(10);
    expect(list.some((s) => s.id === named.id)).toBe(true);
    expect(list.some((s) => s.name === 'auto 0')).toBe(false);
    expect(await library.readSnapshot(doc.meta.id, named.id)).toEqual(doc);
    await library.deleteSnapshot(doc.meta.id, named.id);
    await expect(library.readSnapshot(doc.meta.id, named.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('accepts only PNG thumbnails', async () => {
    const p = await library.create(newProjectDoc({ name: 'Thumb' }));
    await expect(library.setThumbnail(p.id, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const next = await library.setThumbnail(p.id, PNG);
    expect(next.thumbnail).toMatch(/^[0-9a-f]{10}$/);
    expect(library.thumbnailFile(p.id)).toBe(path.join(library.projectDir(p.id), 'thumbnail.png'));
  });
});

describe('packages', () => {
  it('round-trips a project through export and import, keeping or replacing its id', async () => {
    const doc = newProjectDoc({ name: 'Export me', tags: ['x'] });
    await library.create(doc);
    await library.setThumbnail(doc.meta.id, PNG);
    const asset = Buffer.from('fake glb');
    const hash = createHash('sha256').update(asset).digest('hex');
    await fs.mkdir(path.join(library.projectDir(doc.meta.id), 'assets'), { recursive: true });
    await fs.writeFile(path.join(library.projectDir(doc.meta.id), 'assets', `${hash}.glb`), asset);
    await library.createSnapshot(doc.meta.id, doc, { name: 'v1', kind: 'named', createdBy: 'You' });
    const file = path.join(root, 'out', 'house.psp');
    const result = await library.exportProject(doc.meta.id, file, { appVersion: 'test', includeSnapshots: true });
    expect(result.files).toBeGreaterThanOrEqual(5);

    // Into another library: same id.
    const other = new Library(path.join(root, 'Other'));
    await other.open();
    const imported = await other.importProject(file);
    expect(imported).toMatchObject({ id: doc.meta.id, name: 'Export me', tags: ['x'] });
    expect((await readProjectDir(other.projectDir(imported.id))).doc).toEqual(doc);
    expect(await fs.readFile(path.join(other.projectDir(imported.id), 'assets', `${hash}.glb`))).toEqual(asset);
    expect(await other.listSnapshots(imported.id)).toHaveLength(1);
    expect(imported.thumbnail).toBeTruthy();
    await other.close();

    // Into the same library: a new id and a marked name.
    const again = await library.importProject(file);
    expect(again.id).not.toBe(doc.meta.id);
    expect(again.name).toBe('Export me (imported)');
    expect((await readProjectDir(library.projectDir(again.id))).doc.meta.id).toBe(again.id);
  });

  async function hostile(entries: Zippable, manifest = true): Promise<string> {
    const file = path.join(root, `bad-${newId()}.psp`);
    const files: Zippable = { ...entries };
    if (manifest) {
      files['manifest.json'] = strToU8(JSON.stringify({ format: 'studio-project-package', formatVersion: 1, exportedAt: 'x', appVersion: 'x', projectId: 'x', name: 'x', includesSnapshots: false }));
    }
    await fs.writeFile(file, zipSync(files));
    return file;
  }

  it('rejects hostile or broken packages without leaving anything behind', async () => {
    const valid = newProjectDoc({ name: 'ok' });
    const projectJson = strToU8(JSON.stringify({ ...valid, levelData: undefined, levelFiles: {} }));
    const cases: [string, Promise<string>, RegExp][] = [
      ['not a zip', fs.writeFile(path.join(root, 'nz.psp'), 'hello').then(() => path.join(root, 'nz.psp')), /Not a valid project package/],
      ['no manifest', hostile({ 'project/project.json': projectJson }, false), /manifest.json is missing/],
      ['path escape', hostile({ 'project/../../evil.txt': strToU8('x') }), /unsafe/],
      ['reserved name', hostile({ 'project/assets/CON.glb': strToU8('x') }), /unsafe/],
      ['unexpected file', hostile({ 'project/run.exe': strToU8('x') }), /unsafe/],
      ['case collision', hostile({ 'project/project.json': projectJson, 'project/levels/a.json': strToU8('{}'), 'project/levels/A.json': strToU8('{}') }), /differ only in case/],
      ['checksum mismatch', hostile({ 'project/project.json': projectJson, [`project/assets/${'0'.repeat(64)}.glb`]: strToU8('x') }), /checksum/],
      ['zip bomb', hostile({ 'project/project.json': projectJson, 'project/levels/a.json': [new Uint8Array(20 * 1024 * 1024), { level: 9 }] }), /suspiciously compressed/],
      ['invalid project', hostile({ 'project/project.json': strToU8('{"formatVersion":1}') }), /could not be opened/],
    ];
    for (const [label, file, message] of cases) {
      await expect(library.importProject(await file), label).rejects.toMatchObject({ message: expect.stringMatching(message) });
    }
    expect(await fs.readdir(library.stagingDir)).toEqual([]);
    expect(library.list()).toEqual([]);
  });

  it('names unsafe entries', () => {
    expect(unsafeEntryName('manifest.json')).toBeNull();
    expect(unsafeEntryName('project/levels/a.json')).toBeNull();
    expect(unsafeEntryName('project\\levels\\a.json')).toMatch(/backslash/);
    expect(unsafeEntryName('/etc/passwd')).toMatch(/absolute/);
    expect(unsafeEntryName('C:/x')).toMatch(/absolute/);
    expect(unsafeEntryName('project/levels/nul.json')).toMatch(/reserved/);
    expect(unsafeEntryName('project/levels/a.json.')).toMatch(/dot/);
    expect(unsafeEntryName('project/./a')).toMatch(/escapes/);
  });
});

describe('ProjectService', () => {
  async function service() {
    const host = testHost();
    const remembered: { openProjects: string[]; activeProjectId: string | null }[] = [];
    await library.close();
    const svc = new ProjectService({
      libraryRoot: library.root,
      defaultLibraryRoot: library.root,
      appVersion: 'test',
      emit: host.emit,
      rememberSession: async (s) => void remembered.push(s),
      rememberLibrary: async () => {},
      session: { debounceMs: 10, maxWaitMs: 50 },
    });
    await svc.start({ openProjects: [], activeProjectId: null });
    return { svc, host, remembered };
  }

  it('opens, renames, snapshots, restores and closes a project', async () => {
    const { svc, host, remembered } = await service();
    const created = await svc.create({ name: 'House', tags: ['a'] });
    const opened = await svc.open(created.id);
    expect(opened).toMatchObject({ id: created.id, name: 'House', save: { state: 'saved' } });
    expect(svc.current()?.id).toBe(created.id);
    expect(remembered.at(-1)).toEqual({ openProjects: [created.id], activeProjectId: created.id });

    await svc.update(created.id, { name: 'House 2', tags: [' b ', 'b'] });
    expect(svc.get(created.id)).toMatchObject({ name: 'House 2', tags: ['b'] });
    expect((await readProjectDir(svc.library.projectDir(created.id))).doc.meta.name).toBe('House 2');

    const snap = await svc.createSnapshot(created.id, 'Before changes', 'You');
    const session = svc.session(created.id)!;
    const layerId = Object.keys(session.doc.layers)[0];
    const levelId = session.doc.building.stack[0];
    session.setDoc({ ...session.doc, levelData: { [levelId]: { entities: { lbl_0000000000000000: { id: 'lbl_0000000000000000', type: 'label', levelId, layerId, text: 'x', at: [0, 0], size: 250, rotation: 0 } } } } });
    const { backup } = await svc.restoreSnapshot(created.id, snap.id, 'You');
    expect(Object.keys(session.doc.levelData[levelId].entities)).toEqual([]);
    expect(session.doc.meta.name).toBe('House 2');
    expect(backup.kind).toBe('auto');
    expect(host.events.some((e) => e.event === 'project.changed' && (e.payload as { kind: string }).kind === 'replaced')).toBe(true);

    await svc.close(created.id);
    expect(svc.openProjects()).toEqual([]);
    expect(svc.current()).toBeNull();
    await svc.stop();
  });

  it('makes one session for two opens of the same project at once', async () => {
    const { svc, host } = await service();
    const a = await svc.create({ name: 'A' });
    const [first, second] = await Promise.all([svc.open(a.id), svc.open(a.id, { focus: false })]);
    expect(first.id).toBe(a.id);
    expect(second.id).toBe(a.id);
    expect(svc.openProjects().map((p) => p.id)).toEqual([a.id]);
    const session = svc.session(a.id)!;
    await svc.close(a.id);
    expect(svc.session(a.id)).toBeUndefined();
    expect(() => session.setDoc({ ...session.doc })).toThrow(/closed/);
    expect(host.events.filter((e) => e.event === 'project.changed' && (e.payload as { kind: string }).kind === 'closed')).toHaveLength(1);
    await svc.stop();
  });

  it("records in the index when a save holds Otto's edit, and keeps it through a rebuild", async () => {
    const { svc } = await service();
    const a = await svc.create({ name: 'A' });
    await svc.open(a.id);
    const project = (await svc.resolve(a.id))!;
    const levelId = project.doc.building.stack[0];
    const layerId = Object.keys(project.doc.layers)[0];
    const label = (id: string) => (tx: EditContext) => tx.apply([{ t: 'ins', c: 'entity', id, lv: levelId, v: { id, type: 'label', levelId, layerId, text: 'x', at: [0, 0], size: 250, rotation: 0 } }]);
    await project.edit({ kind: 'user', name: 'You' }, 'Add label', label('lbl_0000000000000001'));
    await svc.session(a.id)!.flush();
    await vi.waitFor(() => expect(svc.library.get(a.id)?.updatedAt).toBeDefined());
    expect(svc.library.get(a.id)?.assistantEditedAt).toBeUndefined();
    await project.edit({ kind: 'assistant', name: 'claude-test' }, 'Add label', label('lbl_0000000000000002'));
    await svc.session(a.id)!.flush();
    await vi.waitFor(() => expect(svc.library.get(a.id)?.assistantEditedAt).toMatch(/^\d{4}-/));
    const at = svc.library.get(a.id)!.assistantEditedAt;
    await svc.library.reindex();
    expect(svc.library.get(a.id)?.assistantEditedAt).toBe(at);
    // An index written before the field existed reads as "never".
    await svc.close(a.id);
    await svc.stop();
    const index = JSON.parse(await fs.readFile(path.join(library.root, 'index.json'), 'utf8')) as { projects: Record<string, unknown>[] };
    for (const p of index.projects) delete p.assistantEditedAt;
    await fs.writeFile(path.join(library.root, 'index.json'), JSON.stringify(index));
    const again = new Library(library.root, { appVersion: 'test' });
    await again.open();
    expect(again.get(a.id)).toMatchObject({ name: 'A' });
    expect(again.get(a.id)?.assistantEditedAt).toBeUndefined();
    await again.close();
  });

  it('keeps a project open and its edits when saving it on close fails', async () => {
    const host = testHost();
    await library.close();
    let fail = false;
    const svc = new ProjectService({
      libraryRoot: library.root,
      defaultLibraryRoot: library.root,
      appVersion: 'test',
      emit: host.emit,
      rememberSession: async () => {},
      rememberLibrary: async () => {},
      session: { debounceMs: 60_000, maxWaitMs: 60_000, retryMs: 60_000, write: (dir, doc, prev) => (fail ? Promise.reject(new Error('disk full')) : writeProjectDir(dir, doc, prev)) },
    });
    await svc.start({ openProjects: [], activeProjectId: null });
    const a = await svc.create({ name: 'A' });
    await svc.open(a.id);
    const project = (await svc.resolve(a.id))!;
    const levelId = project.doc.building.stack[0];
    const layerId = Object.keys(project.doc.layers)[0];
    fail = true;
    await project.edit({ kind: 'user', name: 'You' }, 'Add label', (tx) => tx.apply([{ t: 'ins', c: 'entity', id: 'lbl_0000000000000000', lv: levelId, v: { id: 'lbl_0000000000000000', type: 'label', levelId, layerId, text: 'x', at: [0, 0], size: 250, rotation: 0 } }]));
    await expect(svc.close(a.id)).rejects.toThrow('disk full');
    expect(svc.openProjects().map((p) => p.id)).toEqual([a.id]);
    await project.edit({ kind: 'user', name: 'You' }, 'Move label', (tx) => tx.apply([{ t: 'upd', c: 'entity', id: 'lbl_0000000000000000', lv: levelId, set: { at: [100, 0] } }]));
    fail = false;
    await svc.close(a.id);
    expect(svc.openProjects()).toEqual([]);
    expect((await readProjectDir(svc.library.projectDir(a.id))).doc.levelData[levelId].entities.lbl_0000000000000000).toMatchObject({ at: [100, 0] });
    await svc.stop();
  });

  it('exports and duplicates an open project while it autosaves, with every level file', async () => {
    const { svc } = await service();
    const a = await svc.create({ name: 'A' });
    await svc.open(a.id);
    const project = (await svc.resolve(a.id))!;
    const levelId = project.doc.building.stack[0];
    const layerId = Object.keys(project.doc.layers)[0];
    for (let i = 0; i < 5; i++) {
      await project.edit({ kind: 'user', name: 'You' }, 'Add label', (tx) => {
        const id = newId('lbl');
        tx.apply([{ t: 'ins', c: 'entity', id, lv: levelId, v: { id, type: 'label', levelId, layerId, text: `${i}`, at: [i, 0], size: 250, rotation: 0 } }]);
      });
      const [copy] = await Promise.all([svc.duplicate(a.id), svc.exportProject(a.id, path.join(root, `a-${i}.psp`))]);
      const read = await readProjectDir(svc.library.projectDir(copy.id));
      expect(read.warnings).toEqual([]);
      expect(Object.keys(read.doc.levelData[levelId].entities)).toHaveLength(i + 1);
    }
    await svc.stop();
  });

  it('resolves a named project by opening it, and refuses trashed or unknown ones', async () => {
    const { svc } = await service();
    const a = await svc.create({ name: 'A' });
    const b = await svc.create({ name: 'B' });
    expect(await svc.resolve(null)).toBeUndefined();
    expect((await svc.resolve(a.id))?.id).toBe(a.id);
    expect(svc.openProjects().map((p) => p.id)).toEqual([a.id]);
    await svc.trash(b.id);
    await expect(svc.resolve(b.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.resolve(newId('prj'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await svc.stop();
  });

  it('reopens what was open, and closes a project before trashing it', async () => {
    const first = await service();
    const a = await first.svc.create({ name: 'A' });
    const b = await first.svc.create({ name: 'B' });
    await first.svc.open(a.id);
    await first.svc.open(b.id);
    await first.svc.stop();
    const session = first.remembered.at(-1)!;
    expect(session.openProjects).toEqual([a.id, b.id]);

    library = new Library(library.root);
    const second = new ProjectService({ libraryRoot: library.root, defaultLibraryRoot: library.root, appVersion: 'test', emit: () => {}, rememberSession: async () => {}, rememberLibrary: async () => {} });
    await second.start(session);
    expect(second.openProjects().map((p) => p.id)).toEqual([a.id, b.id]);
    expect(second.current()?.id).toBe(b.id);
    await second.trash(a.id);
    expect(second.openProjects().map((p) => p.id)).toEqual([b.id]);
    await second.stop();
  });

  it('moves the library to an empty folder and adopts an existing one', async () => {
    const { svc } = await service();
    const a = await svc.create({ name: 'A' });
    await svc.open(a.id);
    const target = path.join(root, 'Moved');
    await expect(svc.moveLibrary(path.join(library.root, 'inside'), 'move')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const info = await svc.moveLibrary(target, 'move');
    expect(info).toMatchObject({ path: target, projects: 1, isDefault: false });
    expect(svc.openProjects().map((p) => p.id)).toEqual([a.id]);
    expect(await fs.stat(library.root).catch(() => null)).toBeNull();
    await expect(svc.moveLibrary(path.join(root, 'nothing-here'), 'adopt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await svc.stop();
    library = new Library(target);
  });
});
