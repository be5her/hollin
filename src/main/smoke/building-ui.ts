import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { wait, type Smoke } from './harness';

const tab = '[data-tab-type="project.editor"]:not(.hidden)';
const row = (name: string) => `${tab} [data-testid=level-row][data-name="${name}"]`;

/** The building in the project tab: levels and layers, live agent edits, undo, the section. */
export async function smokeBuildingUi(smoke: Smoke, towerId: string): Promise<void> {
  const { host } = smoke;
  smoke.section('building UI');
  await smoke.run('project.open', { id: towerId });
  smoke.check('the project tab shows the levels from top to bottom', await smoke.until(async () => (await smoke.js<string[]>(`[...document.querySelectorAll('${tab} [data-testid=level-row]')].map((r) => r.dataset.name)`)).join() === 'Level 2,Level 1,Gallery,Ground floor,Basement', 8000));
  smoke.check('elevations are shown in display units', (await smoke.js<string>(`document.querySelector('${row('Level 1')} [data-testid=level-elevation]').textContent.trim()`)) === '3600 mm');
  await smoke.click(`${tab} [data-testid=center-tab-section]`);
  smoke.check('the main view switches to the section', await smoke.waitFor(`${tab} [data-testid=section-view]`));
  smoke.check('the section draws every level and connector', (await smoke.count(`${tab} [data-testid=section-level]`)) === 5 && (await smoke.count(`${tab} [data-testid=section-connector]`)) === 2);
  smoke.check('the section draws the stair with its 19 derived risers', (await smoke.js<string | undefined>(`document.querySelector('${tab} [data-testid=section-stair-steps]')?.dataset.risers`)) === '19');
  smoke.check('the active level lists what it holds', await smoke.waitFor(`${tab} [data-testid=level-contents]`, 3000, '1 wall'));
  await smoke.shots('11-building');

  await smoke.click(row('Level 2'));
  smoke.check('clicking a level makes it active', await smoke.waitFor(`${row('Level 2')}[aria-selected=true]`));
  smoke.check('the layers panel follows the active level', await smoke.waitFor(`${tab} [data-testid=layers-panel]`, 3000, 'Level 2'));

  smoke.section('live agent edits');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-ui-architect', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${towerId}`)));
  await client.callTool({ name: 'building_level_add', arguments: { name: 'Roof' } });
  smoke.check('a level an agent adds appears at once, at the top', await smoke.until(async () => (await smoke.js<string | undefined>(`document.querySelector('${tab} [data-testid=level-row]')?.dataset.name`)) === 'Roof'));
  await smoke.click(`${tab} [data-testid=right-tab-history]`);
  smoke.check("the history names the agent's change", await smoke.waitFor(`${tab} [data-testid=history-item][data-author="via MCP: smoke-ui-architect 1.0"]`, 3000, 'Add level "Roof"'));
  await smoke.shots('12-history');
  await smoke.click(`${tab} [data-testid=project-undo]`);
  smoke.check('the undo button takes it back', await smoke.gone(row('Roof')));
  await client.close();

  smoke.section('editing levels');
  await smoke.click(row('Ground floor'));
  await smoke.waitFor(`${tab} [data-testid=level-details]`);
  await smoke.fill(`${tab} [data-testid=level-height-input]`, '4m');
  await smoke.js(`document.querySelector('${tab} [data-testid=level-height-input]').dispatchEvent(new FocusEvent('blur'))`);
  smoke.check('a height typed in any unit moves the levels above on screen', await smoke.until(async () => (await smoke.js<string>(`document.querySelector('${row('Level 1')} [data-testid=level-elevation]').textContent.trim()`)) === '4000 mm'));
  smoke.check('and regenerates the stair: 22 risers in the section', await smoke.until(async () => (await smoke.js<string | undefined>(`document.querySelector('${tab} [data-testid=section-stair-steps]')?.dataset.risers`)) === '22'));
  await smoke.fill(`${tab} [data-testid=level-height-input]`, 'tall');
  await smoke.js(`document.querySelector('${tab} [data-testid=level-height-input]').dispatchEvent(new FocusEvent('blur'))`);
  smoke.check('text that is not a length is refused', (await smoke.waitFor('body', 3000, '"tall" is not a length')) && host.projects.session(towerId)!.doc.levels[host.projects.session(towerId)!.doc.building.groundLevelId].place.height === 4000);

  const structure = `${tab} [data-testid=layer-row][data-name="Structure"]`;
  await smoke.click(`${structure} [data-testid=layer-visible]`);
  smoke.check('hiding a layer is stored', await smoke.waitFor(`${structure}[data-visible=false]`));
  await smoke.js(`document.activeElement?.blur()`);
  await smoke.key('Z', ['control']);
  smoke.check('Ctrl+Z undoes it', await smoke.waitFor(`${structure}[data-visible=true]`));
  await smoke.key('Z', ['control', 'shift']);
  smoke.check('Ctrl+Shift+Z redoes it', await smoke.waitFor(`${structure}[data-visible=false]`));
  await smoke.click(`${structure} [data-testid=layer-visible]`);

  const order = () => smoke.js<string[]>(`[...document.querySelectorAll('${tab} [data-testid=level-row]')].map((r) => r.dataset.name)`);
  const l2 = await smoke.rect(row('Level 2'));
  const l1 = await smoke.rect(row('Level 1'));
  if (l1 && l2) {
    await smoke.drag({ x: l2.x + 30, y: l2.y + l2.height / 2 }, { x: l1.x + 30, y: l1.y + l1.height - 3 });
    smoke.check('dragging a level reorders the stack', await smoke.until(async () => (await order()).slice(0, 2).join() === 'Level 1,Level 2'), await order());
    await smoke.key('Z', ['control']);
    await smoke.until(async () => (await order()).slice(0, 2).join() === 'Level 2,Level 1');
  }

  await smokeLevelManagement(smoke, towerId);

  await smoke.click(`${tab} [data-testid=right-tab-details]`);
  smoke.check('the details panel lists snapshots', await smoke.waitFor(`${tab} [data-testid=snapshot-item][data-name="Full building"]`));
  await smoke.shots('13-details');
  await wait(50);
}

/** The levels panel's own commands: renaming in place, adding with values, mezzanines moved between levels, removal listing what goes. Everything is undone at the end. */
async function smokeLevelManagement(smoke: Smoke, towerId: string): Promise<void> {
  smoke.section('level management');
  const doc = () => smoke.host.projects.session(towerId)!.doc;
  const elevationOf = async (name: string) => Number(await smoke.js<string>(`document.querySelector('${row(name)}')?.dataset.elevation`));
  const undo = () => smoke.click(`${tab} [data-testid=project-undo]`);
  const menu = async (name: string, item: string) => {
    await smoke.rightClick(`${row(name)} [data-testid=level-row-name]`);
    return smoke.click(`[data-testid=${item}]`);
  };
  const submitForm = () => smoke.click('x-dialog-host [data-testid=form-dialog-confirm]');

  // Rename in place: a double-click on the name, Enter keeps it, Escape drops it.
  const name = await smoke.rect(`${row('Level 2')} [data-testid=level-row-name]`);
  if (name) await smoke.clickAt(name.x + 10, name.y + name.height / 2, { clickCount: 2 });
  smoke.check('double-clicking a level name edits it in place', await smoke.waitFor(`${tab} [data-testid=level-rename]`));
  await smoke.fill(`${tab} [data-testid=level-rename]`, 'Roof terrace');
  await smoke.key('Return');
  smoke.check('Enter renames the level', await smoke.waitFor(row('Roof terrace')));
  const renamed = await smoke.rect(row('Roof terrace'));
  if (renamed) await smoke.clickAt(renamed.x + renamed.width - 20, renamed.y + renamed.height / 2);
  await smoke.key('F2');
  await smoke.fill(`${tab} [data-testid=level-rename]`, 'Discarded');
  await smoke.key('Escape');
  smoke.check('F2 edits the name and Escape drops the change', (await smoke.gone(`${tab} [data-testid=level-rename]`)) && !(await smoke.count(row('Discarded'))) && (await smoke.count(row('Roof terrace'))) === 1);
  await undo();
  smoke.check('the rename is one undo step', await smoke.waitFor(row('Level 2')));

  // A level below the basement, with a typed height.
  await menu('Basement', 'level-menu-add-below');
  smoke.check('"Add level below…" asks for name, height and slab', await smoke.waitFor('x-dialog-host [data-testid=form-dialog]', 3000, 'Floor to floor'));
  await smoke.fill('x-dialog-host [data-testid=dialog-field-name]', 'Parking');
  await smoke.fill('x-dialog-host [data-testid=dialog-field-height]', 'deep');
  smoke.check('a height that is not a length cannot be confirmed', (await smoke.waitFor('x-dialog-host', 2000, 'Not a length')) && (await smoke.js<boolean>(`document.querySelector('x-dialog-host [data-testid=form-dialog-confirm]').disabled`)));
  await smoke.fill('x-dialog-host [data-testid=dialog-field-height]', '2.5m');
  await submitForm();
  smoke.check('the new level goes below the basement at its typed height', (await smoke.waitFor(row('Parking'))) && (await elevationOf('Parking')) === -5500, await elevationOf('Parking'));
  await undo();
  await smoke.gone(row('Parking'));

  // A mezzanine with an offset, moved to another level and back.
  const level1 = await elevationOf('Level 1');
  const level2 = await elevationOf('Level 2');
  await menu('Level 1', 'level-menu-mezzanine');
  await smoke.waitFor('x-dialog-host [data-testid=form-dialog]');
  await smoke.fill('x-dialog-host [data-testid=dialog-field-name]', 'Loft');
  await smoke.fill('x-dialog-host [data-testid=dialog-field-offset]', '1200');
  await smoke.fill('x-dialog-host [data-testid=dialog-field-height]', '1800');
  await submitForm();
  smoke.check('a mezzanine is added at the typed offset above its level', (await smoke.waitFor(row('Loft'))) && (await elevationOf('Loft')) === level1 + 1200, await elevationOf('Loft'));
  smoke.check('the section draws it', await smoke.waitFor(`${tab} [data-testid=section-level][data-name="Loft"]`));
  await smoke.waitFor(`${tab} [data-testid=level-host]`);
  await smoke.fill(`${tab} [data-testid=level-host]`, doc().building.stack[doc().building.stack.length - 1]);
  smoke.check('choosing another host in the details moves the mezzanine onto that level', await smoke.until(async () => (await elevationOf('Loft')) === level2), await elevationOf('Loft'));
  await smoke.shots('13a-mezzanine');
  await menu('Loft', 'level-menu-rehost');
  await smoke.waitFor('x-dialog-host [data-testid=dialog-field-host]');
  const level1Id = Object.values(doc().levels).find((l) => l.name === 'Level 1')!.id;
  await smoke.fill('x-dialog-host [data-testid=dialog-field-host]', level1Id);
  await submitForm();
  smoke.check('"Move to another level…" puts it back on Level 1', await smoke.until(async () => (await elevationOf('Loft')) === level1), await elevationOf('Loft'));
  for (let i = 0; i < 3; i++) await undo();
  smoke.check('undo takes the mezzanine away again', await smoke.gone(row('Loft')));

  // Removing a level lists what goes with it; a level hosting a mezzanine says what to move first.
  await menu('Ground floor', 'level-menu-remove');
  smoke.check('a level hosting a mezzanine cannot be removed, and says why', await smoke.waitFor('body', 3000, 'Move or remove "Gallery" first'));
  await menu('Level 1', 'level-menu-remove');
  smoke.check('removing a level lists the stair that goes and the elevator that stops skipping it', (await smoke.waitFor('x-dialog-host [data-testid=confirm-details]', 3000, 'Removed with it: stair')) && ((await smoke.text('x-dialog-host [data-testid=confirm-details]')) ?? '').includes('No longer stopping here: elevator'));
  await smoke.shots('13b-remove-level');
  await smoke.click('x-dialog-host button', 'Remove');
  smoke.check('confirming removes it with its stair', (await smoke.gone(row('Level 1'))) && Object.values(doc().connectors).every((c) => c.kind !== 'stair'));
  await undo();
  smoke.check('undo brings the level and its stair back', (await smoke.waitFor(row('Level 1'))) && Object.values(doc().connectors).some((c) => c.kind === 'stair'));
}
