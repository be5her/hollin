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
const toScreen = (rect: Rect, cam: Camera, p: readonly [number, number]) => ({ x: rect.x + (p[0] - cam.x) * cam.scale + rect.width / 2, y: rect.y + (cam.y - p[1]) * cam.scale + rect.height / 2 });

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
  // On the arc's body but away from its grips (its middle at (0, 1200) is one).
  const arcMid = toScreen(rect, cam, [1000, 967]);
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
  const grab = toScreen(rect, cam, [(movedArc.path.v[0].p[0] + movedArc.path.v[1].p[0]) / 2 + 1000, 967]);
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

  smoke.section('grips and corners');
  const focusCanvas = () => smoke.js(`document.querySelector('${canvas}').focus()`);
  const wallById = (id: string) => wallsOnGallery().find((w) => w.id === id)!;
  const top = wallsOnGallery().find((w) => w.path.v[0].p[1] === w.path.v[1].p[1] && w.path.v[0].p[1] > 1000)!;
  await smoke.clickAt(...xy(toScreen(rect, cam, [right.path.v[0].p[0], 0])));
  await smoke.until(async () => (await selection()).join() === right.id);
  const cornerIndex = right.path.v[1].p[1] > right.path.v[0].p[1] ? 1 : 0;
  const cornerPos = right.path.v[cornerIndex].p;
  const topIndex = top.path.v.findIndex((v) => Math.hypot(v.p[0] - cornerPos[0], v.p[1] - cornerPos[1]) < 1);
  const cornerScreen = toScreen(rect, cam, cornerPos);
  await smoke.dragAt(cornerScreen, { x: cornerScreen.x + 50, y: cornerScreen.y - 50 });
  const expected: [number, number] = [cornerPos[0] + 50 / cam.scale, cornerPos[1] + 50 / cam.scale];
  smoke.check('dragging a corner grip moves the wall end', await smoke.until(() => near(wallById(right.id).path.v[cornerIndex].p, expected)), wallById(right.id).path.v[cornerIndex].p);
  smoke.check('the wall end that met it follows', topIndex >= 0 && near(wallById(top.id).path.v[topIndex].p, expected), wallById(top.id).path.v[topIndex]?.p);
  smoke.check('both moved in one change', (await smoke.run<{ undo: { label: string }[] }>('edit.history', {}, { projectId: towerId })).undo[0].label === 'Move corner');
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  const gripScreen = toScreen(rect, cam, wallById(right.id).path.v[cornerIndex].p);
  await smoke.clickAt(gripScreen.x, gripScreen.y);
  smoke.check('clicking a corner grip selects the corner', await smoke.until(async () => (await attr(smoke, 'vertex')) === `${right.id}:${cornerIndex}`), await attr(smoke, 'vertex'));
  smoke.check('the inspector shows the corner', await smoke.waitFor(`${tab} [data-testid=vertex-editor]`));
  const vertexX = await smoke.rect(`${tab} [data-testid=vertex-x]`);
  if (vertexX) {
    await smoke.clickAt(vertexX.x + vertexX.width / 2, vertexX.y + vertexX.height / 2);
    await smoke.key('A', ['control']);
    await smoke.typeText('3000');
    await smoke.key('Return');
    smoke.check('a corner position typed in the inspector moves the wall end', await smoke.until(() => Math.abs(wallById(right.id).path.v[cornerIndex].p[0] - 3000) < 0.01), wallById(right.id).path.v[cornerIndex].p);
  }
  await focusCanvas();
  await smoke.key('Escape');
  smoke.check('Escape drops the corner', await smoke.until(async () => (await attr(smoke, 'vertex')) === ''));

  smoke.section('the inspector');
  await smoke.clickAt(...xy(toScreen(rect, cam, [0, bottom.path.v[0].p[1]])));
  smoke.check('the inspector shows the wall', (await smoke.waitFor(`${tab} [data-testid=entity-editor][data-type=wall]`)) && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=prop-thickness]').value`)) === '200 mm');
  const thickness = (await smoke.rect(`${tab} [data-testid=prop-thickness]`))!;
  await smoke.clickAt(thickness.x + thickness.width / 2, thickness.y + thickness.height / 2);
  await smoke.key('A', ['control']);
  await smoke.typeText('30cm');
  await smoke.key('Return');
  smoke.check('a thickness typed in any unit changes the wall', await smoke.until(() => wallById(bottom.id).thickness === 300), wallById(bottom.id).thickness);
  await smoke.clickAt(thickness.x + thickness.width / 2, thickness.y + thickness.height / 2);
  await smoke.key('A', ['control']);
  await smoke.typeText('thick');
  smoke.check('text that is not a length is marked invalid while typing', await smoke.waitFor(`${tab} [data-testid=prop-thickness][aria-invalid=true]`));
  await smoke.key('Return');
  smoke.check('and put back on Enter', (await smoke.until(async () => (await smoke.js<string>(`document.querySelector('${tab} [data-testid=prop-thickness]').value`)) === '300 mm')) && wallById(bottom.id).thickness === 300);
  await focusCanvas();
  // A crossing selection (leftwards) that touches all five walls, kept inside the canvas.
  await smoke.dragAt(toScreen(rect, cam, [3400, 2300]), toScreen(rect, cam, [-3400, -2300]));
  smoke.check('a multi-selection of one kind edits them together', (await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000, '5 items')) && (await smoke.waitFor(`${tab} [data-testid=entity-editor][data-type=wall]`)));
  await smoke.shots('18-plan-inspector');
  await smoke.clickAt(...xy(toScreen(rect, cam, [-1500, -1000])));

  smoke.section('stale edits');
  const agent = new Client({ name: 'smoke-late-agent', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${towerId}`)));
  const stale = await agent.callTool({ name: 'plan_entity_update', arguments: { id: bottom.id, set: { thickness: 150 }, baseSeq: 1 } });
  const staleText = (stale.content as { text: string }[])[0]?.text ?? '';
  smoke.check('an agent editing from an old copy is refused and told who changed it', stale.isError === true && staleText.includes('CONFLICT') && staleText.includes('meanwhile') && wallById(bottom.id).thickness === 300, staleText);
  await agent.close();

  smoke.section('snapping');
  const exact = (p: readonly [number, number], q: readonly [number, number]) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  await focusCanvas();
  await smoke.key('W');
  await wait(100);
  rect = (await smoke.rect(canvas))!;
  cam = (await readCamera(smoke))!;
  const cornerOf = wallById(bottom.id).path.v[0].p;
  // The record's order is not insertion order after updates, so find new walls by id.
  let known = new Set<string>();
  const remember = () => (known = new Set(wallsOnGallery().map((w) => w.id)));
  const snappedWall = () => wallsOnGallery().find((w) => !known.has(w.id))!;
  const c = toScreen(rect, cam, cornerOf);
  remember();
  await smoke.mouseMove(c.x + 4, c.y - 3);
  smoke.check('hovering near a corner shows the snap', await smoke.waitFor(`${tab} [data-testid=plan-snap]`, 2000, 'Endpoint'));
  await smoke.shots('19-plan-snap');
  await smoke.clickAt(c.x + 4, c.y - 3);
  const away = toScreen(rect, cam, [cornerOf[0] + 2000, cornerOf[1] + 60]);
  await smoke.clickAt(away.x, away.y, { modifiers: ['shift'] });
  await smoke.key('Escape');
  smoke.check('a click near a corner starts exactly at it', (await smoke.until(() => wallsOnGallery().length === 6)) && exact(snappedWall().path.v[0].p, cornerOf), snappedWall()?.path.v[0].p);
  smoke.check('Shift keeps the wall horizontal', Math.abs(snappedWall().path.v[1].p[1] - cornerOf[1]) < 1e-6 && Math.abs(snappedWall().path.v[1].p[0] - (cornerOf[0] + 2000)) < tolerance, snappedWall().path.v[1].p);
  const rightNow = wallById(right.id);
  const mid: [number, number] = [(rightNow.path.v[0].p[0] + rightNow.path.v[1].p[0]) / 2, (rightNow.path.v[0].p[1] + rightNow.path.v[1].p[1]) / 2];
  const m = toScreen(rect, cam, mid);
  remember();
  await smoke.key('W');
  smoke.check('the wall tool waits for a start', (await hint())?.includes('start') === true, await hint());
  await smoke.clickAt(m.x + 2, m.y + 3);
  smoke.check('the click starts a run', (await hint())?.includes('next point') === true, await hint());
  // A second point far from anything, so nothing snaps there, and well inside the canvas (about 690 px wide here).
  const free = toScreen(rect, cam, [mid[0] - 1500, mid[1] - 1250]);
  await smoke.clickAt(free.x, free.y);
  smoke.check('a click near the middle of a wall starts at its midpoint', (await smoke.until(() => wallsOnGallery().length === 7)) && exact(snappedWall().path.v[0].p, mid), { got: snappedWall()?.path.v[0].p, mid, hint: await hint() });
  await focusCanvas();
  await smoke.key('Escape');
  await smoke.key('Escape');
  smoke.check('two Escapes leave the wall tool', await smoke.until(async () => (await attr(smoke, 'tool')) === 'select'));
  await smoke.click(`${tab} [data-testid=snap-menu-button]`);
  smoke.check('the snap menu opens', await smoke.waitFor(`${tab} [data-testid=snap-menu]`));
  await smoke.click(`${tab} [data-testid=snap-snapEndpoint]`);
  smoke.check('a snap kind can be switched off, and the setting is kept', await smoke.until(async () => (await smoke.run<{ editor: { snapEndpoint: boolean } }>('config.get')).editor.snapEndpoint === false));
  await smoke.js(`document.querySelector('[data-testid=snap-menu]')?.previousElementSibling?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await smoke.gone(`${tab} [data-testid=snap-menu]`);
  await smoke.run('config.update', { patch: { editor: { snapEndpoint: true } } });
  // The corner is also where two wall lines cross, so only the magnet (everything off) frees the click.
  await smoke.click(`${tab} [data-testid=snap-toggle]`);
  smoke.check('the magnet switches snapping off, and the setting is kept', await smoke.until(async () => (await smoke.run<{ editor: { snap: boolean } }>('config.get')).editor.snap === false));
  await focusCanvas();
  remember();
  await smoke.key('W');
  await smoke.clickAt(c.x + 4, c.y - 3);
  await smoke.clickAt(c.x + 150, c.y - 60);
  smoke.check('without snapping the click lands where it is', (await smoke.until(() => wallsOnGallery().length === 8)) && !exact(snappedWall().path.v[0].p, cornerOf) && near(snappedWall().path.v[0].p, [cornerOf[0] + 40, cornerOf[1] + 30]), { got: snappedWall()?.path.v[0].p, hint: await hint() });
  await smoke.key('Escape');
  await smoke.key('Escape');
  await smoke.click(`${tab} [data-testid=snap-toggle]`);
  smoke.check('and back on', await smoke.until(async () => (await smoke.run<{ editor: { snap: boolean } }>('config.get')).editor.snap === true));
  await smoke.run('plan.entity.delete', { ids: wallsOnGallery().slice(5).map((w) => w.id) }, { projectId: towerId });
  await smoke.until(() => wallsOnGallery().length === 5);
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
