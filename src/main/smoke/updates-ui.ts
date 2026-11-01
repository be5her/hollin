import type { Smoke } from './harness';

const home = '[data-testid=tab][data-type="shell.home"]';
const settingsTab = '[data-testid=tab][data-type="settings.main"]';
const status = '[data-testid=updates-status]';

/** Clicks away the toasts stacked over the bottom-right corner. */
const dismissToasts = (smoke: Smoke) => smoke.js("[...document.querySelectorAll('[aria-label=Dismiss]')].forEach((b) => b.click())");

/**
 * Settings > Updates as a user drives it, with the scripted updater: the section sits before About;
 * the status line follows the states in order (not checked, checking, available with notes,
 * downloading n %, ready), each button is enabled only when it can act, a ready download and a
 * version found by the startup check bring toasts (Restart and install, Settings), install reaches the
 * updater, an error and an unsupported build say so, the startup switch writes config, and the
 * palette offers no update command.
 */
export async function smokeUpdatesUi(smoke: Smoke): Promise<void> {
  smoke.section('updates: Settings');
  const { host } = smoke;
  const u = smoke.updates;
  u.reset();
  const enabled = () =>
    smoke.js<Record<string, boolean>>(`Object.fromEntries(['check', 'download', 'install'].map((b) => [b, !document.querySelector('[data-testid=updates-' + b + ']')?.disabled]))`);
  const buttons = async (want: string) => {
    const ok = await smoke.until(async () => Object.entries(await enabled()).filter(([, on]) => on).map(([b]) => b).join() === want, 3000);
    return ok;
  };
  const showSection = () => smoke.js(`document.querySelector('[data-section=updates]')?.scrollIntoView({ block: 'start' })`);

  await smoke.click(home);
  await smoke.click('[data-testid=titlebar-settings]');
  smoke.check('Settings shows an Updates section, right before About', (await smoke.waitFor('[data-section=updates]')) && (await smoke.js<string | undefined>(`document.querySelector('[data-section=updates]')?.nextElementSibling?.getAttribute('data-section')`)) === 'about');
  smoke.check('a fresh install has not checked yet; only Check is enabled', (await smoke.waitFor(status, 3000, 'Not checked yet')) && (await buttons('check')), await enabled());
  smoke.check('the startup switch shows the stored setting (on)', await smoke.js<boolean>(`document.querySelector('[data-testid=updates-auto]')?.checked === true`));

  // Every toast message shown from here on is recorded as it appears, so the absence of a toast for the
  // user's own check is read after a later toast has come, not after a fixed wait.
  await smoke.js(`(() => {
    const seen = (window.__updateToasts = []);
    const take = (n) => {
      if (!(n instanceof Element)) return;
      for (const m of n.matches('[data-testid=toast-message]') ? [n] : n.querySelectorAll('[data-testid=toast-message]')) seen.push(m);
    };
    window.__updateToastObserver?.disconnect();
    window.__updateToastObserver = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(take)));
    window.__updateToastObserver.observe(document.body, { childList: true, subtree: true });
  })()`);
  const toastsSeen = () => smoke.js<string[]>(`(window.__updateToasts ?? []).map((m) => m.textContent.trim())`);

  // Checking… stays on screen while the scripted feed holds the answer.
  u.script({ outcome: 'available', version: '1.2.3', notes: 'Faster exports.\n- The PDF title block fits long names.', hold: 'check' });
  await smoke.click('[data-testid=updates-check]');
  smoke.check('a check shows Checking… with every button disabled', (await smoke.waitFor(status, 3000, 'Checking…')) && (await buttons('')), await smoke.text(status));
  u.release();
  smoke.check('then Version 1.2.3 is available; Check and Download are enabled', (await smoke.waitFor(status, 3000, 'Version 1.2.3 is available')) && (await buttons('check,download')), await enabled());
  smoke.check('the release notes show as plain text, line by line', await smoke.until(() => smoke.js<boolean>(`(() => { const n = document.querySelector('[data-testid=updates-notes]'); return !!n && n.innerText.includes('Faster exports.\\n- The PDF title block') && n.children.length === 0; })()`), 3000));

  // The section takes each state from update.changed itself: no app.update.status round trip per progress step.
  let statusCalls = 0;
  const invoke = host.invoke;
  host.invoke = (id, input, options) => {
    if (id === 'app.update.status') statusCalls++;
    return invoke.call(host, id, input, options);
  };
  u.script({ outcome: 'available', version: '1.2.3', progress: [0, 10, 20, 30, 42, 60, 80, 100], hold: 'download', holdAt: 42 });
  await dismissToasts(smoke);
  await smoke.click('[data-testid=updates-download]');
  smoke.check('Download shows Downloading 42 % with every button disabled', (await smoke.waitFor(status, 3000, 'Downloading 42 %')) && (await buttons('')), await smoke.text(status));
  await showSection();
  await smoke.shots('61-settings-updates-downloading');
  u.release();
  smoke.check('then Ready to install; only Restart and install is enabled', (await smoke.waitFor(status, 3000, 'Ready to install version 1.2.3')) && (await buttons('install')), await enabled());
  host.invoke = invoke;
  smoke.check('the section follows the download from the events, without asking for the status again', statusCalls === 0, statusCalls);
  smoke.check('a toast says the download is ready, with Restart and install', (await smoke.waitFor('[data-testid=toast-message]', 3000, 'Version 1.2.3 is ready to install')) && (await smoke.waitFor('[data-testid=toast-action]', 3000, 'Restart and install')));
  const seen = await toastsSeen();
  smoke.check('a check the user asked for brought no toast (only the ready one came since)', seen.some((t) => t.includes('is ready to install')) && !seen.some((t) => t.includes('is available')), seen);
  await smoke.js(`window.__updateToastObserver?.disconnect()`);
  // The action is clicked while the toast is surely up (6 s), before the screenshots' theme switches.
  let installs = u.installs;
  await smoke.click('[data-testid=toast-action]', 'Restart and install');
  smoke.check("the toast's Restart and install reaches the updater", await smoke.until(() => u.installs === installs + 1), u.installs);
  await dismissToasts(smoke);
  await showSection();
  await smoke.shots('62-settings-updates-ready');
  installs = u.installs;
  await smoke.click('[data-testid=updates-install]');
  smoke.check('so does the Restart and install button', await smoke.until(() => u.installs === installs + 1), u.installs);

  // The startup check (asked for as the app does 10 s after start): its find is announced with a toast that opens Settings.
  u.reset();
  await dismissToasts(smoke);
  await smoke.click(home);
  u.script({ outcome: 'available', version: '1.3.0' });
  await u.check({ scheduled: true });
  smoke.check('a version found by the startup check brings a toast with Settings', (await smoke.waitFor('[data-testid=toast-message]', 3000, 'Version 1.3.0 is available')) && (await smoke.waitFor('[data-testid=toast-action]', 3000, 'Settings')));
  await smoke.click('[data-testid=toast-action]', 'Settings');
  const where = () => smoke.js<{ top: number; height: number; scrollTop: number }>(`(() => ({ top: document.querySelector('[data-section=updates]')?.getBoundingClientRect().top ?? -1, height: window.innerHeight, scrollTop: document.querySelector('[data-testid=settings]')?.scrollTop ?? 0 }))()`);
  const scrolled = async () => {
    const w = await where();
    return w.top >= 0 && w.top < w.height - 200 && w.scrollTop > 0;
  };
  smoke.check(
    "the toast's Settings opens Settings, scrolled to Updates",
    (await smoke.waitFor(`${settingsTab}[aria-selected=true]`)) && (await smoke.waitFor(status, 3000, 'Version 1.3.0 is available')) && (await smoke.until(scrolled, 3000)),
    await where(),
  );

  u.script({ outcome: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
  await smoke.click('[data-testid=updates-check]');
  smoke.check('a failed check shows its message; Check is enabled again', (await smoke.waitFor(status, 3000, 'net::ERR_INTERNET_DISCONNECTED')) && (await buttons('check')) && (await smoke.js<string | null>(`document.querySelector('[data-testid=updates-status]')?.getAttribute('data-state')`)) === 'error');

  u.unsupported('this build has no update feed (only release builds have one)');
  smoke.check('a build without a feed says updates are not available, and why; every button is disabled', (await smoke.waitFor(status, 3000, 'Updates are not available in this build: this build has no update feed')) && (await buttons('')), await smoke.text(status));
  await dismissToasts(smoke);
  await showSection();
  await smoke.shots('63-settings-updates-unsupported');
  u.unsupported(null);
  u.reset();

  await smoke.click('[data-testid=updates-auto]');
  smoke.check('turning the startup check off stores it', await smoke.until(() => host.config.get().updates.check === false));
  await smoke.click('[data-testid=updates-auto]');
  smoke.check('and on again', await smoke.until(() => host.config.get().updates.check === true));

  // The beta switch stores the setting, and a check's answer from the other channel is asked again.
  smoke.check('the beta switch shows the stored setting (off), with its note', (await smoke.js<boolean>(`document.querySelector('[data-testid=updates-beta]')?.checked === false`)) && (await smoke.count('[data-testid=updates-beta-note]')) === 1);
  u.script({ outcome: 'up-to-date' });
  await smoke.click('[data-testid=updates-check]');
  smoke.check('a stable-only check finds nothing newer', (await smoke.waitFor(status, 3000, 'You have the latest version')) && u.checks.at(-1)?.beta === false, u.checks.at(-1));
  u.script({ outcome: 'available', version: '0.2.0-beta.2' });
  let checks = u.checks.length;
  await smoke.click('[data-testid=updates-beta]');
  smoke.check('turning beta versions on stores it', await smoke.until(() => host.config.get().updates.beta === true));
  smoke.check('and checks again for betas, finding 0.2.0-beta.2', (await smoke.waitFor(status, 3000, 'Version 0.2.0-beta.2 is available')) && u.checks.length === checks + 1 && u.checks.at(-1)?.beta === true, u.checks.slice(checks));
  await dismissToasts(smoke);
  await showSection();
  await smoke.shots('74-settings-updates-beta');
  u.script({ outcome: 'up-to-date' });
  checks = u.checks.length;
  await smoke.click('[data-testid=updates-beta]');
  smoke.check('turning them off stores it and checks again for stable versions', (await smoke.until(() => host.config.get().updates.beta === false)) && (await smoke.waitFor(status, 3000, 'You have the latest version')) && u.checks.at(-1)?.beta === false && u.checks.length === checks + 1, u.checks.slice(checks));
  u.reset();

  await smoke.key('K', ['control']);
  await smoke.waitFor('[data-testid=palette-input]');
  await smoke.typeText('update');
  const items = await smoke.js<string[]>(`[...document.querySelectorAll('.palette-item')].map((e) => e.textContent.trim())`);
  smoke.check('the palette offers no update command', !items.some((t) => /check for updates|download the update|restart and install|update status/i.test(t)), items);
  await smoke.key('Escape');
  await smoke.gone('[data-testid=palette]');

  await smoke.key('W', ['control']);
  smoke.check('Settings closes', await smoke.gone(settingsTab));
  await smoke.click(home);
}
