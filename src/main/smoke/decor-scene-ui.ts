import type { Entity, ProjectDoc } from '@studio/core';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, openProjectTab, tab, view } from './plan-canvas';
import { colorDistance, readOrbit, sceneAttr, sceneView, type Vec3 } from './scene-canvas';

/** The sum of a colour's channels, to compare how light two pixels are. */
const lightness = (rgb: string | null) => (rgb ? rgb.split(',').map(Number).reduce((a, b) => a + b, 0) : NaN);

/**
 * Furniture, lights and doors in 3D, in the flat the plan's furniture section furnished: the sofa drawn
 * where it stands, an imported model loaded and drawn, a door's leaf beside its opening, Night darker
 * than Day away from the lights and lit near a lamp, a click on the sofa selecting it on the plan;
 * then the Light tool and the light inspector on the plan.
 */
export async function smokeDecorSceneUi(smoke: Smoke, flatId: string, tableRef: string): Promise<void> {
  smoke.section('decor in 3D');
  const doc = () => smoke.host.projects.session(flatId)!.doc as ProjectDoc;
  const run = <T = unknown>(id: string, input: unknown) => smoke.run<T>(id, input, { projectId: flatId });
  const ground = doc().building.groundLevelId;
  const entities = () => Object.values(doc().levelData[ground].entities);
  const sofa = entities().find((e): e is Extract<Entity, { type: 'item' }> => e.type === 'item' && e.asset === 'builtin:sofa-3')!;
  const south = entities().find((e) => e.type === 'wall' && e.path.v[0].p[0] === 0 && e.path.v[0].p[1] === 0)!;
  // A door in the south wall at x = 3000 (opening into the room), a floor lamp with its light in the north-west corner, the imported table by the east wall.
  await run('plan.opening.add', { wallId: south.id, kind: 'door', along: 3000 });
  const lamp = await run<{ id: string; lightId: string }>('decor.item.place', { levelId: ground, ref: 'builtin:floor-lamp', at: [800, 3700], withLight: true });
  const light = doc().levelData[ground].entities[lamp.lightId];
  smoke.check('a lamp placed with its light gets a point light at its bulb', light?.type === 'light' && light.kind === 'point' && light.at[2] === 1450 && light.intensity === 1200, light);
  await run('decor.item.place', { levelId: ground, ref: tableRef, at: [4700, 1300] });

  smoke.check('the flat is on screen', await openProjectTab(smoke, flatId));
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  smoke.check('the 3D view draws the flat', await smoke.until(async () => Number(await sceneAttr(smoke, 'meshes')) > 0, 10_000));
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  await smoke.click(`${tab} [data-testid=scene-preset-top]`);
  await smoke.until(async () => (await readOrbit(smoke))?.elevation === 89);
  await wait(150);
  let v = await sceneView(smoke);
  const floorAt: Vec3 = [1500, 900, 0];
  const floor = await v.pixel(floorAt);
  // The sofa is turned a quarter: its back (charcoal) runs along x = 2150–2350 at 800 high.
  const sofaBack: Vec3 = [sofa.at[0] - 350, sofa.at[1], 800];
  const back = await v.pixel(sofaBack);
  smoke.check('the sofa is drawn in 3D where it stands', colorDistance(back, floor) > 40, { back, floor });
  // The imported table: its top (brown in the model) once the model has loaded; a grey box stands in until then.
  const tableTop: Vec3 = [4700, 1300, 750];
  smoke.check('the imported model is loaded and drawn', await smoke.until(async () => {
    const [r, , b] = ((await v.pixel(tableTop)) ?? '0,0,0').split(',').map(Number);
    return r > b + 25;
  }, 10_000), { top: await v.pixel(tableTop), floor });
  // The door's leaf: open at 90° into the room from the hinge at x = 2600, 800 long, 2050 high.
  const leafAt = v.at([2620, 500, 2050]);
  for (let i = 0; i < 4; i++) await smoke.wheel(leafAt.x, leafAt.y, -240);
  await wait(200);
  v = await sceneView(smoke);
  const leaf = await v.pixel([2620, 500, 2050]);
  const besideLeaf = await v.pixel([2800, 500, 0]);
  smoke.check("the door's leaf is drawn open beside its opening", colorDistance(leaf, besideLeaf) > 20, { leaf, besideLeaf });
  await smoke.click(`${tab} [data-testid=scene-preset-iso]`);
  await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 225);
  await wait(150);
  await smoke.shots('53-decor-3d');

  smoke.section('day and night');
  await smoke.click(`${tab} [data-testid=scene-preset-top]`);
  await smoke.until(async () => (await readOrbit(smoke))?.elevation === 89);
  await wait(150);
  v = await sceneView(smoke);
  // Away from the lamp (the south-east corner of the floor), and the floor just beside the lamp's base.
  const away: Vec3 = [5600, 600, 0];
  const nearLamp: Vec3 = [800, 3200, 0];
  const dayAway = await v.pixel(away);
  const dayNear = await v.pixel(nearLamp);
  await smoke.click(`${tab} [data-testid=scene-lighting-night]`);
  smoke.check('Night is chosen and the lamp is lit', (await smoke.until(async () => (await sceneAttr(smoke, 'lighting')) === 'night')) && (await smoke.until(async () => (await sceneAttr(smoke, 'lights')) === '1')));
  const nightAway = await v.pixel(away);
  const nightNear = await v.pixel(nearLamp);
  smoke.check('at night the floor away from the lamp is darker than by day', lightness(nightAway) < lightness(dayAway) - 120, { dayAway, nightAway });
  smoke.check('and the floor by the lamp is lit', lightness(nightNear) > lightness(nightAway) + 90, { nightNear, nightAway, dayNear });
  smoke.check('Night is kept in the view state', await smoke.until(async () => (await run<{ view3d?: { lighting?: string } }>('project.ui.get', {})).view3d?.lighting === 'night'));
  await smoke.click(`${tab} [data-testid=scene-preset-iso]`);
  await smoke.until(async () => (await readOrbit(smoke))?.azimuth === 225);
  await wait(150);
  await smoke.shots('54-decor-night');
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  smoke.check('Day puts the lights out', await smoke.until(async () => (await sceneAttr(smoke, 'lights')) === '0'));

  smoke.section('picking furniture in 3D');
  await smoke.click(`${tab} [data-testid=scene-preset-top]`);
  await smoke.until(async () => (await readOrbit(smoke))?.elevation === 89);
  await wait(150);
  v = await sceneView(smoke);
  const onSofa = v.at(sofaBack);
  await smoke.clickAt(onSofa.x, onSofa.y);
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  smoke.check('a click on the sofa in 3D selects it on the plan', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === sofa.id), await canvasAttr(smoke, 'selection'));

  smoke.section('the Light tool');
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('g');
  smoke.check('G picks the Light tool', await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'light'));
  const pv = await view(smoke);
  // Clear of the furniture (the sofa starts at x = 2150, the bed at y = 1950): a light there is the only thing under the pointer.
  const spot: [number, number] = [1700, 700];
  const inSymbol: [number, number] = [spot[0] + 25, spot[1] + 25];
  const before = await pv.pixel(inSymbol);
  const p = pv.at(spot);
  await smoke.clickAt(p.x, p.y, { modifiers: ['alt'] });
  const lights = () => entities().filter((e): e is Extract<Entity, { type: 'light' }> => e.type === 'light');
  smoke.check('a click adds a light at the height the options give', await smoke.until(() => lights().some((l) => Math.abs(l.at[0] - spot[0]) <= 2 / pv.cam.scale && l.at[2] === 2400)), lights());
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select');
  // The options bar went with the tool: the canvas moved, so measure again.
  await smoke.until(async () => (await smoke.count(`${tab} [data-testid=tool-options]`)) === 0);
  const sv = await view(smoke);
  const after = await sv.pixel(inSymbol);
  smoke.check('the light is drawn on the plan', after !== before, { before, after });
  const added = lights().find((l) => Math.abs(l.at[0] - spot[0]) <= 2 / pv.cam.scale)!;
  await smoke.clickAt(sv.at(spot).x, sv.at(spot).y);
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  smoke.check('the inspector shows the light', (await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === added.id)) && (await smoke.waitFor(`${tab} [data-testid=light-editor]`)));
  const lumens = (await smoke.rect(`${tab} [data-testid=light-lumens]`))!;
  await smoke.clickAt(lumens.x + lumens.width / 2, lumens.y + lumens.height / 2);
  await smoke.key('A', ['control']);
  await smoke.typeText('1500');
  await smoke.key('Return');
  smoke.check('its lumens are typed in the inspector', await smoke.until(() => (doc().levelData[ground].entities[added.id] as { intensity: number }).intensity === 1500));
  await smoke.shots('55-decor-light');
}
