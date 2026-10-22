import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { DesignDescription, Entity, ProjectDoc } from '@studio/core';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, openProjectTab, tab, view } from './plan-canvas';
import { readOrbit, sceneAttr, sceneCanvas, sceneView, type Vec3 } from './scene-canvas';

type Wall = Extract<Entity, { type: 'wall' }>;
type Room = Extract<Entity, { type: 'room' }>;

/** How much redder than blue a pixel is: a warm finish (terracotta, timber) against a grey one. */
const warmth = (rgb: string | null) => {
  const [r, , b] = (rgb ?? '0,0,0').split(',').map(Number);
  return r - b;
};

/**
 * Finishes with real input, in the furnished flat: a wall face painted from the 3D view by a click on
 * it (its colour read back, the other face untouched), the room's floor in timber by command and seen
 * from above, an agent finishing the room's walls over MCP in one undoable change, and the plan's
 * Paint tool giving a floor a material by a click.
 */
export async function smokeDecorFinishesUi(smoke: Smoke, flatId: string): Promise<void> {
  smoke.section('finishes from the 3D view');
  const doc = () => smoke.host.projects.session(flatId)!.doc as ProjectDoc;
  const ground = doc().building.groundLevelId;
  const entities = () => doc().levelData[ground].entities;
  const walls = () => Object.values(entities()).filter((e): e is Wall => e.type === 'wall');
  const south = () => walls().find((w) => w.path.v[0].p[0] === 0 && w.path.v[0].p[1] === 0)!;
  const room = () => Object.values(entities()).find((e): e is Room => e.type === 'room')!;

  smoke.check('the flat is on screen', await openProjectTab(smoke, flatId));
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  await smoke.until(async () => Number(await sceneAttr(smoke, 'meshes')) > 0, 10_000);
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  await smoke.click(`${tab} [data-testid=scene-preset-front]`);
  await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 270);
  await wait(150);
  let v = await sceneView(smoke);
  // The south wall's outside face, west of the door.
  const onFace: Vec3 = [1200, -101, 1500];
  const plain = await v.pixel(onFace);
  await smoke.click(`${tab} [data-testid=right-tab-catalog]`);
  await smoke.click(`${tab} [data-testid=catalog-tab-material]`);
  await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="builtin:paint-terracotta"]`);
  await smoke.click(`${tab} [data-testid=catalog-card][data-ref="builtin:paint-terracotta"]`);
  smoke.check('a material picked in the Catalog panel arms painting in 3D', await smoke.until(async () => (await sceneAttr(smoke, 'paint')) === 'builtin:paint-terracotta') && (await smoke.waitFor(`${tab} [data-testid=scene-painting]`, 3000, 'Terracotta paint')));
  const at = v.at(onFace);
  await smoke.clickAt(at.x, at.y);
  smoke.check('a click on a wall face in 3D paints that face', await smoke.until(() => south().materials?.right === 'builtin:paint-terracotta'), south().materials);
  smoke.check('and not the other face of the wall', !south().materials?.left);
  const painted = await smoke.until(async () => warmth(await v.pixel(onFace)) > warmth(plain) + 40);
  smoke.check('the face shows the colour', painted, { plain, now: await v.pixel(onFace) });
  await smoke.js(`document.querySelector('${sceneCanvas}').focus()`);
  await smoke.key('Escape');
  smoke.check('Escape stops painting', await smoke.until(async () => (await sceneAttr(smoke, 'paint')) === ''));
  await smoke.shots('56-decor-finish-wall');

  smoke.section('room finishes');
  await smoke.click(`${tab} [data-testid=scene-preset-top]`);
  await smoke.until(async () => (await readOrbit(smoke))?.elevation === 89);
  await wait(150);
  v = await sceneView(smoke);
  const onFloor: Vec3 = [1500, 900, 2];
  const slab = await v.pixel(onFloor);
  await smoke.run('decor.material.set', { target: { roomId: room().id, surface: 'floor' }, material: 'builtin:oak-floor' }, { projectId: flatId });
  smoke.check('a timber floor set by command shows from above', await smoke.until(async () => warmth(await v.pixel(onFloor)) > warmth(slab) + 30), { slab, now: await v.pixel(onFloor) });

  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-decorator', version: '2.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${flatId}`)));
  const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
  const set = text(await agent.callTool({ name: 'decor_material_set', arguments: { target: { roomId: room().id, surface: 'walls' }, material: 'builtin:paint-sage', projectId: flatId } })) as { changed: { wallId: string; side: string }[] };
  smoke.check("an agent finishes the room's walls: every face that looks into it", set.changed?.length === 4 && walls().every((w) => w.materials?.left === 'builtin:paint-sage'), set);
  smoke.check('the outside keeps its own finish', south().materials?.right === 'builtin:paint-terracotta');
  const described = text(await agent.callTool({ name: 'plan_describe', arguments: { projectId: flatId } })) as unknown as DesignDescription;
  const finish = described.levels[0].rooms[0].finish;
  smoke.check('plan.describe reports the finishes', finish.floor === 'builtin:oak-floor' && finish.walls === 'builtin:paint-sage' && finish.ceiling === null, finish);
  await agent.close();
  await smoke.shots('57-decor-finishes');
  await smoke.run('edit.undo', {}, { projectId: flatId });
  smoke.check('one undo takes the four faces back', walls().every((w) => !w.materials?.left) && south().materials?.right === 'builtin:paint-terracotta', walls().map((w) => w.materials));

  smoke.section('the Paint tool on the plan');
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.waitFor(canvas);
  await smoke.click(`${tab} [data-testid=catalog-card][data-ref="builtin:tile-white"]`);
  smoke.check('a material picked with the plan on screen picks the Paint tool', (await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'paint')) && (await smoke.waitFor(`${tab} [data-testid=paint-armed]`, 3000, 'White tiles')));
  const pv = await view(smoke);
  // Clear floor, away from the furniture.
  const p = pv.at([5500, 500]);
  await smoke.mouseMove(p.x, p.y);
  await smoke.clickAt(p.x, p.y);
  smoke.check("a click on the room paints its floor", await smoke.until(() => room().finish?.floor === 'builtin:tile-white'), room().finish);
  await smoke.key('Escape');
  smoke.check('Escape ends the Paint tool and painting', (await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select')) && (await smoke.until(async () => (await smoke.count(`${tab} [data-testid=catalog-card][data-ref="builtin:tile-white"].border-accent`)) === 0)));
  await smoke.click(`${tab} [data-testid=catalog-tab-item]`);
}
