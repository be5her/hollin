import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { wait, type Smoke } from './harness';

const tab = '[data-tab-type="project.editor"]:not(.hidden)';
const canvas = `${tab} [data-testid=plan-canvas]`;

type Camera = { x: number; y: number; scale: number };
type Rect = { x: number; y: number; width: number; height: number };

/** The plan view's camera, mirrored on the canvas as `data-camera="x,y,scale"`. */
async function readCamera(smoke: Smoke): Promise<Camera | null> {
  const attr = await smoke.js<string>(`document.querySelector('${canvas}')?.dataset.camera ?? ''`);
  if (!attr) return null;
  const [x, y, scale] = attr.split(',').map(Number);
  return { x, y, scale };
}

/** World mm to window pixels, the same mapping the renderer uses (y up in the world, down on screen). */
const toScreen = (rect: Rect, cam: Camera, p: [number, number]) => ({ x: rect.x + (p[0] - cam.x) * cam.scale + rect.width / 2, y: rect.y + (cam.y - p[1]) * cam.scale + rect.height / 2 });

const attr = (smoke: Smoke, name: string) => smoke.js<string | undefined>(`document.querySelector('${canvas}')?.dataset.${name}`);

/** The plan view driven with real pointer and keyboard input: level switching, underlay, pan and zoom, live agent edits. */
export async function smokePlanUi(smoke: Smoke, towerId: string): Promise<void> {
  const { host } = smoke;
  smoke.section('plan view');
  const doc = () => host.projects.session(towerId)!.doc;
  const ground = doc().building.groundLevelId;
  const gallery = Object.values(doc().levels).find((l) => l.name === 'Gallery')!.id;

  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  smoke.check('the plan is the main view', await smoke.waitFor(canvas));
  await smoke.fill(`${tab} [data-testid=plan-level]`, ground);
  smoke.check('the level switcher picks the level to draw', await smoke.until(async () => (await attr(smoke, 'level')) === ground));
  smoke.check('the levels panel follows the switcher', await smoke.waitFor(`${tab} [data-testid=level-row][data-name="Ground floor"][aria-selected=true]`));
  smoke.check('every entity of the level is drawn', await smoke.until(async () => (await attr(smoke, 'entities')) === '4'), await attr(smoke, 'entities'));

  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(100);
  let rect = (await smoke.rect(canvas))!;
  let cam = (await readCamera(smoke))!;
  const inside = (p: [number, number]) => {
    const s = toScreen(rect, cam, p);
    return s.x > rect.x && s.x < rect.x + rect.width && s.y > rect.y && s.y < rect.y + rect.height;
  };
  smoke.check('zoom to fit shows the whole floor', Boolean(cam) && inside([0, 0]) && inside([9000, 6000]), cam);

  const pixelAt = async (p: [number, number]) => {
    const s = toScreen(rect, cam, p);
    return smoke.canvasPixel(canvas, s.x, s.y);
  };
  // (2345, 4567) is empty floor off the grid lines; (4500, 3000) holds the Lobby's room badge.
  const background = await pixelAt([2345, 4567]);
  const wallPixel = await pixelAt([6000, 0]);
  const doorPixel = await pixelAt([4000, 0]);
  const badgePixel = await pixelAt([4500, 3000]);
  smoke.check('the wall is painted and the floor inside it is not', background !== null && wallPixel !== null && wallPixel !== background, { background, wallPixel });
  smoke.check('the door cuts the wall', doorPixel === background, { background, doorPixel });
  smoke.check('the room is marked at its seed', badgePixel !== background, { background, badgePixel });
  await smoke.shots('14-plan');

  smoke.section('plan navigation');
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await smoke.wheel(centre.x, centre.y, -300);
  const zoomed = (await readCamera(smoke))!;
  // Synthetic pointer positions are whole pixels, so the centre may drift by up to a pixel's worth of mm.
  const px = 1 / cam.scale + 1;
  smoke.check('the wheel zooms in at the cursor', zoomed.scale > cam.scale * 1.2 && Math.abs(zoomed.x - cam.x) < px && Math.abs(zoomed.y - cam.y) < px, { before: cam, after: zoomed });
  await smoke.wheel(centre.x + 200, centre.y, 300);
  const out = (await readCamera(smoke))!;
  smoke.check('zooming out off-centre keeps the point under the cursor still', out.scale < zoomed.scale && out.x !== zoomed.x, { zoomed, out });
  await smoke.dragAt(centre, { x: centre.x + 120, y: centre.y + 60 }, { button: 'middle' });
  const panned = (await readCamera(smoke))!;
  smoke.check('a middle-button drag pans the view', Math.abs(panned.x - (out.x - 120 / out.scale)) < 1 && Math.abs(panned.y - (out.y + 60 / out.scale)) < 1, { out, panned });
  await smoke.clickAt(centre.x, centre.y);
  await smoke.keyDown('Space');
  await smoke.dragAt(centre, { x: centre.x - 120, y: centre.y - 60 });
  await smoke.keyUp('Space');
  const back = (await readCamera(smoke))!;
  smoke.check('Space with a left drag pans too', Math.abs(back.x - out.x) < 1 && Math.abs(back.y - out.y) < 1, { out, back });
  smoke.check('the footer shows the cursor position in display units', await smoke.waitFor(`${tab} [data-testid=plan-cursor]`, 2000, 'mm'));
  smoke.check('the camera is stored with the project', await smoke.until(async () => Boolean((await smoke.run<{ camera?: Camera }>('project.ui.get', {}, { projectId: towerId })).camera), 3000));

  await smoke.key('PageUp');
  smoke.check('PageUp moves to the level above', await smoke.until(async () => (await attr(smoke, 'level')) === gallery), await attr(smoke, 'level'));
  await smoke.fill(`${tab} [data-testid=plan-underlay]`, 'below');
  smoke.check('the reference underlay can show the level below', await smoke.until(async () => (await attr(smoke, 'underlay')) === 'below'));
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  cam = (await readCamera(smoke))!;
  const faintWall = await pixelAt([6000, 0]);
  const empty = await pixelAt([2345, 4567]);
  smoke.check('the level below is drawn faintly under an empty level', (await attr(smoke, 'entities')) === '0' && faintWall !== null && faintWall !== empty && inside([0, 0]) && inside([9000, 6000]), { faintWall, empty, cam });
  await smoke.shots('15-plan-underlay');
  await smoke.key('PageDown');
  smoke.check('PageDown moves back down', await smoke.until(async () => (await attr(smoke, 'level')) === ground));
  await smoke.fill(`${tab} [data-testid=plan-underlay]`, 'none');

  smoke.section('plan follows agents');
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  cam = (await readCamera(smoke))!;
  const beforeWall = await pixelAt([4500, 3000]);
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-plan-agent', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${towerId}`)));
  const added = await client.callTool({ name: 'plan_entity_add', arguments: { levelId: ground, entity: { type: 'wall', path: { closed: false, v: [{ p: [4500, 500] }, { p: [4500, 5500] }] }, thickness: 150 } } });
  smoke.check("an agent's wall appears on the canvas at once", !added.isError && (await smoke.until(async () => (await attr(smoke, 'entities')) === '5')) && (await pixelAt([4500, 3000])) !== beforeWall, { beforeWall, after: await pixelAt([4500, 3000]) });
  await client.close();
  await smoke.run('edit.undo', {}, { projectId: towerId });
  smoke.check('undoing it clears the canvas again', await smoke.until(async () => (await attr(smoke, 'entities')) === '4'));
}
