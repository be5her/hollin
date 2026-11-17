import { promises as fs, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Entity, ProjectDoc } from '@studio/core';
import type { BrowserWindow } from 'electron';
import type { Host } from '../host';
import { Smoke, freePort, wait } from './harness';
import { canvas, canvasAttr, openProjectTab, readCamera, tab, view } from './plan-canvas';
import { sceneAttr, sceneCanvas, sceneView } from './scene-canvas';

/**
 * `COURSE_SHOTS=<dir> npm run smoke`: instead of the checks, the app draws the two projects of the
 * course (`course/`, the web tutorial) the way its lessons tell a learner to, once in English and once
 * in Arabic, and saves the pictures the lessons show as WebP into `<dir>/<language>/`, with
 * `<dir>/shots.json` giving each picture's size and the numbered marks drawn over it.
 *
 * What a lesson asks a learner to do by hand is done here with real input wherever it could go wrong
 * (lengths typed along a tracked direction, runs closed on their first point, walls started on
 * endpoints, a door at a typed distance, the mirror of one apartment into the other), and every such
 * step is checked against the document: a lesson step that stops working fails this run. The rest
 * (furniture, finishes, lights) goes through commands, the same ones the tools send.
 */

type Lang = 'en' | 'ar';
type P = readonly [number, number];
type Rect = { x: number; y: number; width: number; height: number };
type Wall = Extract<Entity, { type: 'wall' }>;
type Opening = Extract<Entity, { type: 'opening' }>;
type Mark = { n: number; sel?: string; world?: P; at?: { x: number; y: number } };
type Crop = 'window' | 'center' | 'left' | 'right' | 'center+right' | 'dialog' | { sel: string[]; pad?: number } | { world: readonly [number, number, number, number]; pad?: number };
type ShotMeta = { w: number; h: number; marks?: { n: number; x: number; y: number }[] };

/** What the learner types as names, per language. Level, layer and default names come from the app. */
const TEXT = {
  en: {
    studio: 'My first plan',
    building: 'Four apartments',
    firstFloor: 'First floor',
    living: 'Living',
    bedroom: 'Bedroom',
    bathroom: 'Bathroom',
    kitchen: 'Kitchen',
    livingRoom: 'Living room',
    bedroom1: 'Bedroom 1',
    bedroom2: 'Bedroom 2',
    hall: 'Hall',
    entrance: 'Entrance hall',
    landing: 'Landing',
    snapshot: 'Before the first floor',
  },
  ar: {
    studio: 'مخططي الأول',
    building: 'أربع شقق',
    firstFloor: 'الطابق الأول',
    living: 'المعيشة',
    bedroom: 'غرفة النوم',
    bathroom: 'الحمّام',
    kitchen: 'المطبخ',
    livingRoom: 'غرفة المعيشة',
    bedroom1: 'غرفة النوم 1',
    bedroom2: 'غرفة النوم 2',
    hall: 'الممر',
    entrance: 'بهو المدخل',
    landing: 'بسطة الدرج',
    snapshot: 'قبل الطابق الأول',
  },
} as const;

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a: P, b: P, tol = 0.5) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
const other = (side: 'left' | 'right') => (side === 'left' ? 'right' : 'left');

/** One open project: its document in main, commands on it, and the walls found by their ends. */
class Project {
  constructor(
    readonly smoke: Smoke,
    readonly id: string,
  ) {}

  doc(): ProjectDoc {
    return this.smoke.host.projects.session(this.id)!.doc as ProjectDoc;
  }

  run<T = unknown>(command: string, input: unknown = {}): Promise<T> {
    return this.smoke.run<T>(command, input, { projectId: this.id });
  }

  get ground(): string {
    return this.doc().building.groundLevelId;
  }

  entities(levelId: string): Entity[] {
    return Object.values(this.doc().levelData[levelId]?.entities ?? {});
  }

  walls(levelId: string): Wall[] {
    return this.entities(levelId).filter((e): e is Wall => e.type === 'wall');
  }

  openings(levelId: string): Opening[] {
    return this.entities(levelId).filter((e): e is Opening => e.type === 'opening');
  }

  count(levelId: string, type: Entity['type']): number {
    return this.entities(levelId).filter((e) => e.type === type).length;
  }

  /** The wall between two points, whichever way it was drawn. */
  findWall(levelId: string, a: P, b: P, tol = 0.5): { wall: Wall; reversed: boolean } | null {
    for (const wall of this.walls(levelId)) {
      const v = wall.path.v;
      if (v.length !== 2) continue;
      if (near(v[0].p, a, tol) && near(v[1].p, b, tol)) return { wall, reversed: false };
      if (near(v[0].p, b, tol) && near(v[1].p, a, tol)) return { wall, reversed: true };
    }
    return null;
  }

  wall(levelId: string, a: P, b: P): { wall: Wall; reversed: boolean } {
    const found = this.findWall(levelId, a, b);
    if (!found) throw new Error(`no wall from ${a.join(',')} to ${b.join(',')}`);
    return found;
  }

  /**
   * A learner's first click lands wherever the pointer is, a few millimetres from the round numbers the
   * script aims at. Everything after it is exact from there (typed lengths, endpoints), so once the first
   * run is drawn the script moves it by that offset and works in round numbers from then on.
   */
  async normalise(levelId: string): Promise<void> {
    const first = this.walls(levelId)[0]?.path.v[0].p;
    if (!first || (first[0] === 0 && first[1] === 0)) return;
    console.log(`the first click landed at ${first.join(', ')}`);
    await this.run('plan.transform', { ids: this.walls(levelId).map((w) => w.id), translate: [-first[0], -first[1]] });
  }

  /** A door or window in the wall a → b, its centre `d` from `a`; a door's hinge end and swing side are given looking from a to b. */
  async opening(levelId: string, a: P, b: P, d: number, o: { kind: 'door' | 'window'; width?: number; height?: number; sill?: number; hinge?: 'a' | 'b'; side?: 'left' | 'right' }): Promise<string> {
    const { wall, reversed } = this.wall(levelId, a, b);
    const along = reversed ? dist(a, b) - d : d;
    const side = o.side ?? 'left';
    const hinge = (o.hinge ?? 'a') === 'a' ? 'start' : 'end';
    const swing = o.kind === 'door' ? { hinge: reversed ? (hinge === 'start' ? 'end' : 'start') : hinge, side: reversed ? other(side) : side } : undefined;
    const made = await this.run<{ id: string }>('plan.opening.add', { wallId: wall.id, kind: o.kind, along, width: o.width, height: o.height, sill: o.sill, ...(swing ? { swing } : {}) });
    return made.id;
  }

  async room(levelId: string, seed: P, name: string): Promise<string> {
    return (await this.run<{ id: string }>('plan.room.add', { levelId, seed, name })).id;
  }

  item(levelId: string, ref: string, at: P, rotation = 0, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.run('decor.item.place', { levelId, ref: `builtin:${ref}`, at, rotation, ...extra });
  }

  light(levelId: string, at: P, lumens = 1200, height = 2400): Promise<unknown> {
    return this.run('decor.light.add', { levelId, kind: 'point', at: [at[0], at[1], height], intensity: lumens });
  }

  finish(roomId: string, surface: 'floor' | 'walls' | 'ceiling', material: string): Promise<unknown> {
    return this.run('decor.material.set', { target: { roomId, surface }, material: `builtin:${material}` });
  }
}

/** The pictures: a crop of the window as WebP, with the marks a lesson numbers. */
class Shots {
  readonly meta: Record<string, Record<string, ShotMeta>> = {};
  lang: Lang = 'en';

  constructor(
    private readonly smoke: Smoke,
    private readonly dir: string,
  ) {}

  /** `trim` cuts that fraction off each side (the exports leave a wide margin round the building). */
  private async toWebp(png: Buffer, quality = 0.9, trim: readonly [number, number] = [0, 0]): Promise<{ data: Buffer; width: number; height: number }> {
    const source = `data:image/png;base64,${png.toString('base64')}`;
    const url = await this.smoke.js<string>(
      `new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { const w = Math.round(img.naturalWidth * (1 - 2 * ${trim[0]})); const h = Math.round(img.naturalHeight * (1 - 2 * ${trim[1]})); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, -Math.round(img.naturalWidth * ${trim[0]}), -Math.round(img.naturalHeight * ${trim[1]})); resolve(w + 'x' + h + ';' + c.toDataURL('image/webp', ${quality})); }; img.onerror = () => reject(new Error('the picture could not be decoded')); img.src = ${JSON.stringify(source)}; })`,
    );
    const [width, height] = url.slice(0, url.indexOf(';')).split('x').map(Number);
    return { data: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'), width, height };
  }

  private async save(name: string, png: Buffer, marks?: { n: number; x: number; y: number }[], trim?: readonly [number, number]): Promise<void> {
    const folder = path.join(this.dir, this.lang);
    await fs.mkdir(folder, { recursive: true });
    const webp = await this.toWebp(png, 0.9, trim);
    await fs.writeFile(path.join(folder, `${name}.webp`), webp.data);
    (this.meta[this.lang] ??= {})[name] = { w: webp.width, h: webp.height, ...(marks?.length ? { marks } : {}) };
    console.log(`shot ${this.lang}/${name} ${webp.width}x${webp.height}`);
  }

  private async cropRect(crop: Crop): Promise<Rect> {
    const [width, height] = this.smoke.window.getContentSize();
    const whole: Rect = { x: 0, y: 0, width, height };
    if (crop === 'window') return whole;
    let boxes: Rect[] = [];
    let pad = 0;
    if (typeof crop === 'object' && 'world' in crop) {
      const v = await view(this.smoke);
      const a = v.at([crop.world[0], crop.world[3]]);
      const b = v.at([crop.world[2], crop.world[1]]);
      boxes = [{ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }];
      pad = crop.pad ?? 24;
    } else {
      const selectors =
        typeof crop === 'object'
          ? crop.sel
          : crop === 'center'
            ? [`${tab} [data-testid=project-center]`]
            : crop === 'left'
              ? [`${tab} [data-testid=project-left]`]
              : crop === 'right'
                ? [`${tab} [data-testid=project-right]`]
                : crop === 'dialog'
                  ? ['x-dialog-host [role=dialog]']
                  : [`${tab} [data-testid=project-center]`, `${tab} [data-testid=project-right]`];
      pad = typeof crop === 'object' ? (crop.pad ?? 0) : crop === 'dialog' ? 56 : 0;
      for (const sel of selectors) {
        const r = await this.smoke.rect(sel);
        if (r && r.width > 0 && r.height > 0) boxes.push(r);
      }
    }
    if (!boxes.length) return whole;
    const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((r) => r.x)) - pad));
    const y0 = Math.max(0, Math.floor(Math.min(...boxes.map((r) => r.y)) - pad));
    const x1 = Math.min(width, Math.ceil(Math.max(...boxes.map((r) => r.x + r.width)) + pad));
    const y1 = Math.min(height, Math.ceil(Math.max(...boxes.map((r) => r.y + r.height)) + pad));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /** A picture of the window (or a part of it) as it is now, toasts dismissed first. */
  async take(name: string, crop: Crop = 'center', marks: Mark[] = []): Promise<void> {
    const smoke = this.smoke;
    await smoke.js("[...document.querySelectorAll('x-toast-host button:not([data-testid=toast-action])')].forEach((b) => b.click())");
    await wait(180);
    const rect = await this.cropRect(crop);
    const placed: { n: number; x: number; y: number }[] = [];
    for (const mark of marks) {
      let at = mark.at;
      if (mark.sel) {
        const r = await smoke.rect(mark.sel);
        if (r) at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      } else if (mark.world) at = (await view(smoke)).at(mark.world);
      if (!at) {
        smoke.check(`mark ${mark.n} of ${name} has a place`, false, mark);
        continue;
      }
      placed.push({ n: mark.n, x: Math.round(((at.x - rect.x) / rect.width) * 1000) / 10, y: Math.round(((at.y - rect.y) / rect.height) * 1000) / 10 });
    }
    const wc = smoke.window.webContents;
    wc.invalidate();
    await Promise.race([smoke.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'), wait(500)]);
    const image = await wc.capturePage(rect);
    await this.save(name, image.toPNG(), placed);
  }

  /** A picture the app exported itself (a PNG file), kept next to the screenshots. */
  async keep(name: string, file: string, trim: readonly [number, number] = [0, 0]): Promise<void> {
    await this.save(name, await fs.readFile(file), undefined, trim);
  }

  async writeIndex(): Promise<void> {
    await fs.writeFile(path.join(this.dir, 'shots.json'), `${JSON.stringify(this.meta, null, 1)}\n`);
  }
}

// ---------- driving the plan like a learner ----------

const focusCanvas = (smoke: Smoke) => smoke.js(`document.querySelector('${canvas}')?.focus()`);
const tool = (smoke: Smoke) => canvasAttr(smoke, 'tool');

/** Picks a tool by its key with the canvas focused, and waits until the editor has it. */
async function pick(smoke: Smoke, key: string, id: string, shift = false): Promise<void> {
  await focusCanvas(smoke);
  await smoke.key(key, shift ? ['shift'] : []);
  smoke.check(`${shift ? 'Shift+' : ''}${key} picks the ${id} tool`, await smoke.until(async () => (await tool(smoke)) === id, 4000), await tool(smoke));
  await wait(150);
}

/** Back to the Select tool with nothing in progress and nothing selected. */
async function toSelect(smoke: Smoke): Promise<void> {
  await focusCanvas(smoke);
  for (let i = 0; i < 4 && (await tool(smoke)) !== 'select'; i++) await smoke.key('Escape');
  await smoke.key('Escape');
  await wait(120);
}

/** Moves the pointer to a point of the plan; a second move makes sure the canvas has seen it. */
async function hover(smoke: Smoke, p: P, modifiers: ('alt' | 'control' | 'shift')[] = []): Promise<void> {
  const v = await view(smoke);
  const at = v.at(p);
  await smoke.mouseMove(at.x + 1, at.y, modifiers);
  await smoke.mouseMove(at.x, at.y, modifiers);
  await wait(60);
}

async function clickWorld(smoke: Smoke, p: P, modifiers: ('alt' | 'control' | 'shift')[] = [], clickCount = 1): Promise<void> {
  const v = await view(smoke);
  const at = v.at(p);
  await smoke.mouseMove(at.x + 1, at.y, modifiers);
  await smoke.clickAt(at.x, at.y, { modifiers, clickCount });
}

/** Types into the dynamic input at the cursor: the first character opens it. */
async function typeAtCursor(smoke: Smoke, text: string, commit = true): Promise<void> {
  await smoke.key(text[0]);
  if (text.length > 1) await smoke.typeText(text.slice(1));
  if (commit) await smoke.key('Return');
}

/** Types a value into a field (a tool option, a property) and commits it with Enter. */
async function typeInto(smoke: Smoke, selector: string, text: string): Promise<void> {
  const r = await smoke.rect(selector);
  if (!r) {
    smoke.check(`the field ${selector} is there`, false);
    return;
  }
  await smoke.clickAt(r.x + r.width / 2, r.y + r.height / 2);
  await smoke.key('A', ['control']);
  await smoke.typeText(text);
  await smoke.key('Return');
  await wait(150);
}

/** Zooms and pans the plan until a rectangle of the world fills the canvas (the wheel and a middle drag, as a learner would). */
async function frame(smoke: Smoke, r: readonly [number, number, number, number], fill = 0.86): Promise<void> {
  await smoke.waitFor(canvas);
  // A plan nobody has moved yet has not said where its camera is: one wheel tick makes it.
  if (!(await readCamera(smoke))) {
    const r = (await smoke.rect(canvas))!;
    await smoke.mouseMove(r.x + r.width / 2, r.y + r.height / 2);
    await smoke.wheel(r.x + r.width / 2, r.y + r.height / 2, 100);
    smoke.check('the plan says where its camera is', await smoke.until(async () => Boolean(await readCamera(smoke)), 4000));
  }
  let last = 0;
  for (let i = 0; i < 60; i++) {
    const v = await view(smoke);
    const want = Math.min(v.rect.width / (r[2] - r[0]), v.rect.height / (r[3] - r[1])) * fill;
    const cx = v.rect.x + v.rect.width / 2;
    const cy = v.rect.y + v.rect.height / 2;
    const step = v.cam.scale > want * 1.0005 ? 1 : v.cam.scale < want / 1.12 ? -1 : 0;
    if (step === 0 || (last !== 0 && step !== last)) break;
    last = step;
    const before = v.cam.scale;
    await smoke.wheel(cx, cy, step * 100);
    await smoke.until(async () => (await view(smoke)).cam.scale !== before, 800);
  }
  for (let i = 0; i < 3; i++) {
    const v = await view(smoke);
    const c = v.at([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]);
    const cx = v.rect.x + v.rect.width / 2;
    const cy = v.rect.y + v.rect.height / 2;
    if (Math.hypot(c.x - cx, c.y - cy) < 3) break;
    await smoke.dragAt(c, { x: cx, y: cy }, { button: 'middle' });
    await wait(120);
  }
  await wait(150);
}

/**
 * A run of walls the way the lessons draw one: a click on the start, then each next corner either
 * typed as a length along the direction the pointer was moved in, or clicked (an endpoint that is
 * already there). `close` clicks the first point again; otherwise Enter ends the run.
 */
async function drawRun(smoke: Smoke, project: Project, levelId: string, start: P, legs: (readonly [dx: number, dy: number, how: 'type' | 'click'])[], close: boolean, onLeg?: (index: number) => Promise<void>, tol = 0.5): Promise<void> {
  const walls = () => project.walls(levelId).length;
  let count = walls();
  let at: P = start;
  await clickWorld(smoke, start);
  for (let i = 0; i < legs.length; i++) {
    const [dx, dy, how] = legs[i];
    const next: P = [at[0] + dx, at[1] + dy];
    const length = Math.hypot(dx, dy);
    if (how === 'type') {
      // Aim a little way along the leg: the direction is what counts, the typed length does the rest.
      const aim = Math.min(length, 1800) / length;
      await hover(smoke, [at[0] + dx * aim, at[1] + dy * aim]);
      await smoke.key(String(length)[0]);
      await smoke.typeText(String(length).slice(1));
      if (onLeg) await onLeg(i);
      await smoke.key('Return');
    } else await clickWorld(smoke, next);
    count++;
    const drawn = await smoke.until(() => walls() === count && Boolean(project.findWall(levelId, at, next, tol)), 4000);
    smoke.check(`wall ${i + 1} of the run from ${start.join(',')} ends at ${next.join(',')}`, drawn, project.walls(levelId).map((w) => w.path.v.map((v) => v.p.join(',')).join(' > ')).slice(-2));
    at = next;
  }
  if (close) {
    await clickWorld(smoke, start);
    count++;
    smoke.check(`the run closes on its first point ${start.join(',')}`, await smoke.until(() => walls() === count && Boolean(project.findWall(levelId, at, start, tol)), 4000));
  } else {
    await focusCanvas(smoke);
    await smoke.key('Return');
  }
  await wait(120);
}

async function rightTab(smoke: Smoke, id: string): Promise<void> {
  await smoke.click(`${tab} [data-testid=right-tab-${id}]`);
  await wait(250);
}

async function centerTab(smoke: Smoke, id: 'plan' | 'section' | '3d'): Promise<void> {
  await smoke.click(`${tab} [data-testid=center-tab-${id}]`);
  if (id === 'plan') await smoke.waitFor(canvas);
  if (id === '3d') await smoke.until(async () => Number(await sceneAttr(smoke, 'meshes')) > 0, 15_000);
  await wait(500);
}

/** Makes a level active from the Levels panel and waits until the plan has drawn it. */
async function showLevel(smoke: Smoke, levelId: string, name: string): Promise<void> {
  await smoke.click(`${tab} [data-testid=level-row][data-name=${JSON.stringify(name)}]`);
  if (await smoke.count(canvas)) smoke.check(`the plan shows ${name}`, await smoke.until(async () => (await canvasAttr(smoke, 'frameLevel')) === levelId, 5000));
  await wait(200);
}

/** Waits for the 3D view to have drawn after a change (its frame time changes with every frame). */
async function sceneSettled(smoke: Smoke, ms = 900): Promise<void> {
  await wait(ms);
  await Promise.race([smoke.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'), wait(500)]);
}

async function scenePreset(smoke: Smoke, preset: 'iso' | 'top' | 'front' | 'side'): Promise<void> {
  await smoke.click(`${tab} [data-testid=scene-preset-${preset}]`);
  await sceneSettled(smoke);
}

async function sceneMode(smoke: Smoke, mode: 'all' | 'isolate' | 'cutaway', levelId?: string): Promise<void> {
  if (levelId) {
    await smoke.fill(`${tab} [data-testid=scene-level]`, levelId);
    await smoke.until(async () => (await sceneAttr(smoke, 'level')) === levelId, 3000);
  }
  await smoke.click(`${tab} [data-testid=scene-mode-${mode}]`);
  await smoke.until(async () => (await sceneAttr(smoke, 'mode')) === mode, 3000);
  await sceneSettled(smoke);
}

/** Orbits the 3D view by dragging, and zooms with the wheel at its centre (negative: in). */
async function sceneOrbit(smoke: Smoke, dx: number, dy: number, zoomTicks = 0): Promise<void> {
  const r = (await smoke.rect(sceneCanvas))!;
  const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  if (dx || dy) await smoke.dragAt(c, { x: c.x + dx, y: c.y + dy }, { steps: 10 });
  for (let i = 0; i < Math.abs(zoomTicks); i++) await smoke.wheel(c.x, c.y, zoomTicks < 0 ? -100 : 100);
  await sceneSettled(smoke, 500);
}

async function setLanguage(smoke: Smoke, lang: Lang): Promise<void> {
  await smoke.run('config.update', { patch: { appearance: { language: lang } } });
  smoke.check(`the window speaks ${lang}`, await smoke.until(() => smoke.js<boolean>(`document.documentElement.lang === ${JSON.stringify(lang)}`), 5000));
  await wait(400);
}

/** Sets the Wall tool's thickness in its options bar (kept in the settings, as the lessons say). */
async function wallThickness(smoke: Smoke, mm: number): Promise<void> {
  await typeInto(smoke, `${tab} [data-testid=wall-thickness]`, String(mm));
  smoke.check(`the Wall tool draws ${mm} mm walls`, await smoke.until(() => smoke.host.config.get().editor.wallThickness === mm, 3000), smoke.host.config.get().editor.wallThickness);
  await focusCanvas(smoke);
}

// ---------- part 1: the practice project ----------

/** A small house of 7.5 × 4.5 m on two floors, with a bathroom at its east end and a stair along the back wall: lessons 1 to 8. */
async function practice(smoke: Smoke, shots: Shots, lang: Lang): Promise<string> {
  const text = TEXT[lang];
  smoke.section(`${lang}: lesson 1, a first project`);
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check('an empty library shows the first-launch guide', await smoke.waitFor('[data-testid=library-first-launch]', 5000));
  await shots.take('home-first', 'window', [{ n: 1, sel: '[data-testid=first-launch-new]' }]);
  await smoke.click('[data-testid=first-launch-new]');
  smoke.check('New project asks for a name', await smoke.waitFor('x-dialog-host form input'));
  await smoke.fill('x-dialog-host form input', text.studio);
  await wait(200);
  await shots.take('new-project', 'dialog');
  await smoke.click('x-dialog-host form button[type=submit]');
  smoke.check('the project opens in its tab', await smoke.until(() => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(text.studio)}`), 8000));
  const listed = await smoke.run<{ id: string; name: string }[]>('project.list');
  const project = new Project(smoke, listed.find((p) => p.name === text.studio)!.id);
  const ground = project.ground;
  await smoke.waitFor(canvas);
  await wait(600);
  await shots.take('tour', 'window', [
    { n: 1, sel: `${tab} [data-testid=project-name]` },
    { n: 2, sel: `${tab} [data-testid=level-row]` },
    { n: 3, sel: `${tab} [data-testid=tool-wall]` },
    { n: 4, sel: `${tab} [data-testid=center-tab-section]` },
    { n: 5, sel: `${tab} [data-testid=right-tab-catalog]` },
    { n: 6, sel: `${tab} [data-testid=plan-hint]` },
    { n: 7, sel: `${tab} [data-testid=project-undo]` },
    { n: 8, sel: '[data-testid=palette-button]' },
  ]);

  smoke.section(`${lang}: lesson 2, walls`);
  const house = [-900, -900, 8400, 5400] as const;
  await frame(smoke, house);
  await pick(smoke, 'W', 'wall');
  await wallThickness(smoke, 200);
  // The outline, stopping where the bathroom wall will meet it: 5500 + 2000 along the bottom, 4500 up, back along the top, and closed.
  await drawRun(
    smoke,
    project,
    ground,
    [0, 0],
    [
      [5500, 0, 'type'],
      [2000, 0, 'type'],
      [0, 4500, 'type'],
      [-2000, 0, 'type'],
      [-5500, 0, 'type'],
    ],
    true,
    async (i) => {
      if (i === 1) await shots.take('wall-typing', 'center');
    },
    12,
  );
  await project.normalise(ground);
  smoke.check('the outline is six walls', project.walls(ground).length === 6, project.walls(ground).length);
  await toSelect(smoke);
  await shots.take('walls-outline', 'center');
  await pick(smoke, 'W', 'wall');
  await wallThickness(smoke, 100);
  await drawRun(smoke, project, ground, [5500, 0], [[0, 4500, 'click']], false);
  smoke.check('the bathroom wall runs between the two marks, 100 mm thick', project.findWall(ground, [5500, 0], [5500, 4500])?.wall.thickness === 100);
  await wallThickness(smoke, 200);
  await toSelect(smoke);
  await clickWorld(smoke, [5500, 3300]);
  await rightTab(smoke, 'properties');
  smoke.check('a click on the wall shows its numbers', await smoke.waitFor(`${tab} [data-testid=prop-thickness]`, 4000));
  await shots.take('wall-properties', 'center+right');
  await toSelect(smoke);

  smoke.section(`${lang}: lesson 3, doors and windows`);
  await pick(smoke, 'D', 'door');
  await typeInto(smoke, `${tab} [data-testid=door-width]`, '900');
  await focusCanvas(smoke);
  await hover(smoke, [2500, 0]);
  await wait(250);
  await shots.take('door-tool', 'center');
  // The front door at a typed distance from the wall's start (its left end, where the run began).
  await typeAtCursor(smoke, '2500');
  smoke.check('a typed distance places the front door 2500 from the corner', await smoke.until(() => project.openings(ground).some((o) => o.kind === 'door' && Math.abs(o.along - 2500) < 1e-6), 4000), project.openings(ground));
  await toSelect(smoke);
  await project.opening(ground, [5500, 0], [5500, 4500], 2250, { kind: 'door', width: 800, side: 'right' });
  await project.opening(ground, [0, 0], [5500, 0], 1100, { kind: 'window' });
  await project.opening(ground, [0, 0], [5500, 0], 4300, { kind: 'window' });
  await project.opening(ground, [0, 4500], [0, 0], 2250, { kind: 'window' });
  await project.opening(ground, [7500, 0], [7500, 4500], 2250, { kind: 'window', width: 600, height: 600, sill: 1500 });
  await wait(300);
  await shots.take('openings', 'center');
  const frontDoor = project.openings(ground).find((o) => o.kind === 'door' && Math.abs(o.along - 2500) < 1)!;
  await clickWorld(smoke, [2500, 0]);
  smoke.check('a click on the door selects it before its wall', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === frontDoor.id, 3000), await canvasAttr(smoke, 'selection'));
  await wait(250);
  await shots.take('door-properties', 'center+right');
  await toSelect(smoke);

  smoke.section(`${lang}: lesson 4, rooms`);
  await pick(smoke, 'R', 'room');
  await hover(smoke, [1500, 2250]);
  await wait(300);
  await shots.take('room-tool', 'center');
  await clickWorld(smoke, [1500, 2250]);
  smoke.check('a click makes the space a room', await smoke.until(() => project.count(ground, 'room') === 1, 4000));
  await toSelect(smoke);
  const mainRoom = project.entities(ground).find((e) => e.type === 'room')!;
  await project.run('plan.entity.update', { id: mainRoom.id, set: { name: text.living } });
  const bath = await project.room(ground, [6500, 2250], text.bathroom);
  await project.run('plan.dimension.add', { levelId: ground, kind: 'horizontal', from: [0, 0], to: [5500, 0], offset: -900 });
  await project.run('plan.dimension.add', { levelId: ground, kind: 'horizontal', from: [5500, 0], to: [7500, 0], offset: -900 });
  await project.run('plan.dimension.add', { levelId: ground, kind: 'vertical', from: [7500, 0], to: [7500, 4500], offset: 900 });
  // A detected room is picked near its seed, where it was clicked.
  await clickWorld(smoke, [1350, 2050]);
  smoke.check('a click in the room selects it', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === mainRoom.id, 3000), await canvasAttr(smoke, 'selection'));
  await wait(300);
  await shots.take('rooms', 'center+right');
  await toSelect(smoke);

  smoke.section(`${lang}: lesson 5, zones`);
  // A room divider where no wall stands: the kitchen keeps the side next to the bathroom's pipes.
  await pick(smoke, 'S', 'separator');
  // Clicked on the walls themselves, as the lesson says, so the line leaves no gap at either end.
  await clickWorld(smoke, [2950, 0]);
  await hover(smoke, [2950, 4500]);
  await wait(250);
  await shots.take('divider-tool', 'center');
  await clickWorld(smoke, [2950, 4500]);
  await focusCanvas(smoke);
  await smoke.key('Return');
  smoke.check('two clicks and Enter make a room divider', await smoke.until(() => project.count(ground, 'separator') === 1, 4000));
  await toSelect(smoke);
  const divider = project.entities(ground).find((e) => e.type === 'separator') as Extract<Entity, { type: 'separator' }>;
  console.log(`the divider: ${divider.path.v.map((v) => v.p.join(',')).join(' > ')}`);
  smoke.check('the divider stands upright where it was clicked', Math.abs(divider.path.v[0].p[0] - divider.path.v[1].p[0]) < 0.01 && Math.abs(divider.path.v[0].p[0] - 2950) < 15, divider.path.v);
  const kitchen = await project.room(ground, [4200, 1800], text.kitchen);
  await wait(300);
  await shots.take('zones', 'center');
  const zoned = await project.run<{ name: string; enclosed: boolean; area: number }[]>('plan.rooms', { levelId: ground });
  console.log(`practice rooms: ${zoned.map((r) => `${r.name} ${(r.area / 1e6).toFixed(1)} m2${r.enclosed ? '' : ' (open)'}`).join(', ')}`);
  smoke.check('the divider leaves three enclosed rooms', zoned.length === 3 && zoned.every((r) => r.enclosed), zoned.map((r) => r.name));

  smoke.section(`${lang}: lesson 6, floors and stairs`);
  // The floor: a rectangle that makes a slab, from corner to corner of the outline.
  await pick(smoke, 'K', 'rectangle');
  await smoke.fill(`${tab} [data-testid=shape-kind]`, 'slab');
  await wait(200);
  await clickWorld(smoke, [0, 0]);
  await hover(smoke, [7500, 4500]);
  await shots.take('slab-tool', 'center');
  await clickWorld(smoke, [7500, 4500]);
  smoke.check('the rectangle makes the floor slab', await smoke.until(() => project.count(ground, 'slab') === 1, 4000));
  await smoke.fill(`${tab} [data-testid=shape-kind]`, 'shape');
  await toSelect(smoke);
  // The floor above: a copy of this one, renamed.
  await smoke.click(`${tab} [data-testid=level-duplicate]`);
  smoke.check('Duplicate level stacks a copy above', await smoke.until(() => Object.keys(project.doc().levels).length === 2, 5000));
  const upper = Object.keys(project.doc().levels).find((id) => id !== ground)!;
  await project.run('building.level.update', { levelId: upper, name: text.firstFloor });
  const groundName = project.doc().levels[ground].name;
  await wait(400);
  await shots.take('levels', 'left');
  // Upstairs is a bedroom: no front door (it becomes a window), no divider, one room.
  await showLevel(smoke, upper, text.firstFloor);
  const copyDoor = project.openings(upper).find((o) => o.kind === 'door' && Math.abs(o.along - 2500) < 1)!;
  await clickWorld(smoke, [2500, 0]);
  smoke.check('a click selects the copied front door upstairs', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === copyDoor.id, 3000), await canvasAttr(smoke, 'selection'));
  await smoke.fill(`${tab} [data-testid=prop-kind]`, 'window');
  smoke.check('Kind: Window turns the door into a window', await smoke.until(() => project.openings(upper).find((o) => o.id === copyDoor.id)?.kind === 'window', 3000));
  await project.run('plan.entity.update', { id: copyDoor.id, set: { sill: 900, height: 1200 } });
  await toSelect(smoke);
  const upstairs = project.entities(upper);
  await project.run('plan.entity.delete', { ids: upstairs.filter((e) => e.type === 'separator' || (e.type === 'room' && e.name === text.kitchen)).map((e) => e.id) });
  const upperLiving = upstairs.find((e) => e.type === 'room' && e.name === text.living);
  if (upperLiving) await project.run('plan.entity.update', { id: upperLiving.id, set: { name: text.bedroom } });
  // The stair, inside along the back wall: a click at its foot, then a length typed towards the far end.
  await showLevel(smoke, ground, groundName);
  await pick(smoke, 'S', 'stair', true);
  await smoke.fill(`${tab} [data-testid=stair-shape]`, 'straight');
  await typeInto(smoke, `${tab} [data-testid=stair-width]`, '1000');
  await focusCanvas(smoke);
  await clickWorld(smoke, [4750, 3900], ['alt']);
  await hover(smoke, [3000, 3900]);
  await wait(300);
  await smoke.key('3');
  await smoke.typeText('750');
  await shots.take('stair-tool', 'center');
  await smoke.key('Return');
  smoke.check('a click and a typed length make the stair', await smoke.until(() => Object.keys(project.doc().connectors).length === 1, 4000));
  await toSelect(smoke);
  const stair = Object.values(project.doc().connectors)[0] as { id: string; axis?: { v: { p: P }[] } };
  console.log(`the practice stair's walk line: ${stair.axis?.v.map((v) => v.p.join(',')).join(' > ')}`);
  smoke.check('the stair runs 3750 from where it was clicked, along the wall', Boolean(stair.axis && near(stair.axis.v[0].p, [4750, 3900], 15) && Math.abs(dist(stair.axis.v[0].p, stair.axis.v[1].p) - 3750) < 0.01 && Math.abs(stair.axis.v[0].p[1] - stair.axis.v[1].p[1]) < 0.01), stair.axis?.v);
  // Where the lesson says to nudge it into place with the arrow keys, the script sets it exactly.
  if (stair.axis && !near(stair.axis.v[0].p, [4750, 3900])) await project.run('plan.transform', { ids: [stair.id], translate: [4750 - stair.axis.v[0].p[0], 3900 - stair.axis.v[0].p[1]] });
  const built = await project.run<{ connectors: { derived: { risers?: number; riserHeight?: number; treadDepth?: number; broken?: unknown[] } }[] }>('building.get');
  console.log(`the practice stair: ${JSON.stringify(built.connectors[0]?.derived)}`);
  smoke.check('the practice stair breaks no rule', (built.connectors[0]?.derived.broken?.length ?? 1) === 0, built.connectors[0]?.derived);
  await wait(300);
  await shots.take('stair-plan', 'center');
  await centerTab(smoke, 'section');
  await shots.take('section', 'center');
  await centerTab(smoke, '3d');
  await sceneMode(smoke, 'all');
  await scenePreset(smoke, 'iso');
  await shots.take('view-3d', 'center');
  await sceneMode(smoke, 'cutaway', upper);
  await sceneOrbit(smoke, 0, 70, -1);
  await shots.take('view-3d-cut', 'center');
  await sceneMode(smoke, 'all', ground);
  await centerTab(smoke, 'plan');

  smoke.section(`${lang}: lesson 7, furniture`);
  await showLevel(smoke, ground, groundName);
  await frame(smoke, house);
  await rightTab(smoke, 'catalog');
  await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="builtin:sofa-2"] img[src^="data:image/png"]`, 8000);
  await smoke.click(`${tab} [data-testid=catalog-category][data-category=living]`);
  await wait(500);
  await smoke.click(`${tab} [data-testid=catalog-card][data-ref="builtin:sofa-2"]`);
  smoke.check('a click on a model arms the Furniture tool', await smoke.until(async () => (await tool(smoke)) === 'item', 4000));
  await wait(200);
  await hover(smoke, [550, 2250], ['alt']);
  await focusCanvas(smoke);
  for (let i = 0; i < 6; i++) await smoke.key('r');
  await hover(smoke, [550, 2250], ['alt']);
  await wait(250);
  await shots.take('catalog', 'center+right');
  await clickWorld(smoke, [550, 2250], ['alt']);
  smoke.check('a click places the sofa, turned a quarter with R', await smoke.until(() => project.entities(ground).some((e) => e.type === 'item' && e.rotation[2] === 90), 4000), project.entities(ground).filter((e) => e.type === 'item'));
  await toSelect(smoke);
  const sofa = project.entities(ground).find((e) => e.type === 'item')!;
  await project.run('plan.entity.update', { id: sofa.id, set: { at: [550, 2250, 0] } });
  await project.item(ground, 'coffee-table', [1700, 2250], 90);
  await project.item(ground, 'armchair', [1600, 800], 180);
  await project.item(ground, 'floor-lamp', [350, 3150], 0, { withLight: true });
  await project.item(ground, 'sink-unit', [3550, 400], 180);
  await project.item(ground, 'cooker', [4450, 400], 180);
  await project.item(ground, 'fridge', [5100, 450], 180);
  await project.item(ground, 'toilet', [7050, 3000], 270);
  await project.item(ground, 'washbasin', [7175, 1000], 270);
  await project.item(ground, 'shower', [6950, 3950], 0);
  await smoke.click(`${tab} [data-testid=catalog-category][data-category=living]`);
  await rightTab(smoke, 'properties');
  await clickWorld(smoke, [550, 2250]);
  await wait(300);
  await shots.take('furnished', 'center+right');
  await toSelect(smoke);

  smoke.section(`${lang}: lesson 8, materials and light`);
  await rightTab(smoke, 'catalog');
  await smoke.click(`${tab} [data-testid=catalog-tab-material]`);
  await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="builtin:oak-floor"] img[src^="data:image/png"]`, 8000);
  await smoke.click(`${tab} [data-testid=catalog-card][data-ref="builtin:oak-floor"]`);
  smoke.check('a click on a material arms the Paint tool', await smoke.until(async () => (await tool(smoke)) === 'paint', 4000), await tool(smoke));
  await wait(200);
  await hover(smoke, [2200, 1700]);
  await wait(250);
  await shots.take('materials', 'center+right');
  await clickWorld(smoke, [2200, 1700]);
  smoke.check('a click paints the floor of the room under it', await smoke.until(() => project.entities(ground).some((e) => e.type === 'room' && e.id === mainRoom.id && Boolean(e.finish?.floor)), 4000));
  await toSelect(smoke);
  await smoke.click(`${tab} [data-testid=catalog-tab-item]`);
  await rightTab(smoke, 'properties');
  await project.finish(kitchen, 'floor', 'tile-grey-large');
  await project.finish(bath, 'floor', 'tile-white');
  await project.finish(bath, 'walls', 'tile-subway');
  await project.finish(mainRoom.id, 'walls', 'paint-warm-grey');
  await project.finish(kitchen, 'walls', 'paint-sage');
  await project.light(ground, [1500, 1700]);
  await project.light(ground, [4200, 1700], 1000);
  await project.light(ground, [6500, 2250], 800);
  await centerTab(smoke, '3d');
  await sceneMode(smoke, 'cutaway', ground);
  await scenePreset(smoke, 'iso');
  await sceneOrbit(smoke, 0, 60, -2);
  await shots.take('finishes-3d', 'center');
  await smoke.click(`${tab} [data-testid=scene-lighting-night]`);
  await smoke.until(async () => (await sceneAttr(smoke, 'lighting')) === 'night', 3000);
  await sceneSettled(smoke, 1200);
  await shots.take('night-3d', 'center');
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  await sceneMode(smoke, 'all');
  await centerTab(smoke, 'plan');
  await toSelect(smoke);
  const warnings = await project.run<{ count: number; warnings: { message: string }[] }>('rules.check');
  smoke.check('the practice house has no warnings', warnings.count === 0, warnings.warnings.map((w) => w.message));
  return project.id;
}

// ---------- part 2: the building ----------

/** Two floors of two mirrored apartments round a stair hall, 21 × 10 m: lessons 9 to 17. */
async function building(smoke: Smoke, shots: Shots, lang: Lang, tmp: string): Promise<string> {
  const text = TEXT[lang];
  smoke.section(`${lang}: lesson 9, the outline`);
  const created = await smoke.run<{ id: string }>('project.create', { name: text.building });
  const project = new Project(smoke, created.id);
  const ground = project.ground;
  smoke.check('the building project opens in its tab', await openProjectTab(smoke, project.id));
  await centerTab(smoke, 'plan');
  await rightTab(smoke, 'properties');
  const whole = [-700, -700, 21700, 10700] as const;
  const flatA = [-700, -700, 9700, 10700] as const;
  await frame(smoke, whole);
  await pick(smoke, 'W', 'wall');
  await wallThickness(smoke, 200);
  // Once round the outside, stopping wherever an inner wall of the first apartment and the stair hall will meet it.
  await drawRun(
    smoke,
    project,
    ground,
    [0, 0],
    [
      [3800, 0, 'type'],
      [5200, 0, 'type'],
      [3000, 0, 'type'],
      [9000, 0, 'type'],
      [0, 10000, 'type'],
      [-9000, 0, 'type'],
      [-3000, 0, 'type'],
      [-3300, 0, 'type'],
      [-1900, 0, 'type'],
      [-3800, 0, 'type'],
      [0, -4500, 'type'],
    ],
    true,
    async (i) => {
      if (i === 4) await shots.take('b-outline-typing', 'center');
    },
    40,
  );
  await project.normalise(ground);
  smoke.check('the outline is twelve walls', project.walls(ground).length === 12, project.walls(ground).length);
  await toSelect(smoke);
  await shots.take('b-outline', 'center');

  smoke.section(`${lang}: lesson 10, the inner walls`);
  await pick(smoke, 'W', 'wall');
  // The stair hall's wall on this side, in two pieces that meet where the apartment's cross wall will arrive.
  await drawRun(
    smoke,
    project,
    ground,
    [9000, 0],
    [
      [0, 5500, 'type'],
      [0, 4500, 'click'],
    ],
    false,
  );
  await wallThickness(smoke, 100);
  await drawRun(
    smoke,
    project,
    ground,
    [3800, 0],
    [
      [0, 5500, 'type'],
      [0, 1500, 'type'],
      [0, 3000, 'click'],
    ],
    false,
  );
  await drawRun(
    smoke,
    project,
    ground,
    [0, 5500],
    [
      [3800, 0, 'click'],
      [1900, 0, 'type'],
      [3300, 0, 'click'],
    ],
    false,
  );
  await drawRun(
    smoke,
    project,
    ground,
    [5700, 5500],
    [
      [0, 1500, 'type'],
      [0, 3000, 'click'],
    ],
    false,
  );
  await drawRun(smoke, project, ground, [3800, 7000], [[1900, 0, 'click']], false);
  await wallThickness(smoke, 200);
  await toSelect(smoke);
  smoke.check('the first apartment has its eleven inner walls', project.walls(ground).length === 12 + 2 + 9, project.walls(ground).length);
  smoke.check('the inner walls are 100 mm thick', project.walls(ground).filter((w) => w.thickness === 100).length === 9);
  await frame(smoke, flatA);
  await shots.take('b-inner', 'center');

  smoke.section(`${lang}: lesson 11, doors and windows`);
  await pick(smoke, 'D', 'door');
  await typeInto(smoke, `${tab} [data-testid=door-width]`, '1000');
  await focusCanvas(smoke);
  await hover(smoke, [9000, 4700]);
  await wait(250);
  await shots.take('b-door-tool', 'center');
  await typeAtCursor(smoke, '4700');
  smoke.check("the apartment's entrance is 4700 along the stair hall wall", await smoke.until(() => project.openings(ground).some((o) => o.kind === 'door' && o.width === 1000 && Math.abs(o.along - 4700) < 1e-6), 4000), project.openings(ground));
  await typeInto(smoke, `${tab} [data-testid=door-width]`, '900');
  await toSelect(smoke);
  // The entrance swings into the apartment, hinged at its far end (the keys F and H while placing).
  const entrance = project.openings(ground).find((o) => o.kind === 'door' && o.width === 1000)!;
  await project.run('plan.entity.update', { id: entrance.id, set: { swing: { hinge: 'end', side: 'left' } } });
  await project.opening(ground, [9000, 0], [12000, 0], 1500, { kind: 'door', width: 1200, side: 'left' });
  await project.opening(ground, [3800, 0], [3800, 5500], 2750, { kind: 'door', side: 'left' });
  await project.opening(ground, [3800, 5500], [5700, 5500], 950, { kind: 'door', side: 'right' });
  await project.opening(ground, [3800, 5500], [3800, 7000], 750, { kind: 'door', side: 'left' });
  await project.opening(ground, [5700, 5500], [5700, 7000], 750, { kind: 'door', side: 'right' });
  await project.opening(ground, [3800, 7000], [5700, 7000], 950, { kind: 'door', width: 800, side: 'left' });
  await project.opening(ground, [0, 0], [3800, 0], 1900, { kind: 'window' });
  await project.opening(ground, [3800, 0], [9000, 0], 2600, { kind: 'window', width: 2000 });
  await project.opening(ground, [0, 10000], [0, 5500], 2250, { kind: 'window' });
  await project.opening(ground, [0, 5500], [0, 0], 2750, { kind: 'window' });
  await project.opening(ground, [9000, 10000], [5700, 10000], 1650, { kind: 'window' });
  await project.opening(ground, [5700, 10000], [3800, 10000], 950, { kind: 'window', width: 600, height: 600, sill: 1500 });
  await project.opening(ground, [12000, 10000], [9000, 10000], 1500, { kind: 'window' });
  await wait(300);
  await shots.take('b-openings', 'center');

  smoke.section(`${lang}: lesson 12, rooms`);
  const kitchen = await project.room(ground, [1900, 2750], text.kitchen);
  const living = await project.room(ground, [6400, 2750], text.livingRoom);
  const bed1 = await project.room(ground, [1900, 7750], text.bedroom1);
  const hall = await project.room(ground, [4750, 6250], text.hall);
  const bath = await project.room(ground, [4750, 8500], text.bathroom);
  const bed2 = await project.room(ground, [7350, 7750], text.bedroom2);
  await wait(300);
  await clickWorld(smoke, [6250, 2550]);
  smoke.check('a click in the living room selects it', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === living, 3000), await canvasAttr(smoke, 'selection'));
  await wait(300);
  await shots.take('b-rooms', 'center+right');
  await toSelect(smoke);
  const rooms = await project.run<{ name: string; enclosed: boolean; area: number }[]>('plan.rooms', { levelId: ground });
  console.log(`rooms: ${rooms.map((r) => `${r.name} ${(r.area / 1e6).toFixed(1)} m2${r.enclosed ? '' : ' (open)'}`).join(', ')}`);
  smoke.check('the six rooms are enclosed', rooms.length === 6 && rooms.every((r) => r.enclosed), rooms.map((r) => r.name));

  smoke.section(`${lang}: lesson 13, furniture, finishes and light`);
  // Living room
  await project.item(ground, 'tv-unit', [8650, 2200], 270);
  await project.item(ground, 'sofa-3', [5600, 2200], 90);
  await project.item(ground, 'coffee-table', [7000, 2200], 90);
  await project.item(ground, 'armchair', [6900, 3900], 0);
  await project.item(ground, 'floor-lamp', [5500, 3700], 0, { withLight: true });
  await project.item(ground, 'planter', [8500, 500]);
  // Kitchen
  await project.item(ground, 'counter-run', [400, 1500], 90);
  await project.item(ground, 'sink-unit', [400, 3300], 90);
  await project.item(ground, 'cooker', [400, 4200], 90);
  await project.item(ground, 'fridge', [450, 4950], 90);
  await project.item(ground, 'dining-table-4', [2100, 1900]);
  for (const [x, y, r] of [
    [1800, 1300, 180],
    [2400, 1300, 180],
    [1800, 2500, 0],
    [2400, 2500, 0],
  ] as const)
    await project.item(ground, 'dining-chair', [x, y], r);
  await project.item(ground, 'pendant', [2100, 1900], 0, { withLight: true });
  // Bedrooms
  await project.item(ground, 'bed-double', [1900, 8850]);
  await project.item(ground, 'nightstand', [800, 9700]);
  await project.item(ground, 'nightstand', [3000, 9700]);
  await project.item(ground, 'wardrobe', [1200, 5850], 180);
  await project.item(ground, 'bed-single', [6500, 8850]);
  await project.item(ground, 'bed-single', [8200, 8850]);
  await project.item(ground, 'nightstand', [7350, 9700]);
  await project.item(ground, 'desk', [7900, 5900], 180);
  await project.item(ground, 'office-chair', [7900, 6600], 0);
  await project.item(ground, 'wardrobe', [8600, 7150], 270);
  // Bathroom
  await project.item(ground, 'bathtub', [4750, 9525]);
  await project.item(ground, 'toilet', [4200, 8300], 90);
  await project.item(ground, 'washbasin', [5425, 8200], 270);
  for (const room of [living, bed1, bed2, hall]) await project.finish(room, 'floor', 'oak-floor');
  await project.finish(kitchen, 'floor', 'tile-grey-large');
  await project.finish(bath, 'floor', 'tile-white');
  await project.finish(bath, 'walls', 'tile-subway');
  await project.finish(living, 'walls', 'paint-warm-grey');
  await project.finish(bed1, 'walls', 'paint-sage');
  await project.light(ground, [6400, 2800]);
  await project.light(ground, [1900, 7400], 1000);
  await project.light(ground, [7350, 7400], 1000);
  await project.light(ground, [4750, 8300], 800);
  await project.light(ground, [4750, 6250], 600);
  await wait(400);
  await shots.take('b-furnished', 'center');

  smoke.section(`${lang}: lesson 14, the mirror`);
  await frame(smoke, whole);
  await toSelect(smoke);
  const before = { walls: project.walls(ground).length, rooms: project.count(ground, 'room'), items: project.count(ground, 'item'), lights: project.count(ground, 'light'), openings: project.openings(ground).length };
  // A crossing box (dragged right to left) from the empty stair hall across the apartment: it takes what it touches, and the outer walls stay out.
  {
    const v = await view(smoke);
    const from = v.at([9600, 9600]);
    const to = v.at([400, 400]);
    await smoke.mouseMove(from.x, from.y);
    await smoke.mouseDown(from.x, from.y);
    for (let i = 1; i <= 10; i++) await smoke.mouseMove(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10, ['leftbuttondown']);
    await wait(200);
    await shots.take('b-select', 'center');
    await smoke.mouseUp(to.x, to.y);
    await wait(250);
  }
  // 9 inner walls and the stair hall's 2, their 6 doors, the 6 rooms, the furniture and the lights; the box also reaches the apartment's 6 windows,
  // which stay where they are (a window is only copied with its wall): the footer counts them all.
  const expected = 11 + 6 + 6 + before.rooms + before.items + before.lights;
  const selected = Number(/\d+/.exec((await smoke.text(`${tab} [data-testid=plan-selection]`)) ?? '')?.[0] ?? 0);
  smoke.check('the crossing box takes the apartment and none of the outer walls', selected === expected, { selected, expected });
  await focusCanvas(smoke);
  await smoke.key('M', ['shift']);
  await wait(150);
  // The axis: the middle of the stair hall's top wall, then straight down (Ctrl keeps the original).
  await clickWorld(smoke, [10500, 10000]);
  await hover(smoke, [10500, 300]);
  await wait(300);
  await shots.take('b-mirror', 'center');
  await clickWorld(smoke, [10500, 0], ['control']);
  smoke.check(
    'Ctrl on the second click keeps the apartment and adds its mirror image',
    await smoke.until(() => project.walls(ground).length === before.walls + 11 && project.count(ground, 'room') === before.rooms * 2 && project.count(ground, 'item') === before.items * 2, 6000),
    { walls: project.walls(ground).length, rooms: project.count(ground, 'room'), items: project.count(ground, 'item'), before },
  );
  await toSelect(smoke);
  for (const [a, b] of [
    [
      [12000, 0],
      [12000, 5500],
    ],
    [
      [17200, 0],
      [17200, 5500],
    ],
    [
      [21000, 5500],
      [17200, 5500],
    ],
    [
      [15300, 5500],
      [15300, 7000],
    ],
    [
      [17200, 7000],
      [15300, 7000],
    ],
  ] as const)
    smoke.check(`the mirror has a wall from ${a.join(',')} to ${b.join(',')}`, Boolean(project.findWall(ground, a, b)));
  smoke.check('the doors came with their walls, the entrance too', project.openings(ground).length === before.openings + 6, { openings: project.openings(ground).length, before: before.openings });
  smoke.check('and the lights', project.count(ground, 'light') === before.lights * 2, project.count(ground, 'light'));
  // The second apartment's windows sit in the long outer walls: placed by hand, as the first one's were.
  await project.opening(ground, [12000, 0], [21000, 0], 2600, { kind: 'window', width: 2000 });
  await project.opening(ground, [12000, 0], [21000, 0], 7100, { kind: 'window' });
  await project.opening(ground, [21000, 0], [21000, 10000], 2750, { kind: 'window' });
  await project.opening(ground, [21000, 0], [21000, 10000], 7750, { kind: 'window' });
  await project.opening(ground, [21000, 10000], [12000, 10000], 4750, { kind: 'window', width: 600, height: 600, sill: 1500 });
  await project.opening(ground, [21000, 10000], [12000, 10000], 7350, { kind: 'window' });
  const entranceHall = await project.room(ground, [10500, 2500], text.entrance);
  await project.finish(entranceHall, 'floor', 'polished-concrete');
  await project.light(ground, [10500, 2500], 1000);
  const mirrored = await project.run<{ name: string; enclosed: boolean }[]>('plan.rooms', { levelId: ground });
  smoke.check('all thirteen rooms are enclosed', mirrored.length === 13 && mirrored.every((r) => r.enclosed), mirrored.filter((r) => !r.enclosed).map((r) => r.name));
  await wait(400);
  await shots.take('b-mirrored', 'center');

  smoke.section(`${lang}: lesson 15, the first floor and the stair`);
  await rightTab(smoke, 'details');
  await project.run('project.snapshot.create', { name: text.snapshot });
  await wait(400);
  await shots.take('b-snapshots', 'right');
  await rightTab(smoke, 'properties');
  await pick(smoke, 'K', 'rectangle');
  await smoke.fill(`${tab} [data-testid=shape-kind]`, 'slab');
  await wait(200);
  await clickWorld(smoke, [0, 0]);
  await clickWorld(smoke, [21000, 10000]);
  smoke.check('the floor slab covers the building', await smoke.until(() => project.count(ground, 'slab') === 1, 4000));
  await smoke.fill(`${tab} [data-testid=shape-kind]`, 'shape');
  await toSelect(smoke);
  await smoke.click(`${tab} [data-testid=level-duplicate]`);
  smoke.check('Duplicate level makes the first floor', await smoke.until(() => Object.keys(project.doc().levels).length === 2, 8000));
  const upper = Object.keys(project.doc().levels).find((id) => id !== ground)!;
  await project.run('building.level.update', { levelId: upper, name: text.firstFloor });
  const groundName = project.doc().levels[ground].name;
  smoke.check('the copy holds everything the ground floor does', project.entities(upper).length === project.entities(ground).length, { upper: project.entities(upper).length, ground: project.entities(ground).length });
  // Upstairs nobody walks in from the street: the building's entrance becomes a window, and the hall a landing.
  await showLevel(smoke, upper, text.firstFloor);
  const streetDoor = project.openings(upper).find((o) => o.kind === 'door' && o.width === 1200)!;
  await clickWorld(smoke, [10500, 0]);
  smoke.check('a click selects the copied entrance door upstairs', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === streetDoor.id, 3000), await canvasAttr(smoke, 'selection'));
  await smoke.fill(`${tab} [data-testid=prop-kind]`, 'window');
  smoke.check('Kind: Window turns the door into a window', await smoke.until(() => project.openings(upper).find((o) => o.id === streetDoor.id)?.kind === 'window', 3000));
  await project.run('plan.entity.update', { id: streetDoor.id, set: { sill: 900, height: 1200 } });
  await wait(300);
  await shots.take('b-window-props', 'center+right');
  await toSelect(smoke);
  const upperHall = project.entities(upper).find((e) => e.type === 'room' && e.name === text.entrance);
  if (upperHall) await project.run('plan.entity.update', { id: upperHall.id, set: { name: text.landing } });
  await showLevel(smoke, ground, groundName);
  await frame(smoke, [8200, -700, 12800, 10700]);
  await pick(smoke, 'S', 'stair', true);
  await smoke.fill(`${tab} [data-testid=stair-shape]`, 'u');
  await typeInto(smoke, `${tab} [data-testid=stair-width]`, '1200');
  await smoke.fill(`${tab} [data-testid=stair-turn]`, 'right');
  await focusCanvas(smoke);
  await wait(200);
  await clickWorld(smoke, [9900, 6950]);
  await hover(smoke, [9900, 8400]);
  await wait(300);
  await shots.take('b-stair-tool', 'center');
  await clickWorld(smoke, [9900, 8400]);
  smoke.check('two clicks make the U stair', await smoke.until(() => Object.keys(project.doc().connectors).length === 1, 4000));
  await toSelect(smoke);
  const stair = Object.values(project.doc().connectors)[0] as { id: string; axis?: { v: { p: P }[] } };
  console.log(`the stair's walk line: ${stair.axis?.v.map((v) => v.p.join(',')).join(' > ')}`);
  smoke.check('the stair starts where it was clicked (on the 100 mm grid)', Boolean(stair.axis && near(stair.axis.v[0].p, [9900, 6950], 60)), stair.axis?.v[0]);
  // Where the lesson says to nudge it into place with the arrow keys, the script sets it exactly.
  if (stair.axis && !near(stair.axis.v[0].p, [9900, 6950])) await project.run('plan.transform', { ids: [stair.id], translate: [9900 - stair.axis.v[0].p[0], 6950 - stair.axis.v[0].p[1]] });
  const got = await project.run<{ connectors: { derived: { risers?: number; riserHeight?: number; treadDepth?: number; flights?: unknown; broken?: unknown[]; cuts?: string[] } }[] }>('building.get');
  console.log(`the stair: ${JSON.stringify(got.connectors[0]?.derived)}`);
  smoke.check('the stair breaks no rule and cuts the first floor', (got.connectors[0]?.derived.broken?.length ?? 1) === 0 && got.connectors[0]?.derived.cuts?.join() === upper, got.connectors[0]?.derived);
  await shots.take('b-stair-plan', 'center');
  await frame(smoke, whole);
  await showLevel(smoke, upper, text.firstFloor);
  await shots.take('b-first-plan', 'center');
  await centerTab(smoke, 'section');
  await shots.take('b-section', 'center');

  smoke.section(`${lang}: lesson 16, the review in 3D`);
  await rightTab(smoke, 'warnings');
  await wait(600);
  const warnings = await project.run<{ warnings: unknown[] }>('rules.check').catch(() => ({ warnings: [] as unknown[] }));
  console.log(`warnings: ${JSON.stringify(warnings).slice(0, 600)}`);
  await centerTab(smoke, 'plan');
  await shots.take('b-warnings', 'center+right');
  await rightTab(smoke, 'properties');
  // The façade: white brick on the outside face of every outer wall (the outline was drawn anticlockwise, so outside is its right).
  for (const levelId of [ground, upper]) {
    const steps = project
      .walls(levelId)
      .filter((w) => w.path.v.every((v) => v.p[1] === 0) || w.path.v.every((v) => v.p[1] === 10000) || w.path.v.every((v) => v.p[0] === 0) || w.path.v.every((v) => v.p[0] === 21000))
      .map((w) => ({ command: 'decor.material.set', input: { target: { wallId: w.id, side: 'right' }, material: 'builtin:brick-white' } }));
    await project.run('plan.apply', { label: 'Facade', steps });
  }
  await centerTab(smoke, '3d');
  await sceneMode(smoke, 'all');
  await scenePreset(smoke, 'iso');
  await shots.take('b-3d', 'center');
  await smoke.fill(`${tab} [data-testid=scene-explode]`, '70');
  await sceneSettled(smoke, 1200);
  await smoke.click(`${tab} [data-testid=scene-fit]`);
  await sceneSettled(smoke);
  await shots.take('b-explode', 'center');
  await smoke.fill(`${tab} [data-testid=scene-explode]`, '0');
  await sceneMode(smoke, 'cutaway', ground);
  await smoke.click(`${tab} [data-testid=scene-fit]`);
  await sceneSettled(smoke);
  await sceneOrbit(smoke, 0, 90, -1);
  await shots.take('b-cutaway', 'center');
  await smoke.click(`${tab} [data-testid=scene-lighting-night]`);
  await smoke.until(async () => (await sceneAttr(smoke, 'lighting')) === 'night', 3000);
  await sceneSettled(smoke, 1400);
  await shots.take('b-night', 'center');
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  await sceneSettled(smoke);
  // A walk: a double click on the living room floor, then a look round.
  {
    const s = await sceneView(smoke);
    const at = s.at([7600, 1200, 5]);
    await smoke.clickAt(at.x, at.y, { clickCount: 2 });
    const walking = await smoke.until(async () => ((await sceneAttr(smoke, 'walk')) ?? '') !== '', 5000);
    smoke.check('a double click on the floor starts the walk', walking, await sceneAttr(smoke, 'walk'));
    if (walking) {
      await sceneSettled(smoke, 900);
      const r = (await smoke.rect(sceneCanvas))!;
      const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const facing = Number(((await sceneAttr(smoke, 'walk')) ?? '').split(',')[3] ?? 0);
      // Turn to look north-west across the room, towards the sofa and the hall door (0.25° a pixel).
      const turn = ((135 - facing + 540) % 360) - 180;
      await smoke.dragAt(c, { x: c.x - turn * 4, y: c.y }, { steps: 12 });
      await sceneSettled(smoke, 900);
      console.log(`walking: ${await sceneAttr(smoke, 'walk')}`);
      await shots.take('b-walk', 'center');
      await smoke.js(`document.querySelector('${sceneCanvas}')?.focus()`);
      await smoke.key('Escape');
      await smoke.until(async () => ((await sceneAttr(smoke, 'walk')) ?? '') === '', 3000);
    }
  }
  await sceneMode(smoke, 'all');
  await centerTab(smoke, 'plan');

  smoke.section(`${lang}: lesson 17, dimensions and export`);
  await showLevel(smoke, ground, groundName);
  await frame(smoke, [-2600, -2600, 23600, 11500]);
  for (const [a, b] of [
    [0, 3800],
    [3800, 9000],
    [9000, 12000],
    [12000, 21000],
  ] as const)
    await project.run('plan.dimension.add', { levelId: ground, kind: 'horizontal', from: [a, 0], to: [b, 0], offset: -1000 });
  await project.run('plan.dimension.add', { levelId: ground, kind: 'horizontal', from: [0, 0], to: [21000, 0], offset: -1900 });
  await project.run('plan.dimension.add', { levelId: ground, kind: 'vertical', from: [0, 0], to: [0, 5500], offset: -1000 });
  await project.run('plan.dimension.add', { levelId: ground, kind: 'vertical', from: [0, 5500], to: [0, 10000], offset: -1000 });
  await project.run('plan.dimension.add', { levelId: ground, kind: 'vertical', from: [0, 0], to: [0, 10000], offset: -1900 });
  await wait(400);
  await shots.take('b-dimensions', 'center');
  await smoke.click(`${tab} [data-testid=exchange-export]`);
  smoke.check('Export… opens its dialog', await smoke.waitFor('x-dialog-host [role=dialog]', 5000));
  await wait(500);
  await shots.take('b-export', 'window');
  await smoke.key('Escape');
  await smoke.gone('x-dialog-host [role=dialog]', 3000);
  const planPng = path.join(tmp, `plan-${lang}.png`);
  await project.run('export.image', { path: planPng, levelId: ground, view: 'plan', width: 2000, height: 1200 });
  await shots.keep('b-plan-export', planPng);
  const render = path.join(tmp, `render-${lang}.png`);
  await project.run('export.image', { path: render, view: '3d', width: 2000, height: 1200, azimuth: 235, elevation: 24 });
  await shots.keep('b-render', render, [0.17, 0.2]);
  const cut = path.join(tmp, `cut-${lang}.png`);
  await project.run('export.image', { path: cut, view: '3d', levelId: ground, display: 'cutaway', width: 2000, height: 1200, azimuth: 250, elevation: 52 });
  await shots.keep('b-render-cutaway', cut, [0.17, 0.2]);
  const night = path.join(tmp, `night-${lang}.png`);
  await project.run('export.image', { path: night, view: '3d', levelId: upper, display: 'cutaway', lighting: 'night', width: 2000, height: 1200, azimuth: 250, elevation: 52 });
  await shots.keep('b-render-night', night, [0.17, 0.2]);
  await toSelect(smoke);
  return project.id;
}

export async function runCourseShots(host: Host, openWindow: () => BrowserWindow, dir: string): Promise<number> {
  const smoke = new Smoke(host, undefined);
  const shots = new Shots(smoke, dir);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'course-shots-'));
  const started = Date.now();
  const only = process.env.COURSE_LANGS?.split(',').filter((l): l is Lang => l === 'en' || l === 'ar');
  try {
    await smoke.run('config.update', { patch: { mcp: { port: await freePort() } } });
    await smoke.run('config.update', { patch: { appearance: { theme: 'light' } } }).catch(() => undefined);
    const win = await smoke.openWindow(openWindow);
    const [width, height] = win.getContentSize();
    if (width < 1400 || height < 760) throw new Error(`the window is ${width} x ${height}: the course pictures need the 1440 x 900 window, so a 1920 x 1080 screen`);
    await smoke.waitFor('[data-testid=app-ready]', 15_000);
    await smoke.setDark(false);
    for (const lang of only?.length ? only : (['en', 'ar'] as const)) {
      shots.lang = lang;
      await setLanguage(smoke, lang);
      const ids = [await practice(smoke, shots, lang)];
      if (process.env.COURSE_PART !== '1') ids.push(await building(smoke, shots, lang, tmp));
      await smoke.click('[data-testid=tab][data-type="shell.home"]');
      await smoke.waitFor('[data-testid=project-card] img', 8000);
      await wait(2200);
      await shots.take('home-projects', 'window');
      // The next language starts from an empty library, as a learner does.
      for (const id of ids) {
        await smoke.run('project.close', { id }).catch(() => undefined);
        await smoke.run('project.trash', { id });
      }
      await wait(500);
    }
    await shots.writeIndex();
    smoke.check('the renderer has no console errors', smoke.consoleErrors.length === 0, smoke.consoleErrors);
  } catch (err) {
    smoke.check(`unexpected error: ${(err as Error).stack ?? String(err)}`, false);
    await shots.writeIndex().catch(() => undefined);
  } finally {
    smoke.closeWindow();
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = smoke.failures.length ? `COURSE SHOTS FAILED (${smoke.failures.length} of ${smoke.passes + smoke.failures.length}): ${smoke.failures.join(' | ')}` : `COURSE SHOTS DONE (${smoke.passes} checks, ${seconds}s)`;
  writeSync(1, `\n${summary}\nPictures: ${dir}\n`);
  return smoke.failures.length ? 1 : 0;
}
