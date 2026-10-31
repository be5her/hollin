import type { Entity } from '@studio/core';
import { FakeClaude } from '@studio/modules/assistant/fake-api';
import type { Smoke } from './harness';
import { openProjectTab, tab } from './plan-canvas';

/**
 * Otto's presence (`design/identity/03-otto.md` §b, §d, §e) against the fake Claude API: the right tab
 * named Otto with its mark, the panel header, the empty conversation's example chips, the status bar
 * going ready → thinking (a held answer) → waiting for your yes → ready and opening the Otto tab, a
 * done card with its level and "one undo step, by Otto", the waiting card with Allow and Keep it and the
 * greyed waiting row at the top of History, History's rows for you and for Otto (the tint, the mark, the
 * signature and the newest bar), and a snapshot card with its image. The real API is never called.
 */
export async function smokeOttoUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('otto');
  const fake = new FakeClaude();
  process.env.STUDIO_AI_BASE_URL = await fake.start();
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  const ground = doc().building.groundLevelId;
  const groundName = doc().levels[ground].name;
  const walls = () => Object.values(doc().levelData[ground].entities).filter((e: Entity) => e.type === 'wall').length;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId: duplexId });
  const panel = `${tab} [data-testid=assistant-panel]`;
  const status = '[data-testid=status-otto]';
  const idle = () =>
    smoke.until(async () => {
      const state = await run<{ status: string; stopping: boolean }>('assistant.state');
      return state.status === 'idle' && !state.stopping;
    });
  const send = async (text: string) => {
    await idle();
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.fill(`${panel} [data-testid=assistant-input]`, text);
    await smoke.click(`${panel} [data-testid=assistant-send]`);
  };
  const statusIs = (state: string, text?: string, timeoutMs = 5000) => smoke.waitFor(`${status}[data-state=${state}]`, timeoutMs, text);

  try {
    await openProjectTab(smoke, duplexId);
    smoke.check('the right tab is named Otto, with its mark', (await smoke.waitFor(`${tab} [data-testid=right-tab-assistant]`, 3000, 'Otto')) && (await smoke.count(`${tab} [data-testid=right-tab-assistant] x-otto-mark`)) === 1);
    smoke.check('without a key the status bar says Otto needs one', await statusIs('needs-key', 'Otto · needs a key'));
    await run('ai.key.set', { key: 'sk-ant-smoke-key-0000' });
    smoke.check('with a key it says Otto is ready', await statusIs('ready', 'Otto · ready'));
    await smoke.click(`${tab} [data-testid=right-tab-history]`);
    await smoke.click(status);
    smoke.check('clicking the status opens the Otto tab', await smoke.waitFor(panel, 3000));

    smoke.check('the header shows the mark, Otto, the model and the rule', (await smoke.waitFor(`${panel} [data-testid=assistant-header] x-otto-mark[aria-label=Otto]`, 3000)) && (await smoke.waitFor(`${panel} [data-testid=assistant-header]`, 3000, 'asks before deleting')) && ((await smoke.text(`${panel} [data-testid=assistant-model]`))?.length ?? 0) > 0);
    smoke.check('the composer asks Otto, with the hint about the undo stack', (await smoke.js<string>(`document.querySelector('${panel} [data-testid=assistant-input]').placeholder`)) === 'Ask Otto…' && (await smoke.waitFor(`${panel} [data-testid=assistant-hint]`, 3000, 'Edits land on your undo stack, signed Otto.')));
    smoke.check('the empty conversation offers two example sentences', (await smoke.count(`${panel} [data-testid=assistant-intro] [data-testid=assistant-example]`)) === 2);
    await smoke.click(`${panel} [data-testid=assistant-example]`);
    smoke.check('an example goes into the message field, unsent', (await smoke.js<string>(`document.querySelector('${panel} [data-testid=assistant-input]').value`)).startsWith('add a 4 by 5 m bedroom') && fake.requests.length === 0);

    // An edit: the first answer is held, so the status bar shows Otto thinking and the composer offers Stop.
    const before = walls();
    fake.script(
      { hold: true, text: 'Adding the wall.', tools: [{ name: 'plan_apply', input: { label: 'Add a 3 m wall', steps: [{ command: 'plan.wall.add', input: { levelId: ground, from: [3000, 6500], to: [6000, 6500], thickness: 150 } }] } }] },
      { text: 'Added a 3 000 mm wall on the ground floor, 150 mm thick. It is in History, signed Otto.' },
    );
    await send('Add a 3 m wall');
    smoke.check('while Otto works the status bar says it is thinking', (await smoke.until(() => fake.held === 1)) && (await statusIs('thinking', 'Otto · thinking…')));
    smoke.check('and the composer offers Stop in place of Send', (await smoke.waitFor(`${panel} [data-testid=assistant-stop]`, 3000)) && (await smoke.count(`${panel} [data-testid=assistant-send]`)) === 0);
    fake.release();
    smoke.check('the edit lands as a done card titled by the batch', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="plan.apply"][data-status=ok] [data-testid=assistant-tool-title]`, 8000, 'Add a 3 m wall'));
    smoke.check('the card names the command, the level and one undo step by Otto', (await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="plan.apply"] [data-testid=assistant-tool-command]`, 3000, 'plan.apply')) && (await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="plan.apply"] [data-testid=assistant-tool-meta]`, 3000, `${groundName} · 1 edit · one undo step, by Otto`)), await smoke.text(`${panel} [data-testid=assistant-tool-meta]`));
    smoke.check('the wall was added', await smoke.until(() => walls() === before + 1));
    smoke.check("Otto's reply is a margin note", (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'Added a 3 000 mm wall')) && (await smoke.js<boolean>(`[...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=assistant]')].every((e) => e.classList.contains('border-ai'))`)));
    smoke.check('the status bar is ready again', await statusIs('ready', 'Otto · ready'));
    await idle();

    // Your own edit, then a destructive call Otto waits on.
    await run('plan.wall.add', { levelId: ground, from: [3000, 7500], to: [6000, 7500], thickness: 150 });
    fake.reset();
    fake.script({ tools: [{ name: 'smoke_destroy', input: {} }] }, { text: 'Kept it. Nothing changed.' });
    await send('Wipe it');
    smoke.check('a destructive call waits in the chat with Allow and Keep it', (await smoke.waitFor(`${panel} [data-testid=assistant-confirm][data-command="smoke.destroy"]`, 5000)) && (await smoke.text(`${panel} [data-testid=assistant-allow]`)) === 'Allow' && (await smoke.text(`${panel} [data-testid=assistant-decline]`)) === 'Keep it');
    smoke.check('the waiting card says Otto asks before deleting, and takes focus', (await smoke.waitFor(`${panel} [data-testid=assistant-confirm]`, 3000, 'Otto asks before deleting.')) && (await smoke.until(() => smoke.js<boolean>(`document.activeElement?.dataset?.testid === 'assistant-confirm'`), 3000)));
    smoke.check('the status bar says Otto is waiting for your yes', await statusIs('waiting', 'Otto · waiting for your yes'));
    smoke.check('the composer waits too', (await smoke.js<string>(`document.querySelector('${panel} [data-testid=assistant-input]').placeholder`)) === 'Otto is waiting for your answer above');

    await smoke.click(`${tab} [data-testid=right-tab-history]`);
    smoke.check('History shows the waiting call greyed at the top', (await smoke.waitFor(`${tab} [data-testid=history-list] > li:first-child[data-testid=history-waiting][data-command="smoke.destroy"]`, 3000)) && (await smoke.waitFor(`${tab} [data-testid=history-waiting]`, 3000, 'Otto · waiting for your yes')));
    const rows = await smoke.js<{ kind: string; author: string; tint: boolean; newest: boolean; bar: boolean; signature: string; mark: boolean }[]>(
      `[...document.querySelectorAll('${tab} [data-testid=history-item]')].slice(0, 2).map((e) => ({ kind: e.dataset.kind, author: e.dataset.author, tint: e.classList.contains('bg-ai-tint'), newest: e.dataset.newest === 'true', bar: !!e.querySelector('[data-testid=history-newest-bar]'), signature: e.querySelector('[data-testid=history-signature]').textContent.trim(), mark: !!e.querySelector('[data-glyph=assistant] x-otto-mark') }))`,
    );
    const [yours, otto] = rows;
    smoke.check('your edit is the newest row: no tint, signed You, with the terracotta bar', yours?.kind === 'user' && yours.author === 'You' && !yours.tint && yours.newest && yours.bar && yours.signature.startsWith('You · Structure'), yours);
    smoke.check("Otto's row is on the tint with the mark, signed Otto · layer · command id", otto?.kind === 'assistant' && otto.author === 'Otto' && otto.tint && otto.mark && !otto.bar && otto.signature === 'Otto · Structure · plan.apply', otto);
    await smoke.shots('69-otto-history');
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
    await smoke.waitFor(`${panel} [data-testid=assistant-decline]`, 3000);
    await smoke.click(`${panel} [data-testid=assistant-decline]`);
    smoke.check('Keep it turns the card into declined', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="smoke.destroy"][data-status=declined]`, 5000, 'Kept. Otto was told no.'));
    smoke.check('and the status bar is ready again', await statusIs('ready', 'Otto · ready', 8000));
    await smoke.click(`${tab} [data-testid=right-tab-history]`);
    smoke.check('the waiting row leaves History', await smoke.gone(`${tab} [data-testid=history-waiting]`, 3000));
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);

    // A snapshot card carries the picture Otto looked at.
    fake.reset();
    fake.script({ tools: [{ name: 'view_snapshot', input: { levelId: ground } }] }, { text: 'I looked at the ground floor; the picture is above. The new walls run parallel, 1 000 mm apart.' });
    await send('Show me the ground floor');
    smoke.check('the snapshot card shows its image', await smoke.until(() => smoke.js<boolean>(`(() => { const img = document.querySelector('${panel} [data-testid=assistant-tool][data-command="view.snapshot"] [data-testid=assistant-snapshot] img'); return !!img && img.complete && img.naturalWidth > 0; })()`), 10_000));
    smoke.check('with the level and the view on its second line', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="view.snapshot"] [data-testid=assistant-tool-meta]`, 3000, `${groundName} · plan`));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'I looked at the ground floor');
    await idle();
    await smoke.shots('68-otto-panel');

    await run('edit.undo');
    await run('edit.undo');
    smoke.check('both walls are undone', await smoke.until(() => walls() === before));
    await smoke.click(`${panel} [data-testid=assistant-clear]`);
    await smoke.waitFor(`${panel} [data-testid=assistant-intro]`, 3000);
  } finally {
    delete process.env.STUDIO_AI_BASE_URL;
    await fake.close();
    await smoke.run('ai.key.clear');
  }
}
