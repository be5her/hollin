import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { inspectGlb, readDxfEntities, readGlbChunks, readGlbTriangles, xmlEscape } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

type Exported = { format: string; files: { path: string; levelId?: string; bytes: number }[]; levels: { levelId: string; name: string; scale: number }[] };
type GlbExported = { path: string; bytes: number; nodes: number; triangles: number; skipped: string[] };

/** The node names of a GLB file. */
const glbNodeNames = (bytes: Uint8Array) => (readGlbChunks(bytes).json.nodes ?? []).map((n) => (n as { name?: string }).name ?? '');

/**
 * Plan exports through commands and MCP: the duplex as DXF (a file per level that reads back), SVG
 * (a file per level naming it) and PDF (one file, a page per level), announced with
 * `exchange.exported`; the building as a GLB with its levels, stair and elevator as named nodes; over
 * MCP both exports are refused until mutations are allowed.
 */
export async function smokeExchange(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('exchange');
  const out = path.join(smoke.host.opts.userDataDir, 'exports');
  await fs.mkdir(out, { recursive: true });
  const doc = (await smoke.host.resolveProject(duplexId))!.doc;
  const names = doc.building.stack.map((id) => doc.levels[id].name);
  const run = <T = unknown>(input: unknown) => smoke.run<T>('export.plan', input, { projectId: duplexId });

  const from = smoke.events.length;
  const dxf = await run<Exported>({ path: path.join(out, 'Duplex.dxf'), format: 'dxf' });
  smoke.check('DXF writes a file per level, bottom to top, named after the level', dxf.files.length === 2 && dxf.files.every((f, i) => f.path.endsWith(` - ${names[i]}.dxf`) && f.levelId === doc.building.stack[i]), dxf.files);
  let dxfOk = true;
  for (const f of dxf.files) {
    const read = readDxfEntities(await fs.readFile(f.path, 'utf8'));
    dxfOk &&= read.insUnits === 4 && read.layers.includes('Walls') && read.entities.some((e) => e.layer === 'Walls' && e.type === 'LWPOLYLINE') && read.entities.some((e) => e.layer === 'Stairs and lifts');
  }
  smoke.check('each DXF reads back in millimetres with its walls and the stair', dxfOk);

  const svg = await run<Exported>({ path: path.join(out, 'Duplex.svg'), format: 'svg', fit: true });
  let svgOk = svg.files.length === 2;
  for (const [i, f] of svg.files.entries()) {
    const content = await fs.readFile(f.path, 'utf8');
    svgOk &&= content.includes('<svg ') && content.includes('width="420mm"') && content.includes(`>${xmlEscape(names[i])}</text>`) && content.includes('data-layer="Walls"') && content.includes('>Duplex</text>');
  }
  smoke.check('SVG writes an A3 sheet per level with its name, its layers and the title block', svgOk, svg);
  smoke.check('and fits a standard scale', svg.levels.every((l) => [20, 25, 50, 100, 200, 250, 500, 1000].includes(l.scale)), svg.levels);

  const pdfPath = path.join(out, 'Duplex.pdf');
  const pdf = await run<Exported>({ path: pdfPath, format: 'pdf', page: 'A4', scale: 100 });
  const bytes = await fs.readFile(pdfPath);
  const pdfText = bytes.toString('latin1');
  smoke.check('PDF writes one file with a page per level', pdf.files.length === 1 && pdf.files[0].bytes === bytes.length && pdfText.startsWith('%PDF-1.4') && pdfText.trimEnd().endsWith('%%EOF') && /\/Count 2 /.test(pdfText) && pdfText.match(/\/Type \/Page /g)?.length === 2, pdf);
  smoke.check('its content streams are compressed', pdfText.match(/\/Filter \/FlateDecode/g)?.length === 2);
  const announced = smoke.eventsSince(from, 'exchange.exported').filter((e) => e.projectId === duplexId);
  smoke.check('every export is announced with its files', announced.map((e) => `${e.format}:${e.files.length}`).join() === 'dxf:2,svg:2,pdf:1', announced);

  const glbPath = path.join(out, 'Duplex.glb');
  const glbFrom = smoke.events.length;
  const glb = await smoke.run<GlbExported>('export.building', { path: glbPath }, { projectId: duplexId });
  const glbBytes = new Uint8Array(await fs.readFile(glbPath));
  console.log(`Duplex.glb: ${glbBytes.length} bytes, ${glb.nodes} nodes, ${glb.triangles} triangles`);
  let glbInfo: ReturnType<typeof inspectGlb> | null = null;
  try {
    glbInfo = inspectGlb(glbBytes);
  } catch (err) {
    smoke.check('the GLB reads back', false, (err as Error).message);
  }
  smoke.check('GLB writes one file that reads back with every triangle', glb.bytes === glbBytes.length && glbInfo?.triangles === glb.triangles && glb.triangles > 0 && glb.skipped.length === 0, { glb, glbInfo });
  const glbNames = glbNodeNames(glbBytes);
  smoke.check('its nodes: the project, each level, the stair and the elevator', glbNames[0] === 'Duplex' && names.every((n) => glbNames.includes(n)) && glbNames.includes('Stair') && glbNames.includes('Elevator') && glbNames.length === glb.nodes, glbNames);
  smoke.check('it is in metres with y up (read back in mm, z up, the duplex is a few metres)', Boolean(glbInfo) && glbInfo!.size[0] > 3000 && glbInfo!.size[0] < 100000 && glbInfo!.size[2] > 2000 && glbInfo!.min[2] < 1 && glbInfo!.min[2] > -2000, glbInfo);
  const upperOnly = await smoke.run<GlbExported>('export.building', { path: path.join(out, 'Upper.glb'), levelIds: [doc.building.stack[1]] }, { projectId: duplexId });
  const upperNames = glbNodeNames(new Uint8Array(await fs.readFile(upperOnly.path)));
  smoke.check('levelIds limits the export, connectors going with the level they start on', upperNames.includes(names[1]) && !upperNames.includes(names[0]) && !upperNames.includes('Stair') && upperOnly.triangles < glb.triangles, upperNames);
  smoke.check('the GLB export is announced', smoke.eventsSince(glbFrom, 'exchange.exported').some((e) => e.format === 'glb' && e.files.join() === glbPath));
  await smoke.expectError('a relative GLB path is refused', 'export.building', { path: 'Duplex.glb' }, 'INVALID_INPUT', { projectId: duplexId });
  await smoke.expectError('a GLB of an unknown level is refused', 'export.building', { path: path.join(out, 'x.glb'), levelIds: ['lvl_0000000000000000'] }, 'NOT_FOUND', { projectId: duplexId });
  await smoke.expectError('a relative path is refused', 'export.plan', { path: 'Duplex.pdf', format: 'pdf' }, 'INVALID_INPUT', { projectId: duplexId });
  await smoke.expectError('an unknown level is refused', 'export.plan', { path: path.join(out, 'x.pdf'), format: 'pdf', levelIds: ['lvl_0000000000000000'] }, 'NOT_FOUND', { projectId: duplexId });

  smoke.section('exchange over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-exporter', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${duplexId}`)));
  const { tools } = await agent.listTools();
  const tool = tools.find((t) => t.name === 'export_plan');
  smoke.check('export_plan is a tool, marked destructive', tool?.annotations?.destructiveHint === true, tool?.annotations);
  smoke.check('export_building is a tool, marked destructive', tools.find((t) => t.name === 'export_building')?.annotations?.destructiveHint === true);
  const agentPath = path.join(out, 'Agent.pdf');
  const blocked = await agent.callTool({ name: 'export_plan', arguments: { path: agentPath, format: 'pdf' } });
  smoke.check('an agent is refused the export while mutations are off', blocked.isError === true && text(blocked).code === 'MUTATION_BLOCKED' && !(await exists(agentPath)), text(blocked));
  const agentGlb = path.join(out, 'Agent.glb');
  const blockedGlb = await agent.callTool({ name: 'export_building', arguments: { path: agentGlb } });
  smoke.check('and the GLB export too', blockedGlb.isError === true && text(blockedGlb).code === 'MUTATION_BLOCKED' && !(await exists(agentGlb)), text(blockedGlb));
  await smoke.run('config.update', { patch: { mcp: { allowMutations: true } } });
  try {
    const before = smoke.events.length;
    const allowed = text(await agent.callTool({ name: 'export_plan', arguments: { path: agentPath, format: 'pdf', levelIds: [doc.building.stack[1]], fit: true } })) as unknown as Exported;
    const head = (await fs.readFile(agentPath)).subarray(0, 8).toString('latin1');
    smoke.check('once allowed, an agent exports one level as a PDF', allowed.files?.length === 1 && head.startsWith('%PDF-1.4') && allowed.levels?.[0]?.name === names[1], allowed);
    smoke.check('and the export is announced', await smoke.until(() => smoke.eventsSince(before, 'exchange.exported').some((e) => e.files.includes(agentPath))));
    const allowedGlb = text(await agent.callTool({ name: 'export_building', arguments: { path: agentGlb, includeItems: false } })) as unknown as GlbExported;
    const agentBytes = new Uint8Array(await fs.readFile(agentGlb).catch(() => Buffer.alloc(0)));
    smoke.check('once allowed, an agent exports the building as a GLB', allowedGlb.bytes === agentBytes.length && glbNodeNames(agentBytes).includes('Stair'), allowedGlb);
    smoke.check('and that export is announced', await smoke.until(() => smoke.eventsSince(before, 'exchange.exported').some((e) => e.format === 'glb' && e.files.includes(agentGlb))));
  } finally {
    await smoke.run('config.update', { patch: { mcp: { allowMutations: false } } });
    await agent.close();
  }
  await smoke.run('project.close', { id: duplexId });
}

/**
 * The decor project as a GLB: its imported table is read from the project's assets and written with
 * the built-in furniture, and leaving the furniture out drops their triangles.
 */
export async function smokeExchangeDecor(smoke: Smoke, decorId: string): Promise<void> {
  smoke.section('exchange: decor as glTF');
  const out = path.join(smoke.host.opts.userDataDir, 'exports');
  await fs.mkdir(out, { recursive: true });
  const withItems = await smoke.run<GlbExported>('export.building', { path: path.join(out, 'Decor.glb') }, { projectId: decorId });
  const without = await smoke.run<GlbExported>('export.building', { path: path.join(out, 'Decor bare.glb'), includeItems: false }, { projectId: decorId });
  const bytes = new Uint8Array(await fs.readFile(withItems.path));
  console.log(`Decor.glb: ${withItems.bytes} bytes, ${withItems.nodes} nodes, ${withItems.triangles} triangles; without furniture ${without.bytes} bytes, ${without.triangles} triangles`);
  const names = glbNodeNames(bytes);
  smoke.check('the imported table is exported from the project assets, with the built-in furniture', withItems.skipped.length === 0 && names.includes('Smoke dining table') && names.includes('Sofa, 3 seats') && inspectGlb(bytes).triangles === withItems.triangles, { names, skipped: withItems.skipped });
  const tableTop = readGlbTriangles(bytes).filter((t) => t.material === 'top');
  smoke.check("the table's own material comes with it", tableTop.length === 1 && tableTop[0].positions.length === 12 * 9, tableTop.map((t) => t.positions.length));
  smoke.check('leaving the furniture out drops its triangles', without.triangles + 24 <= withItems.triangles && !glbNodeNames(new Uint8Array(await fs.readFile(without.path))).includes('Smoke dining table'), { with: withItems.triangles, without: without.triangles });
  await smoke.run('project.close', { id: decorId });
}
