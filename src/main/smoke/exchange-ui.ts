import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { pngTopLeftPixel, readPngHeader } from '@studio/core';
import type { Smoke } from './harness';

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
    await fs.writeFile(path.join(smoke.shotsDir, '36-export-plan-dark.png'), dark);
    await fs.writeFile(path.join(smoke.shotsDir, '36-export-3d.png'), buildingBytes);
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
