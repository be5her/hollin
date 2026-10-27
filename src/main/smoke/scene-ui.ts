import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, openProjectTab, tab, view } from './plan-canvas';
import { colorDistance, readOrbit, rgbOf, sceneAttr, sceneCanvas, sceneView, type Vec3 } from './scene-canvas';

const rect = (x: number, y: number, w: number, h: number) => ({ closed: true, v: [{ p: [x, y] }, { p: [x + w, y] }, { p: [x + w, y + h] }, { p: [x, y + h] }] });
const line = (a: [number, number], b: [number, number]) => ({ closed: false, v: [{ p: a }, { p: b }] });
/** The canvas colours from styles.css: what shows where nothing is drawn. */
const LIGHT_BACKGROUND = rgbOf('#f7f7f5');
const DARK_BACKGROUND = rgbOf('#17181a');

/**
 * The 3D view: a two-storey project drawn through commands shows in the 3D tab; seen from the front,
 * a free-standing wall is drawn where its face is and its door lets the background through; an
 * agent's wall appears at once and goes away on undo; the camera moved with the wheel is kept across
 * closing and reopening the project; the view follows the dark theme. Isolate, Cutaway (the floor
 * above gone, the walls cut at the plan cut height) and Explode, checked by pixels; side by side, the
 * level shared with the plan both ways, a click in 3D picking a level, and a wall drawn on the plan
 * with real clicks appearing in 3D.
 */
export async function smokeSceneUi(smoke: Smoke): Promise<void> {
  smoke.section('3D view');
  const created = await smoke.run<{ id: string }>('project.create', { name: 'Scene' });
  const id = created.id;
  const run = <T = unknown>(command: string, input: unknown = {}) => smoke.run<T>(command, input, { projectId: id });
  const doc = () => smoke.host.projects.session(id)!.doc;
  const ground = doc().building.groundLevelId;
  const upper = (await run<{ id: string }>('building.level.add', { name: 'Level 1' })).id;

  // A 6 × 6 m room on each floor with a slab, a stair up its west side and an elevator in its north-east corner, and in front of it (south) a free-standing wall with a door.
  for (const levelId of [ground, upper]) {
    await run('plan.entity.add', { levelId, entity: { type: 'wall', path: rect(0, 0, 6000, 6000), thickness: 200 } });
    await run('plan.entity.add', { levelId, entity: { type: 'slab', source: { k: 'auto' } } });
  }
  await run('building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: line([1000, 300], [1000, 3700]), width: 1000 } });
  await run('building.connector.add', { connector: { kind: 'elevator', at: [4500, 4500], shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground }, { levelId: upper }] } });
  const freeWall = await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'wall', path: line([9000, -4000], [13000, -4000]), thickness: 200 } });
  await run('plan.opening.add', { wallId: freeWall.id, kind: 'door', along: 2000 });

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

  // Display modes, from the front. The room's south wall face is at y = -100: its ground storey around 1.5 m, its upper storey around 4.5 m.
  const front = async () => {
    await smoke.click(`${tab} [data-testid=scene-preset-front]`);
    await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 270);
    await wait(100);
    return sceneView(smoke);
  };
  const groundWall: Vec3 = [3000, -100, 1500];
  const upperWall: Vec3 = [3000, -100, 4500];
  const isBackground = async (p: Vec3) => colorDistance(await v.pixel(p), LIGHT_BACKGROUND) <= 3;
  const chooseLevel = async (levelId: string) => {
    await smoke.fill(`${tab} [data-testid=scene-level]`, levelId);
    return smoke.until(async () => (await sceneAttr(smoke, 'level')) === levelId);
  };
  await chooseLevel(ground);
  v = await front();
  smoke.check('all levels show both storeys of the room', !(await isBackground(groundWall)) && !(await isBackground(upperWall)));
  await smoke.click(`${tab} [data-testid=scene-mode-isolate]`);
  smoke.check('Isolate shows the active level alone', await smoke.until(async () => (await sceneAttr(smoke, 'levels')) === ground), await sceneAttr(smoke, 'levels'));
  smoke.check('the ground storey is drawn and the upper one is not', !(await isBackground(groundWall)) && (await isBackground(upperWall)), { ground: await v.pixel(groundWall), upper: await v.pixel(upperWall) });
  smoke.check('the level select switches the isolated level', (await chooseLevel(upper)) && (await smoke.until(async () => (await sceneAttr(smoke, 'levels')) === upper)));
  smoke.check('now only the upper storey is drawn', await smoke.until(async () => (await isBackground(groundWall)) && !(await isBackground(upperWall))), { ground: await v.pixel(groundWall), upper: await v.pixel(upperWall) });

  // Cutaway at the ground floor: the floor above goes, and the ground floor's walls are cut at the plan cut height (1200), a stair's flight with them.
  await chooseLevel(ground);
  await smoke.click(`${tab} [data-testid=scene-mode-cutaway]`);
  smoke.check('Cutaway shows the active level and those below', await smoke.until(async () => (await sceneAttr(smoke, 'levels')) === ground && (await sceneAttr(smoke, 'clip')) === '1200'), { levels: await sceneAttr(smoke, 'levels'), clip: await sceneAttr(smoke, 'clip') });
  const aboveCut: Vec3 = [3000, -100, 2400];
  const belowCut: Vec3 = [3000, -100, 600];
  smoke.check('the walls are cut: background above the cut, wall below it', await smoke.until(async () => (await isBackground(aboveCut)) && !(await isBackground(belowCut))), { above: await v.pixel(aboveCut), below: await v.pixel(belowCut) });
  await smoke.shots('38-scene-cutaway');
  await smoke.click(`${tab} [data-testid=scene-mode-all]`);
  smoke.check('All brings the levels back', await smoke.until(async () => (await sceneAttr(smoke, 'levels')) === `${ground} ${upper}` && (await sceneAttr(smoke, 'clip')) === ''));
  smoke.check('and the walls whole', await smoke.until(async () => !(await isBackground(aboveCut))));

  // Explode: the upper level rises by 4 m; between the storeys, the background.
  await smoke.fill(`${tab} [data-testid=scene-explode]`, '100');
  smoke.check('Explode spreads the levels apart', await smoke.until(async () => (await sceneAttr(smoke, 'explode')) === '1'));
  v = await front();
  smoke.check('the gap between the storeys shows the background, the upper storey 4 m higher', await smoke.until(async () => (await isBackground(upperWall)) && !(await isBackground([3000, -100, 8500]))), { gap: await v.pixel(upperWall), raised: await v.pixel([3000, -100, 8500]) });
  await smoke.shots('39-scene-explode');
  await smoke.fill(`${tab} [data-testid=scene-explode]`, '0');
  await smoke.until(async () => (await sceneAttr(smoke, 'explode')) === '0');

  // Side by side: the plan next to the 3D view, sharing the active level; a click in 3D picks a level, a wall drawn on the plan shows in 3D.
  await smoke.click(`${tab} [data-testid=center-split]`);
  smoke.check('Side by side shows the plan next to the 3D view', (await smoke.waitFor(`${tab} [data-testid=center-side-by-side] [data-testid=plan-canvas]`)) && (await smoke.count(`${tab} [data-testid=center-side-by-side] [data-testid=scene-canvas]`)) === 1);
  await smoke.waitFor(`${tab} [data-testid=plan-level] option[value="${upper}"]`);
  await smoke.fill(`${tab} [data-testid=plan-level]`, upper);
  smoke.check('switching the level on the plan switches it in 3D', await smoke.until(async () => (await sceneAttr(smoke, 'level')) === upper));
  v = await front();
  const onGround = v.at(groundWall);
  await smoke.clickAt(onGround.x, onGround.y);
  smoke.check('a click on the ground storey in 3D makes it the active level, on the plan too', await smoke.until(async () => (await sceneAttr(smoke, 'level')) === ground && (await canvasAttr(smoke, 'level')) === ground), { scene: await sceneAttr(smoke, 'level'), plan: await canvasAttr(smoke, 'level') });
  const spot3d: Vec3 = [7750, -4100, 1200];
  smoke.check('nothing stands between the room and the free wall yet', await isBackground(spot3d));
  await smoke.until(async () => (await canvasAttr(smoke, 'frameLevel')) === ground);
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(150);
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('W');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  await wait(100);
  // The Wall tool's options bar changes the plan's height: measure after it shows. Alt keeps both clicks exactly where they are.
  const plan = await view(smoke);
  const a = plan.at([7000, -4000]);
  const b = plan.at([8500, -4000]);
  await smoke.clickAt(a.x, a.y, { modifiers: ['alt'] });
  await smoke.mouseMove(b.x, b.y, ['alt']);
  await smoke.clickAt(b.x, b.y, { modifiers: ['alt'] });
  await smoke.key('Escape');
  smoke.check('a wall drawn on the plan appears in 3D', await smoke.until(async () => !(await isBackground(spot3d))), { at: await v.pixel(spot3d) });
  await smoke.shots('40-scene-side-by-side');
  await smoke.key('Escape');
  await smoke.click(`${tab} [data-testid=center-split]`);
  smoke.check('Side by side turns off again', await smoke.gone(`${tab} [data-testid=center-side-by-side]`));

  // Walking. From above, a double click on the stair's first tread (seen through the stairwell) starts walking there, facing north, away from the camera.
  const walkAt = async () => {
    const attr = await sceneAttr(smoke, 'walk');
    return attr ? attr.split(',').map(Number) : null;
  };
  await smoke.click(`${tab} [data-testid=scene-preset-top]`);
  await smoke.until(async () => (await readOrbit(smoke))?.elevation === 89);
  await wait(100);
  v = await sceneView(smoke);
  const tread = v.at([1000, 420, 187.5]);
  await smoke.clickAt(tread.x, tread.y, { clickCount: 2 });
  // The point comes from the pixel clicked: within a few cm of the one aimed at; the height is the tread's (187.5).
  smoke.check(
    'a double click on the first tread starts walking on it, facing north',
    await smoke.until(async () => {
      const w = await walkAt();
      return w !== null && Math.abs(w[0] - 1000) < 30 && Math.abs(w[1] - 420) < 30 && w[2] === 188 && w[3] === 90;
    }),
    await walkAt(),
  );
  smoke.check('the footer says where the walker is', await smoke.waitFor(`${tab} [data-testid=scene-walk-level]`, 3000, 'Ground floor'));
  await smoke.keyDown('W');
  smoke.check('holding W climbs the stair to the upper floor', await smoke.until(async () => (await sceneAttr(smoke, 'walkLevel')) === upper && (await walkAt())?.[2] === 3000, 15_000), await walkAt());
  // On to the north wall, whose inner face is at 5900: the walker stops a body's width short of it.
  await smoke.until(async () => ((await walkAt())?.[1] ?? 0) > 5500, 10_000);
  // Under load the last stretch can take longer than any fixed delay: wait until two reads 400 ms apart agree.
  let stopped = (await walkAt())!;
  await smoke.until(async () => {
    await wait(400);
    const now = (await walkAt())!;
    const same = now[1] === stopped[1];
    stopped = now;
    return same;
  }, 10_000, 0);
  await smoke.keyUp('W');
  const still = (await walkAt())!;
  smoke.check('the wall stops it', stopped[1] === still[1] && still[1] <= 5650 && still[1] > 5400, { stopped, still });
  // A drag looks around: 720 px to the left turns the walker half round (0.25° a pixel), to look back over the room and the stairwell.
  const sr = (await smoke.rect(sceneCanvas))!;
  await smoke.dragAt({ x: sr.x + sr.width / 2 + 360, y: sr.y + sr.height / 2 }, { x: sr.x + sr.width / 2 - 360, y: sr.y + sr.height / 2 }, { steps: 12 });
  smoke.check('a drag turns the walker round', await smoke.until(async () => (await walkAt())?.[3] === 270), await walkAt());
  await smoke.shots('41-scene-walk');
  await smoke.key('Escape');
  smoke.check('Escape goes back to the orbit it left', await smoke.until(async () => (await sceneAttr(smoke, 'walk')) === '' && (await readOrbit(smoke))?.elevation === 89));
  // The elevator: a double click on its car's roof (through the glass shaft) stands in the car at the ground stop; PageUp and PageDown ride it.
  v = await sceneView(smoke);
  const car = v.at([4500, 4500, 2300]);
  await smoke.clickAt(car.x, car.y, { clickCount: 2 });
  smoke.check('a double click on the elevator car stands in it at the ground stop', await smoke.until(async () => (await walkAt())?.[2] === 0), await walkAt());
  await smoke.key('PageUp');
  smoke.check('PageUp rides it up to the upper floor', await smoke.until(async () => (await walkAt())?.[2] === 3000 && (await sceneAttr(smoke, 'walkLevel')) === upper), await walkAt());
  await smoke.key('PageDown');
  smoke.check('and PageDown back down', await smoke.until(async () => (await walkAt())?.[2] === 0), await walkAt());
  await smoke.key('Escape');
  await smoke.until(async () => (await sceneAttr(smoke, 'walk')) === '');
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.run('project.close', { id });
}
