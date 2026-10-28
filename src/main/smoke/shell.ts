import { BRANDING } from '@studio/core';
import { wait, type Smoke } from './harness';

/** The shell as a user drives it: palette, tabs, settings, theme, toasts and context menus. */
export async function smokeShell(smoke: Smoke): Promise<void> {
  const { host } = smoke;
  smoke.section('shell');
  smoke.check('the shell renders', await smoke.waitFor('[data-testid=app-ready]', 15000));
  smoke.check('the title bar names the product', (await smoke.text('[data-testid=product-name]')) === BRANDING.productName);
  smoke.check('with no module panel there is no activity bar, so the tab content starts at the left edge', await smoke.js<boolean>(`!document.querySelector('[data-testid=activity-bar]') && document.querySelector('main')?.getBoundingClientRect().left === 0`));
  smoke.check('projects open before the window are restored as tabs', await smoke.waitFor('[data-testid=tab][data-type="project.editor"][aria-selected=true]'));
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check('Home is the first, pinned tab', await smoke.js<boolean>(`(() => { const t = document.querySelector('[data-testid=tab]'); return t?.dataset.type === 'shell.home' && t.getAttribute('aria-selected') === 'true'; })()`));
  smoke.check('the status bar shows the running MCP server', ((await smoke.text('[data-testid=status-mcp]')) ?? '').includes(`:${host.config.get().mcp.port}`));
  await smoke.shots('01-home');

  // The palette opens with a real Ctrl+K and runs what is typed.
  await smoke.key('K', ['control']);
  smoke.check('Ctrl+K opens the command palette', await smoke.waitFor('[data-testid=palette-input]'));
  await smoke.typeText('settings');
  smoke.check('typing filters the palette', await smoke.waitFor('.palette-item[data-selected=true]', 3000, 'Settings'));
  await smoke.shot('02-palette');
  await smoke.key('Return');
  smoke.check('Enter runs the highlighted entry: Settings open in a tab', (await smoke.gone('[data-testid=palette]')) && (await smoke.waitFor('[data-testid=settings]')));
  await smoke.shots('03-settings');

  smoke.section('settings');
  smoke.check('the theme select follows the stored config', (await smoke.js<string>(`document.querySelector('[data-testid=settings-theme]').value`)) === host.config.get().appearance.theme);
  await smoke.fill('[data-testid=settings-theme]', 'dark');
  smoke.check('choosing a theme applies it at once', await smoke.until(() => smoke.js<boolean>(`document.documentElement.classList.contains('dark')`)));
  smoke.check('and stores it', await smoke.until(() => host.config.get().appearance.theme === 'dark'));
  await smoke.fill('[data-testid=settings-theme]', 'light');
  await smoke.until(() => host.config.get().appearance.theme === 'light');
  // The window hears of the stored theme a round trip later (config.changed): wait for the class itself.
  smoke.check('switching back to light removes the dark class', await smoke.until(async () => !(await smoke.js<boolean>(`document.documentElement.classList.contains('dark')`))));

  await smoke.click('[data-testid=units-system-imperial]');
  smoke.check('the units editor stores the unit system', await smoke.until(() => host.config.get().units.system === 'imperial'));
  smoke.check('the example shows feet and inches', await smoke.waitFor('[data-testid=units-example]', 3000, `10' 6 1/2"`));
  smoke.check('the status bar follows the units', await smoke.waitFor('[data-testid=status-units]', 3000, 'ft-in'));
  await smoke.click('[data-testid=units-system-metric]');
  await smoke.until(() => host.config.get().units.system === 'metric');
  smoke.check('back to metric', await smoke.waitFor('[data-testid=units-example]', 3000, '3213 mm'));

  smoke.check('the MCP section shows the server running', await smoke.waitFor('[data-testid=settings-mcp-state]', 3000, 'Running'));
  smoke.check('the MCP port field shows the stored port', Number(await smoke.js(`document.querySelector('[data-testid=settings-mcp-port]').value`)) === host.config.get().mcp.port);
  smoke.check('ready-to-copy client snippets name the URL', ((await smoke.text('[data-testid=snippet-claude-code]')) ?? '').includes(`/mcp`));
  smoke.check('recent agent calls are listed with the agent', await smoke.waitFor('[data-testid=settings-mcp-calls]', 3000, 'via MCP: smoke-'));
  await smoke.click('[data-testid=settings-mcp-mutations]');
  smoke.check('the mutations switch is stored', await smoke.until(() => host.config.get().mcp.allowMutations === true));
  await smoke.click('[data-testid=settings-mcp-mutations]');
  await smoke.until(() => host.config.get().mcp.allowMutations === false);

  await smoke.fill('[data-testid=settings-key-input]', 'sk-ant-ui-test-key-000000');
  // Save key stays on one line beside the field (it once wrapped onto two): its text one line high.
  const keyRow = await smoke.js<{ button: number; input: number; lines: number }>(`(() => {
    const b = document.querySelector('[data-testid=settings-key-save]');
    const i = document.querySelector('[data-testid=settings-key-input]');
    const r = document.createRange();
    r.selectNodeContents(b);
    const tops = new Set([...r.getClientRects()].filter((c) => c.width > 0).map((c) => Math.round(c.top)));
    return { button: b.getBoundingClientRect().height, input: i.getBoundingClientRect().height, lines: tops.size };
  })()`);
  smoke.check('Save key sits on one line beside the key field', keyRow.lines === 1, keyRow);
  await smoke.click('[data-testid=settings-key-save]');
  smoke.check('saving the API key from Settings stores it', await smoke.until(() => host.secrets.get('anthropic-api-key') === 'sk-ant-ui-test-key-000000'));
  smoke.check('Settings then shows that a key is set, never the key', (await smoke.waitFor('[data-testid=settings-key-set]')) && !(await smoke.js<string>('document.body.innerText')).includes('sk-ant-ui-test'));
  await smoke.click('[data-testid=settings-key-clear]');
  smoke.check('the key can be removed from Settings', await smoke.until(() => !host.secrets.has('anthropic-api-key')));
  smoke.check('the About section shows the version', await smoke.waitFor('[data-testid=settings-about]', 3000, host.opts.version));

  smoke.section('palette form');
  await smoke.key('K', ['control']);
  await smoke.waitFor('[data-testid=palette-input]');
  await smoke.typeText('Smoke: echo');
  await smoke.waitFor('.palette-item[data-selected=true]', 3000, 'Smoke: echo');
  await smoke.key('Return');
  smoke.check('a command with input opens a form generated from its schema', await smoke.waitFor('[data-testid=palette-form][data-command="smoke.echo"]'));
  smoke.check('the form has a field per input property', (await smoke.count('[data-testid=palette-form] input[id^=palette-]')) === 2);
  await smoke.fill('#palette-text', 'xyz');
  await smoke.fill('#palette-times', '2');
  await smoke.shot('04-palette-form');
  await smoke.click('[data-testid=palette-run]');
  smoke.check('running the form shows the result in a toast', await smoke.waitFor('body', 3000, 'xyzxyz'));
  smoke.check('and closes the palette', await smoke.gone('[data-testid=palette]'));

  smoke.section('tabs');
  smoke.check('right-clicking a tab opens its menu', (await smoke.rightClick('[data-testid=tab][data-type="settings.main"]')) && (await smoke.waitFor('[data-testid=context-menu]')));
  await smoke.shot('05-tab-menu');
  await smoke.click('[data-testid=tab-menu-close]');
  smoke.check('Close in the tab menu closes the tab', await smoke.gone('[data-testid=tab][data-type="settings.main"]'));
  smoke.check('the tab to its left becomes active', await smoke.waitFor('[data-testid=tab][aria-selected=true]'));
  await smoke.click('[data-testid=titlebar-settings]');
  smoke.check('the title bar gear opens Settings', await smoke.waitFor('[data-testid=tab][data-type="settings.main"][aria-selected=true]'));
  await smoke.key('W', ['control']);
  smoke.check('Ctrl+W closes the active tab', await smoke.gone('[data-testid=tab][data-type="settings.main"]'));
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check('Home shows the project library', await smoke.waitFor('[data-tab-type="shell.home"]:not(.hidden) [data-testid=library-home]'));
  await smoke.key('W', ['control']);
  await wait(100);
  smoke.check('Home cannot be closed', (await smoke.count('[data-testid=tab][data-type="shell.home"]')) === 1);

  const dark = await smoke.js<boolean>(`document.documentElement.classList.contains('dark')`);
  await smoke.click('[data-testid=status-theme]');
  smoke.check('the status bar toggles the theme', await smoke.until(async () => (await smoke.js<boolean>(`document.documentElement.classList.contains('dark')`)) !== dark && host.config.get().appearance.theme === (dark ? 'light' : 'dark')));
  await smoke.click('[data-testid=status-theme]');
  await smoke.until(() => host.config.get().appearance.theme === (dark ? 'dark' : 'light'));
}
