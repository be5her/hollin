import type { Entity, ProjectSummary } from '@studio/core';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, tab, view } from './plan-canvas';
import { sceneAttr } from './scene-canvas';

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
    const faces = await document.fonts.load('600 28px "Markazi Text"', 'الإعدادات');
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

  if (project) await smokeArabicPlan(smoke, project.id);
  if (project) await smokeArabicBuilding(smoke, project.id);

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

type Wall = Extract<Entity, { type: 'wall' }>;

/** The Arabic room name and label text the plan section draws. */
const ROOM_NAME = 'غرفة المعيشة';
const LABEL_TEXT = 'مطبخ مفتوح';

/**
 * How many dark pixels (the plan's ink on the light paper: walls, text) the plan canvas has in a box of
 * window pixels, after the renderer has drawn a frame: a name or a label drawn there shows as ink. The box
 * must lie on the canvas.
 */
const inkIn = (smoke: Smoke, box: { x: number; y: number; width: number; height: number }) =>
  smoke.js<number>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const c = document.querySelector(${JSON.stringify(canvas)});
    if (!c) return resolve(-1);
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const d = c.getContext('2d').getImageData(Math.round((${box.x} - r.x) * dpr), Math.round((${box.y} - r.y) * dpr), Math.round(${box.width} * dpr), Math.round(${box.height} * dpr)).data;
    let n = 0;
    // Opaque pixels only: outside the canvas getImageData answers transparent black.
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) n++;
    resolve(n);
  })))`);

/**
 * The plan in Arabic (milestone 12, step 3): the empty level's guide, the Wall tool's options and hint, a
 * shortcut pressed on an Arabic keyboard layout, a wall drawn by typing its length in Arabic-Indic digits,
 * a label typed in Arabic through the Label tool and a room named in Arabic drawn on the canvas, the hint
 * following a live language switch, and a selected wall's Properties with its length a left-to-right island.
 */
async function smokeArabicPlan(smoke: Smoke, projectId: string): Promise<void> {
  const { host } = smoke;
  smoke.section('arabic: the plan');
  const doc = () => host.projects.session(projectId)!.doc;
  const level = doc().building.groundLevelId;
  const entities = () => Object.values(doc().levelData[level].entities);
  const walls = () => entities().filter((e): e is Wall => e.type === 'wall');
  const hint = () => smoke.text(`${tab} [data-testid=plan-hint]`);
  const tool = () => canvasAttr(smoke, 'tool');
  await smoke.click(`[data-testid=tab][data-type="project.editor"][data-title="${ARABIC_NAME}"]`);
  await smoke.until(() => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(ARABIC_NAME)}`));
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);

  smoke.check('the empty level speaks Arabic', (await smoke.waitFor(`${tab} [data-testid=plan-empty]`, 3000, 'ارسم الجدار الأول.')) && (await smoke.waitFor(`${tab} [data-testid=plan-empty-otto-line]`, 3000, 'Otto')));
  smoke.check("its sketch's dimension stays a drawing, left to right", (await direction(smoke, `${tab} [data-testid=plan-empty] x-room-sketch svg`)) === 'ltr');
  smoke.check('the canvas is never mirrored', (await direction(smoke, canvas)) === 'ltr');
  smoke.check('the Properties panel speaks Arabic', (await smoke.waitFor(`${tab} [data-testid=properties-empty]`, 3000, 'لا شيء محدد')) && (await smoke.waitFor(`${tab} [data-testid=right-tab-properties]`, 3000, 'الخصائص')));

  smoke.section('arabic: the Wall tool');
  await smoke.click(`${tab} [data-testid=tool-wall]`);
  smoke.check('the Wall tool shows its options in Arabic', (await smoke.until(async () => (await tool()) === 'wall')) && (await smoke.waitFor(`${tab} [data-testid=tool-options]`, 3000, 'السماكة')));
  smoke.check('and its hint in the footer, key names in Latin', await smoke.until(async () => (await hint()) === 'انقر بداية الجدار · V: تحديد'), await hint());
  smoke.check('the hint is a line of the right-to-left footer', (await direction(smoke, `${tab} [data-testid=plan-hint]`)) === 'rtl');
  // A live switch: the footer's hint follows the language without the tool being picked again.
  await smoke.run('config.update', { patch: { appearance: { language: 'en' } } });
  smoke.check('the hint follows a switch to English at once', await smoke.until(async () => (await hint()) === 'Click the start of a wall · V: select'), await hint());
  await smoke.run('config.update', { patch: { appearance: { language: 'ar' } } });
  smoke.check('and back to Arabic', await smoke.until(async () => (await hint()) === 'انقر بداية الجدار · V: تحديد'), await hint());
  await smoke.until(() => smoke.js<boolean>(`document.documentElement.dir === 'rtl'`));

  // On an Arabic layout the W key writes ص: the shortcut goes by the physical key. Electron's input events
  // always come from a Latin layout, so this one is dispatched as the Arabic layout would send it.
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Escape');
  await smoke.until(async () => (await tool()) === 'select');
  await smoke.js(`document.querySelector('${canvas}').dispatchEvent(new KeyboardEvent('keydown', { key: 'ص', code: 'KeyW', bubbles: true, cancelable: true }))`);
  smoke.check('W on an Arabic keyboard layout picks the Wall tool', await smoke.until(async () => (await tool()) === 'wall'), await tool());
  await wait(100);

  // A wall typed in Arabic-Indic digits: start with a click (Alt: exactly there), aim to the right, type ٣٦٠٠.
  // An empty level's camera has not moved yet, so the canvas has no `data-camera`: zoom in and out once.
  await smoke.click(`${tab} [data-testid=plan-zoom-in]`);
  await smoke.click(`${tab} [data-testid=plan-zoom-out]`);
  await smoke.until(async () => Boolean(await canvasAttr(smoke, 'camera')));
  let v = await view(smoke);
  const start = v.at([-2000, -1500]);
  await smoke.clickAt(start.x, start.y, { modifiers: ['alt'] });
  await smoke.mouseMove(start.x + 60, start.y, ['alt']);
  await smoke.mouseMove(start.x + 61, start.y, ['alt']);
  // The first digit is a key the canvas must see; an Arabic-Indic one comes from an Arabic layout, dispatched as it would send it.
  await smoke.js(`document.querySelector('${canvas}').dispatchEvent(new KeyboardEvent('keydown', { key: '٣', code: 'Digit3', bubbles: true, cancelable: true }))`);
  smoke.check('an Arabic-Indic digit opens the input at the cursor', (await smoke.waitFor(`${tab} [data-testid=dynamic-input][data-mode=coord]`)) && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=dynamic-input]').value`)) === '٣');
  await smoke.typeText('٦٠٠');
  const typed = await smoke.js<{ value: string; dir: string }>(`(() => { const el = document.querySelector('${tab} [data-testid=dynamic-input]'); return { value: el.value, dir: getComputedStyle(el).direction }; })()`);
  smoke.check('the length reads as typed, left to right', typed.value === '٣٦٠٠' && typed.dir === 'ltr', typed);
  await smoke.shots('88-plan-typed-arabic');
  const before = walls().length;
  await smoke.key('Return');
  const typedWall = () => walls()[before];
  const length = () => {
    const w = typedWall();
    return w ? Math.hypot(w.path.v[1].p[0] - w.path.v[0].p[0], w.path.v[1].p[1] - w.path.v[0].p[1]) : 0;
  };
  smoke.check('a length typed as ٣٦٠٠ draws a 3600 mm wall', await smoke.until(() => walls().length === before + 1 && Math.abs(length() - 3600) < 0.01), { walls: walls().length, length: length() });
  smoke.check('the hint goes on to the next point, in Arabic', await smoke.until(async () => (await hint())?.startsWith('انقر النقطة التالية') === true), await hint());
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Escape');
  await smoke.key('Escape');
  await smoke.until(async () => (await tool()) === 'select');

  // The rest of the room through commands, and its name in Arabic.
  const p0 = typedWall().path.v[0].p;
  const corner = (dx: number, dy: number): [number, number] => [p0[0] + dx, p0[1] + dy];
  await smoke.run('plan.wall.add', { levelId: level, points: [{ p: corner(3600, 0) }, { p: corner(3600, 3000) }, { p: corner(0, 3000) }, { p: corner(0, 0) }] }, { projectId });
  await smoke.run('plan.room.add', { levelId: level, seed: corner(1800, 1500), name: ROOM_NAME }, { projectId });
  const rooms = await smoke.run<{ name: string; enclosed: boolean; labelAt: [number, number] }[]>('plan.rooms', { levelId: level }, { projectId });
  const room = rooms.find((r) => r.name === ROOM_NAME);
  smoke.check('the Arabic room is enclosed', room?.enclosed === true, rooms);
  // Fit the room into view. The walls reach the window's mirror a moment after the commands: fit again until both corners are on the canvas.
  const inView = async () => {
    const now = await view(smoke);
    return [corner(-200, -200), corner(3800, 3200)].every((p) => {
      const s = now.at(p);
      return s.x > now.rect.x && s.x < now.rect.x + now.rect.width && s.y > now.rect.y && s.y < now.rect.y + now.rect.height;
    });
  };
  smoke.check(
    'the room fits into view',
    await smoke.until(async () => {
      await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
      await wait(150);
      return inView();
    }),
  );

  // A label typed in Arabic through the Label tool, in the room above its name (on the room's light floor).
  const labelAt = corner(1800, 2300);
  const labelBox = (at: { x: number; y: number }) => ({ x: at.x - 50, y: at.y - 12, width: 100, height: 24 });
  v = await view(smoke);
  const inkBefore = await inkIn(smoke, labelBox(v.at(labelAt)));
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('T');
  smoke.check('T picks the Label tool', await smoke.until(async () => (await tool()) === 'label'), await tool());
  await wait(100);
  // The Label tool's options bar took space above the canvas: measure again.
  v = await view(smoke);
  const labelPx = v.at(labelAt);
  await smoke.clickAt(labelPx.x, labelPx.y, { modifiers: ['alt'] });
  smoke.check('the Label tool asks for its text in Arabic', (await smoke.waitFor(`${tab} [data-testid=dynamic-input][data-mode=text]`)) && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=dynamic-input]').placeholder`)) === 'النص');
  await smoke.typeText(LABEL_TEXT);
  await smoke.key('Return');
  const label = () => entities().find((e) => e.type === 'label' && e.text === LABEL_TEXT);
  smoke.check('an Arabic label is placed', await smoke.until(() => Boolean(label())), entities().filter((e) => e.type === 'label'));
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Escape');
  await smoke.until(async () => (await tool()) === 'select');
  await wait(100);

  // Drawn: ink where the label and the room's name are (both on the room's light floor, nothing else dark there).
  v = await view(smoke);
  const inkAfter = await inkIn(smoke, labelBox(v.at(labelAt)));
  smoke.check('the Arabic label is drawn on the canvas', inkBefore >= 0 && inkAfter > inkBefore + 15, { inkBefore, inkAfter });
  if (room) {
    const name = v.at(room.labelAt);
    const nameInk = await inkIn(smoke, { x: name.x - 50, y: name.y - 18, width: 100, height: 16 });
    smoke.check("and so is the room's Arabic name", nameInk > 15, nameInk);
  }
  await smoke.shots('89-plan-arabic');

  await smoke.click(`${tab} [data-testid=snap-menu-button]`);
  smoke.check('the snap menu speaks Arabic', (await smoke.waitFor(`${tab} [data-testid=snap-menu]`, 3000, 'نقاط النهاية')) && (await smoke.waitFor(`${tab} [data-testid=snap-menu]`, 3000, 'إظهار الشبكة')));
  smoke.check('with its grid spacing a left-to-right island', (await direction(smoke, `${tab} [data-testid=grid-spacing]`)) === 'ltr');
  await smoke.shots('91-plan-snap-menu-arabic');
  await smoke.js(`document.querySelector('[data-testid=snap-menu]')?.previousElementSibling?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await smoke.gone(`${tab} [data-testid=snap-menu]`);
  // The stair's options bar, the longest, and its hint on a one-level project.
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('S', ['shift']);
  smoke.check('Shift+S picks the stair, its options and hint in Arabic', (await smoke.until(async () => (await tool()) === 'stair')) && (await smoke.waitFor(`${tab} [data-testid=tool-options]`, 3000, 'درج')) && (await smoke.until(async () => (await hint())?.startsWith('يحتاج الدرج') === true)), await hint());
  await smoke.shots('92-plan-stair-arabic');
  await smoke.key('Escape');
  await smoke.until(async () => (await tool()) === 'select');
  await wait(100);
  v = await view(smoke);

  smoke.section('arabic: a selected wall');
  const mid = v.at(corner(1800, 0));
  await smoke.clickAt(mid.x, mid.y);
  smoke.check('clicking the wall selects it', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === typedWall().id), await canvasAttr(smoke, 'selection'));
  smoke.check('its Properties speak Arabic', (await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000, 'جدار')) && (await smoke.waitFor(`${tab} [data-testid=entity-editor][data-type=wall]`, 3000, 'السماكة')));
  smoke.check('its length reads 3600 mm, a left-to-right island', (await smoke.text(`${tab} [data-testid=prop-length]`)) === '3600 mm' && (await direction(smoke, `${tab} [data-testid=prop-length]`)) === 'ltr', await smoke.text(`${tab} [data-testid=prop-length]`));
  smoke.check('and its thickness field too', (await direction(smoke, `${tab} [data-testid=prop-thickness]`)) === 'ltr');
  smoke.check('the footer counts the selection in Arabic', await smoke.waitFor(`${tab} [data-testid=plan-selection]`, 3000, 'عنصر واحد محدد'));
  smoke.check('and its hint is Arabic', (await hint())?.startsWith('تم تحديد عنصر واحد') === true, await hint());
  await smoke.shots('90-plan-properties-arabic');
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Escape');
}

/** Whether, in the first text node of an element, `first` is drawn to the left of `second` (both must be in it): `3000 mm` read in that visual order, not `mm 3000`. */
const leftOf = (smoke: Smoke, selector: string, first: string, second: string) =>
  smoke.js<boolean | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !node.textContent.includes(${JSON.stringify(first)}));
    if (!node) return null;
    const text = node.textContent;
    const x = (needle) => {
      const i = text.indexOf(needle);
      if (i < 0) return NaN;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      return range.getBoundingClientRect().x;
    };
    return x(${JSON.stringify(first)}) < x(${JSON.stringify(second)});
  })()`);

/**
 * The building, the rules and the decor in Arabic (milestone 12, step 4), on the Arabic project the plan
 * section drew: the Levels panel with its lengths read left to right (`3000 mm`, never `mm 3000`), the
 * Layers panel, a stair made too steep raising a warning the Warnings panel says in Arabic, the Catalog
 * searched in Arabic, a sofa placed from it with its Arabic name in Properties, the 3D view's toolbar,
 * the section and Settings > Rules.
 */
async function smokeArabicBuilding(smoke: Smoke, projectId: string): Promise<void> {
  const { host } = smoke;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const doc = () => host.projects.session(projectId)!.doc;
  const ground = doc().building.groundLevelId;
  const tool = () => canvasAttr(smoke, 'tool');

  smoke.section('arabic: levels and layers');
  // A level above the ground floor, for a stair to reach.
  const upper = (await run<{ id: string }>('building.level.add', { position: 'top' })).id;
  smoke.check('a second level is added', await smoke.until(async () => (await smoke.count(`${tab} [data-testid=level-row]`)) === 2));
  // The ground floor stays the active level: its row, then its fields.
  await smoke.click(`${tab} [data-testid=level-row][data-elevation="0"]`);
  smoke.check(
    'the Levels panel speaks Arabic',
    (await smoke.waitFor(`${tab} [data-testid=levels-panel]`, 3000, 'الطوابق')) && (await smoke.waitFor(`${tab} [data-testid=level-details]`, 3000, 'الارتفاع بين الطابقين')) && (await smoke.waitFor(`${tab} [data-testid=level-details]`, 3000, 'المنسوب')),
  );
  const upperRow = `${tab} [data-testid=level-row][data-elevation="3000"] [data-testid=level-elevation]`;
  smoke.check(
    "the level above reads 3000 mm, the number left of its unit",
    (await smoke.text(upperRow)) === '3000 mm' && (await direction(smoke, upperRow)) === 'ltr' && (await leftOf(smoke, upperRow, '3', 'm')) === true,
    { text: await smoke.text(upperRow), left: await leftOf(smoke, upperRow, '3', 'm') },
  );
  const height = `${tab} [data-testid=level-height-input]`;
  smoke.check(
    "the ground floor's height field holds 3000 mm, left to right",
    (await smoke.until(async () => (await smoke.js<string>(`document.querySelector('${height}')?.value ?? ''`)) === '3000 mm')) && (await direction(smoke, height)) === 'ltr',
    await smoke.js<string>(`document.querySelector('${height}')?.value ?? ''`),
  );
  smoke.check("and the level's name field takes either direction", (await smoke.js<string | null>(`document.querySelector('${tab} [data-testid=level-name]')?.getAttribute('dir') ?? null`)) === 'auto');
  smoke.check(
    'the Layers panel speaks Arabic',
    (await smoke.waitFor(`${tab} [data-testid=layers-panel]`, 3000, 'الطبقات')) && (await smoke.waitFor(`${tab} [data-testid=layer-kind]`, 3000, 'إنشائية')) && (await smoke.waitFor(`${tab} [data-testid=layers-panel]`, 3000, 'العتامة')),
  );
  smoke.check(
    'with its opacity a left-to-right island and its buttons named in Arabic',
    (await direction(smoke, `${tab} [data-testid=layer-opacity-value]`)) === 'ltr' && ((await smoke.js<string>(`document.querySelector('${tab} [data-testid=layer-visible]')?.getAttribute('aria-label') ?? ''`)) ?? '').startsWith('إخفاء'),
  );
  await smoke.js(`document.querySelector('${tab} [data-testid=project-left]').scrollTop = 0`);
  await smoke.shots('93-levels-layers-arabic');

  smoke.section('arabic: a warning');
  const walls = Object.values(doc().levelData[ground].entities).filter((e): e is Wall => e.type === 'wall');
  const xs = walls.flatMap((w) => w.path.v.map((v) => v.p[0]));
  const ys = walls.flatMap((w) => w.path.v.map((v) => v.p[1]));
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  // A stair beside the room, then eight risers over 3 m: 375 mm each, too high (as the rules section does in English).
  const stair = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'stair', shape: 'straight', from: [minX - 1500, minY], to: [minX - 1500, minY + 3000], bottomLevelId: ground, topLevelId: upper } })).id;
  await run('building.connector.update', { id: stair, set: { riser: { count: 8 } } });
  await smoke.click(`${tab} [data-testid=right-tab-warnings]`);
  const row = `${tab} [data-testid=warning-row][data-rule=stair-limits][data-target="${stair}"]`;
  smoke.check('the stair raises a warning', await smoke.waitFor(row, 5000), await smoke.text(`${tab} [data-testid=warnings-panel]`));
  const warning = (await smoke.js<string[]>(`[...document.querySelectorAll('${row} [data-testid=warning-text]')].map((el) => el.textContent)`)) ?? [];
  const high = warning.find((text) => text.includes('ارتفاع القائمة')) ?? '';
  smoke.check('the Warnings panel says it in Arabic, the stair named as its kind', high.startsWith('\u2068الدرج\u2069') && high.includes('يتجاوز الحد الأقصى'), warning);
  // The panel keeps a length on one line: a no-break space between the number and its unit.
  smoke.check('its lengths are formatted and isolated left to right', high.includes(`${LRI}375\u00a0mm${PDI}`), high);
  smoke.check('the panel counts in Arabic, its tab too', (await smoke.waitFor(`${tab} [data-testid=warnings-count]`, 3000, 'تحذير')) && (await smoke.waitFor(`${tab} [data-testid=right-tab-warnings]`, 3000, 'التحذيرات')));
  const agents = (await run<{ warnings: { id: string; message: string }[] }>('rules.check')).warnings.find((w) => w.id === `${stair}:riser-high`);
  smoke.check('while agents still read the warning in English', agents?.message.startsWith('Stair: Risers of 375 mm are higher than') === true, agents);
  await smoke.shots('94-warnings-arabic');

  smoke.section('arabic: the catalog');
  await smoke.click(`${tab} [data-testid=right-tab-catalog]`);
  smoke.check(
    'the Catalog speaks Arabic',
    (await smoke.waitFor(`${tab} [data-testid=catalog-tab-item]`, 3000, 'الأثاث')) && (await smoke.waitFor(`${tab} [data-testid=catalog-category][data-category=bedroom]`, 3000, 'النوم')) && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=catalog-search]').placeholder`)) === 'بحث',
  );
  // "أريكة" typed without its hamza and with ه for ة, as people often type it.
  await smoke.fill(`${tab} [data-testid=catalog-search]`, 'اريكه');
  const firstCard = () => smoke.js<string>(`document.querySelector('${tab} [data-testid=catalog-card]')?.dataset.ref ?? ''`);
  smoke.check('an Arabic search finds the sofas, best match first', await smoke.until(async () => (await firstCard()) === 'builtin:sofa-2' && (await smoke.count(`${tab} [data-testid=catalog-card]`)) < 5), { first: await firstCard(), count: await smoke.count(`${tab} [data-testid=catalog-card]`) });
  const sofa = `${tab} [data-testid=catalog-card][data-ref="builtin:sofa-2"]`;
  smoke.check('shown by their Arabic names', (await smoke.text(`${sofa} [data-testid=catalog-card-name]`)) === 'أريكة بمقعدين', await smoke.text(`${sofa} [data-testid=catalog-card-name]`));
  smoke.check('with their sizes left to right', (await direction(smoke, `${sofa} [data-testid=catalog-card-caption]`)) === 'ltr');
  await smoke.shots('95-catalog-arabic');

  smoke.section('arabic: a piece placed');
  await smoke.click(sofa);
  smoke.check('a click arms the Furniture tool, its options naming the sofa in Arabic', (await smoke.until(async () => (await tool()) === 'item')) && (await smoke.waitFor(`${tab} [data-testid=item-armed]`, 3000, 'أريكة بمقعدين')));
  // The options bar took space above the canvas: measure again.
  let v = await view(smoke);
  const at: [number, number] = [minX + 1000, minY + 900];
  const items = () => Object.values(doc().levelData[ground].entities).filter((e) => e.type === 'item');
  const p = v.at(at);
  await smoke.mouseMove(p.x, p.y, ['alt']);
  await smoke.clickAt(p.x, p.y, { modifiers: ['alt'] });
  smoke.check('a click places it', await smoke.until(() => items().length === 1), items().length);
  const item = items()[0];
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Escape');
  await smoke.until(async () => (await tool()) === 'select');
  await wait(100);
  v = await view(smoke);
  const q = v.at(at);
  await smoke.clickAt(q.x, q.y);
  smoke.check('clicking it selects it', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === item?.id), await canvasAttr(smoke, 'selection'));
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  smoke.check('Properties name its model in Arabic', await smoke.waitFor(`${tab} [data-testid=item-model-name]`, 3000, 'أريكة بمقعدين'), await smoke.text(`${tab} [data-testid=item-model-name]`));
  smoke.check(
    'and its material slots and their built-in materials too',
    (await smoke.waitFor(`${tab} [data-testid=item-model]`, 3000)) && (await smoke.js<boolean>(`(() => { const s = document.querySelector('${tab} [data-testid=item-slot-fabric]'); return !!s && s.closest('label').textContent.includes('القماش') && [...s.options].some((o) => o.textContent.includes('قماش فحمي')); })()`)),
  );
  await smoke.shots('96-item-properties-arabic');
  await smoke.js(`document.querySelector('${canvas}').focus()`);
  await smoke.key('Escape');

  smoke.section('arabic: the 3D view and the section');
  await smoke.click(`${tab} [data-testid=center-tab-3d]`);
  smoke.check(
    "the 3D view's toolbar speaks Arabic",
    (await smoke.waitFor(`${tab} [data-testid=scene-toolbar]`, 5000, 'أعلى')) && (await smoke.waitFor(`${tab} [data-testid=scene-lighting-day]`, 3000, 'نهار')) && (await smoke.waitFor(`${tab} [data-testid=scene-mode-cutaway]`, 3000, 'قطع')) && (await smoke.waitFor(`${tab} [data-testid=scene-footer]`, 3000, 'اسحب للدوران')),
  );
  smoke.check('its tab title too', await smoke.waitFor(`${tab} [data-testid=center-tab-3d]`, 3000, 'ثلاثي الأبعاد'));
  smoke.check('the 3D canvas draws the building', await smoke.until(async () => Number(await sceneAttr(smoke, 'meshes')) > 0, 10_000));
  const option = await smoke.js<string>(`document.querySelector('${tab} [data-testid=scene-level] option[value="${ground}"]')?.textContent ?? ''`);
  smoke.check("its level select keeps each elevation left to right", option.includes(`${LRI}0 mm${PDI}`), option);
  await smoke.shots('97-scene-arabic');
  await smoke.click(`${tab} [data-testid=center-tab-section]`);
  smoke.check(
    'the section speaks Arabic, its drawing never mirrored',
    (await smoke.waitFor(`${tab} [data-testid=section-ground]`, 3000, 'منسوب الأرض')) && (await smoke.waitFor(`${tab} [data-testid=level-contents]`, 3000, 'قطعة أثاث')) && (await direction(smoke, `${tab} [data-testid=section-view]`)) === 'ltr',
    await smoke.text(`${tab} [data-testid=level-contents]`),
  );
  await smoke.shots('98-section-arabic');
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  await smoke.waitFor(canvas);

  smoke.section('arabic: Settings > Rules');
  await smoke.click('[data-testid=tab][data-type="settings.main"]');
  await smoke.waitFor('[data-section=rules]');
  smoke.check(
    'the Rules section speaks Arabic, its limits left to right',
    (await smoke.waitFor('[data-section=rules] h2', 3000, 'القواعد')) && (await smoke.waitFor('[data-section=rules]', 3000, 'أعلى قائمة')) && (await direction(smoke, '[data-testid=rule-maxRiser]')) === 'ltr' && (await direction(smoke, '[data-testid=rule-maxRampSlope]')) === 'ltr',
  );
  await smoke.js(`document.querySelector('[data-section=rules]').scrollIntoView({ block: 'start' })`);
  await smoke.shots('99-settings-rules-arabic');
  await smoke.click(`[data-testid=tab][data-type="project.editor"][data-title="${ARABIC_NAME}"]`);
  await smoke.until(() => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(ARABIC_NAME)}`));
}
