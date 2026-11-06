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
    // The reply's last words show before the run ends and Send is enabled again: wait for idle (and a stop to finish), or the click is lost.
    await smoke.until(async () => {
      const state = await run<{ status: string; stopping: boolean }>('assistant.state');
      return state.status === 'idle' && !state.stopping;
    });
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
    smoke.check('the History panel lists the change signed Otto, with the command', (await smoke.waitFor(`${tab} [data-testid=history-item][data-label="Add a 3 m wall"][data-author="Otto"]`, 3000, 'Otto · Structure · plan.apply')) && model !== undefined);
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

    // Pasted images: a 3200 × 1800 screenshot and a small PNG pasted into the composer (a real paste event,
    // never the system clipboard), one removed again, the big one shrunk to the 1568 px long edge, and the
    // image reaching the model as a base64 image block before the text.
    fake.reset();
    fake.script({ text: 'That is a plan with a red room.' });
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    const paste = (width: number, height: number, fill: string) =>
      smoke.js<boolean>(`(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = ${width};
        canvas.height = ${height};
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f4efe6';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '${fill}';
        ctx.fillRect(canvas.width / 4, canvas.height / 4, canvas.width / 2, canvas.height / 2);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const data = new DataTransfer();
        data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
        const input = document.querySelector(${JSON.stringify(`${panel} [data-testid=assistant-input]`)});
        input.focus();
        return !input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      })()`);
    const attachments = `${panel} [data-testid=assistant-attachment]`;
    smoke.check('pasting an image takes it instead of pasting text', await paste(3200, 1800, '#c0392b'));
    smoke.check('the pasted image shows above the message field, shrunk to a 1568 px long edge', (await smoke.waitFor(`${attachments}[data-size="1568x882"][data-mime="image/png"]`, 5000)), await smoke.js(`[...document.querySelectorAll('${attachments}')].map((el) => el.dataset.size)`));
    await paste(40, 40, '#2e86c1');
    smoke.check('a second paste adds a second image', await smoke.until(async () => (await smoke.count(attachments)) === 2));
    smoke.check('Send is enabled by images alone', await smoke.js<boolean>(`!document.querySelector('${panel} [data-testid=assistant-send]').disabled`));
    await smoke.shots('75-assistant-pasted-image');
    await smoke.click(`${panel} [data-testid=assistant-attachment]:nth-child(2) [data-testid=assistant-attachment-remove]`);
    smoke.check('an image can be removed before sending', await smoke.until(async () => (await smoke.count(attachments)) === 1));
    await smoke.fill(`${panel} [data-testid=assistant-input]`, 'What is in this screenshot?');
    await smoke.click(`${panel} [data-testid=assistant-send]`);
    // The chat still holds the earlier turns: the new message is the request's last.
    const pasted = (await fake.received(1)) ? fake.requests[0].body.messages.at(-1) : undefined;
    const blocks = Array.isArray(pasted?.content) ? pasted.content : [];
    const imageBlock = blocks[0] as { type: string; source?: { type: string; media_type: string; data: string } } | undefined;
    smoke.check(
      'the model gets the pasted image as a base64 PNG before the text',
      blocks.length === 2 && imageBlock?.type === 'image' && imageBlock.source?.type === 'base64' && imageBlock.source.media_type === 'image/png' && (imageBlock.source.data.length ?? 0) > 1000 && blocks[1].type === 'text' && blocks[1].text === 'What is in this screenshot?',
      blocks.map((b) => b.type),
    );
    const size = imageBlock?.source ? Buffer.from(imageBlock.source.data, 'base64') : undefined;
    smoke.check('at the shrunk size', size !== undefined && size.readUInt32BE(16) === 1568 && size.readUInt32BE(20) === 882, size && [size.readUInt32BE(16), size.readUInt32BE(20)]);
    smoke.check('your message shows the image, and the composer is empty again', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=user][data-images="1"] [data-testid=assistant-user-image] img`, 5000)) && (await smoke.count(attachments)) === 0);
    smoke.check('the reply about it streams in', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'red room'));
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.shots('76-assistant-image-message');


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
