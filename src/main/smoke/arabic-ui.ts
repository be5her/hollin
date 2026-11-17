import type { Smoke } from './harness';

interface Layout {
  dir: string;
  lang: string;
  /** The title bar's own padding: the space kept for the OS window buttons, which never moves. */
  padLeft: string;
  padRight: string;
  /** Centre x of the brand (app icon and name) and of the palette button. */
  brand: number;
  palette: number;
}

const layout = (smoke: Smoke) =>
  smoke.js<Layout>(`(() => {
    const header = document.querySelector('header');
    const style = getComputedStyle(header);
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; };
    return {
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      padLeft: style.paddingLeft,
      padRight: style.paddingRight,
      brand: mid(document.querySelector('[data-testid=product-name]').parentElement),
      palette: mid(document.querySelector('[data-testid=palette-button]')),
    };
  })()`);

/**
 * Arabic and right to left (milestone 12, `docs/i18n.md`): pick العربية in Settings through the UI,
 * check the shell follows at once (direction, Settings, the title bar, the palette's search in Arabic,
 * the tab strip's drag and menu right to left), take the Arabic screenshots, and switch back to English
 * so the sections after this one see the app as they always have. Later steps of the milestone add here.
 */
export async function smokeArabicUi(smoke: Smoke): Promise<void> {
  const { host } = smoke;
  smoke.section('arabic: switching');
  const preference = host.config.get().appearance.language;
  smoke.check('the smoke runs in English whatever the machine speaks', (await smoke.run<{ language: string; systemLocale: string }>('app.language')).language === 'en' && preference === 'system');
  smoke.check('and the window says so', await smoke.js<boolean>(`document.documentElement.dir === 'ltr' && document.documentElement.lang === 'en'`));
  const english = await layout(smoke);
  // Settings may not be open yet; if this section opens it, it closes it again, so the sections after it find the tabs as they were.
  const settingsWasOpen = (await smoke.count('[data-testid=tab][data-type="settings.main"]')) > 0;

  await smoke.click('[data-testid=titlebar-settings]');
  smoke.check('Settings has a Language select', await smoke.waitFor('[data-testid=settings-language]'));
  const options = await smoke.js<string[]>(`[...document.querySelectorAll('[data-testid=settings-language] option')].map((o) => o.value + ':' + o.textContent.trim())`);
  smoke.check('offering the system language, English and العربية, each under its own name', options.join('|') === 'system:Follow system|en:English|ar:العربية', options);

  const changed = smoke.events.length;
  await smoke.fill('[data-testid=settings-language]', 'ar');
  smoke.check('choosing العربية stores it', await smoke.until(() => host.config.get().appearance.language === 'ar'));
  smoke.check('and main announces the language', await smoke.until(() => smoke.eventsSince(changed, 'language.changed').some((e) => e.language === 'ar' && e.direction === 'rtl')));
  smoke.check('the window turns right to left at once', await smoke.until(() => smoke.js<boolean>(`document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'`)));
  smoke.check('agents can read the language', (await smoke.run<{ language: string; direction: string; preference: string }>('app.language')).direction === 'rtl');

  smoke.section('arabic: the shell and Settings');
  smoke.check('the Settings heading is in Arabic', await smoke.waitFor('[data-testid=settings-title]', 3000, 'الإعدادات'));
  smoke.check('and so are its tab and Home\'s', await smoke.js<boolean>(`(() => {
    const titles = [...document.querySelectorAll('[data-testid=tab]')].map((t) => t.dataset.type + ':' + t.dataset.title);
    return titles.includes('settings.main:الإعدادات') && titles.includes('shell.home:الرئيسية');
  })()`));
  smoke.check('the title bar\'s search field speaks Arabic', (await smoke.text('[data-testid=palette-button-label]')) === 'ابحث في الأوامر…');
  const arabic = await layout(smoke);
  smoke.check('the title bar mirrors: the brand at the right, the palette at the left', arabic.brand > arabic.palette && english.brand < english.palette, { english, arabic });
  smoke.check('while the space for the window buttons stays where the OS draws them', arabic.padLeft === english.padLeft && arabic.padRight === english.padRight, { english, arabic });
  const heading = await smoke.js<{ spacing: string; font: boolean }>(`(async () => {
    const h = document.querySelector('[data-testid=settings-title]');
    const faces = await document.fonts.load('600 28px "Noto Naskh Arabic"', 'الإعدادات');
    const text = await document.fonts.load('13px "IBM Plex Sans Arabic"', 'الإعدادات');
    return { spacing: getComputedStyle(h).letterSpacing, font: faces.length > 0 && text.length > 0 };
  })()`);
  smoke.check('Arabic headings are not letter-spaced, so their letters join', heading.spacing === 'normal' || heading.spacing === '0px', heading);
  smoke.check('the bundled Arabic faces load', heading.font, heading);
  smoke.check('the wordmark is a name: its full stop stays after it', await smoke.js<boolean>(`getComputedStyle(document.querySelector('header x-wordmark')).direction === 'ltr'`));
  smoke.check('measurements stay left-to-right islands', await smoke.js<boolean>(`getComputedStyle(document.querySelector('[data-testid=units-example]')).direction === 'ltr'`));
  smoke.check('the MCP state reads in Arabic', await smoke.waitFor('[data-testid=settings-mcp-state]', 3000, 'يعمل'));
  await smoke.js(`document.querySelector('[data-testid=settings]').scrollTop = 0`);
  await smoke.shots('77-settings-arabic');
  await smoke.js(`document.querySelector('[data-section=mcp]').scrollIntoView({ block: 'start' })`);
  await smoke.shots('78-settings-arabic-mcp');
  await smoke.js(`document.querySelector('[data-section=about]').scrollIntoView({ block: 'end' })`);
  smoke.check('About reads in Arabic with its version as an island', (await smoke.waitFor('[data-testid=about-version]', 3000, 'الإصدار')) && (await smoke.waitFor('[data-testid=about-description]', 3000, 'صمّم')));
  await smoke.shots('79-settings-arabic-about');

  smoke.section('arabic: the palette');
  await smoke.key('K', ['control']);
  await smoke.waitFor('[data-testid=palette-input]');
  // Typed without the hamza, as people often do: the search folds both sides.
  await smoke.fill('[data-testid=palette-input]', 'الاعدادات');
  smoke.check('an Arabic search finds the Arabic title', await smoke.waitFor('.palette-item[data-selected=true]', 3000, 'الإعدادات'));
  smoke.check('the palette\'s groups are in Arabic', await smoke.waitFor('[data-heading]', 3000, 'التطبيق'));
  await smoke.shots('80-palette-arabic');
  await smoke.fill('[data-testid=palette-input]', 'لغة التطبيق');
  smoke.check('a command is shown by its Arabic title', await smoke.waitFor('.palette-item[data-selected=true]', 3000, 'لغة التطبيق'));
  await smoke.fill('[data-testid=palette-input]', 'settings');
  smoke.check('and English still finds it', await smoke.waitFor('.palette-item[data-selected=true]', 3000, 'الإعدادات'));
  await smoke.key('Escape');
  await smoke.gone('[data-testid=palette]');

  smoke.section('arabic: the tab strip');
  const order = () => smoke.js<string[]>(`[...document.querySelectorAll('[data-testid=tab][data-drag-id]')].map((t) => t.dataset.dragId)`);
  const before = await order();
  if (before.length >= 2) {
    const rect = (id: string) => smoke.rect(`[data-testid=tab][data-drag-id="${id}"]`);
    const first = (await rect(before[0]))!;
    const last = (await rect(before[before.length - 1]))!;
    smoke.check('right to left, the tabs run from the right', first.x > last.x, { first, last });
    // The first tab's start is its right edge: drop the last tab just inside it.
    await smoke.drag({ x: last.x + last.width / 2, y: last.y + last.height / 2 }, { x: first.x + first.width - 4, y: first.y + first.height / 2 });
    await smoke.until(async () => (await order())[0] === before[before.length - 1]);
    const after = await order();
    smoke.check('dragging a tab to the start reorders the strip right to left', after[0] === before[before.length - 1] && after.length === before.length, { before, after });

    const tab = (await rect(after[0]))!;
    const at = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 };
    await smoke.rightClickAt(at.x, at.y);
    smoke.check('the tab menu speaks Arabic', await smoke.waitFor('[data-testid=tab-menu-close-others]', 3000, 'إغلاق التبويبات الأخرى'));
    const menu = await smoke.rect('[data-testid=context-menu]');
    smoke.check('and opens towards the start, to the left of the pointer', menu !== null && menu.x + menu.width <= at.x + 1, { menu, at });
    await smoke.shots('81-tab-menu-arabic');
    await smoke.key('Escape');
    await smoke.gone('[data-testid=context-menu]');
  } else {
    smoke.check('two tabs to reorder right to left', false, before);
  }

  smoke.section('arabic: back to English');
  await smoke.click('[data-testid=tab][data-type="settings.main"]');
  await smoke.fill('[data-testid=settings-language]', preference);
  smoke.check('the language goes back to the system\'s', await smoke.until(() => host.config.get().appearance.language === preference));
  smoke.check('and the window back to left to right', await smoke.until(() => smoke.js<boolean>(`document.documentElement.dir === 'ltr' && document.documentElement.lang === 'en'`)));
  smoke.check('Settings reads in English again', await smoke.waitFor('[data-testid=settings-title]', 3000, 'Settings'));
  smoke.check('as does the title bar', (await smoke.text('[data-testid=palette-button-label]')) === 'Search commands…');
  const back = await layout(smoke);
  smoke.check('laid out as before', back.brand === english.brand && back.palette === english.palette, { english, back });
  if (!settingsWasOpen) {
    await smoke.click('[data-testid=tab][data-type="settings.main"][aria-selected=true] button');
    await smoke.gone('[data-testid=tab][data-type="settings.main"]');
  }
}
