import type { OpenProject } from '@studio/core';
import { wait, type Smoke } from './harness';

const tab = '[data-tab-type="project.editor"]:not(.hidden)';
const canvas = `${tab} [data-testid=plan-canvas]`;

/**
 * 5,000 walls on one level: added in three batches, drawn, then panned and zoomed with real input
 * while the plan's frame time is read from the canvas. The bounds are loose (CI draws with
 * software GL); the numbers are logged for the eye.
 */
export async function smokePerf(smoke: Smoke): Promise<void> {
  smoke.section('performance');
  const project = await smoke.run<OpenProject>('project.create', { name: 'Stress' });
  const ground = smoke.host.projects.session(project.id)!.doc.building.groundLevelId;
  smoke.check('the stress project opens in a tab', await smoke.until(() => smoke.js<boolean>(`!!document.querySelector('${tab} [data-testid=plan-level] option[value="${ground}"]')`)));
  // A grid of short walls, none touching another, so every one is a separate body.
  const steps = [];
  for (let i = 0; i < 5000; i++) {
    const x = (i % 71) * 1000;
    const y = Math.floor(i / 71) * 1000;
    const vertical = (i + Math.floor(i / 71)) % 2 === 1;
    steps.push({ command: 'plan.wall.add', input: { levelId: ground, from: [x, y], to: vertical ? [x, y + 700] : [x + 700, y], thickness: 150 } });
  }
  const t0 = Date.now();
  for (let i = 0; i < steps.length; i += 2000) await smoke.run('plan.apply', { label: `Walls ${i / 2000 + 1}`, steps: steps.slice(i, i + 2000) }, { projectId: project.id });
  const added = Date.now() - t0;
  const count = () => Object.keys(smoke.host.projects.session(project.id)!.doc.levelData[ground].entities).length;
  smoke.check(`5,000 walls added in three batches (${added} ms)`, count() === 5000 && added < 30_000, { count: count(), added });
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.waitFor(canvas);
  await smoke.fill(`${tab} [data-testid=plan-level]`, ground);
  const attr = (name: string) => smoke.js<string | undefined>(`document.querySelector('${canvas}')?.dataset.${name}`);
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  smoke.check('the plan shows them all', await smoke.until(async () => (await attr('entities')) === '5000', 20_000), await attr('entities'));
  await wait(300);
  const firstFrame = Number(await attr('frameMs'));
  const rect = (await smoke.rect(canvas))!;
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const frames: number[] = [];
  const sample = async () => {
    await wait(80);
    frames.push(Number(await attr('frameMs')));
  };
  for (let i = 0; i < 4; i++) {
    await smoke.wheel(centre.x + i * 20, centre.y, -240);
    await sample();
  }
  for (let i = 0; i < 3; i++) {
    await smoke.dragAt(centre, { x: centre.x + 90, y: centre.y + 40 }, { button: 'middle', steps: 6 });
    await sample();
  }
  for (let i = 0; i < 3; i++) {
    await smoke.wheel(centre.x, centre.y, 240);
    await sample();
  }
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  const worst = Math.max(...frames);
  console.log(`5,000 walls: full frame ${firstFrame.toFixed(1)} ms; ${frames.length} frames while zooming and panning: mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  smoke.check(`panning and zooming 5,000 walls stays under 100 ms a frame (mean ${mean.toFixed(1)} ms)`, frames.every(Number.isFinite) && mean < 100, { firstFrame, frames });
  const rooms = await smoke.run<unknown[]>('plan.rooms', { levelId: ground }, { projectId: project.id });
  smoke.check('nothing encloses a room on the grid', rooms.length === 0);
  await smoke.run('project.close', { id: project.id });
}
