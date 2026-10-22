import type { OpenProject } from '@studio/core';
import { wait, type Smoke } from './harness';

const tab = '[data-tab-type="project.editor"]:not(.hidden)';
const canvas = `${tab} [data-testid=plan-canvas]`;

/**
 * 5,000 walls on one level: added in three batches, drawn, then panned and zoomed with real input
 * while the plan's frame time is read from the canvas; then built in 3D and orbited and zoomed there.
 * Then 200 pieces of furniture and 20 lights, orbited in 3D at night with the 16 nearest lights on.
 * The bounds are loose (CI draws with software GL); the numbers are logged for the eye.
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

  // The same 5,000 walls in 3D: built, then orbited and zoomed with real input.
  const scene = `${tab} [data-testid=scene-canvas]`;
  const sceneAttr = (name: string) => smoke.js<string | undefined>(`document.querySelector('${scene}')?.dataset.${name}`);
  const t1 = Date.now();
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  smoke.check('the 3D view builds them', await smoke.until(async () => Number(await sceneAttr('meshes')) > 0, 30_000), await sceneAttr('meshes'));
  const built = Date.now() - t1;
  await wait(300);
  const r3 = (await smoke.rect(scene))!;
  const middle = { x: r3.x + r3.width / 2, y: r3.y + r3.height / 2 };
  const frames3d: number[] = [];
  const sample3d = async () => {
    await wait(80);
    frames3d.push(Number(await sceneAttr('frameMs')));
  };
  for (let i = 0; i < 3; i++) {
    await smoke.dragAt(middle, { x: middle.x + 80, y: middle.y + 20 }, { steps: 6 });
    await sample3d();
  }
  for (let i = 0; i < 3; i++) {
    await smoke.wheel(middle.x, middle.y, -240);
    await sample3d();
  }
  const mean3d = frames3d.reduce((a, b) => a + b, 0) / frames3d.length;
  console.log(`5,000 walls in 3D: built and first drawn in ${built} ms; ${frames3d.length} frames while orbiting and zooming: mean ${mean3d.toFixed(1)} ms, worst ${Math.max(...frames3d).toFixed(1)} ms`);
  smoke.check(`orbiting and zooming 5,000 walls in 3D stays under 250 ms a frame (mean ${mean3d.toFixed(1)} ms)`, frames3d.every(Number.isFinite) && mean3d < 250, { built, frames3d });
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.run('project.close', { id: project.id });

  // 200 pieces of furniture and 20 lights in 3D, at night: placed in one batch, drawn, orbited and zoomed.
  const furnished = await smoke.run<OpenProject>('project.create', { name: 'Furnished stress' });
  const floor = smoke.host.projects.session(furnished.id)!.doc.building.groundLevelId;
  const models = ['builtin:sofa-3', 'builtin:armchair', 'builtin:dining-table-6', 'builtin:dining-chair', 'builtin:bed-double', 'builtin:wardrobe', 'builtin:desk', 'builtin:office-chair', 'builtin:bookshelf', 'builtin:planter'];
  const decor = [
    { command: 'plan.entity.add', input: { levelId: floor, entity: { type: 'slab', source: { k: 'region', region: { outer: { closed: true, v: [{ p: [-1500, -1500] }, { p: [58500, -1500] }, { p: [58500, 28500] }, { p: [-1500, 28500] }] } } } } } },
    ...Array.from({ length: 200 }, (_, i) => ({ command: 'decor.item.place', input: { levelId: floor, ref: models[i % models.length], at: [(i % 20) * 3000, Math.floor(i / 20) * 3000], rotation: (i * 30) % 360 } })),
    ...Array.from({ length: 20 }, (_, i) => ({ command: 'decor.light.add', input: { levelId: floor, at: [(i % 5) * 12000 + 1500, Math.floor(i / 5) * 7000 + 1500, 2400], intensity: 1500 } })),
  ];
  const t2 = Date.now();
  await smoke.run('plan.apply', { label: 'Furnish', steps: decor }, { projectId: furnished.id });
  const placed = Date.now() - t2;
  const entities = Object.values(smoke.host.projects.session(furnished.id)!.doc.levelData[floor].entities);
  smoke.check(`200 items and 20 lights placed in one batch (${placed} ms)`, entities.filter((e) => e.type === 'item').length === 200 && entities.filter((e) => e.type === 'light').length === 20, { placed });
  await smoke.until(() => smoke.js<boolean>(`!!document.querySelector('${tab} [data-testid=plan-level] option[value="${floor}"]')`));
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  const t3 = Date.now();
  smoke.check('the 3D view builds the furniture', await smoke.until(async () => Number(await sceneAttr('meshes')) > 400, 30_000), await sceneAttr('meshes'));
  const furnishedBuilt = Date.now() - t3;
  await smoke.click(`${tab} [data-testid=scene-lighting-night]`);
  smoke.check('at night only the 16 nearest of the 20 lights are on', await smoke.until(async () => (await sceneAttr('lights')) === '16'), await sceneAttr('lights'));
  await wait(300);
  const r4 = (await smoke.rect(scene))!;
  const mid = { x: r4.x + r4.width / 2, y: r4.y + r4.height / 2 };
  const framesDecor: number[] = [];
  const sampleDecor = async () => {
    await wait(80);
    framesDecor.push(Number(await sceneAttr('frameMs')));
  };
  for (let i = 0; i < 3; i++) {
    await smoke.dragAt(mid, { x: mid.x + 80, y: mid.y + 20 }, { steps: 6 });
    await sampleDecor();
  }
  for (let i = 0; i < 3; i++) {
    await smoke.wheel(mid.x, mid.y, -240);
    await sampleDecor();
  }
  const meanDecor = framesDecor.reduce((a, b) => a + b, 0) / framesDecor.length;
  console.log(`200 items and 20 lights in 3D at night: placed in ${placed} ms, built and first drawn in ${furnishedBuilt} ms (${await sceneAttr('meshes')} meshes); ${framesDecor.length} frames while orbiting and zooming: mean ${meanDecor.toFixed(1)} ms, worst ${Math.max(...framesDecor).toFixed(1)} ms`);
  smoke.check(`orbiting 200 items with 16 lights on stays under 250 ms a frame (mean ${meanDecor.toFixed(1)} ms)`, framesDecor.every(Number.isFinite) && meanDecor < 250, { furnishedBuilt, framesDecor });
  await smoke.click(`${tab} [data-testid=scene-lighting-day]`);
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.run('project.close', { id: furnished.id });
}
