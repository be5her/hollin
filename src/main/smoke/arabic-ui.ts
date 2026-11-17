import type { ProjectSummary } from '@studio/core';
import type { Smoke } from './harness';
import { tab } from './plan-canvas';

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

  await smokeArabicLibrary(smoke);

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

/** The Arabic name the section gives its project, and a search for it typed without the hamza and with ه for ة. */
const ARABIC_NAME = 'بيت الأُسرة على البحر';
const ARABIC_SEARCH = 'الاسره';
/** The left-to-right isolate around an angle in an Arabic line, and its end. */
const [LRI, PDI] = [0x2066, 0x2069].map((code) => String.fromCharCode(code));

/** The direction an element (the first match) reads in. */
const direction = (smoke: Smoke, selector: string) => smoke.js<string | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).direction : null; })()`);
/** Whether an icon (the first match) is drawn mirrored, as `rtl:-scale-x-100` does right to left. */
const mirrored = (smoke: Smoke, selector: string) => smoke.js<boolean>(`(() => { const svg = document.querySelector(${JSON.stringify(selector)}); return !!svg && getComputedStyle(svg).scale.startsWith('-1'); })()`);

/**
 * Home, the project tab, the export dialog, History and the library's and the updates' Settings in Arabic
 * (milestone 12, step 2): a project named in Arabic through Home's New project, found by a search typed
 * the way people type, opened from its card. The project goes to the trash and its tab closes at the end,
 * so the sections after this one find the library they expect.
 */
async function smokeArabicLibrary(smoke: Smoke): Promise<void> {
  const { host } = smoke;
  smoke.section('arabic: Home');
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check(
    'Home speaks Arabic',
    (await smoke.waitFor('[data-testid=library-heading]', 3000, 'المشاريع')) && (await smoke.waitFor('[data-testid=library-new]', 3000, 'مشروع جديد')) && (await smoke.waitFor('[data-testid=library-trash]', 3000, 'سلة المحذوفات')),
  );
  smoke.check("Otto's composer card and the search too", (await smoke.waitFor('[data-testid=otto-composer]', 3000, 'ابدأ مع Otto')) && (await smoke.js<string>(`document.querySelector('[data-testid=library-search]').placeholder`)) === 'ابحث في المشاريع');
  smoke.check('a card counts its levels in Arabic', await smoke.waitFor('[data-testid=project-card]', 3000, 'طابق'));

  await smoke.click('[data-testid=library-new]');
  smoke.check('New project asks in Arabic, with an Arabic default name', (await smoke.waitFor('x-dialog-host', 3000, 'مشروع جديد')) && (await smoke.js<string>(`document.querySelector('x-dialog-host form input')?.value ?? ''`)) === 'مشروع بلا عنوان');
  await smoke.fill('x-dialog-host form input', ARABIC_NAME);
  await smoke.click('x-dialog-host form button[type=submit]');
  const opened = (name: string) => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(name)}`);
  smoke.check('a project named in Arabic is created and opens', (await smoke.until(() => host.projects.list().some((p) => p.name === ARABIC_NAME))) && (await smoke.until(() => opened(ARABIC_NAME))));
  const project: ProjectSummary | undefined = host.projects.list().find((p) => p.name === ARABIC_NAME);

  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  const card = `[data-testid=project-card][data-name="${ARABIC_NAME}"]`;
  smoke.check('its card is on Home, its name reading right to left', (await smoke.waitFor(card)) && (await direction(smoke, `${card} [data-testid=project-card-name]`)) === 'rtl');
  await smoke.js(`document.querySelector('[data-testid=library-home]').scrollTop = 0`);
  await smoke.shots('82-home-arabic');

  const found = () => smoke.js<string[]>(`[...document.querySelectorAll('[data-testid=project-card]')].map((c) => c.dataset.name)`);
  await smoke.fill('[data-testid=library-search]', ARABIC_SEARCH);
  smoke.check('a search typed without the hamza and with ه for ة finds it', await smoke.until(async () => (await found()).join('|') === ARABIC_NAME), await found());
  await smoke.fill('[data-testid=library-search]', 'بيت الاسرة');
  smoke.check('and so does one with the ة', await smoke.until(async () => (await found()).join('|') === ARABIC_NAME), await found());
  await smoke.click(card);
  smoke.check('its card opens it', await smoke.until(() => opened(ARABIC_NAME)));
  // Home's search is left empty for the sections after this one.
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  await smoke.fill('[data-testid=library-search]', '');
  await smoke.until(async () => (await smoke.count('[data-testid=otto-composer]')) === 1);
  await smoke.click(`[data-testid=tab][data-type="project.editor"][data-title="${ARABIC_NAME}"]`);
  await smoke.until(() => opened(ARABIC_NAME));

  smoke.section('arabic: the project tab');
  smoke.check("the project's name reads right to left", (await direction(smoke, `${tab} [data-testid=project-name]`)) === 'rtl');
  smoke.check(
    'the toolbar speaks Arabic',
    (await smoke.waitFor(`${tab} [data-testid=project-save]`, 3000, 'حفظ')) && (await smoke.waitFor(`${tab} [data-testid=exchange-export]`, 3000, 'تصدير…')) && (await smoke.waitFor(`${tab} [data-testid=project-trash]`, 3000, 'إلى السلة')),
  );
  smoke.check('so do the panel titles', (await smoke.waitFor(`${tab} [data-testid=right-tab-history]`, 3000, 'السجل')) && (await smoke.waitFor(`${tab} [data-testid=right-tab-details]`, 3000, 'المشروع')));
  smoke.check('undo and redo point the Arabic way', (await mirrored(smoke, `${tab} [data-testid=project-undo] svg`)) && (await mirrored(smoke, `${tab} [data-testid=project-redo] svg`)));
  smoke.check(
    'the right column sits at the left',
    await smoke.js<boolean>(`(() => { const l = document.querySelector('${tab} [data-testid=project-left]').getBoundingClientRect(); const r = document.querySelector('${tab} [data-testid=project-right]').getBoundingClientRect(); return r.x < l.x; })()`),
  );

  await smoke.click(`${tab} [data-testid=right-tab-history]`);
  smoke.check(
    'History speaks Arabic',
    (await smoke.waitFor(`${tab} [data-testid=history-undo]`, 3000, 'تراجع')) && (await smoke.waitFor(`${tab} [data-testid=history-list]`, 3000, 'لا توجد تغييرات بعد')) && (await mirrored(smoke, `${tab} [data-testid=history-undo] svg`)),
  );
  await smoke.shots('83-project-history-arabic');

  await smoke.click(`${tab} [data-testid=right-tab-details]`);
  smoke.check('the project details speak Arabic', (await smoke.waitFor(`${tab} [data-testid=project-details]`, 3000, 'الوصف')) && (await smoke.waitFor(`${tab} [data-testid=project-details]`, 3000, 'النسخ المحفوظة')));
  smoke.check('and the description takes either direction', (await smoke.js<string | null>(`document.querySelector('${tab} [data-testid=project-description]')?.getAttribute('dir') ?? null`)) === 'auto');
  await smoke.shots('84-project-details-arabic');

  await smoke.click(`${tab} [data-testid=exchange-export]`);
  // The dialog starts from the last export's choices: a PDF of this one-level project names its pages.
  await smoke.waitFor('[data-testid=export-format-pdf]');
  await smoke.click('[data-testid=export-format-pdf]');
  smoke.check(
    'the export dialog speaks Arabic',
    (await smoke.waitFor('[data-testid=export-dialog]', 3000, 'تصدير')) && (await smoke.waitFor('[data-testid=export-levels-hint]', 3000, 'صفحة')) && (await smoke.waitFor('[data-testid=export-confirm]', 3000, 'تصدير…')),
  );
  await smoke.click('[data-testid=export-format-png]');
  await smoke.click('[data-testid=export-view-3d]');
  smoke.check('its 3D line keeps the angles left to right', await smoke.waitFor('[data-testid=export-view3d-hint]', 3000, `${LRI}225°${PDI}`), await smoke.text('[data-testid=export-view3d-hint]'));
  await smoke.shots('85-export-arabic');
  await smoke.click('x-dialog-host button', 'إلغاء');
  smoke.check('and cancels in Arabic', await smoke.gone('[data-testid=export-dialog]'));

  smoke.section('arabic: Settings > Library and Updates');
  await smoke.click('[data-testid=tab][data-type="settings.main"]');
  await smoke.waitFor('[data-section=library]');
  smoke.check(
    'the Library section speaks Arabic',
    (await smoke.waitFor('[data-section=library] h2', 3000, 'المكتبة')) && (await smoke.waitFor('[data-testid=library-move]', 3000, 'نقل…')) && (await smoke.waitFor('[data-testid=library-count]', 3000, 'سلة المحذوفات')),
  );
  smoke.check('with its path a left-to-right island', (await direction(smoke, '[data-testid=library-path]')) === 'ltr');
  await smoke.js(`document.querySelector('[data-section=library]').scrollIntoView({ block: 'start' })`);
  await smoke.shots('86-settings-library-arabic');
  smoke.check(
    'the Updates section speaks Arabic',
    (await smoke.waitFor('[data-section=updates] h2', 3000, 'التحديثات')) && (await smoke.waitFor('[data-testid=updates-check]', 3000, 'التحقق من وجود تحديثات')) && (await smoke.waitFor('[data-testid=updates-beta-note]', 3000, 'الإصدارات التجريبية')),
  );
  await smoke.js(`document.querySelector('[data-section=updates]').scrollIntoView({ block: 'start' })`);
  await smoke.shots('87-settings-updates-arabic');

  // The project leaves: its tab closes and it goes to the trash, so the sections after this one count the library they expect.
  if (project) {
    await smoke.run('project.close', { id: project.id });
    await smoke.run('project.trash', { id: project.id });
  }
  smoke.check(
    "the Arabic project's tab is closed and the project in the trash",
    await smoke.until(async () => (await smoke.count(`[data-testid=tab][data-type="project.editor"][data-title="${ARABIC_NAME}"]`)) === 0 && !host.projects.list().some((p) => p.name === ARABIC_NAME)),
  );
}
