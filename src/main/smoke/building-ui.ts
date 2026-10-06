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

  await smoke.click(`${tab} [data-testid=right-tab-details]`);
  smoke.check('the details panel lists snapshots', await smoke.waitFor(`${tab} [data-testid=snapshot-item][data-name="Full building"]`));
  await smoke.shots('13-details');
  await wait(50);
}
