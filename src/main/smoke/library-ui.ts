import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ProjectSummary } from '@studio/core';
import { wait, type Smoke } from './harness';

const tabSelector = (title: string) => `[data-testid=tab][data-type="project.editor"][data-title="${title}"]`;
const cardSelector = (name: string) => `[data-testid=project-card][data-name="${name}"]`;

/** Answers the open prompt dialog with `value`. */
async function answerPrompt(smoke: Smoke, value: string): Promise<boolean> {
  if (!(await smoke.waitFor('x-dialog-host form input'))) return false;
  await smoke.fill('x-dialog-host form input', value);
  return smoke.click('x-dialog-host form button[type=submit]');
}

/** Confirms the open confirm dialog. */
async function confirmDialog(smoke: Smoke, label: string): Promise<boolean> {
  if (!(await smoke.waitFor('x-dialog-host button', 3000, label))) return false;
  return smoke.click('x-dialog-host button', label);
}

/** The project library as a user drives it. */
export async function smokeLibraryUi(smoke: Smoke, houseId: string): Promise<void> {
  const { host } = smoke;
  smoke.section('library UI');
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check('Home lists the projects as cards', (await smoke.waitFor('[data-testid=project-card]')) && (await smoke.count('[data-testid=project-card]')) === host.projects.list().length);
  smoke.check('the open project has a tab', await smoke.waitFor(tabSelector('Smoke House')));

  await smoke.fill('[data-testid=library-search]', 'office');
  smoke.check('searching filters the cards', await smoke.until(async () => (await smoke.count('[data-testid=project-card]')) === 1));
  await smoke.fill('[data-testid=library-search]', '');
  await smoke.until(async () => (await smoke.count('[data-testid=project-card]')) > 1);
  await smoke.click('[data-testid=library-tag]', 'commercial');
  smoke.check('tag chips filter the cards', await smoke.until(async () => (await smoke.count('[data-testid=project-card]')) === 1 && (await smoke.text('[data-testid=project-card-name]')) === 'Office Block'));
  await smoke.click('[data-testid=library-tag]', 'commercial');
  await smoke.until(async () => (await smoke.count('[data-testid=project-card]')) > 1);

  // A real thumbnail, cut from the window itself.
  const image = await smoke.window.webContents.capturePage({ x: 0, y: 0, width: 480, height: 360 });
  await smoke.run('project.thumbnail.set', { id: houseId, png: image.toPNG().toString('base64') });
  smoke.check('a project thumbnail is served to the card', await smoke.until(() => smoke.js<boolean>(`(() => { const img = document.querySelector('${cardSelector('Smoke House')} img'); return !!img && img.complete && img.naturalWidth > 0; })()`)));
  smoke.check('unknown library URLs are not served', await smoke.js<boolean>(`fetch('library://project/prj_0000000000000000/../../config.json').then((r) => r.status === 404, () => true)`));
  await smoke.shots('06-library');

  smoke.section('new project');
  await smoke.click('[data-testid=library-new]');
  smoke.check('New project asks for a name', await smoke.waitFor('x-dialog-host form input'));
  await smoke.shot('07-new-project-dialog');
  await answerPrompt(smoke, 'UI Villa');
  smoke.check('the new project opens in a tab on screen', (await smoke.waitFor(`${tabSelector('UI Villa')}[aria-selected=true]`)) && (await smoke.waitFor('[data-tab-type="project.editor"]:not(.hidden) [data-testid=project-tab]')));
  const villa = host.projects.list().find((p) => p.name === 'UI Villa');
  smoke.check('the host knows it is on screen', await smoke.until(() => host.projects.current()?.id === villa?.id));
  smoke.check('the status bar shows the project and that it is saved', (await smoke.waitFor('[data-testid=status-project]', 3000, 'UI Villa')) && (await smoke.waitFor('[data-testid=status-save][data-state=saved]')));

  const visibleTab = '[data-tab-type="project.editor"]:not(.hidden)';
  await smoke.fill(`${visibleTab} [data-testid=project-name]`, 'UI Villa Renamed');
  await smoke.js(`document.querySelector('${visibleTab} [data-testid=project-name]').dispatchEvent(new FocusEvent('blur'))`);
  smoke.check('renaming in the project tab saves the name', await smoke.until(() => host.projects.get(villa!.id)?.name === 'UI Villa Renamed'));
  smoke.check('the tab follows the new name', await smoke.waitFor(tabSelector('UI Villa Renamed')));
  await smoke.click(`${visibleTab} [data-testid=right-tab-details]`);
  await smoke.waitFor(`${visibleTab} [data-testid=project-tags]`);
  await smoke.fill(`${visibleTab} [data-testid=project-tags]`, 'villa, concept');
  await smoke.js(`document.querySelector('${visibleTab} [data-testid=project-tags]').dispatchEvent(new FocusEvent('blur'))`);
  smoke.check('tags typed in the project tab are saved', await smoke.until(() => host.projects.get(villa!.id)?.tags.join() === 'villa,concept'));

  await smoke.click(`${visibleTab} [data-testid=snapshot-create]`);
  await answerPrompt(smoke, 'UI snapshot');
  smoke.check('a snapshot saved from the project tab is listed', await smoke.waitFor(`${visibleTab} [data-testid=snapshot-item][data-name="UI snapshot"]`));
  await smoke.shots('08-project-tab');
  await smoke.click(`${visibleTab} [data-testid=snapshot-item][data-name="UI snapshot"] [data-testid=snapshot-restore]`);
  await confirmDialog(smoke, 'Restore');
  smoke.check('restoring from the project tab keeps a backup snapshot', await smoke.waitFor(`${visibleTab} [data-testid=snapshot-item][data-kind=auto]`));

  smoke.section('project tabs');
  const order = () => smoke.js<string[]>(`[...document.querySelectorAll('[data-testid=tab][data-type="project.editor"]')].map((t) => t.dataset.title)`);
  const before = await order();
  const first = await smoke.rect(tabSelector(before[0]));
  const last = await smoke.rect(tabSelector(before[before.length - 1]));
  if (first && last && before.length >= 2) {
    await smoke.drag({ x: last.x + last.width / 2, y: last.y + last.height / 2 }, { x: first.x + 4, y: first.y + first.height / 2 });
    const after = await order();
    smoke.check('dragging a tab reorders the tabs', after[0] === before[before.length - 1] && after.length === before.length, { before, after });
    await smoke.shot('09-tab-drag');
  } else {
    smoke.check('two project tabs to reorder', false, before);
  }

  smoke.section('context menus and trash');
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  await smoke.rightClick(cardSelector('Office Block'));
  await smoke.click('[data-testid=project-menu-rename]');
  const answered = await answerPrompt(smoke, 'Office Block 2');
  smoke.check('renaming from the card menu works', await smoke.waitFor(cardSelector('Office Block 2')), { answered, cards: await smoke.js('[...document.querySelectorAll("[data-testid=project-card]")].map((c) => c.dataset.name)'), menu: await smoke.js('!!document.querySelector("[data-testid=context-menu]")'), dialog: await smoke.js('document.querySelector("x-dialog-host")?.textContent?.slice(0, 200) ?? null') });

  await smoke.click(`[data-testid=tab][data-title="UI Villa Renamed"]`);
  await smoke.click(`${visibleTab} [data-testid=project-trash]`);
  smoke.check('moving the open project to the trash closes its tab', await smoke.gone(tabSelector('UI Villa Renamed')));
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  await smoke.rightClick(cardSelector('Smoke House copy'));
  await smoke.click('[data-testid=project-menu-trash]');
  smoke.check('the card menu moves a project to the trash', await smoke.gone(cardSelector('Smoke House copy')));
  await smoke.click('[data-testid=library-trash]');
  smoke.check('the trash lists both', (await smoke.waitFor('[data-testid=trash-item][data-name="UI Villa Renamed"]')) && (await smoke.waitFor('[data-testid=trash-item][data-name="Smoke House copy"]')));
  await smoke.shots('10-trash');
  await smoke.click('[data-testid=trash-item][data-name="UI Villa Renamed"] [data-testid=trash-restore]');
  smoke.check('restore takes a project out of the trash', await smoke.gone('[data-testid=trash-item][data-name="UI Villa Renamed"]'));
  await smoke.click('[data-testid=library-empty-trash]');
  smoke.check('emptying the trash asks first', await smoke.waitFor('x-dialog-host', 3000, 'permanently'));
  await confirmDialog(smoke, 'Empty trash');
  smoke.check('and then deletes the trashed projects', (await smoke.until(() => host.projects.list({ trashed: true }).length === 0)) && (await smoke.waitFor('x-empty-state', 3000, 'The trash is empty')));
  await smoke.click('[data-testid=library-back]');

  smoke.section('live agent changes');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-ui-agent', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.url)));
  const office = host.projects.list().find((p: ProjectSummary) => p.name === 'Office Block 2')!;
  await client.callTool({ name: 'project_open', arguments: { id: office.id } });
  smoke.check('a project an agent opens appears as a tab on screen', await smoke.waitFor(`${tabSelector('Office Block 2')}[aria-selected=true]`));
  await client.callTool({ name: 'project_update', arguments: { id: office.id, name: 'Office Block 3' } });
  smoke.check('a rename by an agent shows up at once', await smoke.waitFor(tabSelector('Office Block 3')));
  await client.callTool({ name: 'project_close', arguments: { id: office.id } });
  smoke.check('a project an agent closes loses its tab', await smoke.gone(tabSelector('Office Block 3')));
  await client.close();

  await smoke.click('[data-testid=activity-settings]');
  smoke.check('Settings shows where the library is', await smoke.waitFor('[data-testid=library-path]', 3000, host.projects.library.root));
  await smoke.key('W', ['control']);
  await wait(100);
}
