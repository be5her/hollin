import { wait, type Smoke } from './harness';
import { openProjectTab, tab } from './plan-canvas';
import { colorDistance, readOrbit, rgbOf, sceneAttr, sceneCanvas, sceneView } from './scene-canvas';

const rect = (x: number, y: number, w: number, h: number) => ({ closed: true, v: [{ p: [x, y] }, { p: [x + w, y] }, { p: [x + w, y + h] }, { p: [x, y + h] }] });
const line = (a: [number, number], b: [number, number]) => ({ closed: false, v: [{ p: a }, { p: b }] });
/** The canvas colours from styles.css: what shows where nothing is drawn. */
const LIGHT_BACKGROUND = rgbOf('#f7f7f5');
const DARK_BACKGROUND = rgbOf('#17181a');

/**
 * The 3D view: a two-storey project drawn through commands shows in the 3D tab; seen from the front,
 * a free-standing wall is drawn where its face is and its door lets the background through; an
 * agent's wall appears at once and goes away on undo; the camera moved with the wheel is kept across
 * closing and reopening the project; the view follows the dark theme.
 */
export async function smokeSceneUi(smoke: Smoke): Promise<void> {
  smoke.section('3D view');
  const created = await smoke.run<{ id: string }>('project.create', { name: 'Scene' });
  const id = created.id;
  const run = <T = unknown>(command: string, input: unknown = {}) => smoke.run<T>(command, input, { projectId: id });
  const doc = () => smoke.host.projects.session(id)!.doc;
  const ground = doc().building.groundLevelId;
  const upper = (await run<{ id: string }>('building.level.add', { name: 'Level 1' })).id;

  // A 6 × 4 m room on each floor with a slab, a stair between them inside, and in front of it (south) a free-standing wall with a door.
  for (const levelId of [ground, upper]) {
    await run('plan.entity.add', { levelId, entity: { type: 'wall', path: rect(0, 0, 6000, 4000), thickness: 200 } });
    await run('plan.entity.add', { levelId, entity: { type: 'slab', source: { k: 'auto' } } });
  }
  await run('building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: line([1000, 300], [1000, 3700]), width: 1000 } });
  const front = await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'wall', path: line([9000, -4000], [13000, -4000]), thickness: 200 } });
  await run('plan.opening.add', { wallId: front.id, kind: 'door', along: 2000 });

  await openProjectTab(smoke, id);
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  smoke.check('the 3D tab draws the building', await smoke.until(async () => Number(await sceneAttr(smoke, 'meshes')) > 0, 10_000), { meshes: await sceneAttr(smoke, 'meshes'), unavailable: await smoke.count(`${tab} [data-testid=scene-unavailable]`) });
  smoke.check('both levels are shown', (await sceneAttr(smoke, 'levels')) === `${ground} ${upper}`, await sceneAttr(smoke, 'levels'));

  await smoke.click(`${tab} [data-testid=scene-preset-front]`);
  smoke.check('the front preset looks from the south', await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 270), await readOrbit(smoke));
  let v = await sceneView(smoke);
  // Through the door (900 wide, centred 2000 along the wall) nothing stands behind the free wall; beside it, the wall's face.
  const throughDoor = await v.pixel([11000, -4000, 1000]);
  const wallFace = await v.pixel([9800, -4100, 1000]);
  smoke.check('the door in the free-standing wall lets the background through', colorDistance(throughDoor, LIGHT_BACKGROUND) <= 3, { throughDoor, background: LIGHT_BACKGROUND });
  smoke.check('and the wall beside it is drawn', colorDistance(wallFace, LIGHT_BACKGROUND) > 20, { wallFace });
  // A full-height wall on a floor with a level above stops under that floor's slab (2800): above it, the background.
  const aboveWall = await v.pixel([10200, -4000, 3100]);
  smoke.check('the free wall stops under the floor above', colorDistance(aboveWall, LIGHT_BACKGROUND) <= 3, { aboveWall });

  // An agent's wall, between the room and the free wall, appears at once and goes on undo.
  const spot: [number, number, number] = [7750, -4100, 1200];
  const before = await v.pixel(spot);
  await run('plan.wall.add', { levelId: ground, from: [7000, -4000], to: [8500, -4000] });
  smoke.check("an agent's wall appears in 3D", await smoke.until(async () => colorDistance(await v.pixel(spot), LIGHT_BACKGROUND) > 20), { before, after: await v.pixel(spot) });
  await run('edit.undo');
  smoke.check('and goes on undo', await smoke.until(async () => colorDistance(await v.pixel(spot), LIGHT_BACKGROUND) <= 3), { after: await v.pixel(spot) });

  await smoke.shots('36-scene-front');
  await smoke.click(`${tab} [data-testid=scene-preset-iso]`);
  smoke.check('the 3/4 preset looks from the south-west, above', await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 225));
  await wait(150);
  await smoke.shots('37-scene-iso');

  // The dark theme: the background follows the class on <html>.
  await smoke.click(`${tab} [data-testid=scene-preset-front]`);
  await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 270);
  v = await sceneView(smoke);
  await smoke.setDark(true);
  smoke.check('the 3D view follows the dark theme', await smoke.until(async () => colorDistance(await v.pixel([11000, -4000, 1000]), DARK_BACKGROUND) <= 3), { throughDoor: await v.pixel([11000, -4000, 1000]), background: DARK_BACKGROUND });
  await smoke.setDark(false);

  // The wheel zooms; the camera is stored per project and comes back when the project is reopened.
  const r = (await smoke.rect(sceneCanvas))!;
  const zoomedFrom = (await readOrbit(smoke))!.distance;
  await smoke.wheel(r.x + r.width / 2, r.y + r.height / 2, -240);
  smoke.check('the wheel zooms in', await smoke.until(async () => (await readOrbit(smoke))!.distance < zoomedFrom * 0.9), { from: zoomedFrom, now: (await readOrbit(smoke))?.distance });
  const kept = (await readOrbit(smoke))!;
  smoke.check(
    'the camera is stored in the view state',
    await smoke.until(async () => {
      const stored = (await run<{ view3d?: { orbit?: { distance: number } } }>('project.ui.get')).view3d?.orbit;
      return stored !== undefined && Math.abs(stored.distance - kept.distance) <= 1;
    }),
  );
  await smoke.run('project.close', { id });
  await openProjectTab(smoke, id);
  smoke.check('the project reopens on its 3D view', await smoke.waitFor(sceneCanvas, 10_000));
  smoke.check(
    'with the camera where it was',
    await smoke.until(async () => {
      const o = await readOrbit(smoke);
      return o !== null && Math.abs(o.distance - kept.distance) <= 1 && o.azimuth === kept.azimuth && o.elevation === kept.elevation;
    }, 10_000),
    { kept, now: await readOrbit(smoke) },
  );
  smoke.check('the canvas reports its frame time', Number(await sceneAttr(smoke, 'frameMs')) >= 0);
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.run('project.close', { id });
}
