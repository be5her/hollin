import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readDxfEntities, xmlEscape } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

type Exported = { format: string; files: { path: string; levelId?: string; bytes: number }[]; levels: { levelId: string; name: string; scale: number }[] };

/**
 * Plan exports through commands and MCP: the duplex as DXF (a file per level that reads back), SVG
 * (a file per level naming it) and PDF (one file, a page per level), announced with
 * `exchange.exported`; over MCP the export is refused until mutations are allowed.
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
  await smoke.expectError('a relative path is refused', 'export.plan', { path: 'Duplex.pdf', format: 'pdf' }, 'INVALID_INPUT', { projectId: duplexId });
  await smoke.expectError('an unknown level is refused', 'export.plan', { path: path.join(out, 'x.pdf'), format: 'pdf', levelIds: ['lvl_0000000000000000'] }, 'NOT_FOUND', { projectId: duplexId });

  smoke.section('exchange over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-exporter', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${duplexId}`)));
  const { tools } = await agent.listTools();
  const tool = tools.find((t) => t.name === 'export_plan');
  smoke.check('export_plan is a tool, marked destructive', tool?.annotations?.destructiveHint === true, tool?.annotations);
  const agentPath = path.join(out, 'Agent.pdf');
  const blocked = await agent.callTool({ name: 'export_plan', arguments: { path: agentPath, format: 'pdf' } });
  smoke.check('an agent is refused the export while mutations are off', blocked.isError === true && text(blocked).code === 'MUTATION_BLOCKED' && !(await exists(agentPath)), text(blocked));
  await smoke.run('config.update', { patch: { mcp: { allowMutations: true } } });
  try {
    const before = smoke.events.length;
    const allowed = text(await agent.callTool({ name: 'export_plan', arguments: { path: agentPath, format: 'pdf', levelIds: [doc.building.stack[1]], fit: true } })) as unknown as Exported;
    const head = (await fs.readFile(agentPath)).subarray(0, 8).toString('latin1');
    smoke.check('once allowed, an agent exports one level as a PDF', allowed.files?.length === 1 && head.startsWith('%PDF-1.4') && allowed.levels?.[0]?.name === names[1], allowed);
    smoke.check('and the export is announced', await smoke.until(() => smoke.eventsSince(before, 'exchange.exported').some((e) => e.files.includes(agentPath))));
  } finally {
    await smoke.run('config.update', { patch: { mcp: { allowMutations: false } } });
    await agent.close();
  }
  await smoke.run('project.close', { id: duplexId });
}
