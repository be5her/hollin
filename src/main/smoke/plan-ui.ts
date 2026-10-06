import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Entity } from '@studio/core';
import { wait, type Smoke } from './harness';

type Wall = Extract<Entity, { type: 'wall' }>;

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

  smoke.section('drawing walls');
  // The empty Gallery level, at the default camera (10 px per metre around the origin).
  await smoke.fill(`${tab} [data-testid=plan-level]`, gallery);
  await smoke.until(async () => (await attr(smoke, 'level')) === gallery);
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  cam = (await readCamera(smoke))!;
  const wallsOnGallery = () => Object.values(doc().levelData[gallery].entities).filter((e): e is Wall => e.type === 'wall');
  await smoke.click(`${tab} [data-testid=tool-wall]`);
  smoke.check('the wall tool shows its options', (await smoke.waitFor(`${tab} [data-testid=tool-options]`)) && (await attr(smoke, 'tool')) === 'wall');
  // The options bar took space above the canvas: measure again.
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  cam = (await readCamera(smoke))!;
  const hint = () => smoke.text(`${tab} [data-testid=plan-hint]`);
  await smoke.clickAt(...xy(toScreen(rect, cam, [-3000, -2000])));
  smoke.check('the first click starts a run', (await hint())?.includes('next point') === true, await hint());
  await smoke.clickAt(...xy(toScreen(rect, cam, [3000, -2000])));
  await smoke.clickAt(...xy(toScreen(rect, cam, [3000, 2000])));
  await smoke.clickAt(...xy(toScreen(rect, cam, [-3000, 2000])));
  await smoke.clickAt(...xy(toScreen(rect, cam, [-3000, -2000])));
  smoke.check('clicking the corners draws one wall per side and closes on the first point', await smoke.until(() => wallsOnGallery().length === 4), wallsOnGallery().length);
  const tolerance = 1 / cam.scale + 1;
  const near = (p: readonly [number, number], q: readonly [number, number]) => Math.abs(p[0] - q[0]) <= tolerance && Math.abs(p[1] - q[1]) <= tolerance;
  const last = wallsOnGallery()[3];
  smoke.check('the clicked points are where the walls are', near(last.path.v[0].p, [-3000, 2000]) && near(last.path.v[1].p, [-3000, -2000]), last.path.v);
  smoke.check('the run ended: the tool waits for a new start', (await hint())?.includes('start') === true, await hint());
  const corner = await pixelAt([3080, -2080]);
  const floor = await pixelAt([123, 45]);
  smoke.check('walls meeting at a corner are joined to the outer corner', corner !== null && corner !== floor, { corner, floor });
  await smoke.key('V');
  smoke.check('V on the canvas selects', await smoke.until(async () => (await attr(smoke, 'tool')) === 'select'));
  await smoke.key('W');
  smoke.check('W on the canvas picks the wall tool', await smoke.until(async () => (await attr(smoke, 'tool')) === 'wall'));
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  // Inside the rectangle, so every click lands on the canvas (it is about 460 px tall at this window size).
  await smoke.clickAt(...xy(toScreen(rect, cam, [-2000, 0])));
  await smoke.key('A');
  smoke.check('A asks for the end of an arc', (await hint())?.includes('end of the arc') === true, await hint());
  await smoke.clickAt(...xy(toScreen(rect, cam, [2000, 0])));
  await smoke.clickAt(...xy(toScreen(rect, cam, [0, 1200])));
  smoke.check('A then an end and a through point draws an arc wall', await smoke.until(() => wallsOnGallery().length === 5 && wallsOnGallery()[4].path.v[0].s?.k === 'arc'), wallsOnGallery()[4]?.path.v);
  await smoke.key('Escape');
  await smoke.shots('16-plan-walls');
  await smoke.key('Escape');
  smoke.check('Escape leaves the tool', await smoke.until(async () => (await attr(smoke, 'tool')) === 'select'));

  smoke.section('selecting and editing');
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  cam = (await readCamera(smoke))!;
  const selection = async () => ((await attr(smoke, 'selection')) ?? '').split(' ').filter(Boolean);
  const bottom = wallsOnGallery().find((w) => w.path.v[0].p[1] === w.path.v[1].p[1] && w.path.v[0].p[1] < -1000)!;
  const right = wallsOnGallery().find((w) => w.path.v[0].p[0] === w.path.v[1].p[0] && w.path.v[0].p[0] > 1000)!;
  const arcWall = wallsOnGallery().find((w) => w.path.v[0].s?.k === 'arc')!;
  await smoke.clickAt(...xy(toScreen(rect, cam, [0, bottom.path.v[0].p[1]])));
  smoke.check('clicking a wall selects it', await smoke.until(async () => (await selection()).join() === bottom.id), await selection());
  smoke.check('the footer counts the selection', await smoke.waitFor(`${tab} [data-testid=plan-selection]`, 2000, '1 selected'));
  await smoke.clickAt(...xy(toScreen(rect, cam, [right.path.v[0].p[0], 0])), { modifiers: ['shift'] });
  smoke.check('Shift+click adds to the selection', await smoke.until(async () => (await selection()).length === 2));
  await smoke.clickAt(...xy(toScreen(rect, cam, [-1500, -1000])));
  smoke.check('clicking empty floor clears it', await smoke.until(async () => (await selection()).length === 0));
  await smoke.dragAt(toScreen(rect, cam, [-3500, -2500]), toScreen(rect, cam, [3500, 2500]));
  smoke.check('a window drag selects what lies inside', await smoke.until(async () => (await selection()).length === 5), await selection());
  // From empty floor (a drag that starts on a selected entity moves it), leftwards across the arc wall only.
  await smoke.dragAt(toScreen(rect, cam, [500, 600]), toScreen(rect, cam, [-500, -600]));
  smoke.check('a crossing drag selects what it touches', await smoke.until(async () => (await selection()).join() === arcWall.id), await selection());
  await smoke.shots('17-plan-selection');

  const arcStart = arcWall.path.v[0].p;
  const arcMid = toScreen(rect, cam, [0, 1200]);
  await smoke.dragAt(arcMid, { x: arcMid.x + 50, y: arcMid.y });
  smoke.check('dragging a selected wall moves it', await smoke.until(() => Math.abs(wallsOnGallery().find((w) => w.id === arcWall.id)!.path.v[0].p[0] - (arcStart[0] + 50 / cam.scale)) < tolerance), wallsOnGallery().find((w) => w.id === arcWall.id)?.path.v[0].p);
  await smoke.key('Right');
  await smoke.key('Right');
  await smoke.key('Right');
  const nudged = () => wallsOnGallery().find((w) => w.id === arcWall.id)!.path.v[0].p[0];
  smoke.check('arrow keys nudge the selection', await smoke.until(() => Math.abs(nudged() - (arcStart[0] + 50 / cam.scale + 300)) < tolerance), nudged());
  const history = await smoke.run<{ undo: { label: string }[] }>('edit.history', {}, { projectId: towerId });
  smoke.check('quick nudges merge into one undo step', history.undo[0].label === 'Nudge wall' && history.undo[1].label === 'Move wall', history.undo.slice(0, 3).map((h) => h.label));
  await smoke.key('Delete');
  smoke.check('Delete removes the selection', await smoke.until(() => wallsOnGallery().length === 4));
  await smoke.key('Z', ['control']);
  smoke.check('Ctrl+Z brings it back', await smoke.until(() => wallsOnGallery().length === 5));

  smoke.section('agents and drags');
  const movedArc = wallsOnGallery().find((w) => w.path.v[0].s?.k === 'arc')!;
  const grab = toScreen(rect, cam, [(movedArc.path.v[0].p[0] + movedArc.path.v[1].p[0]) / 2, 1200]);
  await smoke.clickAt(grab.x, grab.y);
  await smoke.until(async () => (await selection()).join() === movedArc.id);
  await smoke.mouseMove(grab.x, grab.y);
  await smoke.mouseDown(grab.x, grab.y);
  await smoke.mouseMove(grab.x + 40, grab.y, ['leftbuttondown']);
  await smoke.mouseMove(grab.x + 80, grab.y, ['leftbuttondown']);
  smoke.check('a drag shows its hint', await smoke.waitFor(`${tab} [data-testid=plan-hint]`, 2000, 'Release'));
  await smoke.run('plan.entity.delete', { ids: [movedArc.id] }, { projectId: towerId });
  await smoke.mouseMove(grab.x + 120, grab.y, ['leftbuttondown']);
  await smoke.mouseUp(grab.x + 120, grab.y);
  await wait(300);
  smoke.check('an agent deleting the dragged wall cancels the drag', wallsOnGallery().length === 4 && (await selection()).length === 0 && !(await smoke.text('body'))?.includes('No entity'), { walls: wallsOnGallery().length, selection: await selection() });
  await smoke.run('edit.undo', {}, { projectId: towerId });
  await smoke.until(() => wallsOnGallery().length === 5);

  const bottomMid = toScreen(rect, cam, [0, bottom.path.v[0].p[1]]);
  await smoke.clickAt(bottomMid.x, bottomMid.y, { button: 'right' });
  smoke.check('right-clicking a wall selects it and opens a menu', (await smoke.waitFor('[data-testid=context-menu]')) && (await selection()).join() === bottom.id);
  await smoke.click('[data-testid=menu-duplicate]');
  smoke.check('the menu duplicates it', await smoke.until(() => wallsOnGallery().length === 6));
  smoke.check('the copy is selected', await smoke.until(async () => (await selection()).length === 1 && (await selection())[0] !== bottom.id));
  // The menu took the keyboard focus; give it back to the canvas before pressing keys.
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Delete');
  smoke.check('Delete removes the copy', await smoke.until(() => wallsOnGallery().length === 5));
  await smoke.clickAt(...xy(toScreen(rect, cam, [0, bottom.path.v[0].p[1]])));
  await smoke.key('C', ['control']);
  await smoke.mouseMove(...xy(toScreen(rect, cam, [0, 1000])));
  await smoke.key('V', ['control']);
  smoke.check('Ctrl+C and Ctrl+V paste a copy at the cursor', await smoke.until(() => wallsOnGallery().length === 6 && wallsOnGallery().some((w) => Math.abs(w.path.v[0].p[1] - 1000) < tolerance)), wallsOnGallery().map((w) => w.path.v[0].p));
  await smoke.key('Delete');
  await smoke.until(() => wallsOnGallery().length === 5);
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
