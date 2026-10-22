import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { DesignDescription, Entity, ProjectDoc } from '@studio/core';
import type { Smoke } from './harness';
import { decorRoom } from './decor-ui';
import { openProjectTab } from './plan-canvas';

type ImageContent = { type: string; data?: string; mimeType?: string; text?: string };

/** The mean of a PNG's bytes is no measure of light, so compare two snapshots by their decoded pixels in the window. */
async function meanLightness(smoke: Smoke, base64: string): Promise<number> {
  return smoke.js<number>(`new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      resolve(sum / (d.length / 4) / 3);
    };
    img.onerror = () => resolve(-1);
    img.src = 'data:image/png;base64,${base64}';
  })`);
}

/**
 * An agent furnishing a room over MCP, as the furnish-room prompt asks: a sofa, a coffee table and a
 * floor lamp with its light placed and the floor finished in one plan_apply; plan_describe listing
 * them in the room with its finish; snapshots of the plan and of the room in 3D by day and at night.
 */
export async function smokeDecorAgentUi(smoke: Smoke): Promise<void> {
  smoke.section('an agent furnishing a room');
  const lounge = await decorRoom(smoke, 'Agent Lounge');
  const doc = () => smoke.host.projects.session(lounge.id)!.doc as ProjectDoc;
  await openProjectTab(smoke, lounge.id);
  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-interior-designer', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${lounge.id}`)));
  const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
  const image = (r: unknown) => ((r as { content: ImageContent[] }).content ?? []).find((c) => c.type === 'image');

  const prompt = await agent.getPrompt({ name: 'furnish-room', arguments: { room: 'Living' } });
  smoke.check('the furnish-room prompt asks to furnish, light and finish the room', /the room "Living".*withLight.*decor_material_set/.test((prompt.messages[0].content as { text: string }).text));
  const emptyPlan = image(await agent.callTool({ name: 'view_snapshot', arguments: { levelId: lounge.ground } }));
  const applied = json(
    await agent.callTool({
      name: 'plan_apply',
      arguments: {
        label: 'Furnish the living room',
        steps: [
          { command: 'decor.item.place', input: { levelId: lounge.ground, ref: 'builtin:sofa-3', at: [3000, 3700], rotation: 180 } },
          { command: 'decor.item.place', input: { levelId: lounge.ground, ref: 'builtin:coffee-table', at: [3000, 2500] } },
          { command: 'decor.item.place', input: { levelId: lounge.ground, ref: 'builtin:floor-lamp', at: [1500, 3800], withLight: true } },
          { command: 'decor.material.set', input: { target: { roomId: lounge.roomId, surface: 'floor' }, material: 'builtin:oak-floor' } },
        ],
      },
    }),
  );
  const entities = Object.values(doc().levelData[lounge.ground].entities) as Entity[];
  smoke.check(
    'one plan_apply places three pieces, a light and a timber floor',
    applied.applied === true && entities.filter((e) => e.type === 'item').length === 3 && entities.filter((e) => e.type === 'light').length === 1 && (entities.find((e) => e.type === 'room') as { finish?: { floor?: string } }).finish?.floor === 'builtin:oak-floor',
    applied,
  );
  const history = await smoke.run<{ undo: { label: string; author: { kind: string } }[] }>('edit.history', {}, { projectId: lounge.id });
  smoke.check('as one undo step under the agent', history.undo[0]?.label === 'Furnish the living room' && history.undo[0].author.kind === 'mcp', history.undo[0]);
  const described = json(await agent.callTool({ name: 'plan_describe', arguments: {} })) as unknown as DesignDescription;
  const living = described.levels[0].rooms.find((r) => r.name === 'Living');
  smoke.check('plan.describe lists the furniture, the light and the finish in the room', living?.furniture.map((f) => f.name).sort().join() === 'Coffee table,Floor lamp,Sofa, 3 seats' && living.lights.length === 1 && living.lights[0].lumens === 1200 && living.finish.floor === 'builtin:oak-floor', living);
  const furnishedPlan = image(await agent.callTool({ name: 'view_snapshot', arguments: { levelId: lounge.ground } }));
  smoke.check('the plan snapshot shows the furniture', Boolean(emptyPlan?.data && furnishedPlan?.data) && emptyPlan!.data !== furnishedPlan!.data);
  const shot = (lighting: 'day' | 'night') => agent.callTool({ name: 'view_snapshot', arguments: { view: '3d', display: 'cutaway', levelId: lounge.ground, elevation: 55, lighting, width: 640, height: 480 } });
  const day = image(await shot('day'));
  const night = image(await shot('night'));
  smoke.check('the 3D snapshots by day and at night are images, and differ', day?.mimeType === 'image/png' && night?.mimeType === 'image/png' && day.data !== night.data);
  const dayLight = day?.data ? await meanLightness(smoke, day.data) : -1;
  const nightLight = night?.data ? await meanLightness(smoke, night.data) : -1;
  smoke.check('the night one is darker', nightLight >= 0 && nightLight < dayLight - 40, { dayLight, nightLight });
  await agent.close();
  if (smoke.shotsDir && day?.data && night?.data) {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    await fs.writeFile(path.join(smoke.shotsDir, '58-snapshot-3d-day.png'), Buffer.from(day.data, 'base64'));
    await fs.writeFile(path.join(smoke.shotsDir, '59-snapshot-3d-night.png'), Buffer.from(night.data, 'base64'));
  }
  await smoke.run('project.close', { id: lounge.id });
}
