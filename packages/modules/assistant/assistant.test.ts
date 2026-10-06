import { CommandRegistry, defineCommand, newProjectDoc, testHost, type ChatSnapshot, type HostEventMessage, type MutationRequest, type ProjectApi, type ProjectsApi } from '@studio/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeClaude } from './fake-api';
import { assistantModule } from './main';
import { ANTHROPIC_KEY } from '../settings/main';

/*
 * The assistant's loop against a fake Claude API (`fake-api.ts`): tool calls run through the registry
 * as the assistant and their results go back to the model, image results as images, mutating calls wait
 * for the user, and a stopped run leaves a clean conversation.
 */

const fake = new FakeClaude();

const calls: { id: string; input: unknown; caller: string; agent?: string; project?: string }[] = [];

function registry(): CommandRegistry {
  const r = new CommandRegistry();
  r.registerModule({
    id: 'test',
    commands: [
      defineCommand({
        id: 'test.add',
        title: 'Add',
        description: 'Adds a wall.',
        scope: 'project',
        input: z.object({ length: z.number() }),
        handler: async ({ length }, ctx) => {
          calls.push({ id: 'test.add', input: { length }, caller: ctx.caller, agent: ctx.agent, project: ctx.project?.id });
          return { added: true, length };
        },
      }),
      defineCommand({ id: 'test.picture', title: 'Picture', description: 'A tiny PNG.', scope: 'project', output: 'image', input: z.object({}), handler: async () => ({ mimeType: 'image/png', data: 'iVBORw0KGgo=', width: 1, height: 1 }) }),
      defineCommand({
        id: 'test.wipe',
        title: 'Wipe',
        description: 'Deletes data.',
        scope: 'global',
        mutating: true,
        input: z.object({}),
        handler: async (_input, ctx) => {
          calls.push({ id: 'test.wipe', input: {}, caller: ctx.caller, agent: ctx.agent });
          return 'wiped';
        },
      }),
      defineCommand({ id: 'test.hidden', title: 'Hidden', description: 'Plumbing.', scope: 'global', hidden: true, input: z.object({}), handler: async () => 'ok' }),
    ],
  });
  r.registerModule(assistantModule);
  return r;
}

/** A fresh project per test: the module keeps one chat per project id. */
function setup() {
  const doc = newProjectDoc({ name: 'Chat house' });
  const project = { id: doc.meta.id, name: doc.meta.name, doc, history: () => ({ undo: [], redo: [], seq: 0, epoch: 0 }), lastTouched: () => null } as unknown as ProjectApi;
  const projects = { resolve: async () => project, current: () => null, openProjects: () => [], list: () => [] } as unknown as ProjectsApi;
  const reg = registry();
  const host = testHost({ registry: reg, projects, config: { ai: { model: 'claude-test-1' } } });
  const run = <T = unknown>(id: string, input: unknown = {}) => reg.execute<T>(id, input, { caller: 'ui', host, project });
  const events = () => host.events.filter((e): e is HostEventMessage<'assistant.event'> => e.event === 'assistant.event');
  const state = () => run<ChatSnapshot>('assistant.state');
  const idle = async () => {
    for (let i = 0; i < 200 && (await state()).status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 25));
    return state();
  };
  return { reg, host, run, events, state, idle, project };
}

beforeAll(async () => {
  process.env.STUDIO_AI_BASE_URL = await fake.start();
});
afterAll(async () => {
  delete process.env.STUDIO_AI_BASE_URL;
  await fake.close();
});
beforeEach(() => {
  fake.reset();
  calls.length = 0;
});

describe('assistant', () => {
  it('refuses to run without a key, and says so', async () => {
    const { run, host } = setup();
    await assistantModule.onStart!(host);
    await expect(run('assistant.send', { text: 'hello' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await run('assistant.status')).toEqual({ keySet: false, persistent: false, model: 'claude-test-1' });
  });

  it('runs a tool call through the registry as the assistant and streams the reply', async () => {
    const { run, host, events, idle, project } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script({ text: 'Adding a wall.', tools: [{ name: 'test_add', input: { length: 3000 } }] }, { text: 'Done: the wall is 3 m long.' });
    expect(await run('assistant.send', { text: 'Add a 3 m wall' })).toEqual({ started: true });
    await expect(run('assistant.send', { text: 'again' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const final = await idle();

    expect(fake.requests).toHaveLength(2);
    const first = fake.requests[0];
    expect(first.headers['x-api-key']).toBe('sk-test-key');
    expect(first.body.model).toBe('claude-test-1');
    expect(first.body.tools!.map((t) => t.name).sort()).toEqual(['test_add', 'test_picture', 'test_wipe']);
    expect(first.body.tools!.find((t) => t.name === 'test_wipe')!.description).toContain('pauses until the user allows');
    expect(JSON.stringify(first.body.system)).toContain('Chat house');
    expect(calls).toEqual([{ id: 'test.add', input: { length: 3000 }, caller: 'assistant', agent: 'claude-test-1', project: project.id }]);
    const second = fake.requests[1].body.messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe('assistant');
    const result = (second[2].content as { type: string; tool_use_id: string; content: string }[])[0];
    expect(result.type).toBe('tool_result');
    expect(JSON.parse(result.content)).toEqual({ added: true, length: 3000 });

    expect(final.status).toBe('idle');
    expect(final.error).toBeNull();
    expect(final.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(final.items[2]).toMatchObject({ kind: 'tool', name: 'test_add', command: 'test.add', status: 'ok' });
    expect((final.items[3] as { text: string }).text).toBe('Done: the wall is 3 m long.');
    const deltas = events().filter((e) => e.payload.event.type === 'text');
    expect(deltas.length).toBeGreaterThan(2);
  });

  it('returns an image result to the model as an image block', async () => {
    const { run, host, idle } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script({ tools: [{ name: 'test_picture', input: {} }] }, { text: 'Looks fine.' });
    await run('assistant.send', { text: 'Show me' });
    await idle();
    const result = (fake.requests[1].body.messages[2].content as { type: string; content: { type: string; source?: { media_type: string; data: string }; text?: string }[] }[])[0];
    expect(result.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    expect(JSON.parse(result.content[1].text!)).toEqual({ width: 1, height: 1 });
  });

  it('pauses a mutating call until the user answers: declined, then allowed', async () => {
    const { run, host, state, idle } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script({ tools: [{ name: 'test_wipe', input: {} }] }, { text: 'I did not wipe it.' }, { tools: [{ name: 'test_wipe', input: {} }] }, { text: 'Wiped.' });

    await run('assistant.send', { text: 'Wipe it' });
    let waiting = await state();
    for (let i = 0; i < 100 && waiting.status !== 'waiting'; i++) {
      await new Promise((r) => setTimeout(r, 25));
      waiting = await state();
    }
    expect(waiting.status).toBe('waiting');
    expect(waiting.confirm?.command.id).toBe('test.wipe');
    expect(fake.requests).toHaveLength(1);
    await expect(run('assistant.confirm.reply', { id: 'nope', allow: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await run('assistant.confirm.reply', { id: waiting.confirm!.id, allow: false });
    let final = await idle();
    expect(calls).toEqual([]);
    expect(final.items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'declined' });
    const declined = (fake.requests[1].body.messages[2].content as unknown as { is_error?: boolean; content: string }[])[0];
    expect(declined.is_error).toBe(true);
    expect(JSON.parse(declined.content).code).toBe('MUTATION_DECLINED');

    await run('assistant.send', { text: 'Really wipe it' });
    for (let i = 0; i < 100 && (await state()).status !== 'waiting'; i++) await new Promise((r) => setTimeout(r, 25));
    await run('assistant.confirm.reply', { id: (await state()).confirm!.id, allow: true });
    final = await idle();
    expect(calls).toEqual([{ id: 'test.wipe', input: {}, caller: 'assistant', agent: 'claude-test-1' }]);
    expect(final.items.filter((i) => i.kind === 'tool').map((i) => (i as { status: string }).status)).toEqual(['declined', 'ok']);
  });

  it('declines a mutating call made outside a chat, and never offers hidden commands as tools', async () => {
    const { reg, host } = setup();
    await assistantModule.onStart!(host);
    await expect(reg.execute('test.wipe', {}, { caller: 'assistant', host })).rejects.toMatchObject({ code: 'MUTATION_DECLINED' });
    expect(host.confirmMutation).toBeDefined();
    const request: MutationRequest = { command: reg.meta('test.wipe')!, input: {}, caller: 'assistant' };
    expect(await host.confirmMutation!(request)).toBe(false);
  });

  it('reports an API failure as the run error and keeps the conversation clean', async () => {
    const { run, host, idle } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-bad-key');
    fake.script({ error: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' } }, { text: 'Fine now.' });
    await run('assistant.send', { text: 'hello' });
    const failed = await idle();
    expect(failed.error).toContain('refused the key');
    expect(failed.items.map((i) => i.kind)).toEqual(['user']);
    await run('assistant.send', { text: 'hello again' });
    const ok = await idle();
    expect(ok.error).toBeNull();
    // The failed turn was dropped from what the model sees: one user message, not two.
    expect(fake.requests.at(-1)!.body.messages.map((m) => m.role)).toEqual(['user']);
    await run('assistant.clear');
    expect((await run<ChatSnapshot>('assistant.state')).items).toEqual([]);
  });

  it('cancel stops a run that is waiting on the user', async () => {
    const { run, host, state, idle } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script({ tools: [{ name: 'test_wipe', input: {} }] }, { text: 'never sent' });
    await run('assistant.send', { text: 'Wipe' });
    for (let i = 0; i < 100 && (await state()).status !== 'waiting'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(await run('assistant.cancel')).toEqual({ stopped: true });
    const final = await idle();
    expect(final.status).toBe('idle');
    expect(final.confirm).toBeNull();
    expect(final.error).toBeNull();
    expect(calls).toEqual([]);
  });
});
