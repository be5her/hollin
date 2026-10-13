import type { Entity, ProjectSummary } from '@studio/core';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, tab, view } from './plan-canvas';

type Wall = Extract<Entity, { type: 'wall' }>;
const DEG = Math.PI / 180;

/** Angle tracking with real input: a wall drawn near vertical lands exactly vertical, one off a diagonal wall lands perpendicular to it, a typed length runs along the tracked ray, Alt draws free, far from the start a few degrees off still tracks, and the toolbar switch turns it off and on. */
export async function smokeTrackingUi(smoke: Smoke): Promise<void> {
  smoke.section('angle tracking');
  const { id: projectId } = await smoke.run<ProjectSummary>('project.create', { name: 'Tracking', open: false });
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const doc = () => smoke.host.projects.session(projectId)!.doc;
  await smoke.run('project.open', { id: projectId });
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  smoke.check('the tracking project opens on its plan', await smoke.waitFor(canvas));
  const ground = doc().building.groundLevelId;
  // A horizontal wall along the top and a wall at 37°, an angle no step offers.
  const diagonalEnd: [number, number] = [-3000 + 4000 * Math.cos(37 * DEG), -3000 + 4000 * Math.sin(37 * DEG)];
  await run('plan.wall.add', { levelId: ground, from: [-4000, 2500], to: [4000, 2500] });
  const diagonal = await run<{ id: string }>('plan.wall.add', { levelId: ground, from: [-3000, -3000], to: diagonalEnd });
  const walls = () => Object.values(doc().levelData[ground].entities).filter((e): e is Wall => e.type === 'wall');
  const diagonalDirection = (() => {
    const w = walls().find((x) => x.id === diagonal.id)!;
    const d = [w.path.v[1].p[0] - w.path.v[0].p[0], w.path.v[1].p[1] - w.path.v[0].p[1]];
    const len = Math.hypot(d[0], d[1]);
    return [d[0] / len, d[1] / len];
  })();
  await smoke.fill(`${tab} [data-testid=plan-level]`, ground);
  await smoke.until(async () => (await canvasAttr(smoke, 'level')) === ground);
  await smoke.until(async () => (await canvasAttr(smoke, 'entities')) === '2');
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(150);
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('W');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  await wait(100);
  const v = await view(smoke);
  const snapText = () => smoke.text(`${tab} [data-testid=plan-snap]`);
  /** Moves the pointer until the footer shows `text`: under load a single synthetic move can land before the canvas has tracked it, so it is repeated (a pixel aside and back) rather than waited for once. */
  const moveUntil = async (x: number, y: number, text: string): Promise<boolean> => {
    for (let i = 0; i < 12; i++) {
      await smoke.mouseMove(x + (i % 2), y);
      if (await smoke.waitFor(`${tab} [data-testid=plan-snap]`, 400, text)) {
        if (i % 2) await smoke.mouseMove(x, y);
        return true;
      }
    }
    return false;
  };
  let known = new Set(walls().map((w) => w.id));
  const remember = () => (known = new Set(walls().map((w) => w.id)));
  const newWall = () => walls().find((w) => !known.has(w.id));
  const polar = (from: readonly [number, number], degrees: number, len: number): [number, number] => [from[0] + len * Math.cos(degrees * DEG), from[1] + len * Math.sin(degrees * DEG)];

  // A start on free floor, then the cursor at about 88°: the 90° ray is a few pixels away and takes over.
  const start: [number, number] = [-2000, -1500];
  const s = v.at(start);
  await smoke.clickAt(s.x, s.y);
  const nearVertical = v.at(polar(start, 88, 2000));
  await smoke.mouseMove(nearVertical.x, nearVertical.y);
  smoke.check('the footer names the tracked angle', await smoke.waitFor(`${tab} [data-testid=plan-snap]`, 2000, '90°'), await snapText());
  // The dashed guide runs on past the cursor along the ray: sample pixels there with Alt (no tracking, no guide) and without.
  const beyond = Array.from({ length: 15 }, (_, i) => ({ x: s.x, y: nearVertical.y - 8 - i * 3 }));
  const samples = () => Promise.all(beyond.map((p) => smoke.canvasPixel(canvas, p.x, p.y)));
  await smoke.mouseMove(nearVertical.x, nearVertical.y, ['alt']);
  await wait(100);
  const withoutGuide = await samples();
  await smoke.mouseMove(nearVertical.x, nearVertical.y);
  await wait(100);
  const withGuide = await samples();
  smoke.check('a dashed guide is drawn along the tracked ray', withGuide.some((px, i) => px !== withoutGuide[i]), { withGuide, withoutGuide });
  await smoke.clickAt(nearVertical.x, nearVertical.y);
  smoke.check('the wall lands exactly vertical', (await smoke.until(() => Boolean(newWall()))) && Math.abs(newWall()!.path.v[1].p[0] - newWall()!.path.v[0].p[0]) < 1e-6 && newWall()!.path.v[1].p[1] > newWall()!.path.v[0].p[1] + 1900, newWall()?.path.v);
  // The run goes on from there: a length typed while tracked runs along the ray.
  const last = newWall()!.path.v[1].p;
  remember();
  const nextCursor = v.at(polar(last, 88, 1500));
  smoke.check('the run goes on tracked at 90°', await moveUntil(nextCursor.x, nextCursor.y, '90°'), await snapText());
  await smoke.key('1');
  await smoke.typeText('200');
  await smoke.key('Return');
  smoke.check('a typed length runs along the tracked direction', (await smoke.until(() => Boolean(newWall()))) && Math.abs(newWall()!.path.v[1].p[0] - last[0]) < 1e-6 && Math.abs(newWall()!.path.v[1].p[1] - (last[1] + 1200)) < 1e-6, newWall()?.path.v);
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  remember();

  // From the end of the diagonal wall, the cursor at about 126° from it: perpendicular to the wall is 127°, and no step is nearer.
  const e = v.at(diagonalEnd);
  smoke.check('the start snaps to the end of the diagonal wall', await moveUntil(e.x, e.y, 'Endpoint'), await snapText());
  await smoke.clickAt(e.x, e.y);
  const perpendicular = v.at(polar(diagonalEnd, 126, 2000));
  smoke.check('the footer says the direction is perpendicular to the wall', await moveUntil(perpendicular.x, perpendicular.y, 'Perpendicular to wall'), await snapText());
  await smoke.shots('24-tracking');
  await smoke.clickAt(perpendicular.x, perpendicular.y);
  const perpendicularWall = () => {
    const w = newWall();
    if (!w) return null;
    const d = [w.path.v[1].p[0] - w.path.v[0].p[0], w.path.v[1].p[1] - w.path.v[0].p[1]];
    const len = Math.hypot(d[0], d[1]);
    return { start: w.path.v[0].p, dot: (d[0] * diagonalDirection[0] + d[1] * diagonalDirection[1]) / len };
  };
  const stored = walls().find((w) => w.id === diagonal.id)!.path.v[1].p;
  smoke.check('the wall starts exactly at the end of the diagonal wall and runs perpendicular to it', (await smoke.until(() => Boolean(newWall()))) && perpendicularWall()!.start[0] === stored[0] && perpendicularWall()!.start[1] === stored[1] && Math.abs(perpendicularWall()!.dot) < 1e-4, perpendicularWall());
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  remember();

  // Alt held: the same near-vertical gesture lands where the pointer is.
  const free: [number, number] = [2500, -2000];
  const f = v.at(free);
  await smoke.clickAt(f.x, f.y, { modifiers: ['alt'] });
  const freeEnd = v.at(polar(free, 88, 2000));
  await smoke.mouseMove(freeEnd.x, freeEnd.y, ['alt']);
  await wait(100);
  smoke.check('Alt suspends tracking', (await snapText()) === '', await snapText());
  await smoke.clickAt(freeEnd.x, freeEnd.y, { modifiers: ['alt'] });
  smoke.check('and the wall lands at the free angle', (await smoke.until(() => Boolean(newWall()))) && Math.abs(newWall()!.path.v[1].p[0] - newWall()!.path.v[0].p[0] - 2000 * Math.cos(88 * DEG)) < 2 / v.cam.scale, newWall()?.path.v);
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  remember();

  // Far from the start the angle counts, not the pixels: 2.5° off vertical, the cursor about 15 px beside the ray (the pixel tolerance is under 10), is still held on it; 5° off every step is free.
  const far: [number, number] = [3500, -2700];
  const farLength = 15 / v.cam.scale / Math.sin(2.5 * DEG);
  const fs0 = v.at(far);
  await smoke.clickAt(fs0.x, fs0.y);
  const farNear = v.at(polar(far, 87.5, farLength));
  const farFree = v.at(polar(far, 85, farLength));
  smoke.check('the far cursor is well beyond the pixel tolerance of the ray', Math.abs(farNear.x - fs0.x) > 11, { start: fs0, cursor: farNear });
  smoke.check('far from the start, a direction 2.5° off vertical is tracked to 90°', await moveUntil(farNear.x, farNear.y, '90°'), await snapText());
  await smoke.mouseMove(farFree.x, farFree.y);
  smoke.check('and one 5° off every step is free', await smoke.until(async () => (await snapText()) === '', 2000), await snapText());
  smoke.check('back near vertical, it is tracked again', await moveUntil(farNear.x, farNear.y, '90°'), await snapText());
  await smoke.clickAt(farNear.x, farNear.y);
  smoke.check('the far wall lands exactly vertical', (await smoke.until(() => Boolean(newWall()))) && Math.abs(newWall()!.path.v[1].p[0] - newWall()!.path.v[0].p[0]) < 1e-6 && newWall()!.path.v[1].p[1] > newWall()!.path.v[0].p[1] + farLength * 0.9, newWall()?.path.v);
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  remember();

  // The switch next to the magnet turns tracking off and on, and the setting is kept.
  const toggle = `${tab} [data-testid=snap-angle-toggle]`;
  const snapAngle = async () => (await smoke.run<{ editor: { snapAngle: boolean } }>('config.get')).editor.snapAngle;
  const pressed = () => smoke.js<string | null>(`document.querySelector('${toggle}').getAttribute('aria-pressed')`);
  smoke.check('the tracking switch shows tracking on', (await pressed()) === 'true', await pressed());
  await smoke.click(toggle);
  smoke.check('the tracking switch turns tracking off, and the setting is kept', (await smoke.until(async () => (await snapAngle()) === false)) && (await smoke.until(async () => (await pressed()) === 'false')));
  const offStart: [number, number] = [0, -2500];
  const o = v.at(offStart);
  await smoke.clickAt(o.x, o.y);
  const offEnd = v.at(polar(offStart, 88, 1200));
  await smoke.clickAt(offEnd.x, offEnd.y);
  smoke.check('with tracking off, the near-vertical wall lands at the free angle', (await smoke.until(() => Boolean(newWall()))) && Math.abs(newWall()!.path.v[1].p[0] - newWall()!.path.v[0].p[0] - 1200 * Math.cos(88 * DEG)) < 2 / v.cam.scale, newWall()?.path.v);
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'wall');
  remember();
  await smoke.click(toggle);
  smoke.check('the switch turns tracking back on', (await smoke.until(async () => (await snapAngle()) === true)) && (await smoke.until(async () => (await pressed()) === 'true')));
  const onStart: [number, number] = [800, -2500];
  const on = v.at(onStart);
  await smoke.clickAt(on.x, on.y);
  const onEnd = v.at(polar(onStart, 88, 1700));
  smoke.check('and the same gesture is tracked to 90° again', await moveUntil(onEnd.x, onEnd.y, '90°'), await snapText());
  await smoke.shots('34-tracking-switch');
  await smoke.key('Escape');
  await smoke.key('Escape');
  await smoke.run('project.close', { id: projectId });
}
