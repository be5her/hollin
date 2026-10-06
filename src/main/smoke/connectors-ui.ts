import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, tab, view } from './plan-canvas';

/** Stairs and elevators on the plan with real input: the stairwell and shaft cut out of the upper slab. */
export async function smokeConnectorsUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('connectors on the plan');
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  await smoke.run('project.open', { id: duplexId });
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  smoke.check('the duplex opens on its plan', await smoke.waitFor(canvas));
  const ground = doc().building.groundLevelId;
  const upper = doc().building.stack[1];

  const showLevel = async (levelId: string) => {
    // The switcher lists the levels once the document has arrived; a value set before that is dropped.
    await smoke.waitFor(`${tab} [data-testid=plan-level] option[value="${levelId}"]`);
    await smoke.fill(`${tab} [data-testid=plan-level]`, levelId);
    await smoke.until(async () => (await canvasAttr(smoke, 'level')) === levelId);
    // The switcher changes before the frame does: sample pixels only once a frame of this level has been drawn.
    smoke.check(`the plan shows ${doc().levels[levelId].name}`, await smoke.until(async () => (await canvasAttr(smoke, 'frameLevel')) === levelId), { level: await canvasAttr(smoke, 'level'), frameLevel: await canvasAttr(smoke, 'frameLevel') });
    await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
    await wait(150);
    return view(smoke);
  };

  // A point in the stairwell clear of its tread lines, one in the shaft clear of the car's cross, and one on the floor, all off the grid lines.
  const inStairwell: [number, number] = [2345, 2617];
  const inShaft: [number, number] = [6713, 4589];
  const onFloor: [number, number] = [5123, 1937];
  let v = await showLevel(upper);
  const upperFloor = await v.pixel(onFloor);
  const upperWell = await v.pixel(inStairwell);
  const upperShaft = await v.pixel(inShaft);
  v = await showLevel(ground);
  const groundFloor = await v.pixel(onFloor);
  const groundWell = await v.pixel(inStairwell);
  smoke.check('the upper slab is painted, with the stairwell cut out of it', upperFloor !== null && upperWell !== null && upperWell !== upperFloor, { upperFloor, upperWell });
  smoke.check('and the elevator shaft too', upperShaft !== null && upperShaft !== upperFloor, { upperFloor, upperShaft });
  smoke.check('the ground slab, where the stair starts, is not cut', groundWell === groundFloor && groundFloor === upperFloor, { groundFloor, groundWell });
  await showLevel(upper);
  await smoke.shots('20-stairwell');

  smoke.section('connector symbols');
  const stairId = Object.values(doc().connectors).find((c) => c.kind === 'stair')!.id;
  // The first tread line runs along the stair's bottom edge (y = 1000); the elevator's door mark sits on the shaft's front side below (y = 4400) and its back side above (y = 6600).
  const firstTread: [number, number] = [2345, 1000];
  v = await showLevel(ground);
  smoke.check('the ground floor shows both connectors', (await canvasAttr(smoke, 'connectors')) === '2', await canvasAttr(smoke, 'connectors'));
  const groundTread = await v.pixel(firstTread);
  const groundDoor = await v.pixel([7500, 4400]);
  const groundBack = await v.pixel([7500, 6600]);
  smoke.check("the stair's treads are drawn where it starts", groundTread !== null && groundTread !== groundFloor, { groundTread, groundFloor });
  smoke.check('the elevator door is marked on the side it opens at the ground floor', groundDoor !== groundBack, { groundDoor, groundBack });
  await smoke.shots('21-stair-up');
  v = await showLevel(upper);
  smoke.check('the upper floor shows both connectors', (await canvasAttr(smoke, 'connectors')) === '2');
  const upperTread = await v.pixel(firstTread);
  const upperBack = await v.pixel([7500, 6600]);
  smoke.check('the stair is drawn where it arrives, over its stairwell', upperTread !== null && upperTread !== upperWell, { upperTread, upperWell });
  smoke.check('and the elevator door on its back side there', upperBack !== groundBack, { upperBack, groundBack });
  await smoke.shots('22-stair-down');

  smoke.section('editing connectors on the plan');
  v = await showLevel(ground);
  const axis = () => (doc().connectors[stairId] as { axis: { v: { p: readonly number[] }[] } }).axis.v.map((x) => x.p.map((n) => Math.round(n / 5) * 5).join(',')).join(' ');
  const inside = v.at([2300, 2617]);
  await smoke.clickAt(inside.x, inside.y);
  smoke.check('a click on the stair selects it', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === stairId), await canvasAttr(smoke, 'selection'));
  smoke.check('the Properties panel shows the stair with its derived numbers', (await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000, 'Stair')) && (await smoke.waitFor(`${tab} [data-testid=connector-derived]`, 3000, '16 risers')));
  await smoke.shots('23-stair-selected');
  // Alt keeps snapping out of the way, so the move is exactly what the pointer did.
  const moveTo = v.at([3300, 2617]);
  await smoke.dragAt(inside, moveTo, { modifiers: ['alt'] });
  smoke.check('dragging the stair moves it on the plan', await smoke.until(() => axis() === '3000,1000 3000,4750'), axis());
  await smoke.key('Z', ['control']);
  smoke.check('Ctrl+Z puts it back', await smoke.until(() => axis() === '2000,1000 2000,4750'), axis());
  await smoke.clickAt(inside.x, inside.y);
  await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === stairId);
  const top = v.at([2000, 4750]);
  const further = v.at([2000, 5250]);
  await smoke.dragAt(top, further, { modifiers: ['alt'] });
  smoke.check("dragging the top of the stair's walk line lengthens it", await smoke.until(() => axis() === '2000,1000 2000,5250'), axis());
  smoke.check('and regenerates its treads', await smoke.waitFor(`${tab} [data-testid=connector-derived]`, 3000, '16 risers'));
  await smoke.key('Z', ['control']);
  await smoke.until(() => axis() === '2000,1000 2000,4750');
  await smoke.clickAt(inside.x, inside.y);
  await smoke.key('Delete');
  smoke.check('Delete removes the stair', await smoke.until(() => !doc().connectors[stairId]));
  await smoke.key('Z', ['control']);
  smoke.check('and Ctrl+Z brings it back', await smoke.until(() => Boolean(doc().connectors[stairId])));
  await smoke.key('Escape');
}
