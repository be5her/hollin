import { BRANDING, type ProjectSummary } from '@studio/core';
import { FakeClaude, type FakeTurn } from '@studio/modules/assistant/fake-api';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, openProjectTab, tab } from './plan-canvas';

const card = (name: string) => `[data-testid=project-card][data-name="${name}"]`;
const composer = '[data-testid=otto-composer]';

/**
 * The identity's moments: Home's cards (tinted sheets with initials, never a gradient) and Otto's composer
 * card (Draft it creates the project, opens it and sends the sentence to Otto, who drafts the ground floor
 * through the fake Claude API while the card says so; the project's card then carries Otto's mark), the
 * empty project's guide and its Otto line (Enter sends the sentence), Properties' "Nothing selected", About
 * with the credit line and the licences, and the first-launch guide on a library with nothing in it (every
 * project moved to the trash for the check, then restored).
 */
export async function smokeIdentityUi(smoke: Smoke): Promise<void> {
  const { host } = smoke;
  smoke.section('identity: the bundled fonts');
  // `check` alone is true for a family no face is declared for (the system's fonts need no loading), so the
  // declared faces must also have loaded: in the packaged build that proves `out/renderer/media` loads over file://.
  const fonts = await smoke.js<{ family: string; check: boolean; loaded: number; failed: number }[]>(`(async () => {
    await document.fonts.ready;
    const families = ['Alegreya Sans', 'IBM Plex Mono', 'Fraunces'];
    await Promise.all(families.map((f) => document.fonts.load('12px "' + f + '"').catch(() => [])));
    const faces = [...document.fonts];
    return families.map((family) => ({
      family,
      check: document.fonts.check('12px "' + family + '"'),
      loaded: faces.filter((f) => f.family.replace(/["']/g, '') === family && f.status === 'loaded').length,
      failed: faces.filter((f) => f.family.replace(/["']/g, '') === family && f.status === 'error').length,
    }));
  })()`);
  smoke.check('Alegreya Sans, IBM Plex Mono and Fraunces load from the bundle', fonts.length === 3 && fonts.every((f) => f.check && f.loaded > 0 && f.failed === 0), fonts);

  smoke.section('identity: Home cards');
  await smoke.run<ProjectSummary>('project.create', { name: 'Garden room sketch', open: false });
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  smoke.check('a project without a thumbnail shows a tinted sheet', await smoke.waitFor(`${card('Garden room sketch')} [data-testid=project-placeholder]`));
  const sheet = await smoke.js<{ tint: string | null; image: string; color: string; initials: string | null; font: string }>(`(() => {
    const el = document.querySelector('${card('Garden room sketch')} [data-testid=project-placeholder]');
    const initials = el.querySelector('[data-testid=project-initials]');
    const style = getComputedStyle(el);
    return { tint: el.dataset.tint ?? null, image: style.backgroundImage, color: style.backgroundColor, initials: initials?.textContent?.trim() ?? null, font: initials ? getComputedStyle(initials).fontFamily : '' };
  })()`);
  smoke.check('the sheet is one of the four tints, a flat colour and no gradient', ['straw', 'sage', 'clay', 'slate'].includes(sheet.tint ?? '') && sheet.image === 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(sheet.color), sheet);
  smoke.check('the sheet carries the initials in Fraunces', sheet.initials === 'GR' && sheet.font.includes('Fraunces'), sheet);
  smoke.check('the sheet carries the pencil doodle', (await smoke.count(`${card('Garden room sketch')} x-house-doodle svg path`)) === 2);
  smoke.check('no card on Home has a gradient', await smoke.js<boolean>(`[...document.querySelectorAll('[data-testid=project-grid] *')].every((el) => !getComputedStyle(el).backgroundImage.includes('gradient'))`));
  smoke.check('the tint is stable for the project', (await smoke.js<string>(`document.querySelector('${card('Garden room sketch')} [data-testid=project-placeholder]').dataset.tint`)) === sheet.tint);
  smoke.check('the card names are not in the display face', await smoke.js<boolean>(`!getComputedStyle(document.querySelector('${card('Garden room sketch')} [data-testid=project-card-name]')).fontFamily.includes('Fraunces')`));
  smoke.check('Home\'s heading is in Fraunces', await smoke.js<boolean>(`getComputedStyle(document.querySelector('[data-testid=library-heading]')).fontFamily.includes('Fraunces')`));
  smoke.check("a project Otto never worked on carries no mark", (await smoke.count(`${card('Garden room sketch')} [data-testid=project-otto-mark]`)) === 0);

  smoke.section('identity: Start with Otto');
  smoke.check("Otto's composer is the grid's first card", await smoke.until(() => smoke.js<boolean>(`document.querySelector('[data-testid=project-grid]')?.firstElementChild?.matches('${composer}') ?? false`)));
  smoke.check('without a key it offers to set Otto up instead of drafting', (await smoke.waitFor(`${composer}[data-state=setup] [data-testid=otto-composer-setup]`)) && (await smoke.count(`${composer} [data-testid=otto-composer-draft]`)) === 0 && (await smoke.js<boolean>(`document.querySelector('${composer} [data-testid=otto-composer-input]').disabled`)));
  await smoke.click(`${composer} [data-testid=otto-composer-setup]`);
  smoke.check('Set up Otto opens Settings at the assistant', (await smoke.waitFor('[data-section=ai]')) && (await smoke.until(() => smoke.js<boolean>(`(() => { const r = document.querySelector('[data-section=ai]')?.getBoundingClientRect(); return !!r && r.top >= -2 && r.top < innerHeight / 2; })()`))));
  await smoke.click('[data-testid=tab][data-type="shell.home"]');
  const fake = new FakeClaude();
  process.env.STUDIO_AI_BASE_URL = await fake.start();
  try {
    await smoke.run('ai.key.set', { key: 'sk-ant-smoke-key-0000' });
    smoke.check('with a key the composer is ready', await smoke.waitFor(`${composer}[data-state=idle] [data-testid=otto-composer-draft]`));
    smoke.check('Draft it waits for a sentence', await smoke.js<boolean>(`document.querySelector('${composer} [data-testid=otto-composer-draft]').disabled`));
    const sentence = 'A small cabin by the lake, one bedroom and a stove';
    await smoke.fill(`${composer} [data-testid=otto-composer-input]`, sentence);
    smoke.check('and is enabled once there is one', await smoke.until(() => smoke.js<boolean>(`!document.querySelector('${composer} [data-testid=otto-composer-draft]').disabled`)));
    await smoke.shots('64-home-cards');
    // Otto's first answer is held until the project exists, then drafts four walls on its ground floor.
    const drafting: FakeTurn = { hold: true, text: 'Drafting the cabin.', tools: [{ name: 'plan_apply', input: {} }] };
    fake.script(drafting, { text: 'I drafted the cabin: four walls, 6 by 4 m. Change any length you like.' });
    await smoke.click(`${composer} [data-testid=otto-composer-draft]`);
    const named = 'A small cabin by the lake';
    smoke.check('Draft it creates a project named from the sentence and opens it', (await smoke.until(() => host.projects.list().some((p) => p.name === named && p.description === sentence))) && (await smoke.until(() => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(named)}`))));
    const cabin = host.projects.list().find((p) => p.name === named)!;
    smoke.check('with the Otto tab showing and the sentence sent as the first message', (await smoke.waitFor(`${tab} [data-testid=assistant-panel] [data-testid=assistant-item][data-kind=user]`, 5000, sentence)) && (await smoke.until(() => fake.held === 1)));
    const ground = host.projects.session(cabin.id)!.doc.building.groundLevelId;
    drafting.tools![0].input = { label: 'Draft the cabin', steps: [{ command: 'plan.wall.add', input: { levelId: ground, points: [{ p: [0, 0] }, { p: [6000, 0] }, { p: [6000, 4000] }, { p: [0, 4000] }], closed: true, thickness: 200 } }] };
    await smoke.click('[data-testid=tab][data-type="shell.home"]');
    smoke.check('while Otto drafts, the card says so with the sentence and Open', (await smoke.waitFor(`${composer}[data-state=drafting][data-project="${cabin.id}"] [data-testid=otto-composer-drafting]`, 3000, 'Otto is drafting…')) && (await smoke.waitFor(`${composer} [data-testid=otto-composer-sentence]`, 3000, sentence)) && (await smoke.count(`${composer} [data-testid=otto-composer-draft]`)) === 0, await smoke.js(`document.querySelector('${composer}')?.dataset.state`));
    await smoke.shots('72-home-drafting');
    await smoke.click(`${composer} [data-testid=otto-composer-open]`);
    smoke.check('Open goes to the project Otto is drafting', await smoke.until(() => smoke.js<boolean>(`document.querySelector('${tab} [data-testid=project-name]')?.value === ${JSON.stringify(named)}`)));
    fake.release();
    const walls = () => Object.values(host.projects.session(cabin.id)?.doc.levelData[ground]?.entities ?? {}).filter((e) => e.type === 'wall').length;
    smoke.check('Otto drafts the ground floor', (await smoke.until(() => walls() === 4, 8000)) && (await smoke.waitFor(`${tab} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'I drafted the cabin')), { walls: walls(), items: (await smoke.run<{ items: { kind: string; text?: string; summary?: string }[] }>('assistant.state', {}, { projectId: cabin.id })).items });
    smoke.check('and marks what it drew on the plan', await smoke.until(async () => (await canvasAttr(smoke, 'aiTag')) === 'Otto · Draft the cabin · now', 5000), await canvasAttr(smoke, 'aiTag'));
    await smoke.click('[data-testid=tab][data-type="shell.home"]');
    smoke.check('when Otto is done the composer is empty again', await smoke.waitFor(`${composer}[data-state=idle]`, 5000));
    smoke.check("and the project's card carries Otto's mark once the save lands", (await smoke.until(() => Boolean(host.projects.list().find((p) => p.id === cabin.id)?.assistantEditedAt), 10_000)) && (await smoke.waitFor(`${card(named)} [data-testid=project-otto-mark] x-otto-mark[aria-label="Otto has worked on ${named}"]`, 5000)));
    await wait(150);
    await smoke.shots('73-home-otto-mark');

    smoke.section('identity: the empty project');
    const studio = await smoke.run<ProjectSummary>('project.create', { name: 'Studio sketch', open: false });
    await openProjectTab(smoke, studio.id);
    smoke.check('a new project shows "Draw the first wall."', (await smoke.waitFor(`${tab} [data-testid=plan-empty]`, 5000, 'Draw the first wall.')) && (await smoke.js<boolean>(`getComputedStyle(document.querySelector('${tab} [data-testid=plan-empty] h2')).fontFamily.includes('Fraunces')`)));
    smoke.check('with the four keys', (await smoke.js<string[]>(`[...document.querySelectorAll('${tab} [data-testid=plan-empty-keys] kbd')].map((k) => k.textContent.trim())`)).join() === 'W,D,N,Ctrl K');
    const through = await smoke.js<{ overlay: string; hit: boolean }>(`(() => {
      const overlay = document.querySelector('${tab} [data-testid=plan-empty]');
      const title = overlay.querySelector('h2').getBoundingClientRect();
      const hit = document.elementFromPoint(title.x + title.width / 2, title.y + title.height / 2);
      return { overlay: getComputedStyle(overlay).pointerEvents, hit: hit === document.querySelector('${canvas}') };
    })()`);
    smoke.check('the guide lets the pointer through to the canvas', through.overlay === 'none' && through.hit, through);
    await smoke.click(`${tab} [data-testid=right-tab-properties]`);
    smoke.check('Properties says "Nothing selected" in Fraunces, with the keys', (await smoke.waitFor(`${tab} [data-testid=properties-empty]`, 3000, 'Nothing selected')) && (await smoke.waitFor(`${tab} [data-testid=properties-empty] kbd`, 3000, 'Esc')) && (await smoke.js<boolean>(`getComputedStyle(document.querySelector('${tab} [data-testid=properties-empty] [data-testid=empty-state-title]')).fontFamily.includes('Fraunces')`)));
    smoke.check("Otto's line holds an editable sentence", (await smoke.js<string>(`document.querySelector('${tab} [data-testid=plan-empty-otto]')?.value ?? ''`)) === 'a 5 by 7 m studio with a bathroom in the corner' && (await smoke.waitFor(`${tab} [data-testid=plan-empty-otto-line][data-ready=true]`, 3000, 'Or tell Otto:')));
    await smoke.shots('66-empty-project');
    fake.reset();
    fake.script({ text: 'A 5 by 7 m studio: shall I put the bathroom in the north-east corner?' });
    const told = 'a 5 by 7 m studio with a bathroom in the north corner';
    await smoke.fill(`${tab} [data-testid=plan-empty-otto]`, told);
    await smoke.js(`document.querySelector('${tab} [data-testid=plan-empty-otto]').focus()`);
    await smoke.key('Enter');
    smoke.check("Enter on Otto's line sends the sentence and opens the Otto tab", (await smoke.waitFor(`${tab} [data-testid=assistant-panel] [data-testid=assistant-item][data-kind=user]`, 5000, told)) && (await smoke.waitFor(`${tab} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'shall I put the bathroom')));
    smoke.check("and Otto's chat is idle again before your wall", await smoke.until(async () => (await smoke.run<{ status: string }>('assistant.state', {}, { projectId: studio.id })).status === 'idle'));
    const studioGround = host.projects.session(studio.id)!.doc.building.groundLevelId;
    await smoke.run('plan.wall.add', { levelId: studioGround, from: [0, 0], to: [4000, 0], thickness: 200 }, { projectId: studio.id });
    smoke.check('the guide is gone once the level has a wall', (await smoke.until(async () => Number(await canvasAttr(smoke, 'entities')) > 0)) && (await smoke.gone(`${tab} [data-testid=plan-empty]`)));
    await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  } finally {
    delete process.env.STUDIO_AI_BASE_URL;
    await fake.close();
    await smoke.run('ai.key.clear');
  }

  smoke.section('identity: About');
  await smoke.click('[data-testid=titlebar-settings]');
  await smoke.waitFor('[data-section=about]');
  await smoke.js(`document.querySelector('[data-section=about]').scrollIntoView({ block: 'end' })`);
  smoke.check('About shows the icon and the wordmark', (await smoke.waitFor('[data-testid=settings-about] x-app-mark svg')) && (await smoke.waitFor('[data-testid=settings-about] x-wordmark', 3000, BRANDING.productName)));
  smoke.check('and the description from the branding', (await smoke.text('[data-testid=about-description]')) === BRANDING.description);
  const credit = await smoke.js<{ text: string; otto: string; color: string; product: string; style: string }>(`(() => {
    const el = document.querySelector('[data-testid=about-credit]');
    const otto = el.querySelector('.text-ai');
    return { text: el.textContent.replace(/\\s+/g, ' ').trim(), otto: otto?.textContent?.trim() ?? '', color: otto ? getComputedStyle(otto).color : '', style: otto ? getComputedStyle(otto).fontStyle : '', product: getComputedStyle(el.firstElementChild).color };
  })()`);
  smoke.check('the credit line names the product with Otto, in two colours, "with Otto" in italic', credit.text === `${BRANDING.productName} with Otto` && credit.otto === 'with Otto' && credit.color !== credit.product && credit.style === 'italic', credit);
  smoke.check('then the model and the rule Otto keeps', await smoke.waitFor('[data-testid=about-assistant]', 3000, 'asks before it deletes anything'));
  const version = (await smoke.text('[data-testid=about-version]')) ?? '';
  smoke.check('and the version with the fonts and their licences', version.includes(host.opts.version) && ['Alegreya Sans', 'IBM Plex Mono', 'Fraunces (OFL 1.1)', 'Lucide (ISC)'].every((t) => version.includes(t)), version);
  await wait(150);
  await smoke.shots('67-about');
  await smoke.click('[data-testid=about-licences]');
  smoke.check('Licences… shows the fonts\' licence texts', await smoke.waitFor('[data-testid=licence-text]', 3000, 'SIL OPEN FONT LICENSE'));
  await smoke.click('[data-testid=licence-tab][data-licence=fraunces]');
  smoke.check('one font at a time', await smoke.waitFor('[data-testid=licence-text]', 3000, 'The Fraunces Project Authors'));
  await smoke.click('[data-testid=licences-close]');
  await smoke.gone('[data-testid=licence-text]');

  smoke.section('identity: first launch');
  const all = host.projects.list();
  const launchFake = new FakeClaude();
  // The project Otto's line creates, once it has (set inside a wait, so held in an object).
  const launch: { project?: ProjectSummary } = {};
  for (const p of all) await smoke.run('project.trash', { id: p.id });
  try {
    await smoke.click('[data-testid=tab][data-type="shell.home"]');
    smoke.check('an empty library shows the first-launch guide', await smoke.waitFor('[data-testid=library-first-launch]', 5000, 'Start with a room you know.'));
    smoke.check('with the wordmark, New project, Import… and Otto\'s line', (await smoke.waitFor('[data-testid=library-first-launch] x-wordmark')) && (await smoke.waitFor('[data-testid=first-launch-new]')) && (await smoke.waitFor('[data-testid=first-launch-import]')) && (await smoke.waitFor('[data-testid=first-launch-otto]', 3000, 'Or tell Otto')));
    smoke.check('and without the filters or the grid', (await smoke.count('[data-testid=library-search]')) === 0 && (await smoke.count('[data-testid=project-grid]')) === 0);
    await smoke.shots('65-first-launch');

    // Otto's line there is the empty project's editable sentence: Enter creates a project and sends it, like Draft it.
    const before = new Set(host.projects.list().map((p) => p.id));
    process.env.STUDIO_AI_BASE_URL = await launchFake.start();
    await smoke.run('ai.key.set', { key: 'sk-ant-smoke-key-0000' });
    launchFake.script({ text: 'A 4 by 5 m bedroom: shall I put the door on the hall side?' });
    const input = '[data-testid=library-first-launch] [data-testid=first-launch-otto-input]';
    smoke.check("first launch's Otto line holds an editable sentence, ready with a key", (await smoke.waitFor('[data-testid=first-launch-otto][data-ready=true]', 5000, 'Or tell Otto:')) && (await smoke.js<string>(`document.querySelector('${input}')?.value ?? ''`)) === 'a 5 by 7 m studio with a bathroom in the corner');
    const told = 'a 4 by 5 m bedroom, door to the hall';
    await smoke.fill(input, told);
    await smoke.js(`document.querySelector('${input}').focus()`);
    await smoke.key('Enter');
    smoke.check(
      'Enter on it creates a project from the sentence and sends it to Otto',
      (await smoke.until(() => (launch.project = host.projects.list().find((p) => !before.has(p.id) && p.description === told)) !== undefined)) &&
        (await smoke.waitFor(`${tab} [data-testid=assistant-panel] [data-testid=assistant-item][data-kind=user]`, 5000, told)) &&
        (await smoke.waitFor(`${tab} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'shall I put the door')),
      launch.project,
    );
    const launched = launch.project;
    if (launched) smoke.check("and Otto's chat there is idle again", await smoke.until(async () => (await smoke.run<{ status: string }>('assistant.state', {}, { projectId: launched.id })).status === 'idle'));
  } finally {
    delete process.env.STUDIO_AI_BASE_URL;
    await launchFake.close();
    await smoke.run('ai.key.clear');
    // The project Otto's line made goes to the trash, so later sections see the library they expect.
    if (launch.project) await smoke.run('project.trash', { id: launch.project.id });
    for (const p of all) await smoke.run('project.restore', { id: p.id });
  }
  smoke.check('the restored projects are back on Home', await smoke.until(async () => (await smoke.count('[data-testid=project-card]')) === host.projects.list().length && host.projects.list().length === all.length));
}
