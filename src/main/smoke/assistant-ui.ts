import type { Entity, HistoryInfo } from '@studio/core';
import { FakeClaude } from '@studio/modules/assistant/fake-api';
import type { Smoke } from './harness';
import { openProjectTab, tab } from './plan-canvas';

type ToolResultBlock = { type: string; tool_use_id?: string; is_error?: boolean; content: string | { type: string; source?: { media_type: string; data: string }; text?: string }[] };

/**
 * The in-app assistant against a fake Claude API: the empty state without a key, a design edit made
 * through plan_apply landing as one undoable transaction attributed to the assistant, a destructive
 * call waiting in the chat until the user declines or allows it, and a snapshot going back to the
 * model as an image. The real API is never called.
 */
export async function smokeAssistantUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('assistant');
  const fake = new FakeClaude();
  process.env.STUDIO_AI_BASE_URL = await fake.start();
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  const ground = doc().building.groundLevelId;
  const upper = doc().building.stack[1];
  const walls = () => Object.values(doc().levelData[ground].entities).filter((e: Entity) => e.type === 'wall').length;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId: duplexId });
  const panel = `${tab} [data-testid=assistant-panel]`;
  const send = async (text: string) => {
    // The reply's last words show before the run ends and Send is enabled again: wait for idle, or the click is lost.
    await smoke.until(async () => (await run<{ status: string }>('assistant.state')).status === 'idle');
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.fill(`${panel} [data-testid=assistant-input]`, text);
    await smoke.click(`${panel} [data-testid=assistant-send]`);
  };
  const lastToolResult = (request: number): ToolResultBlock | undefined => {
    const messages = fake.requests[request]?.body.messages ?? [];
    const last = messages[messages.length - 1];
    return Array.isArray(last?.content) ? (last.content[0] as ToolResultBlock) : undefined;
  };

  try {
    await openProjectTab(smoke, duplexId);
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
    smoke.check('the Assistant panel asks for a key when none is set', (await smoke.waitFor(`${panel} [data-testid=assistant-empty]`)) && (await smoke.count(`${panel} [data-testid=assistant-input]`)) === 0);
    await smoke.shots('27-assistant-empty');
    await smoke.run('ai.key.set', { key: 'sk-ant-smoke-key-0000' });
    smoke.check('once a key is set the chat opens', await smoke.waitFor(`${panel} [data-testid=assistant-input]`));
    smoke.check('the panel names the model', (await smoke.text(`${panel} [data-testid=assistant-model]`))?.length! > 0, await smoke.text(`${panel} [data-testid=assistant-model]`));

    // A design edit: the model answers with text and one plan_apply call, then a closing line.
    const before = walls();
    fake.script(
      { text: 'Adding the wall.', tools: [{ name: 'plan_apply', input: { label: 'Add a 3 m wall', steps: [{ command: 'plan.wall.add', input: { levelId: ground, from: [3000, 6000], to: [6000, 6000], thickness: 150 } }] } }] },
      { text: 'Done: a 3 m wall on the ground floor.' },
    );
    await send('Add a 3 m wall');
    smoke.check('the message shows in the chat', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=user]`, 5000, 'Add a 3 m wall'));
    smoke.check('the reply streams in', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'Done: a 3 m wall'));
    smoke.check('the tool call is shown done, with the batch label', (await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="plan.apply"][data-status=ok]`, 3000)) && (await smoke.text(`${panel} [data-testid=assistant-tool]`))?.includes('Add a 3 m wall') === true);
    smoke.check('the wall was added', await smoke.until(() => walls() === before + 1));
    const history = await run<{ undo: HistoryInfo[] }>('edit.history');
    smoke.check('the history has one entry labelled by the batch, by the assistant', history.undo[0]?.label === 'Add a 3 m wall' && history.undo[0].author.kind === 'assistant' && history.undo[0].author.name.startsWith('claude-'), history.undo[0]);
    const model = history.undo[0]?.author.name;
    const result = lastToolResult(1);
    smoke.check('the model got the tool result back', fake.requests.length === 2 && result?.type === 'tool_result' && !result.is_error && typeof result.content === 'string' && (JSON.parse(result.content) as { applied: boolean }).applied === true, result);
    smoke.check('the request carried the key, the tools and the project', fake.requests[0]?.headers['x-api-key'] === 'sk-ant-smoke-key-0000' && fake.requests[0].body.tools!.some((t) => t.name === 'plan_describe') && !fake.requests[0].body.tools!.some((t) => t.name === 'config_update') && JSON.stringify(fake.requests[0].body.system).includes('Duplex'));
    await smoke.click(`${tab} [data-testid=right-tab-history]`);
    smoke.check('the History panel lists the change under the assistant', await smoke.waitFor(`${tab} [data-testid=history-item][data-label="Add a 3 m wall"]`, 3000, `Assistant (${model})`));
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
    await run('edit.undo');
    smoke.check('one undo removes it', await smoke.until(() => walls() === before));

    // A destructive call waits for the user.
    fake.reset();
    fake.script({ tools: [{ name: 'smoke_destroy', input: {} }] }, { text: 'I left it alone.' }, { tools: [{ name: 'smoke_destroy', input: {} }] }, { text: 'Wiped.' });
    await send('Wipe it');
    smoke.check('a destructive call waits for the user in the chat', await smoke.waitFor(`${panel} [data-testid=assistant-confirm][data-command="smoke.destroy"]`, 5000));
    smoke.check('nothing went back to the model yet', fake.requests.length === 1, fake.requests.length);
    await smoke.shots('28-assistant-confirm');
    await smoke.click(`${panel} [data-testid=assistant-decline]`);
    smoke.check('declining tells the model so', (await fake.received(2)) && lastToolResult(1)?.is_error === true && (JSON.parse(lastToolResult(1)!.content as string) as { code: string }).code === 'MUTATION_DECLINED', lastToolResult(1));
    smoke.check('and the chat shows the call declined', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="smoke.destroy"][data-status=declined]`, 3000));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'I left it alone.');
    await send('Really wipe it');
    smoke.check('the second attempt waits again', await smoke.waitFor(`${panel} [data-testid=assistant-confirm]`, 5000));
    await smoke.click(`${panel} [data-testid=assistant-allow]`);
    smoke.check('allowing runs it', (await fake.received(4)) && (JSON.parse(lastToolResult(3)!.content as string) as { destroyed: boolean }).destroyed === true && (await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="smoke.destroy"][data-status=ok]`, 3000)), lastToolResult(3));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'Wiped.');

    // A snapshot goes back to the model as an image.
    fake.reset();
    fake.script({ tools: [{ name: 'view_snapshot', input: { levelId: upper } }] }, { text: 'The upper floor looks right: the stairwell and the shaft are cut out.' });
    await send('Show me the upper floor');
    const image = (await fake.received(2)) ? lastToolResult(1) : undefined;
    const block = Array.isArray(image?.content) ? image.content[0] : undefined;
    smoke.check('a snapshot reaches the model as an image', block?.type === 'image' && block.source?.media_type === 'image/png' && (block.source.data.length ?? 0) > 1000, { type: block?.type, bytes: block?.source?.data.length });
    smoke.check('the reply about it streams in', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'looks right'));
    smoke.check('the chat is idle again', await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000));
    await smoke.shots('29-assistant-chat');


    await smoke.click(`${panel} [data-testid=assistant-clear]`);
    smoke.check('Clear forgets the conversation', (await smoke.waitFor(`${panel} [data-testid=assistant-intro]`, 3000)) && (await smoke.count(`${panel} [data-testid=assistant-item]`)) === 0);
    smoke.check('the undo stack still holds the assistant\'s batch after its undo', (await run<{ redo: HistoryInfo[] }>('edit.history')).redo.some((h) => h.label === 'Add a 3 m wall'));

    // Furnishing: a room named, a sofa and a lamp with its light placed and the floor finished in one plan_apply, then a look in 3D at night.
    fake.reset();
    const decor = () => Object.values(doc().levelData[ground].entities).filter((e: Entity) => e.type === 'item' || e.type === 'light').length;
    fake.script(
      {
        text: 'Furnishing the lounge.',
        tools: [
          {
            name: 'plan_apply',
            input: {
              label: 'Furnish the lounge',
              steps: [
                { command: 'plan.room.add', input: { levelId: ground, seed: [5000, 4000], name: 'Lounge' }, as: 'lounge' },
                { command: 'decor.item.place', input: { levelId: ground, ref: 'builtin:sofa-3', at: [5000, 2000] } },
                { command: 'decor.item.place', input: { levelId: ground, ref: 'builtin:floor-lamp', at: [4000, 600], withLight: true } },
                { command: 'decor.material.set', input: { target: { roomId: '$lounge', surface: 'floor' }, material: 'builtin:oak-floor' } },
              ],
            },
          },
        ],
      },
      { tools: [{ name: 'view_snapshot', input: { view: '3d', display: 'cutaway', levelId: ground, lighting: 'night' } }] },
      { text: 'The lounge is furnished and lit.' },
    );
    await send('Furnish the lounge');
    smoke.check('the assistant furnishes a room in one plan_apply', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 15_000, 'furnished and lit')) && decor() === 3, decor());
    const furnished = await run<{ undo: HistoryInfo[] }>('edit.history');
    smoke.check('as one undo step by the assistant', furnished.undo[0]?.label === 'Furnish the lounge' && furnished.undo[0].author.kind === 'assistant', furnished.undo[0]);
    const night = lastToolResult(2);
    const nightBlock = Array.isArray(night?.content) ? night.content[0] : undefined;
    smoke.check('and looks at it in 3D at night: the snapshot reaches the model', nightBlock?.type === 'image' && (nightBlock.source?.data.length ?? 0) > 1000, { type: nightBlock?.type });
    await run('edit.undo');
    smoke.check('one undo takes the furnishing back', await smoke.until(() => decor() === 0));
    // Leave the chat empty for the Claude Code section, as it was.
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.click(`${panel} [data-testid=assistant-clear]`);
    await smoke.waitFor(`${panel} [data-testid=assistant-intro]`, 3000);
  } finally {
    delete process.env.STUDIO_AI_BASE_URL;
    await fake.close();
    await smoke.run('ai.key.clear');
  }
}
