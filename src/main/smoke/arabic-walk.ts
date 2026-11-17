import type { Entity, ProjectSummary } from '@studio/core';
import { auditArabic, lookArabic } from './arabic-audit';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, tab, view } from './plan-canvas';

/*
 * The Arabic walk (milestone 12, step 8): every tab, panel, dialog, menu and state the app has, opened in
 * Arabic, each audited (`auditArabic`: no English left, nothing reversed) and photographed light and dark,
 * numbered from 114. It runs inside the Arabic section, on its project, and leaves the app as it found it:
 * the Select tool on, no dialog or menu open, the updater reset, Home's search empty.
 */

/** Clicks away the toasts (their close buttons are named in the interface's language). */
const dismissToasts = (smoke: Smoke) => smoke.js(`[...document.querySelectorAll('x-toast-host button[aria-label]')].forEach((b) => b.click())`);

/** Closes the open dialog with its Cancel (إلغاء) and waits for it to go. */
async function cancelDialog(smoke: Smoke): Promise<boolean> {
  if (!(await smoke.waitFor('x-dialog-host button', 3000, 'إلغاء'))) return false;
  await smoke.click('x-dialog-host button', 'إلغاء');
  return smoke.until(async () => (await smoke.count('x-dialog-host form, x-dialog-host [role=dialog], [data-testid=component-dialog], [data-testid=form-dialog]')) === 0, 3000);
}

/** Whether the open context menu lies wholly inside the window. */
const menuOnScreen = (smoke: Smoke) =>
  smoke.js<boolean>(`(() => { const r = document.querySelector('[data-testid=context-menu]')?.getBoundingClientRect(); return !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);

async function closeMenu(smoke: Smoke): Promise<void> {
  await smoke.key('Escape');
  await smoke.gone('[data-testid=context-menu]', 2000);
}

/** Leaves the plan's Select tool on, and checks it: each part of the walk ends this way so the next one starts clean. */
export async function selectTool(smoke: Smoke, where: string): Promise<void> {
  if ((await smoke.count(canvas)) === 0) return;
  await smoke.js(`document.querySelector('${canvas}')?.focus()`);
  if ((await canvasAttr(smoke, 'tool')) !== 'select') {
    await smoke.key('Escape');
    await smoke.key('Escape');
  }
  smoke.check(`${where} leaves the Select tool on`, await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select', 3000), await canvasAttr(smoke, 'tool'));
}

/**
 * The shell and Settings in Arabic: every Settings section, the Licences dialog, and Settings > Updates in
 * each state the scripted updater can be in, with the notices it raises.
 */
export async function smokeArabicShellWalk(smoke: Smoke): Promise<void> {
  smoke.section('arabic walk: Settings');
  await smoke.click('[data-testid=tab][data-type="settings.main"]');
  await smoke.waitFor('[data-section=about]');
  await auditArabic(smoke, 'every Settings section');
  const sections = await smoke.js<string[]>(`[...document.querySelectorAll('[data-testid=settings] [data-section]')].map((s) => s.dataset.section)`);
  smoke.check('Settings has its sections', sections.length >= 7, sections);
  const show = (id: string) => smoke.js(`document.querySelector('[data-section=${id}]')?.scrollIntoView({ block: 'start' })`);
  // The AI section (Otto) has not been photographed before.
  const ai = sections.find((s) => s === 'ai' || s === 'assistant');
  if (ai) {
    await show(ai);
    await lookArabic(smoke, '114-settings-otto-arabic', 'Settings > Otto');
  }

  await smoke.js(`document.querySelector('[data-section=about]').scrollIntoView({ block: 'end' })`);
  smoke.check("About's model line keeps the model and the provider each whole", (await smoke.waitFor('[data-testid=about-provider]', 3000)) && (await smoke.js<string>(`getComputedStyle(document.querySelector('[data-testid=about-provider]')).direction`)) === 'rtl');
  smoke.check("About's words are not set in the mono face, its version is", await smoke.js<boolean>(`(() => { const p = document.querySelector('[data-testid=about-version]'); const v = p.querySelector('.bidi-ltr'); return !getComputedStyle(p).fontFamily.startsWith('"IBM Plex Mono"') && getComputedStyle(v).fontFamily.includes('IBM Plex Mono'); })()`));
  await smoke.click('[data-testid=about-licences]');
  smoke.check('the Licences dialog opens', await smoke.waitFor('[data-testid=licence-text]', 3000));
  await lookArabic(smoke, '115-licences-arabic', 'the Licences dialog');
  await smoke.click('[data-testid=licences-close]');
  smoke.check('and closes', await smoke.gone('[data-testid=licence-text]'));

  smoke.section('arabic walk: update notices');
  const u = smoke.updates;
  const status = '[data-testid=updates-status]';
  u.reset();
  try {
    await dismissToasts(smoke);
    u.script({ outcome: 'available', version: '1.2.3', notes: 'Faster exports.', hold: 'check' });
    await smoke.click('[data-testid=updates-check]');
    smoke.check('Checking… in Arabic', await smoke.waitFor(`${status}[data-state=checking]`, 3000), await smoke.text(status));
    await show('updates');
    await lookArabic(smoke, '116-updates-checking-arabic', 'Updates: checking');
    u.release();
    smoke.check('a version is available, said in Arabic with the version an island', await smoke.waitFor(`${status}[data-state=available]`, 3000, '1.2.3'), await smoke.text(status));
    await show('updates');
    await lookArabic(smoke, '117-updates-available-arabic', 'Updates: available');
    u.script({ outcome: 'available', version: '1.2.3', progress: [0, 42, 100], hold: 'download', holdAt: 42 });
    await smoke.click('[data-testid=updates-download]');
    smoke.check('downloading, with its percentage', await smoke.waitFor(status, 3000, '42'), await smoke.text(status));
    await show('updates');
    await lookArabic(smoke, '118-updates-downloading-arabic', 'Updates: downloading');
    u.release();
    smoke.check('ready to install, with a toast offering Restart and install', (await smoke.waitFor(`${status}[data-state=ready]`, 3000)) && (await smoke.waitFor('[data-testid=toast-action]', 3000)), await smoke.text(status));
    await show('updates');
    await lookArabic(smoke, '119-updates-ready-arabic', 'Updates: ready, and its toast');
    await dismissToasts(smoke);
    // A ready download is kept; back to a build that has not checked, for the next states.
    u.reset();
    u.script({ outcome: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
    await smoke.click('[data-testid=updates-check]');
    smoke.check('a failed check, its system message left to right', await smoke.waitFor(`${status}[data-state=error]`, 3000), await smoke.text(status));
    await show('updates');
    await lookArabic(smoke, '120-updates-error-arabic', 'Updates: error');
    // The reason as the real updater gives it: a phrase, said in the interface's language.
    u.unsupported({ key: 'updates.reason.noFeed' });
    smoke.check('a build without a feed says so', await smoke.waitFor(`${status}[data-state=unsupported]`, 3000), await smoke.text(status));
    await show('updates');
    await lookArabic(smoke, '121-updates-unsupported-arabic', 'Updates: unsupported');
    u.unsupported(null);
    u.reset();
    u.script({ outcome: 'up-to-date' });
    await smoke.click('[data-testid=updates-check]');
    smoke.check('up to date', await smoke.waitFor(`${status}[data-state=up-to-date]`, 3000), await smoke.text(status));
    await auditArabic(smoke, 'Updates: up to date');
    // The startup check's notice: a toast that opens Settings.
    await smoke.click('[data-testid=tab][data-type="shell.home"]');
    u.script({ outcome: 'available', version: '1.3.0' });
    await u.check({ scheduled: true });
    smoke.check('the startup check announces a version with a toast', (await smoke.waitFor('[data-testid=toast-message]', 3000, '1.3.0')) && (await smoke.waitFor('[data-testid=toast-action]', 3000)));
    await lookArabic(smoke, '122-updates-startup-toast-arabic', 'the startup update toast');
  } finally {
    await dismissToasts(smoke);
    u.unsupported(null);
    u.reset();
  }
}

/** Right-clicks a Home card near its top-left corner, scrolled into view, the toasts dismissed first. */
async function rightClickCard(smoke: Smoke, name: string): Promise<boolean> {
  const card = `[data-testid=project-card][data-name="${name}"]`;
  if (!(await smoke.waitFor(card))) return false;
  await dismissToasts(smoke);
  await smoke.js(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({ block: 'center' })`);
  await wait(120);
  return smoke.rightClick(card, { x: 40, y: 40 });
}

/**
 * Home in Arabic: a search that finds nothing, a card's menu and its rename and trash, the trash with its
 * restore and its two confirmations (delete one permanently, empty the trash), on a project made for it.
 */
export async function smokeArabicHomeWalk(smoke: Smoke, projectName: string): Promise<void> {
  const { host } = smoke;
  smoke.section('arabic walk: Home');
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  await smoke.js(`document.querySelector('[data-testid=library-home]').scrollTop = 0`);
  await auditArabic(smoke, 'Home with its projects');

  await smoke.fill('[data-testid=library-search]', 'لا يوجد مشروع بهذا الاسم');
  smoke.check('a search that finds nothing says so in Arabic', await smoke.waitFor('x-empty-state', 3000), await smoke.text('[data-testid=library-home]'));
  await lookArabic(smoke, '123-home-search-empty-arabic', 'Home: an empty search');
  await smoke.fill('[data-testid=library-search]', '');
  await smoke.until(async () => (await smoke.count('[data-testid=otto-composer]')) === 1);

  // A project for the menu, the trash and the confirmations, made and named in Arabic.
  const SPARE = 'مسودة للحذف';
  const spare = await smoke.run<ProjectSummary>('project.create', { name: SPARE });
  // Creating it opens its tab: back to Home, once that tab has come.
  await smoke.waitFor(`[data-testid=tab][data-type="project.editor"][data-title="${SPARE}"]`, 5000);
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check('a second Arabic project is on Home', await smoke.waitFor(`[data-testid=project-card][data-name="${SPARE}"]`, 5000));
  await rightClickCard(smoke, SPARE);
  smoke.check("a card's menu opens in Arabic, on screen", (await smoke.waitFor('[data-testid=context-menu]', 3000, 'إعادة تسمية')) && (await menuOnScreen(smoke)));
  await lookArabic(smoke, '124-home-card-menu-arabic', "a card's menu");
  await smoke.click('[data-testid=project-menu-rename]');
  smoke.check('Rename asks in Arabic, the name as written', (await smoke.waitFor('x-dialog-host form input', 3000)) && (await smoke.js<string>(`document.querySelector('x-dialog-host form input').value`)) === SPARE);
  await lookArabic(smoke, '125-home-rename-arabic', 'the rename dialog');
  smoke.check('and cancels', await cancelDialog(smoke));

  await rightClickCard(smoke, SPARE);
  await smoke.waitFor('[data-testid=context-menu]', 3000);
  await smoke.click('[data-testid=project-menu-trash]');
  smoke.check('the card menu moves it to the trash', await smoke.until(() => host.projects.list({ trashed: true }).some((p) => p.id === spare.id)));
  await smoke.click('[data-testid=library-trash]');
  smoke.check('the trash lists it', await smoke.waitFor(`[data-testid=trash-item][data-name="${SPARE}"]`, 3000));
  await lookArabic(smoke, '126-trash-arabic', 'the trash');
  await smoke.click(`[data-testid=trash-item][data-name="${SPARE}"] [data-testid=trash-delete]`);
  smoke.check('deleting one permanently asks first, in Arabic', await smoke.waitFor('x-dialog-host', 3000, 'نهائي'), await smoke.text('x-dialog-host'));
  await lookArabic(smoke, '127-trash-delete-confirm-arabic', 'the delete-permanently confirmation');
  await cancelDialog(smoke);
  await smoke.click('[data-testid=library-empty-trash]');
  smoke.check('emptying the trash asks first, in Arabic', await smoke.waitFor('x-dialog-host', 3000, 'نهائي'), await smoke.text('x-dialog-host'));
  await lookArabic(smoke, '128-trash-empty-confirm-arabic', 'the empty-trash confirmation');
  await cancelDialog(smoke);
  // The spare goes for good, through its own confirmation: the trash is left as the sections before left it.
  await smoke.click(`[data-testid=trash-item][data-name="${SPARE}"] [data-testid=trash-delete]`);
  await smoke.waitFor('x-dialog-host button', 3000, 'حذف');
  await smoke.js(`[...document.querySelectorAll('x-dialog-host button')].find((b) => b.textContent.includes('حذف') && !b.textContent.includes('إلغاء'))?.click()`);
  smoke.check('and deletes it once confirmed', await smoke.until(() => !host.projects.list({ trashed: true }).some((p) => p.id === spare.id)));
  await smoke.click('[data-testid=library-back]');
  await smoke.waitFor(`[data-testid=project-card][data-name="${projectName}"]`, 3000);
}

/**
 * The first-launch guide in Arabic: every project moved to the trash for the look, then restored (the
 * Arabic project has gone to the trash already and stays there).
 */
export async function smokeArabicFirstLaunch(smoke: Smoke): Promise<void> {
  const { host } = smoke;
  smoke.section('arabic walk: first launch');
  const all = host.projects.list();
  for (const p of all) await smoke.run('project.trash', { id: p.id });
  try {
    await smoke.click('[data-testid=tab][data-type="shell.home"]');
    smoke.check('an empty library shows the first-launch guide in Arabic', await smoke.waitFor('[data-testid=library-first-launch] [data-testid=first-launch-new]', 5000, 'مشروع جديد'));
    smoke.check("its sentence for Otto is Arabic", ((await smoke.js<string>(`document.querySelector('[data-testid=first-launch-otto-input]')?.value ?? ''`)) ?? '').match(/[\u0600-\u06ff]/) !== null);
    await lookArabic(smoke, '129-first-launch-arabic', 'the first-launch guide');
  } finally {
    for (const p of all) await smoke.run('project.restore', { id: p.id });
  }
  smoke.check('the projects are back on Home', await smoke.until(async () => (await smoke.count('[data-testid=project-card]')) === all.length, 5000));
}

type Wall = Extract<Entity, { type: 'wall' }>;

/**
 * The project tab in Arabic, on the Arabic project: Properties for every kind of thing, every tool's options
 * and hint, the plan's context menu, the levels' and layers' menus and dialogs, the Catalog's materials, the
 * snapshots and their dialogs, the 3D view's modes and night, the export dialog for every format, the
 * palette with a command's form, and toasts of each kind.
 */
export async function smokeArabicProjectWalk(smoke: Smoke, projectId: string, projectName: string): Promise<void> {
  const { host } = smoke;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const doc = () => host.projects.session(projectId)!.doc;
  const ground = doc().building.groundLevelId;
  const levels = Object.values(doc().levels);
  const upper = levels.find((l) => l.id !== ground)!.id;
  const entities = () => Object.values(doc().levelData[ground].entities);
  const open = async () => {
    await smoke.click(`[data-testid=tab][data-type="project.editor"][data-title="${projectName}"]`);
    await smoke.until(() => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(projectName)}`));
  };
  await open();
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.waitFor(canvas);
  await selectTool(smoke, 'the parts before the walk');

  smoke.section('arabic walk: one of everything');
  const walls = entities().filter((e): e is Wall => e.type === 'wall');
  const xs = walls.flatMap((w) => w.path.v.map((v) => v.p[0]));
  const ys = walls.flatMap((w) => w.path.v.map((v) => v.p[1]));
  const at = (dx: number, dy: number): [number, number] => [Math.max(...xs) + 3000 + dx, Math.min(...ys) + dy];
  const wall = (await run<{ id: string }>('plan.wall.add', { levelId: ground, from: at(0, 0), to: at(6000, 0) })).id;
  const door = (await run<{ id: string }>('plan.opening.add', { wallId: wall, kind: 'door', along: 1500 })).id;
  const win = (await run<{ id: string }>('plan.opening.add', { wallId: wall, kind: 'window', along: 4200 })).id;
  const column = (await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'column', at: at(1000, 2500), shape: { k: 'rect', w: 400, d: 400 } } })).id;
  const label = (await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'label', text: 'ملاحظة', at: at(4000, 2500), size: 250 } })).id;
  const dimension = (await run<{ id: string }>('plan.dimension.add', { levelId: ground, from: at(0, -1800), to: at(6000, -1800), offset: 0 })).id;
  const light = (await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'light', kind: 'point', at: [...at(7500, 2500), 2400] } })).id;
  const ramp = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'ramp', from: at(0, 5000), to: at(6000, 5000), bottomLevelId: ground, topLevelId: upper } })).id;
  const elevator = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'elevator', at: at(8500, -500), fromLevelId: ground, toLevelId: upper } })).id;
  const stair = Object.values(doc().connectors ?? {}).find((c) => c.kind === 'stair');
  const rooms = await run<{ id: string; name: string; seed?: [number, number]; labelAt: [number, number] }[]>('plan.rooms', { levelId: ground });
  const room = entities().find((e) => e.type === 'room' && e.name === 'غرفة المعيشة') as Extract<Entity, { type: 'room' }> | undefined;
  smoke.check('the walk has one of every kind on the plan', !!stair && !!room && rooms.length > 0, { stair: !!stair, room: !!room });

  // Undo and redo from an Arabic keyboard layout: Ctrl+Z writes ئ there and Ctrl+Y writes غ (`latinKey`).
  const undoSteps = async () => (await run<{ undo: unknown[] }>('edit.history')).undo.length;
  const steps = await undoSteps();
  const ctrl = (key: string, code: string) => smoke.js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: true, bubbles: true, cancelable: true }))`);
  await smoke.js(`document.activeElement?.blur?.()`);
  await ctrl('ئ', 'KeyZ');
  smoke.check('Ctrl+Z on an Arabic layout (ئ) undoes', await smoke.until(async () => (await undoSteps()) === steps - 1, 3000));
  await ctrl('غ', 'KeyY');
  smoke.check('and Ctrl+Y (غ) redoes', await smoke.until(async () => (await undoSteps()) === steps, 3000));

  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  await dismissToasts(smoke);
  const fit = async () => {
    await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
    await smoke.until(async () => Boolean(await canvasAttr(smoke, 'camera')));
    await wait(150);
  };
  await fit();
  const stairMid: [number, number] | null = stair && 'axis' in stair ? (() => {
    const v = (stair as unknown as { axis: { v: { p: [number, number] }[] } }).axis.v;
    return [(v[0].p[0] + v[v.length - 1].p[0]) / 2, (v[0].p[1] + v[v.length - 1].p[1]) / 2];
  })() : null;
  const targets: { kind: string; id: string; p: readonly [number, number] | null; number: number }[] = [
    { kind: 'door', id: door, p: at(1500, 0), number: 130 },
    { kind: 'window', id: win, p: at(4200, 0), number: 131 },
    { kind: 'room', id: room?.id ?? '', p: room?.boundary.k === 'detect' ? room.boundary.seed : null, number: 132 },
    { kind: 'label', id: label, p: at(4000, 2500), number: 133 },
    { kind: 'dimension', id: dimension, p: at(3000, -1800), number: 134 },
    { kind: 'column', id: column, p: at(1000, 2500), number: 135 },
    { kind: 'stair', id: stair?.id ?? '', p: stairMid, number: 136 },
    { kind: 'ramp', id: ramp, p: at(1500, 5000), number: 137 },
    { kind: 'elevator', id: elevator, p: at(8500, -500), number: 138 },
    { kind: 'light', id: light, p: at(7500, 2500), number: 139 },
  ];
  for (const target of targets) {
    if (!target.p || !target.id) {
      smoke.check(`a ${target.kind} to select`, false);
      continue;
    }
    // Select it by a click, as a person does; a second click a few pixels aside if the first found something else.
    let selected = false;
    for (const [dx, dy] of [[0, 0], [3, 0], [0, 3], [-3, 0]]) {
      const v = await view(smoke);
      const s = v.at(target.p);
      await smoke.clickAt(s.x + dx, s.y + dy);
      selected = await smoke.until(async () => ((await canvasAttr(smoke, 'selection')) ?? '').split(' ').includes(target.id), 1500);
      if (selected) break;
      await smoke.js(`document.querySelector('${canvas}').focus()`);
      await smoke.key('Escape');
    }
    smoke.check(`a click selects the ${target.kind}`, selected, await canvasAttr(smoke, 'selection'));
    smoke.check(`its Properties speak Arabic`, (await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000)) && /[\u0600-\u06ff]/.test((await smoke.text(`${tab} [data-testid=properties-title]`)) ?? ''), await smoke.text(`${tab} [data-testid=properties-title]`));
    await lookArabic(smoke, `${target.number}-properties-${target.kind}-arabic`, `Properties of a ${target.kind}`);
    if (target.kind === 'label') {
      // The plan's context menu on a selection: its shortcuts left to right, on screen.
      const v = await view(smoke);
      const s = v.at(target.p);
      await smoke.rightClickAt(s.x, s.y);
      smoke.check("the plan's context menu opens in Arabic, on screen", (await smoke.waitFor('[data-testid=context-menu]', 3000, 'تكرار')) && (await menuOnScreen(smoke)));
      await lookArabic(smoke, '140-plan-context-menu-arabic', "the plan's context menu");
      await closeMenu(smoke);
    }
    await smoke.js(`document.querySelector('${canvas}').focus()`);
    await smoke.key('Escape');
  }

  smoke.section('arabic walk: every tool');
  const tools = await smoke.js<string[]>(`[...document.querySelectorAll('${tab} [data-testid^=tool-]')].map((b) => b.dataset.testid.slice(5)).filter((id) => id !== 'options')`);
  smoke.check('the toolbar has its tools', tools.length >= 15, tools);
  let shot = 141;
  for (const id of tools) {
    if (id === 'select') continue;
    await smoke.click(`${tab} [data-testid=tool-${id}]`);
    const picked = await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === id, 3000);
    smoke.check(`the ${id} tool is picked from the toolbar`, picked, await canvasAttr(smoke, 'tool'));
    await smoke.until(async () => /[\u0600-\u06ff]/.test((await smoke.text(`${tab} [data-testid=plan-hint]`)) ?? ''), 3000);
    await auditArabic(smoke, `the ${id} tool's options and hint`);
    if (id === 'wall' || id === 'door' || id === 'window' || id === 'column' || id === 'elevator' || id === 'light' || id === 'dimension' || id === 'shape') await smoke.shots(`${shot++}-tool-${id}-arabic`);
    await selectTool(smoke, `the ${id} tool`);
  }

  smoke.section('arabic walk: levels and layers, their menus and dialogs');
  await smoke.click(`${tab} [data-testid=level-add]`);
  smoke.check("the levels' Add menu opens in Arabic, on screen", (await smoke.waitFor('[data-testid=context-menu]', 3000)) && (await menuOnScreen(smoke)));
  await lookArabic(smoke, '149-levels-add-menu-arabic', "the levels' Add menu");
  await closeMenu(smoke);
  const upperRow = `${tab} [data-testid=level-row][data-elevation="3000"]`;
  await smoke.rightClick(upperRow);
  smoke.check("a level's menu opens in Arabic, on screen", (await smoke.waitFor('[data-testid=context-menu]', 3000)) && (await menuOnScreen(smoke)));
  await lookArabic(smoke, '150-level-menu-arabic', "a level's menu");
  await smoke.click('[data-testid=level-menu-add-above]');
  smoke.check('Add level above asks in a form, in Arabic', await smoke.waitFor('[data-testid=form-dialog]', 3000));
  await lookArabic(smoke, '151-level-add-above-arabic', 'the add-level form');
  await cancelDialog(smoke);
  await smoke.rightClick(upperRow);
  await smoke.waitFor('[data-testid=context-menu]', 3000);
  await smoke.click('[data-testid=level-menu-mezzanine], [data-testid=level-menu-rehost]');
  smoke.check('a mezzanine is asked for in a form, in Arabic', await smoke.waitFor('[data-testid=form-dialog]', 3000));
  await lookArabic(smoke, '152-level-mezzanine-arabic', 'the mezzanine form');
  await cancelDialog(smoke);
  await smoke.rightClick(upperRow);
  await smoke.waitFor('[data-testid=context-menu]', 3000);
  await smoke.click('[data-testid=level-menu-remove]');
  smoke.check('removing a level asks first, listing what is on it', await smoke.waitFor('x-dialog-host', 3000, 'إزالة'), await smoke.text('x-dialog-host'));
  await lookArabic(smoke, '153-level-remove-arabic', 'the remove-level confirmation');
  await cancelDialog(smoke);
  await smoke.click(`${tab} [data-testid=level-row][data-elevation="0"]`);

  await smoke.click(`${tab} [data-testid=layer-add]`);
  smoke.check("the layers' Add menu opens in Arabic, on screen", (await smoke.waitFor('[data-testid=context-menu]', 3000)) && (await menuOnScreen(smoke)));
  await lookArabic(smoke, '154-layers-add-menu-arabic', "the layers' Add menu");
  await closeMenu(smoke);
  await smoke.rightClick(`${tab} [data-testid=layer-row]`);
  smoke.check("a layer's menu opens in Arabic", await smoke.waitFor('[data-testid=layer-menu-rename]', 3000));
  await auditArabic(smoke, "a layer's menu");
  await smoke.click('[data-testid=layer-menu-rename]');
  smoke.check('renaming a layer asks in Arabic', await smoke.waitFor('x-dialog-host form input', 3000));
  await lookArabic(smoke, '155-layer-rename-arabic', 'the rename-layer dialog');
  await cancelDialog(smoke);
  await smoke.rightClick(`${tab} [data-testid=layer-row]`);
  await smoke.waitFor('[data-testid=layer-menu-remove]', 3000);
  await smoke.click('[data-testid=layer-menu-remove]');
  smoke.check('removing a layer asks first, in Arabic', await smoke.waitFor('x-dialog-host', 3000, 'إزالة'), await smoke.text('x-dialog-host'));
  await lookArabic(smoke, '156-layer-remove-arabic', 'the remove-layer confirmation');
  await cancelDialog(smoke);

  smoke.section('arabic walk: the Catalog, snapshots, Warnings');
  await smoke.click(`${tab} [data-testid=right-tab-catalog]`);
  await smoke.fill(`${tab} [data-testid=catalog-search]`, '');
  await smoke.click(`${tab} [data-testid=catalog-tab-material]`);
  smoke.check('the materials tab shows its cards', await smoke.waitFor(`${tab} [data-testid=catalog-card]`, 3000));
  await lookArabic(smoke, '157-catalog-materials-arabic', 'the Catalog: materials');
  await smoke.click(`${tab} [data-testid=catalog-tab-item]`);
  await auditArabic(smoke, 'the Catalog: furniture');
  await selectTool(smoke, 'the Catalog');

  await smoke.click(`${tab} [data-testid=right-tab-warnings]`);
  await smoke.waitFor(`${tab} [data-testid=warnings-count]`, 3000);
  await auditArabic(smoke, 'the Warnings panel');

  await smoke.click(`${tab} [data-testid=right-tab-details]`);
  await smoke.click(`${tab} [data-testid=snapshot-create]`);
  smoke.check('saving a snapshot asks for its name in Arabic', await smoke.waitFor('x-dialog-host form input', 3000));
  await lookArabic(smoke, '158-snapshot-create-arabic', 'the snapshot dialog');
  await smoke.fill('x-dialog-host form input', 'قبل التعديل');
  await smoke.click('x-dialog-host form button[type=submit]');
  const snapshot = `${tab} [data-testid=snapshot-item][data-name="قبل التعديل"]`;
  smoke.check('the snapshot is listed, with a success toast in Arabic', (await smoke.waitFor(snapshot, 5000)) && (await smoke.waitFor('[data-testid=toast-message]', 3000, 'قبل التعديل')));
  await smoke.click(`${snapshot} [data-testid=snapshot-restore]`);
  smoke.check('restoring asks first, in Arabic', await smoke.waitFor('x-dialog-host', 3000, 'استعادة'));
  await lookArabic(smoke, '159-snapshot-restore-arabic', 'the restore confirmation');
  await cancelDialog(smoke);
  await smoke.click(`${snapshot} [data-testid=snapshot-delete]`);
  smoke.check('deleting a snapshot asks first, in Arabic', await smoke.waitFor('x-dialog-host', 3000, 'حذف'));
  await lookArabic(smoke, '160-snapshot-delete-arabic', 'the delete-snapshot confirmation');
  await smoke.js(`[...document.querySelectorAll('x-dialog-host button')].find((b) => b.textContent.includes('حذف') && !b.textContent.includes('إلغاء'))?.click()`);
  smoke.check('and deletes it once confirmed', await smoke.gone(snapshot, 5000));

  smoke.section('arabic walk: toasts of each kind');
  await dismissToasts(smoke);
  // Success: a snapshot saved. Error: a thickness that is not one. Info with an action: an export written.
  await smoke.click(`${tab} [data-testid=snapshot-create]`);
  await smoke.waitFor('x-dialog-host form input', 3000);
  await smoke.fill('x-dialog-host form input', 'نسخة ثانية');
  await smoke.click('x-dialog-host form button[type=submit]');
  await smoke.waitFor('[data-testid=toast-message]', 3000, 'نسخة ثانية');
  await smoke.click(`${tab} [data-testid=tool-wall]`);
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall', 3000);
  await smoke.fill(`${tab} [data-testid=wall-thickness]`, 'سميك');
  await smoke.js(`document.querySelector('${tab} [data-testid=wall-thickness]').dispatchEvent(new FocusEvent('blur'))`);
  smoke.check('an error toast in Arabic, the text typed isolated', await smoke.waitFor('[data-testid=toast-message]', 3000, 'سميك'));
  await selectTool(smoke, 'the error toast');
  smoke.nextDialogPath(`${host.opts.userDataDir}\\exports-arabic\\walk.svg`);
  await smoke.click(`${tab} [data-testid=exchange-export]`);
  await smoke.waitFor('[data-testid=export-format-svg]', 3000);
  await smoke.click('[data-testid=export-format-svg]');
  await smoke.click('[data-testid=export-confirm]');
  smoke.check('an export toast in Arabic, with its Show action', (await smoke.waitFor('[data-testid=toast-action]', 10_000)) && (await smoke.count('[data-testid=toast-message]')) >= 3, await smoke.js(`[...document.querySelectorAll('[data-testid=toast-message]')].map((m) => m.textContent)`));
  await lookArabic(smoke, '161-toasts-arabic', 'toasts of each kind');
  await dismissToasts(smoke);

  smoke.section('arabic walk: the export dialog, every format');
  await smoke.click(`${tab} [data-testid=exchange-export]`);
  await smoke.waitFor('[data-testid=export-format-pdf]', 3000);
  let n = 162;
  for (const format of ['pdf', 'svg', 'dxf', 'glb', 'png']) {
    await smoke.click(`[data-testid=export-format-${format}]`);
    if (format === 'png') await smoke.click('[data-testid=export-view-plan]');
    await wait(100);
    await lookArabic(smoke, `${n++}-export-${format}-arabic`, `the export dialog: ${format}`);
  }
  // A number field takes Arabic-Indic digits typed on an Arabic keyboard (a type="number" field dropped them).
  await smoke.fill('[data-testid=export-size]', 'custom');
  await smoke.waitFor('[data-testid=export-width]', 2000);
  const typeInto = async (selector: string, text: string) => {
    await smoke.fill(selector, '');
    await smoke.js(`document.querySelector('${selector}').focus()`);
    await wait(150);
    await smoke.typeText(text);
    await smoke.until(async () => (await smoke.js<string>(`document.querySelector('${selector}').value`)) === text, 2000);
  };
  const confirmDisabled = () => smoke.js<boolean>(`document.querySelector('[data-testid=export-confirm]').disabled`);
  await typeInto('[data-testid=export-width]', '٢٠');
  smoke.check(
    'a width typed in Arabic-Indic digits reaches the field, and ٢٠ is refused in Arabic',
    (await smoke.js<string>(`document.querySelector('[data-testid=export-width]').value`)) === '٢٠' && (await smoke.until(confirmDisabled, 2000)) && (await smoke.waitFor('[data-testid=export-dialog]', 2000, 'لا يقل عن')),
    await smoke.js(`document.querySelector('[data-testid=export-width]').value`),
  );
  await typeInto('[data-testid=export-width]', '٣٢٠');
  await typeInto('[data-testid=export-height]', '٢٤٠');
  smoke.check(
    'and ٣٢٠ × ٢٤٠ is a size the dialog takes',
    (await smoke.js<string>(`document.querySelector('[data-testid=export-height]').value`)) === '٢٤٠' && (await smoke.until(async () => !(await confirmDisabled()), 2000)),
    await smoke.js(`[document.querySelector('[data-testid=export-width]').value, document.querySelector('[data-testid=export-height]').value]`),
  );
  await cancelDialog(smoke);

  smoke.section('arabic walk: the palette with a form');
  await smoke.key('K', ['control']);
  await smoke.waitFor('[data-testid=palette-input]');
  await smoke.fill('[data-testid=palette-input]', 'حفظ نسخة');
  smoke.check('the palette finds a command by its Arabic title', await smoke.waitFor('.palette-item[data-selected=true]', 3000, 'حفظ نسخة'));
  await smoke.key('Return');
  smoke.check("Enter opens the command's form, in Arabic", await smoke.waitFor('[data-testid=palette-form]', 3000));
  await lookArabic(smoke, '167-palette-form-arabic', "the palette's command form");
  await smoke.key('Escape');
  await smoke.key('Escape');
  await smoke.gone('[data-testid=palette]', 3000);

  smoke.section('arabic walk: the 3D view');
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  await smoke.waitFor(`${tab} [data-testid=scene-toolbar]`, 5000);
  await smoke.click(`${tab} [data-testid=scene-lighting-night]`);
  await smoke.click(`${tab} [data-testid=scene-mode-cutaway]`);
  smoke.check('night and cutaway are on', await smoke.until(async () => (await smoke.js<string | null>(`document.querySelector('${tab} [data-testid=scene-canvas]')?.dataset.lighting ?? null`)) === 'night', 5000));
  await lookArabic(smoke, '168-scene-night-cutaway-arabic', 'the 3D view at night, cut away');
  await smoke.click(`${tab} [data-testid=scene-mode-explode]`);
  await wait(200);
  await lookArabic(smoke, '169-scene-explode-arabic', 'the 3D view exploded');
  await smoke.click(`${tab} [data-testid=scene-mode-all]`);
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  await smoke.click(`${tab} [data-testid=center-tab-section]`);
  await smoke.waitFor(`${tab} [data-testid=section-view]`, 3000);
  await auditArabic(smoke, 'the section');
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.waitFor(canvas);
  await selectTool(smoke, 'the walk of the project tab');
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
}
