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
    await smoke.fill(`${tab} [data-testid=plan-level]`, levelId);
    await smoke.until(async () => (await canvasAttr(smoke, 'level')) === levelId);
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
}
