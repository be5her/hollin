import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProjectDoc } from '../doc/defaults';
import { FORMAT_VERSION, type ProjectDoc } from '../doc/schema';
import { newId } from '../ids';
import { ProjectSession } from './project-session';
import { LEVELS_DIR, readProjectDir, writeProjectDir } from './project-store';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-store-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(dir, { recursive: true, force: true });
});

function withEntity(doc: ProjectDoc, levelId = doc.building.stack[0]): ProjectDoc {
  const layerId = Object.values(doc.layers).find((l) => l.levelId === levelId)!.id;
  const id = newId('ent');
  return { ...doc, levelData: { ...doc.levelData, [levelId]: { entities: { ...doc.levelData[levelId].entities, [id]: { id, type: 'label', levelId, layerId, text: 'hi', at: [0, 0], size: 250, rotation: 0 } } } } };
}

function addLevel(doc: ProjectDoc): ProjectDoc {
  const id = newId('lvl');
  return {
    ...doc,
    building: { ...doc.building, stack: [...doc.building.stack, id] },
    levels: { ...doc.levels, [id]: { id, name: 'First floor', slabThickness: 200, place: { k: 'stack', height: 3000 } } },
    levelData: { ...doc.levelData, [id]: { entities: {} } },
  };
}

const levelFiles = async () => (await fs.readdir(path.join(dir, LEVELS_DIR))).sort();

describe('project folder', () => {
  it('round-trips a document', async () => {
    const doc = withEntity(newProjectDoc({ name: 'House', now: '2026-01-01T00:00:00.000Z' }));
    await writeProjectDir(dir, doc);
    const read = await readProjectDir(dir);
    expect(read.doc).toEqual(doc);
    expect(read.warnings).toEqual([]);
    expect(read.doc.formatVersion).toBe(FORMAT_VERSION);
  });

  it('writes only changed levels, under content-hashed names, and removes the old files', async () => {
    let doc = addLevel(newProjectDoc({ name: 'House' }));
    const first = await writeProjectDir(dir, doc);
    const before = await levelFiles();
    expect(before).toHaveLength(2);
    const [ground] = doc.building.stack;
    doc = withEntity(doc, ground);
    const spy = vi.fn(writeProjectDir);
    const second = await spy(dir, doc, first);
    const after = await levelFiles();
    expect(after).toHaveLength(2);
    expect(after.filter((f) => before.includes(f))).toHaveLength(1);
    expect(second.levels.get(doc.building.stack[1])).toBe(first.levels.get(doc.building.stack[1]));
    // Nothing changed: nothing is written.
    const mtime = (await fs.stat(path.join(dir, 'project.json'))).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await writeProjectDir(dir, doc, second);
    expect((await fs.stat(path.join(dir, 'project.json'))).mtimeMs).toBe(mtime);
  });

  it('survives a crash between any two steps of a save', async () => {
    const original = newProjectDoc({ name: 'House' });
    const saved = await writeProjectDir(dir, original);
    const edited = withEntity(original);
    // Crash after the new level file was written but before project.json: the old project loads.
    const ground = edited.building.stack[0];
    const temp = path.join(dir, 'crash');
    await writeProjectDir(temp, edited);
    const newFile = (await fs.readdir(path.join(temp, LEVELS_DIR)))[0];
    await fs.copyFile(path.join(temp, LEVELS_DIR, newFile), path.join(dir, LEVELS_DIR, newFile));
    await fs.writeFile(path.join(dir, 'project.json.abc123.tmp'), '{"half":');
    await fs.rm(temp, { recursive: true });
    const afterCrash = await readProjectDir(dir);
    expect(afterCrash.doc).toEqual(original);
    expect(await levelFiles()).toEqual([[...saved.levels.values()][0].file]);
    expect((await fs.readdir(dir)).some((n) => n.endsWith('.tmp'))).toBe(false);
    // Crash after project.json but before old files were deleted: the new project loads, the old file is cleaned up.
    const s2 = await writeProjectDir(dir, edited, afterCrash.saved);
    await fs.writeFile(path.join(dir, LEVELS_DIR, `${ground}.aaaaaaaaaaaa.json`), '{}');
    const afterSecond = await readProjectDir(dir);
    expect(afterSecond.doc).toEqual(edited);
    expect(await levelFiles()).toEqual([s2.levels.get(ground)!.file]);
  });

  it('leaves files it does not recognise alone', async () => {
    await writeProjectDir(dir, newProjectDoc({ name: 'House' }));
    await fs.writeFile(path.join(dir, LEVELS_DIR, 'notes-DESKTOP-conflict.json'), '{}');
    await readProjectDir(dir);
    expect(await levelFiles()).toContain('notes-DESKTOP-conflict.json');
  });

  it('opens a level whose file is missing as empty, with a warning', async () => {
    const doc = withEntity(newProjectDoc({ name: 'House' }));
    const saved = await writeProjectDir(dir, doc);
    await fs.rm(path.join(dir, LEVELS_DIR, [...saved.levels.values()][0].file));
    const read = await readProjectDir(dir);
    expect(Object.keys(read.doc.levelData[doc.building.stack[0]].entities)).toEqual([]);
    expect(read.warnings[0]).toMatch(/missing/);
  });

  it('refuses a project from a newer version and never rewrites it', async () => {
    await writeProjectDir(dir, newProjectDoc({ name: 'House' }));
    const file = path.join(dir, 'project.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.formatVersion = FORMAT_VERSION + 1;
    raw.futureField = { keep: true };
    await fs.writeFile(file, JSON.stringify(raw));
    await expect(readProjectDir(dir)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).futureField).toEqual({ keep: true });
  });

  it('rejects an invalid project.json with a readable message', async () => {
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ formatVersion: 1, meta: { id: 'x' } }));
    await expect(readProjectDir(dir)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/project.json is not valid/) });
  });
});

describe('ProjectSession autosave', () => {
  // Timing tests write nowhere: fake timers do not wait for real disk I/O.
  const memory = { levels: new Map(), projectJson: '' };

  async function session(options: ConstructorParameters<typeof ProjectSession>[3] = {}) {
    const doc = newProjectDoc({ name: 'House' });
    const saved = await writeProjectDir(dir, doc);
    return new ProjectSession(dir, doc, saved, options);
  }

  it('saves after a quiet period, and within the maximum wait while edits keep coming', async () => {
    vi.useFakeTimers();
    const writes: number[] = [];
    const s = await session({ debounceMs: 750, maxWaitMs: 5000, write: async () => (writes.push(Date.now()), memory) });
    const start = Date.now();
    s.setDoc(withEntity(s.doc));
    await vi.advanceTimersByTimeAsync(700);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toHaveLength(1);
    // A continuous stream of edits every 500 ms still saves within 5 s.
    const streamStart = Date.now();
    for (let i = 0; i < 12; i++) {
      s.setDoc(withEntity(s.doc));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes[1] - streamStart).toBeLessThanOrEqual(5000);
    expect(writes[0] - start).toBe(750);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.isDirty).toBe(false);
  });

  it('stays dirty when a save fails, reports it, and retries', async () => {
    vi.useFakeTimers();
    let fail = true;
    const states: string[] = [];
    const s = await session({
      debounceMs: 10,
      retryMs: 100,
      onSaveState: (state) => states.push(state.state),
      write: async () => {
        if (fail) throw new Error('disk full');
        return memory;
      },
    });
    s.setDoc(withEntity(s.doc));
    await vi.advanceTimersByTimeAsync(20);
    expect(s.isDirty).toBe(true);
    expect(s.saveState).toEqual({ state: 'failed', error: 'disk full' });
    fail = false;
    await vi.advanceTimersByTimeAsync(150);
    expect(s.isDirty).toBe(false);
    expect(s.saveState.state).toBe('saved');
    expect(states).toEqual(['dirty', 'saving', 'failed', 'saving', 'saved']);
  });

  it('writes pending edits when closed', async () => {
    const s = await session({ debounceMs: 60_000 });
    const edited = withEntity(s.doc);
    s.setDoc(edited);
    await s.close();
    expect((await readProjectDir(dir)).doc.levelData).toEqual(edited.levelData);
    expect(() => s.setDoc(withEntity(edited))).toThrow(/closed/);
  });
});
