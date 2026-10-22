import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { DesignDescription, Entity, OpenProject, ProjectDoc } from '@studio/core';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, openProjectTab, tab, view } from './plan-canvas';

type Item = Extract<Entity, { type: 'item' }>;

/** A one-room flat, drawn through commands: walls round 6 × 4.5 m and a living room. */
export async function decorRoom(smoke: Smoke, name: string): Promise<{ id: string; ground: string; roomId: string }> {
  const project = await smoke.run<OpenProject>('project.create', { name, open: false });
  await smoke.run('project.open', { id: project.id });
  const ground = (smoke.host.projects.session(project.id)!.doc as ProjectDoc).building.groundLevelId;
  const run = <T = unknown>(id: string, input: unknown) => smoke.run<T>(id, input, { projectId: project.id });
  await run('plan.wall.add', { levelId: ground, points: [{ p: [0, 0] }, { p: [6000, 0] }, { p: [6000, 4500] }, { p: [0, 4500] }], closed: true });
  const room = await run<{ id: string }>('plan.room.add', { levelId: ground, seed: [3000, 2250], name: 'Living' });
  return { id: project.id, ground, roomId: room.id };
}

/** Furniture on the plan with real input: the Catalog panel, the Furniture tool, the grips and the inspector, and an agent furnishing over MCP. */
export async function smokeDecorUi(smoke: Smoke, tableRef: string): Promise<{ flatId: string }> {
  smoke.section('the catalog panel');
  const flat = await decorRoom(smoke, 'Decor Living');
  const doc = () => smoke.host.projects.session(flat.id)!.doc as ProjectDoc;
  const items = () => Object.values(doc().levelData[flat.ground].entities).filter((e): e is Item => e.type === 'item');
  smoke.check('the flat opens in its tab', await openProjectTab(smoke, flat.id));
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.waitFor(canvas);
  await smoke.click(`${tab} [data-testid=right-tab-catalog]`);
  smoke.check('the Catalog panel lists the built-in furniture', (await smoke.waitFor(`${tab} [data-testid=catalog-panel]`)) && (await smoke.until(async () => (await smoke.count(`${tab} [data-testid=catalog-card]`)) >= 32)), await smoke.count(`${tab} [data-testid=catalog-card]`));
  smoke.check('built-ins have pictures drawn in the window', await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="builtin:sofa-3"] img[src^="data:image/png"]`));
  // The model imported through commands before the window opened gets its picture once the panel asks for it.
  smoke.check("the imported model's picture is drawn and stored with the library", await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="${tableRef}"] img[src^="library://catalog/furniture/"]`, 8000));
  smoke.check('and served over library://', await smoke.until(() => smoke.js<boolean>(`(() => { const img = document.querySelector('${tab} [data-testid=catalog-card][data-ref="${tableRef}"] img'); return Boolean(img && img.complete && img.naturalWidth > 0); })()`)));
  await smoke.fill(`${tab} [data-testid=catalog-search]`, 'sofa');
  smoke.check('searching narrows the list, best match first', await smoke.until(async () => (await smoke.js<string>(`document.querySelector('${tab} [data-testid=catalog-card]')?.dataset.ref ?? ''`)) === 'builtin:sofa-2' && (await smoke.count(`${tab} [data-testid=catalog-card]`)) < 10));
  await smoke.fill(`${tab} [data-testid=catalog-search]`, '');
  await smoke.click(`${tab} [data-testid=catalog-category][data-category=bedroom]`);
  smoke.check('a category chip keeps its furniture', await smoke.until(async () => (await smoke.count(`${tab} [data-testid=catalog-card]`)) === 5));
  await smoke.click(`${tab} [data-testid=catalog-category]`, 'All');
  await smoke.click(`${tab} [data-testid=catalog-tab-material]`);
  smoke.check('the Materials tab shows swatches', (await smoke.until(async () => (await smoke.count(`${tab} [data-testid=catalog-card]`)) >= 30)) && (await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="builtin:oak-floor"] img[src^="data:image/png"]`)));
  await smoke.shots('50-catalog-materials');
  await smoke.click(`${tab} [data-testid=catalog-tab-item]`);

  smoke.section('placing furniture');
  // Measure where the sofa goes before anything is armed: the floor there, and where it reaches once turned.
  await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
  await wait(150);
  let v = await view(smoke);
  const centre: [number, number] = [2600, 1600];
  // Inside a quarter-turned 2200 × 900 sofa at the centre, but outside the same sofa unturned.
  const turnedOnly: [number, number] = [centre[0] + 280, centre[1] + 830];
  const floorThere = await v.pixel(turnedOnly);
  await smoke.waitFor(`${tab} [data-testid=catalog-card][data-ref="builtin:sofa-3"]`);
  await smoke.click(`${tab} [data-testid=catalog-card][data-ref="builtin:sofa-3"]`);
  smoke.check('a click on a model arms the Furniture tool with it', (await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'item')) && (await smoke.waitFor(`${tab} [data-testid=item-armed]`, 3000, 'Sofa, 3 seats')));
  // The options bar changed the canvas height: measure again.
  v = await view(smoke);
  const p = v.at(centre);
  await smoke.mouseMove(p.x, p.y, ['alt']);
  for (let i = 0; i < 6; i++) await smoke.key('r');
  smoke.check('R turns the model 15° at a time', await smoke.until(async () => /turned 90°/.test((await smoke.text(`${tab} [data-testid=plan-hint]`)) ?? '')), await smoke.text(`${tab} [data-testid=plan-hint]`));
  await smoke.clickAt(p.x, p.y, { modifiers: ['alt'] });
  smoke.check('a click places it there, turned', await smoke.until(() => items().length === 1), items());
  const sofa = items()[0];
  const tol = 1.5 / v.cam.scale;
  smoke.check('the sofa stands where it was clicked, a quarter turn round', Math.abs(sofa.at[0] - centre[0]) <= tol && Math.abs(sofa.at[1] - centre[1]) <= tol && sofa.rotation[2] === 90 && sofa.asset === 'builtin:sofa-3', { at: sofa.at, rotation: sofa.rotation, tol });
  await smoke.key('Escape');
  smoke.check('Escape ends the Furniture tool', await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select'));
  v = await view(smoke);
  const drawn = await v.pixel(turnedOnly);
  smoke.check("the sofa's outline is drawn on the plan, turned", drawn !== null && drawn !== floorThere, { drawn, floorThere });
  await smoke.shots('51-decor-plan');

  smoke.section('editing furniture');
  const grab = v.at([sofa.at[0] - 150, sofa.at[1] + 300]);
  const dropAt = v.at([sofa.at[0] - 150 + 1000, sofa.at[1] + 300]);
  await smoke.dragAt(grab, dropAt, { modifiers: ['alt'] });
  const moved = () => items()[0];
  smoke.check('dragging the sofa moves it', await smoke.until(() => Math.abs(moved().at[0] - (sofa.at[0] + 1000)) <= tol && Math.abs(moved().at[1] - sofa.at[1]) <= tol), moved().at);
  smoke.check('and selects it', (await canvasAttr(smoke, 'selection')) === sofa.id);
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  smoke.check('the inspector shows the item, sized in display units', (await smoke.waitFor(`${tab} [data-testid=item-editor]`)) && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=item-w]').value`)) === '2200 mm');
  const width = (await smoke.rect(`${tab} [data-testid=item-w]`))!;
  await smoke.clickAt(width.x + width.width / 2, width.y + width.height / 2);
  await smoke.key('A', ['control']);
  await smoke.typeText('250cm');
  await smoke.key('Return');
  smoke.check('a width typed in centimetres becomes its scale', await smoke.until(() => Math.abs(moved().scale[0] - 2500 / 2200) < 1e-6), moved().scale);
  smoke.check('the inspector shows the new width', await smoke.until(async () => (await smoke.js<string>(`document.querySelector('${tab} [data-testid=item-w]').value`)) === '2500 mm'));
  await smoke.fill(`${tab} [data-testid=item-slot-fabric]`, 'builtin:fabric-velvet-green');
  smoke.check('a slot picks a material', await smoke.until(() => moved().materials.fabric === 'builtin:fabric-velvet-green'), moved().materials);
  await smoke.shots('52-decor-inspector');
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Z', ['control']);
  await smoke.key('Z', ['control']);
  smoke.check('undo puts the size back', await smoke.until(() => moved().scale[0] === 1 && !moved().materials.fabric), moved());
  await smoke.key('Z', ['control']);
  smoke.check('and then the move', await smoke.until(() => Math.abs(moved().at[0] - sofa.at[0]) <= tol));

  smoke.section('furniture over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-furnisher', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${flat.id}`)));
  const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
  const bed = text(await agent.callTool({ name: 'decor_item_place', arguments: { levelId: flat.ground, ref: 'builtin:bed-double', at: [4500, 3000], rotation: 180, projectId: flat.id } }));
  smoke.check('an agent places a double bed over MCP', typeof bed.id === 'string' && items().some((i) => i.id === bed.id && i.rotation[2] === 180), bed);
  smoke.check('it appears on the plan at once', await smoke.until(async () => Number(await canvasAttr(smoke, 'entities')) >= 7));
  const described = text(await agent.callTool({ name: 'plan_describe', arguments: { projectId: flat.id } })) as unknown as DesignDescription;
  const living = described.levels[0].rooms.find((r) => r.name === 'Living');
  smoke.check('plan.describe lists the bed and the sofa in the living room', Boolean(living?.furniture.some((f) => f.id === bed.id && f.name === 'Double bed' && f.size.join() === '1600,2100,1000')) && Boolean(living?.furniture.some((f) => f.ref === 'builtin:sofa-3')), living?.furniture);
  await agent.close();
  return { flatId: flat.id };
}
