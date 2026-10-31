import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { pngTopLeftPixel, readPngHeader } from '@studio/core';
import type { Smoke } from './harness';
import { canvasAttr, openProjectTab, tab } from './plan-canvas';

type Rendered = { path: string; bytes: number; width: number; height: number; view: string; levelId: string; levelName: string };

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
const exists = (file: string) => fs.stat(file).then(() => true, () => false);
/** The top-left pixel of a PNG file as `#rrggbb/alpha`, decoded by hand (see `pngTopLeftPixel`). */
const corner = (bytes: Uint8Array) => {
  const px = pngTopLeftPixel(bytes, (d) => inflateSync(d));
  return px ? `#${px.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}/${px[3]}` : null;
};

/**
 * `export.image`, in the UI phase because the window draws the render: the duplex's plan and the
 * building in 3D written as PNGs whose IHDR says the size asked for; a transparent plan and a
 * transparent 3D render with an alpha-0 corner (the first pixel decoded by hand), the light and dark
 * plans with their paper colour in the corner; 4096 × 4096 in 3D either written at that size or
 * refused with UNAVAILABLE, never smaller; over MCP `export_image` refused until mutations are
 * allowed, then written and announced.
 */
export async function smokeExchangeUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('exchange: PNG renders');
  const out = path.join(smoke.host.opts.userDataDir, 'exports');
  await fs.mkdir(out, { recursive: true });
  const run = (input: Record<string, unknown>) => smoke.run<Rendered>('export.image', input, { projectId: duplexId });
  const read = async (r: Rendered) => new Uint8Array(await fs.readFile(r.path));
  const from = smoke.events.length;

  const plan = await run({ path: path.join(out, 'Duplex plan.png') });
  const planBytes = await read(plan);
  const planHead = readPngHeader(planBytes);
  console.log(`Duplex plan.png: ${plan.width} × ${plan.height}, ${plan.bytes} bytes`);
  smoke.check('a plan render is a PNG of the default 1600 × 1200 with the ground floor', planHead?.width === 1600 && planHead.height === 1200 && plan.bytes === planBytes.length && plan.view === 'plan' && plan.levelName === 'Ground floor', { plan, planHead });

  const building = await run({ path: path.join(out, 'Duplex 3d.png'), view: '3d', width: 1024, height: 768 });
  const buildingBytes = await read(building);
  const buildingHead = readPngHeader(buildingBytes);
  console.log(`Duplex 3d.png: ${building.width} × ${building.height}, ${building.bytes} bytes`);
  smoke.check('a 3D render is a PNG of the asked 1024 × 768', buildingHead?.width === 1024 && buildingHead.height === 768 && building.bytes === buildingBytes.length && building.view === '3d', { building, buildingHead });
  smoke.check('both renders are announced as png', smoke.eventsSince(from, 'exchange.exported').filter((e) => e.format === 'png' && e.projectId === duplexId).map((e) => e.files[0]).join('|') === [plan.path, building.path].join('|'));

  // The corners are padding, so they show the background: the paper colour, or nothing at all.
  const light = await read(await run({ path: path.join(out, 'Light.png'), width: 400, height: 300 }));
  const dark = await read(await run({ path: path.join(out, 'Dark.png'), width: 400, height: 300, theme: 'dark' }));
  const clear = await read(await run({ path: path.join(out, 'Clear.png'), width: 256, height: 192, transparent: true }));
  const clear3d = await read(await run({ path: path.join(out, 'Clear 3d.png'), view: '3d', width: 320, height: 240, transparent: true }));
  const corners = { light: corner(light), dark: corner(dark), clear: corner(clear), clear3d: corner(clear3d), building: corner(buildingBytes) };
  console.log(`PNG corners: ${JSON.stringify(corners)}; light ${light.length} bytes, dark ${dark.length}, transparent ${clear.length}, transparent 3D ${clear3d.length}`);
  smoke.check('the light plan has the light paper in its corner, opaque', corners.light === '#f6f1e8/255', corners);
  smoke.check('the dark plan differs and has the dark paper in its corner', !Buffer.from(dark).equals(Buffer.from(light)) && corners.dark === '#1d1a17/255', corners);
  smoke.check('a transparent plan has an alpha-0 corner', readPngHeader(clear)?.colorType === 6 && corners.clear?.endsWith('/0') === true, corners);
  smoke.check('and so has a transparent 3D render, where the opaque one has its sky', corners.clear3d?.endsWith('/0') === true && corners.building?.endsWith('/255') === true, corners);
  if (smoke.shotsDir) {
    await fs.mkdir(smoke.shotsDir, { recursive: true });
    await fs.writeFile(path.join(smoke.shotsDir, '42-export-plan-dark.png'), dark);
    await fs.writeFile(path.join(smoke.shotsDir, '42-export-3d.png'), buildingBytes);
  }

  // The largest size in 3D: written at exactly that size, or refused (WebGL's drawing buffer is capped by the GPU), never smaller.
  const hugePath = path.join(out, 'Huge 3d.png');
  const started = Date.now();
  try {
    const huge = await run({ path: hugePath, view: '3d', width: 4096, height: 4096 });
    const head = readPngHeader(await read(huge));
    console.log(`Huge 3d.png: 4096 × 4096, ${huge.bytes} bytes in ${Date.now() - started} ms`);
    smoke.check('4096 × 4096 in 3D is written at that size', head?.width === 4096 && head.height === 4096, head);
  } catch (err) {
    const e = err as { code?: string; message: string };
    console.log(`Huge 3d.png refused in ${Date.now() - started} ms: ${e.message}`);
    smoke.check('4096 × 4096 in 3D, when WebGL cannot draw it, is refused with UNAVAILABLE and nothing written', e.code === 'UNAVAILABLE' && !(await exists(hugePath)), e);
  }

  await smoke.expectError('a relative PNG path is refused', 'export.image', { path: 'Duplex.png' }, 'INVALID_INPUT', { projectId: duplexId });
  await smoke.expectError('a PNG of an unknown level is refused', 'export.image', { path: path.join(out, 'x.png'), levelId: 'lvl_0000000000000000' }, 'NOT_FOUND', { projectId: duplexId });
  await smoke.expectError('a size past 4096 is refused', 'export.image', { path: path.join(out, 'x.png'), width: 5000 }, 'INVALID_INPUT', { projectId: duplexId });

  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-renderer', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${duplexId}`)));
  const { tools } = await agent.listTools();
  smoke.check('export_image is a tool, marked destructive', tools.find((t) => t.name === 'export_image')?.annotations?.destructiveHint === true);
  const agentPath = path.join(out, 'Agent.png');
  const blocked = await agent.callTool({ name: 'export_image', arguments: { path: agentPath, view: '3d', width: 320, height: 240 } });
  smoke.check('an agent is refused the render while mutations are off', blocked.isError === true && text(blocked).code === 'MUTATION_BLOCKED' && !(await exists(agentPath)), text(blocked));
  await smoke.run('config.update', { patch: { mcp: { allowMutations: true } } });
  try {
    const before = smoke.events.length;
    const allowed = text(await agent.callTool({ name: 'export_image', arguments: { path: agentPath, view: '3d', width: 320, height: 240 } })) as unknown as Rendered;
    const head = readPngHeader(new Uint8Array(await fs.readFile(agentPath).catch(() => Buffer.alloc(0))));
    smoke.check('once allowed, an agent renders the building to a PNG', allowed.path === agentPath && head?.width === 320 && head.height === 240, { allowed, head });
    smoke.check('and the render is announced', await smoke.until(() => smoke.eventsSince(before, 'exchange.exported').some((e) => e.format === 'png' && e.files.includes(agentPath))));
  } finally {
    await smoke.run('config.update', { patch: { mcp: { allowMutations: false } } });
    await agent.close();
  }
}

/** Clicks away the toasts stacked over the bottom-right corner. */
const dismissToasts = (smoke: Smoke) => smoke.js("[...document.querySelectorAll('[aria-label=Dismiss]')].forEach((b) => b.click())");

/** Where keyboard focus is: inside the component dialog or not, and the focused element's test id. */
const focusInfo = (smoke: Smoke) =>
  smoke.js<{ inside: boolean; testId: string | null }>(`(() => { const a = document.activeElement; return { inside: !!a?.closest('[data-testid=component-dialog]'), testId: a?.getAttribute('data-testid') ?? null }; })()`);
/** The text of the heading that labels the component dialog (`aria-labelledby`). */
const dialogLabel = (smoke: Smoke) => smoke.js<string | null>(`(() => { const id = document.querySelector('[data-testid=component-dialog]')?.getAttribute('aria-labelledby'); return id ? document.getElementById(id)?.textContent?.trim() ?? null : null; })()`);
/** The node names in a GLB's JSON chunk. */
const glbNodeNames = (glb: Buffer): string[] => (glb.length < 20 ? [] : ((JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { nodes?: { name?: string }[] }).nodes ?? []).map((n) => n.name ?? ''));

/**
 * The Export dialog and the DXF import as a user drives them, with the native pickers answered by the
 * smoke's stand-in (`smoke.nextDialogPath`): the dialog opens from the project tab's toolbar and
 * shows only the chosen format's fields, takes focus and keeps Tab inside, and closes with Cancel or
 * Escape giving focus back; a PDF of every level fitted to the page, a dark 320 × 240 PNG and a glTF of
 * the current level are written where the picker said, each with a toast whose Show reveals the file;
 * replacing level files asks first; Export… is busy while a render runs; a non-DXF pick is an error
 * toast; the DXF import dialog closes with Escape or Cancel, shows the probe (units, layers with counts, what is skipped), imports onto the
 * level on screen (the Layers panel lists `DXF Walls`, the canvas draws more entities) and one undo
 * takes it back. The import goes into a throwaway project, deleted at the end.
 */
export async function smokeExchangeDialogs(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('exchange: the Export dialog');
  const out = path.join(smoke.host.opts.userDataDir, 'exports');
  const dialog = '[data-testid=export-dialog]';
  const has = (selector: string) => smoke.js<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
  const checked = (testId: string) => smoke.js<boolean>(`document.querySelector('[data-testid=${testId}]')?.checked === true`);
  const exportButton = `${tab} [data-testid=exchange-export]`;
  /** Opens the Export dialog from the toolbar button, focused first as a click would, so focus has somewhere to return to. */
  const openExport = async () => {
    await dismissToasts(smoke);
    await smoke.js(`document.querySelector(${JSON.stringify(exportButton)})?.focus()`);
    await smoke.click(exportButton);
    return smoke.waitFor(dialog);
  };
  const buttonFocused = () => smoke.js<boolean>(`document.activeElement === document.querySelector(${JSON.stringify(exportButton)})`);
  const idle = () => smoke.until(() => smoke.js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(exportButton)}); return !!b && !b.disabled && !b.hasAttribute('aria-busy') && b.textContent.trim() === 'Export…'; })()`), 30_000);
  /** Confirms the open dialog with the picker answering `file`, then waits for the file and the toast. */
  const exportTo = async (file: string) => {
    await fs.rm(file, { force: true });
    await dismissToasts(smoke);
    smoke.nextDialogPath(file);
    await smoke.click('[data-testid=export-confirm]');
    const written = await smoke.until(() => exists(file), 30_000);
    const toast = await smoke.waitFor('[data-testid=toast-message]', 10_000, 'Exported 1 file to');
    return written && toast;
  };

  smoke.check('the duplex tab opens', await openProjectTab(smoke, duplexId));
  smoke.check('Export… on the project toolbar opens the Export dialog', await openExport());
  // Focus moves in, to the first field (the chosen format), the heading labels the dialog, and Tab stays inside.
  smoke.check('focus moves into the dialog, onto its first field', await smoke.until(async () => (await focusInfo(smoke)).testId === 'export-format-pdf', 2000), await focusInfo(smoke));
  smoke.check('the dialog is labelled by its heading', (await dialogLabel(smoke)) === 'Export', await dialogLabel(smoke));
  await smoke.key('Tab', ['shift']);
  const wrappedBack = await focusInfo(smoke);
  await smoke.key('Tab');
  const wrappedOn = await focusInfo(smoke);
  smoke.check('Shift+Tab on the first field goes round to the last button, and Tab back to the first', wrappedBack.testId === 'export-confirm' && wrappedOn.testId === 'export-format-pdf', { wrappedBack, wrappedOn });
  const stops: (string | null)[] = [];
  for (let i = 0; i < 12; i++) {
    await smoke.key('Tab');
    const at = await focusInfo(smoke);
    stops.push(at.inside ? at.testId ?? '(inside)' : null);
  }
  smoke.check('Tab never leaves the dialog', stops.every((s) => s !== null) && stops.includes('export-confirm'), stops);
  smoke.check('it starts on PDF, every level, fitted to the page', (await checked('export-format-pdf')) && (await checked('export-levels-all')) && (await smoke.js<string>(`document.querySelector('[data-testid=export-scale]').value`)) === 'fit');
  const fields = async () => ({ levels: await has('[data-testid=export-levels]'), sheet: await has('[data-testid=export-sheet]'), glb: await has('[data-testid=export-glb]'), png: await has('[data-testid=export-png]') });
  const shown: Record<string, unknown> = {};
  for (const format of ['svg', 'dxf', 'glb', 'png', 'pdf']) {
    await smoke.click(`[data-testid=export-format-${format}]`);
    await smoke.until(() => checked(`export-format-${format}`), 2000);
    shown[format] = await fields();
  }
  const expected = {
    svg: { levels: true, sheet: true, glb: false, png: false },
    dxf: { levels: true, sheet: false, glb: false, png: false },
    glb: { levels: true, sheet: false, glb: true, png: false },
    png: { levels: false, sheet: false, glb: false, png: true },
    pdf: { levels: true, sheet: true, glb: false, png: false },
  };
  smoke.check('each format shows only its own fields', JSON.stringify(shown) === JSON.stringify(expected), shown);
  smoke.check('PDF of every level says one file with a page per level', ((await smoke.text('[data-testid=export-levels-hint]')) ?? '').includes('a page per level (2)'));
  await smoke.shots('43-export-dialog-pdf');

  const asked = smoke.dialogs.asked.length;
  await smoke.click(`${dialog} button`, 'Cancel');
  smoke.check('Cancel closes the dialog without asking where to save', (await smoke.gone(dialog)) && smoke.dialogs.asked.length === asked);
  smoke.check('and focus goes back to Export…', await smoke.until(buttonFocused, 2000));
  await openExport();
  await smoke.until(async () => (await focusInfo(smoke)).inside, 2000);
  await smoke.key('Escape');
  smoke.check('Escape closes the Export dialog without asking where to save, focus back on Export…', (await smoke.gone(dialog)) && smoke.dialogs.asked.length === asked && (await smoke.until(buttonFocused, 2000)));

  const pdfPath = path.join(out, 'Dialog.pdf');
  await openExport();
  smoke.check('a PDF of every level, fitted, is written where the save dialog said', await exportTo(pdfPath));
  const save = smoke.dialogs.asked.at(-1);
  smoke.check('the save dialog was asked with the project name and the PDF filter', save?.kind === 'pickSavePath' && save.options.defaultPath === 'Duplex.pdf' && save.options.filters?.[0]?.extensions.join() === 'pdf', save);
  const pdfText = (await fs.readFile(pdfPath).catch(() => Buffer.alloc(0))).toString('latin1');
  smoke.check('the PDF has a page per level', pdfText.startsWith('%PDF-') && /\/Count 2 /.test(pdfText));
  smoke.check('the toast names the folder', ((await smoke.text('[data-testid=toast-message]')) ?? '').includes(out));
  await smoke.click('[data-testid=toast-action]', 'Show');
  smoke.check('its Show action reveals the file in the file manager', smoke.dialogs.revealed.at(-1) === pdfPath, smoke.dialogs.revealed);

  const pngPath = path.join(out, 'Dialog.png');
  smoke.check('the dialog opens again', await openExport());
  await smoke.click('[data-testid=export-format-png]');
  await smoke.waitFor('[data-testid=export-size]');
  await smoke.fill('[data-testid=export-size]', 'custom');
  smoke.check('a custom size shows width and height', await smoke.waitFor('[data-testid=export-width]', 2000));
  await smoke.fill('[data-testid=export-width]', '20');
  smoke.check('a width under 64 px is refused', await smoke.until(() => smoke.js<boolean>(`document.querySelector('[data-testid=export-confirm]').disabled`), 2000));
  await smoke.fill('[data-testid=export-width]', '320');
  await smoke.fill('[data-testid=export-height]', '240');
  await smoke.fill('[data-testid=export-theme]', 'dark');
  await smoke.until(() => smoke.js<boolean>(`!document.querySelector('[data-testid=export-confirm]').disabled`), 2000);
  await smoke.shots('44-export-dialog-png');
  smoke.check('a dark 320 × 240 PNG is written', await exportTo(pngPath));
  const pngBytes = new Uint8Array(await fs.readFile(pngPath).catch(() => Buffer.alloc(0)));
  const head = readPngHeader(pngBytes);
  smoke.check('its IHDR says 320 × 240 and its corner is the dark paper', head?.width === 320 && head.height === 240 && corner(pngBytes) === '#1d1a17/255', { head, corner: corner(pngBytes) });

  const glbPath = path.join(out, 'Dialog.glb');
  await openExport();
  // The last answer was a dark PNG, but the theme starts as the app's each time.
  await smoke.click('[data-testid=export-format-png]');
  await smoke.waitFor('[data-testid=export-theme]', 2000);
  const appTheme = (await smoke.js<boolean>(`document.documentElement.classList.contains('dark')`)) ? 'dark' : 'light';
  const startTheme = await smoke.js<string>(`document.querySelector('[data-testid=export-theme]').value`);
  smoke.check("the PNG theme starts as the app's (light), not the last answer (dark)", appTheme === 'light' && startTheme === 'light', { appTheme, startTheme });
  await smoke.click('[data-testid=export-format-glb]');
  smoke.check('glTF offers furniture and finishes, both ticked', (await smoke.waitFor('[data-testid=export-include-items]', 2000)) && (await checked('export-include-items')) && (await checked('export-include-finishes')));
  smoke.check('and the levels', await has('[data-testid=export-levels-current]'));
  await smoke.click('[data-testid=export-levels-current]');
  smoke.check('the current level makes one model of it', await smoke.waitFor('[data-testid=export-levels-hint]', 2000, 'One model of this level'));
  smoke.check('a glTF of the level on screen is written', await exportTo(glbPath));
  const glb = await fs.readFile(glbPath).catch(() => Buffer.alloc(0));
  smoke.check('it is a GLB, named after the project', glb.subarray(0, 4).toString('latin1') === 'glTF' && smoke.dialogs.asked.at(-1)?.options.defaultPath === 'Duplex.glb');
  const duplex = smoke.host.projects.session(duplexId)!.doc;
  const onScreen = duplex.levels[(await canvasAttr(smoke, 'level')) ?? '']?.name;
  const glbNodes = glbNodeNames(glb);
  const levelNodes = duplex.building.stack.map((id) => duplex.levels[id].name).filter((name) => glbNodes.includes(name));
  smoke.check('with the level on screen only', onScreen !== undefined && levelNodes.join() === onScreen, { onScreen, levelNodes });

  // The duplex is 10.2 m wide: at 1:50 it is wider than A4 portrait's 190 mm drawing area.
  const svgPath = path.join(out, 'Dialog.svg');
  await openExport();
  await smoke.click('[data-testid=export-format-svg]');
  await smoke.waitFor('[data-testid=export-sheet]', 2000);
  await smoke.click('[data-testid=export-levels-current]');
  await smoke.fill('[data-testid=export-page]', 'A4');
  await smoke.fill('[data-testid=export-orientation]', 'portrait');
  await smoke.fill('[data-testid=export-scale]', '50');
  smoke.check('an SVG of the level on screen at 1:50 on A4 portrait is written', await exportTo(svgPath));
  smoke.check('the toast says the level does not fit the sheet at that scale', ((await smoke.text('[data-testid=toast-message]')) ?? '').includes('does not fit the sheet at 1:50'), await smoke.text('[data-testid=toast-message]'));
  await dismissToasts(smoke);

  // A DXF of every level writes `Duplex - <level>.dxf` files, which the command smoke wrote already: the UI asks first.
  const dxfBase = path.join(out, 'Duplex.dxf');
  const levelFiles = duplex.building.stack.map((id) => path.join(out, `Duplex - ${duplex.levels[id].name}.dxf`));
  const marked = levelFiles.at(-1)!;
  await fs.writeFile(marked, 'not replaced');
  const askReplace = async () => {
    await openExport();
    await smoke.click('[data-testid=export-format-dxf]');
    await smoke.waitFor('[data-testid=export-levels-all]', 2000);
    await smoke.click('[data-testid=export-levels-all]');
    await dismissToasts(smoke);
    smoke.nextDialogPath(dxfBase);
    await smoke.click('[data-testid=export-confirm]');
    return smoke.waitFor('x-dialog-host [data-testid=confirm-details]', 10_000);
  };
  const listed = (await askReplace()) ? ((await smoke.text('x-dialog-host [data-testid=confirm-details]')) ?? '') : '';
  smoke.check('a DXF of every level over files already there asks before replacing them, naming each', levelFiles.every((f) => listed.includes(path.basename(f))), listed);
  await smoke.shots('46-export-overwrite');
  await smoke.click('x-dialog-host button', 'Cancel');
  smoke.check('Cancel writes nothing and the button is ready again', (await smoke.gone('x-dialog-host [data-testid=confirm-details]')) && (await idle()) && (await fs.readFile(marked, 'utf8')) === 'not replaced' && !(await smoke.waitFor('[data-testid=toast-message]', 500, 'Exported')));
  smoke.check('asked again', await askReplace());
  await smoke.click('x-dialog-host button', 'Replace');
  smoke.check('Replace writes both files', (await smoke.waitFor('[data-testid=toast-message]', 15_000, 'Exported 2 files to')) && (await fs.readFile(marked, 'utf8')).includes('SECTION'));
  await dismissToasts(smoke);

  // While the command runs, the toolbar's Export… is disabled and shows a spinner and "Exporting…" (watched by an observer, since a render may be quick).
  const busyPath = path.join(out, 'Busy.png');
  await openExport();
  await smoke.click('[data-testid=export-format-png]');
  await smoke.waitFor('[data-testid=export-size]', 2000);
  await smoke.fill('[data-testid=export-size]', '2560x1920');
  await smoke.js(`(() => {
    const b = document.querySelector(${JSON.stringify(exportButton)});
    window.__exportBusy = [];
    window.__exportObserver?.disconnect();
    window.__exportObserver = new MutationObserver(() => { if (b.getAttribute('aria-busy') === 'true') window.__exportBusy.push({ disabled: b.disabled, text: b.textContent.trim(), spinner: !!b.querySelector('.animate-spin') }); });
    window.__exportObserver.observe(b, { attributes: true, childList: true, subtree: true, characterData: true });
  })()`);
  smoke.check('a 2560 × 1920 PNG is written', await exportTo(busyPath));
  const busy = await smoke.js<{ disabled: boolean; text: string; spinner: boolean }[]>('(() => { window.__exportObserver?.disconnect(); return window.__exportBusy; })()');
  smoke.check('while it ran, Export… was disabled with a spinner and said Exporting…', busy.some((b) => b.disabled && b.spinner && b.text === 'Exporting…'), busy);
  smoke.check('and is ready again once it returned', await idle());
  await dismissToasts(smoke);

  smoke.section('exchange: the DXF import dialog');
  const dxfFile = path.join(out, 'Duplex - Ground floor.dxf');
  const project = await smoke.run<{ id: string }>('project.create', { name: 'DXF dialog', open: true });
  const projectId = project.id;
  try {
    smoke.check('a throwaway project opens', await openProjectTab(smoke, projectId));
    await smoke.until(async () => (await canvasAttr(smoke, 'entities')) !== undefined, 10_000);
    const before = Number(await canvasAttr(smoke, 'entities'));

    // The Layers panel's add menu offers it too: here the picker is cancelled, so nothing follows.
    const pickedBefore = smoke.dialogs.asked.length;
    await smoke.click(`${tab} [data-testid=layer-add]`);
    smoke.check('the Layers panel add menu has Import DXF…', await smoke.waitFor('[data-testid=layer-add-dxf]', 2000));
    smoke.nextDialogPath(undefined);
    await smoke.click('[data-testid=layer-add-dxf]');
    const picked = await smoke.until(() => smoke.dialogs.asked.length > pickedBefore, 3000);
    const pick = smoke.dialogs.asked.at(-1);
    smoke.check('which asks for a DXF file, and a cancelled picker stops there', picked && pick?.kind === 'pickFile' && pick.options.filters?.[0]?.extensions.join() === 'dxf' && !(await has('[data-testid=import-dxf-dialog]')), pick);

    // A file that is not a DXF: the probe refuses it, the error shows in a toast, and no dialog opens.
    await dismissToasts(smoke);
    smoke.nextDialogPath(pngPath);
    await smoke.click(`${tab} [data-testid=exchange-import-dxf]`);
    smoke.check('a picked file that is not a DXF gives an error toast and no dialog', (await smoke.waitFor('[data-testid=toast-message]', 10_000, 'is not a DXF file')) && !(await has('[data-testid=import-dxf-dialog]')), await smoke.text('[data-testid=toast-message]'));
    await dismissToasts(smoke);

    const openImport = async () => {
      smoke.nextDialogPath(dxfFile);
      await smoke.click(`${tab} [data-testid=exchange-import-dxf]`);
      return smoke.waitFor('[data-testid=import-dxf-dialog]', 10_000);
    };
    const untouched = async () => Number(await canvasAttr(smoke, 'entities')) === before && !(await has(`${tab} [data-testid=layer-row][data-name="DXF Walls"]`));
    smoke.check('the import dialog opens', await openImport());
    smoke.check('with focus on its first field, the scale', await smoke.until(async () => (await focusInfo(smoke)).testId === 'import-dxf-scale', 2000), await focusInfo(smoke));
    smoke.check('labelled by its heading', (await dialogLabel(smoke)) === 'Import DXF');
    await smoke.key('Escape');
    smoke.check('Escape closes it and imports nothing', (await smoke.gone('[data-testid=import-dxf-dialog]')) && (await untouched()));
    await openImport();
    await smoke.click('[data-testid=import-dxf-dialog] button', 'Cancel');
    smoke.check('so does Cancel', (await smoke.gone('[data-testid=import-dxf-dialog]')) && (await untouched()));

    await dismissToasts(smoke);
    smoke.nextDialogPath(dxfFile);
    await smoke.click(`${tab} [data-testid=exchange-import-dxf]`);
    smoke.check('Import DXF… shows the import dialog after probing the file', await smoke.waitFor('[data-testid=import-dxf-dialog]', 10_000));
    // The scale comes from the file's units (millimetres: 1) and the extent follows an edit of it.
    const scaleValue = () => smoke.js<string>(`document.querySelector('[data-testid=import-dxf-scale]').value`);
    const extentText = () => smoke.text('[data-testid=import-dxf-extent]');
    const extent1 = await extentText();
    smoke.check('the scale is prefilled from the units', (await scaleValue()) === '1', await scaleValue());
    await smoke.fill('[data-testid=import-dxf-scale]', '10');
    smoke.check('editing it rescales the extent', await smoke.until(async () => (await extentText()) !== extent1, 2000), { extent1, extent10: await extentText() });
    await smoke.fill('[data-testid=import-dxf-scale]', '1');
    smoke.check('and back', await smoke.until(async () => (await extentText()) === extent1, 2000));
    smoke.check('it shows the units, millimetres', (await smoke.text('[data-testid=import-dxf-units]')) === 'millimetres');
    const layers = await smoke.js<{ name: string; count: number; checked: boolean }[]>(
      `[...document.querySelectorAll('[data-testid=import-dxf-layer]')].map((r) => ({ name: r.dataset.name, count: Number(r.querySelector('[data-testid=import-dxf-count]').textContent), checked: r.querySelector('input').checked }))`,
    );
    smoke.check('and the layers with their entity counts, all ticked', layers.some((l) => l.name === 'Walls' && l.count > 0) && layers.some((l) => l.name === 'Stairs and lifts' && l.count > 0) && layers.every((l) => l.checked), layers);
    smoke.check('what it skips (the hatch) and the extent', ((await smoke.text('[data-testid=import-dxf-skipped]')) ?? '').includes('HATCH') && ((await smoke.text('[data-testid=import-dxf-extent]')) ?? '').includes('×'));
    smoke.check('the level on screen is the target', (await smoke.js<string>(`document.querySelector('[data-testid=import-dxf-level]').value`)) === smoke.host.projects.session(projectId)?.doc.building.groundLevelId);
    await smoke.shots('45-import-dxf-dialog');
    await smoke.click('[data-testid=import-dxf-confirm]');
    smoke.check('the import says what it brought in', await smoke.waitFor('[data-testid=toast-message]', 15_000, 'Imported'));
    const message = (await smoke.text('[data-testid=toast-message]')) ?? '';
    smoke.check('with shapes, dividers and labels', /\d+ shapes?, \d+ dividers? and \d+ labels? on \d+ layers?/.test(message), message);
    smoke.check('the Layers panel lists DXF Walls', await smoke.waitFor(`${tab} [data-testid=layer-row][data-name="DXF Walls"]`, 5000));
    smoke.check('and the canvas draws the drawing', await smoke.until(async () => Number(await canvasAttr(smoke, 'entities')) > before, 5000), { before, after: await canvasAttr(smoke, 'entities') });
    await dismissToasts(smoke);
    await smoke.click(`${tab} [data-testid=project-undo]`);
    smoke.check('one undo removes the import and its layers', (await smoke.gone(`${tab} [data-testid=layer-row][data-name="DXF Walls"]`)) && (await smoke.until(async () => Number(await canvasAttr(smoke, 'entities')) === before, 5000)));

    // From the Layers panel, the import goes to the panel's level: here an upper one.
    const upper = (await smoke.run<{ id: string }>('building.level.add', { name: 'Upper' }, { projectId })).id;
    await smoke.waitFor(`${tab} [data-testid=plan-level] option[value="${upper}"]`);
    await smoke.fill(`${tab} [data-testid=plan-level]`, upper);
    await smoke.until(async () => (await canvasAttr(smoke, 'level')) === upper, 5000);
    await smoke.click(`${tab} [data-testid=layer-add]`);
    await smoke.waitFor('[data-testid=layer-add-dxf]', 2000);
    smoke.nextDialogPath(dxfFile);
    await smoke.click('[data-testid=layer-add-dxf]');
    smoke.check('Import DXF… in the Layers panel of an upper level opens the dialog', await smoke.waitFor('[data-testid=import-dxf-dialog]', 10_000));
    smoke.check('targeting that level', (await smoke.js<string>(`document.querySelector('[data-testid=import-dxf-level]').value`)) === upper);
    await smoke.key('Escape');
    await smoke.gone('[data-testid=import-dxf-dialog]');
  } finally {
    await smoke.run('project.close', { id: projectId });
    await smoke.run('project.trash', { id: projectId });
    await smoke.run('project.delete', { id: projectId });
    await dismissToasts(smoke);
  }
}
