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
  smoke.check('the light plan has the light paper in its corner, opaque', corners.light === '#f7f7f5/255', corners);
  smoke.check('the dark plan differs and has the dark paper in its corner', !Buffer.from(dark).equals(Buffer.from(light)) && corners.dark === '#17181a/255', corners);
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

/**
 * The Export dialog and the DXF import as a user drives them, with the native pickers answered by the
 * smoke's stand-in (`smoke.nextDialogPath`): the dialog opens from the project tab's toolbar and
 * shows only the chosen format's fields; a PDF of every level fitted to the page, a dark 320 × 240
 * PNG and a glTF are written where the picker said, each with a toast whose Show reveals the file; the
 * DXF import dialog shows the probe (units, layers with counts, what is skipped), imports onto the
 * level on screen (the Layers panel lists `DXF Walls`, the canvas draws more entities) and one undo
 * takes it back. The import goes into a throwaway project, deleted at the end.
 */
export async function smokeExchangeDialogs(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('exchange: the Export dialog');
  const out = path.join(smoke.host.opts.userDataDir, 'exports');
  const dialog = '[data-testid=export-dialog]';
  const has = (selector: string) => smoke.js<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
  const checked = (testId: string) => smoke.js<boolean>(`document.querySelector('[data-testid=${testId}]')?.checked === true`);
  const openExport = async () => {
    await dismissToasts(smoke);
    await smoke.click(`${tab} [data-testid=exchange-export]`);
    return smoke.waitFor(dialog);
  };
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
    glb: { levels: false, sheet: false, glb: true, png: false },
    png: { levels: false, sheet: false, glb: false, png: true },
    pdf: { levels: true, sheet: true, glb: false, png: false },
  };
  smoke.check('each format shows only its own fields', JSON.stringify(shown) === JSON.stringify(expected), shown);
  smoke.check('PDF of every level says one file with a page per level', ((await smoke.text('[data-testid=export-levels-hint]')) ?? '').includes('a page per level (2)'));
  await smoke.shots('43-export-dialog-pdf');

  const asked = smoke.dialogs.asked.length;
  await smoke.click(`${dialog} button`, 'Cancel');
  smoke.check('Cancel closes the dialog without asking where to save', (await smoke.gone(dialog)) && smoke.dialogs.asked.length === asked);

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
  smoke.check('its IHDR says 320 × 240 and its corner is the dark paper', head?.width === 320 && head.height === 240 && corner(pngBytes) === '#17181a/255', { head, corner: corner(pngBytes) });

  const glbPath = path.join(out, 'Dialog.glb');
  await openExport();
  await smoke.click('[data-testid=export-format-glb]');
  smoke.check('glTF offers furniture and finishes, both ticked', (await smoke.waitFor('[data-testid=export-include-items]', 2000)) && (await checked('export-include-items')) && (await checked('export-include-finishes')));
  smoke.check('a glTF of the building is written', await exportTo(glbPath));
  const glb = await fs.readFile(glbPath).catch(() => Buffer.alloc(0));
  smoke.check('it is a GLB, named after the project', glb.subarray(0, 4).toString('latin1') === 'glTF' && smoke.dialogs.asked.at(-1)?.options.defaultPath === 'Duplex.glb');

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

    await dismissToasts(smoke);
    smoke.nextDialogPath(dxfFile);
    await smoke.click(`${tab} [data-testid=exchange-import-dxf]`);
    smoke.check('Import DXF… shows the import dialog after probing the file', await smoke.waitFor('[data-testid=import-dxf-dialog]', 10_000));
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
  } finally {
    await smoke.run('project.close', { id: projectId });
    await smoke.run('project.trash', { id: projectId });
    await smoke.run('project.delete', { id: projectId });
    await dismissToasts(smoke);
  }
}
