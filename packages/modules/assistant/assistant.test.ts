import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANDING, CommandRegistry, ConfigPatchSchema, defineCommand, newProjectDoc, testHost, type AssistantStatus, type ChatSnapshot, type ConfigPatch, type HostEventMessage, type McpStatus, type MutationRequest, type ProjectApi, type ProjectsApi } from '@studio/core';
import { startMcpServer, type RunningMcpServer } from '@studio/mcp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { findClaude, probeClaudeCode } from './claude-code';
import { FakeClaude, unansweredToolUse } from './fake-api';
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
function setup(config: ConfigPatch = {}, mcp?: () => McpStatus) {
  const doc = newProjectDoc({ name: 'Chat house' });
  const project = { id: doc.meta.id, name: doc.meta.name, doc, history: () => ({ undo: [], redo: [], seq: 0, epoch: 0 }), lastTouched: () => null } as unknown as ProjectApi;
  /** The project's per-machine view state, merged like the real one. */
  const ui: Record<string, unknown> = {};
  const projects = {
    resolve: async () => project,
    current: () => null,
    openProjects: () => [],
    list: () => [],
    uiState: async () => ({ ...ui }),
    setUiState: async (_id: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete ui[k];
        else ui[k] = v;
      }
    },
  } as unknown as ProjectsApi;
  const reg = registry();
  const host = testHost({ registry: reg, projects, config: { ...config, ai: { model: 'claude-test-1', ...config.ai } }, mcp });
  const run = <T = unknown>(id: string, input: unknown = {}) => reg.execute<T>(id, input, { caller: 'ui', host, project });
  const events = () => host.events.filter((e): e is HostEventMessage<'assistant.event'> => e.event === 'assistant.event');
  const state = () => run<ChatSnapshot>('assistant.state');
  const idle = async () => {
    for (let i = 0; i < 200 && (await state()).status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 25));
    return state();
  };
  return { reg, host, run, events, state, idle, project, ui };
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
    expect(await run('assistant.status')).toEqual({ provider: 'api', keySet: false, persistent: false, model: 'claude-test-1', mcp: { running: false, url: expect.stringContaining('/mcp') }, claudeCode: null });
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

  it('answers every pending call when stopped with several calls left, so the next message is accepted', async () => {
    const { run, host, state, idle } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script({ tools: [{ name: 'test_wipe', input: {}, id: 'toolu_w' }, { name: 'test_add', input: { length: 1 }, id: 'toolu_a' }] }, { text: 'Fine.' });
    await run('assistant.send', { text: 'Wipe, then add' });
    for (let i = 0; i < 100 && (await state()).status !== 'waiting'; i++) await new Promise((r) => setTimeout(r, 25));
    await run('assistant.cancel');
    await idle();
    expect(calls).toEqual([]);
    await run('assistant.send', { text: 'Go on' });
    const final = await idle();
    expect(final.error).toBeNull();
    const messages = fake.requests.at(-1)!.body.messages;
    const results = (messages[2].content as { type: string; tool_use_id: string; content: string }[]).map((b) => [b.tool_use_id, JSON.parse(b.content).message]);
    expect(results).toEqual([
      ['toolu_w', expect.stringContaining('declined')],
      ['toolu_a', 'Not run: the user stopped the assistant.'],
    ]);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Go on' });
  });

  it('answers the calls of the last round at the round limit, so the next message is accepted', async () => {
    const { run, host, idle } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script(...Array.from({ length: 26 }, () => ({ tools: [{ name: 'test_add', input: { length: 1 } }] })), { text: 'Going on.' });
    await run('assistant.send', { text: 'Add walls forever' });
    const capped = await idle();
    expect(fake.requests).toHaveLength(26);
    expect(calls).toHaveLength(25);
    expect((capped.items.at(-1) as { text: string }).text).toContain('Stopped after 25 rounds');
    await run('assistant.send', { text: 'Go on' });
    const final = await idle();
    expect(final.error).toBeNull();
    const messages = fake.requests.at(-1)!.body.messages;
    const last = messages.at(-2)!.content as { type: string; content: string }[];
    expect(last[0].type).toBe('tool_result');
    expect(JSON.parse(last[0].content).message).toContain('limit of 25 rounds');
  });

  it('the fake API refuses a tool_use left without its tool_result, as the real one does', async () => {
    const call = { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }] };
    expect(unansweredToolUse([{ role: 'user', content: 'a' }, call, { role: 'user', content: 'b' }])).toContain('toolu_1');
    expect(unansweredToolUse([{ role: 'user', content: 'a' }, call, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '1' }] }])).toBeNull();
  });
});

/*
 * The Claude Code provider against the fake binary (`fake-claude.cjs`), whose tool calls go through a
 * real MCP server over HTTP: status (not found, logged out, found), the MCP-off refusal, a tool call
 * running as the assistant with the per-process token, a mutating call waiting in the chat, Stop
 * killing the process and the next message resuming the stored session, a lost session starting anew,
 * and the session surviving a project close and reopen.
 */
const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.cjs', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

type FakeTurn = { text?: string; tools?: { name: string; input?: unknown }[]; error?: string };
type FakeScript = { sessionId?: string; expectResume?: string; failResume?: boolean; crashResume?: string; replay?: unknown[]; messages: FakeTurn[][] };
type LogEntry = { type: string; pid: number; resume?: string | null; model?: string | null; effort?: string | null; mcpUrl?: string; systemPrompt?: string; allowedTools?: string; disallowedTools?: string; tools?: string; strict?: boolean; name?: string; text?: string; isError?: boolean; result?: { type: string; text?: string }[] };

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (test: () => boolean | Promise<boolean>, tries = 200): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return test();
};

// These tests start and kill real processes (Node running the fake): one alone takes up to about 4 s, past vitest's 5 s default once the whole suite runs alongside. Their own waits stay bounded at 5 s each.
describe('assistant with Claude Code', { timeout: 30_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fake-claude-'));
  const scriptFile = path.join(dir, 'script.json');
  const logFile = path.join(dir, 'log.jsonl');
  const writeScript = (script: FakeScript) => fs.writeFileSync(scriptFile, JSON.stringify(script));
  const readLog = (): LogEntry[] => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry) : []);
  let server: RunningMcpServer | undefined;

  beforeAll(() => {
    process.env['FAKE_CLAUDE_SCRIPT'] = scriptFile;
    process.env['FAKE_CLAUDE_LOG'] = logFile;
  });
  afterAll(() => {
    delete process.env['FAKE_CLAUDE_SCRIPT'];
    delete process.env['FAKE_CLAUDE_LOG'];
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    writeScript({ messages: [] });
    fs.rmSync(logFile, { force: true });
  });
  afterEach(async () => {
    await assistantModule.onStop!(undefined as never);
    await server?.close();
    server = undefined;
  });

  /** A host on the Claude Code provider with a real MCP server (unless `mcpOff`) that recognises the module's tokens. */
  async function setupClaudeCode(options: { claudeCodePath?: string; mcpOff?: boolean } = {}) {
    let mcp: McpStatus = { running: false, port: 0, url: '' };
    const t = setup({ ai: { provider: 'claude-code', claudeCodePath: options.claudeCodePath ?? FAKE_CLAUDE } }, () => mcp);
    await assistantModule.onStart!(t.host);
    await assistantModule.onProjectOpen!(t.project, t.host);
    if (!options.mcpOff) {
      const port = await freePort();
      server = await startMcpServer({ registry: t.reg, host: t.host, port, name: 'studio-test', version: '1.0.0', resolveProject: async () => t.project, identifyAssistant: (token) => t.host.identifyAssistant?.(token) });
      mcp = { running: true, port, url: server.url };
    }
    const waiting = async () => {
      await until(async () => (await t.state()).status === 'waiting');
      return t.state();
    };
    return { ...t, status: (refresh = false) => t.run<AssistantStatus>('assistant.status', { refresh }), waiting };
  }

  it('reports whether Claude Code was found and is logged in, and refuses to send until it is', async () => {
    const missing = await setupClaudeCode({ claudeCodePath: path.join(dir, 'nowhere', 'claude') });
    const notFound = await missing.status();
    expect(notFound.provider).toBe('claude-code');
    expect(notFound.claudeCode).toMatchObject({ found: false, loggedIn: null });
    await expect(missing.run('assistant.send', { text: 'hi' })).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.stringContaining('not found') });
    await assistantModule.onStop!(missing.host);
    await server?.close();

    process.env['FAKE_CLAUDE_LOGGED_OUT'] = '1';
    try {
      const t = await setupClaudeCode();
      const loggedOut = await t.status();
      expect(loggedOut.claudeCode).toMatchObject({ found: true, version: '9.9.9', loggedIn: false });
      expect(loggedOut.mcp.running).toBe(true);
      await expect(t.run('assistant.send', { text: 'hi' })).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.stringContaining('not logged in') });
      delete process.env['FAKE_CLAUDE_LOGGED_OUT'];
      expect((await t.status()).claudeCode?.loggedIn).toBe(false);
      expect((await t.status(true)).claudeCode?.loggedIn).toBe(true);
    } finally {
      delete process.env['FAKE_CLAUDE_LOGGED_OUT'];
    }
  });

  it('refuses to send while the MCP server is off, and never starts it', async () => {
    const t = await setupClaudeCode({ mcpOff: true });
    expect((await t.status()).mcp.running).toBe(false);
    await expect(t.run('assistant.send', { text: 'hi' })).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.stringContaining('MCP server, which is off') });
    expect(readLog()).toEqual([]);
  });

  it('runs a tool call through the real MCP server as the assistant, streams the reply and stores the session', async () => {
    const t = await setupClaudeCode();
    writeScript({ sessionId: 'sess-1', messages: [[{ text: 'Adding a wall.', tools: [{ name: 'test_add', input: { length: 3000 } }] }, { text: 'Done: the wall is 3 m long.' }]] });
    expect(await t.run('assistant.send', { text: 'Add a 3 m wall' })).toEqual({ started: true });
    await expect(t.run('assistant.send', { text: 'again' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const final = await t.idle();

    expect(final.error).toBeNull();
    expect(final.sessionId).toBe('sess-1');
    // The session and the transcript are stored in the view state, so a reopen or a restart continues the chat.
    expect(t.ui).toMatchObject({ assistant: { provider: 'claude-code', sessionId: 'sess-1' } });
    expect((t.ui['assistant'] as { items: unknown[] }).items).toEqual(final.items);
    expect(calls).toEqual([{ id: 'test.add', input: { length: 3000 }, caller: 'assistant', agent: 'claude-code 9.9.9', project: t.project.id }]);
    expect(final.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(final.items[2]).toMatchObject({ kind: 'tool', name: 'test_add', command: 'test.add', title: 'Add', status: 'ok' });
    expect((final.items[3] as { text: string }).text).toBe('Done: the wall is 3 m long.');
    expect(t.events().filter((e) => e.payload.event.type === 'text').length).toBeGreaterThan(2);

    const start = readLog().find((e) => e.type === 'start')!;
    expect(start.resume).toBeNull();
    expect(start.mcpUrl).toMatch(new RegExp(`^${server!.url}\\?project=${t.project.id}&assistant=[A-Za-z0-9_-]{40,}$`));
    expect(start.systemPrompt).toContain('Chat house');
    expect(start.systemPrompt).toContain('millimetres');
    // The server name in the config and the tool prefix are the branded one, whatever the test server calls itself.
    expect(start).toMatchObject({ allowedTools: `mcp__${BRANDING.mcpServerName}__*`, disallowedTools: 'Bash,Edit,Write,Read,WebFetch,WebSearch', tools: '', strict: true });
    const call = readLog().find((e) => e.type === 'call')!;
    expect(call.isError).toBe(false);
    expect(JSON.parse(call.result![0].text!)).toEqual({ added: true, length: 3000 });
  });

  it('pauses a mutating call made over MCP until the user answers: declined, then allowed', async () => {
    const t = await setupClaudeCode();
    writeScript({ sessionId: 'sess-w', messages: [[{ tools: [{ name: 'test_wipe' }] }, { text: 'I did not wipe it.' }], [{ tools: [{ name: 'test_wipe' }] }, { text: 'Wiped.' }]] });
    await t.run('assistant.send', { text: 'Wipe it' });
    let waiting = await t.waiting();
    expect(waiting.status).toBe('waiting');
    expect(waiting.confirm?.command.id).toBe('test.wipe');
    await t.run('assistant.confirm.reply', { id: waiting.confirm!.id, allow: false });
    let final = await t.idle();
    expect(calls).toEqual([]);
    expect(final.items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'declined', summary: expect.stringContaining('declined') });
    const declined = readLog().filter((e) => e.type === 'call')[0];
    expect(declined.isError).toBe(true);
    expect(JSON.parse(declined.result![0].text!).code).toBe('MUTATION_DECLINED');

    await t.run('assistant.send', { text: 'Really wipe it' });
    waiting = await t.waiting();
    await t.run('assistant.confirm.reply', { id: waiting.confirm!.id, allow: true });
    final = await t.idle();
    expect(calls).toEqual([{ id: 'test.wipe', input: {}, caller: 'assistant', agent: 'claude-code 9.9.9' }]);
    expect(final.items.filter((i) => i.kind === 'tool').map((i) => (i as { status: string }).status)).toEqual(['declined', 'ok']);
    // One process served both messages.
    expect(readLog().filter((e) => e.type === 'start')).toHaveLength(1);
  });

  it('Stop kills the process; the next message resumes the session and shows its history; a lost session starts anew', async () => {
    const t = await setupClaudeCode();
    writeScript({ sessionId: 'sess-r', messages: [[{ tools: [{ name: 'test_wipe' }] }]] });
    await t.run('assistant.send', { text: 'Wipe' });
    await t.waiting();
    const first = readLog().find((e) => e.type === 'start')!;
    expect(alive(first.pid)).toBe(true);
    expect(await t.run('assistant.cancel')).toEqual({ stopped: true });
    const stopped = await t.idle();
    expect(stopped.error).toBeNull();
    expect(stopped.sessionId).toBe('sess-r');
    expect(await until(() => !alive(first.pid))).toBe(true);

    writeScript({
      expectResume: 'sess-r',
      replay: [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Earlier question' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_old', name: `mcp__${BRANDING.mcpServerName}__test_add`, input: { length: 1 } }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_old', content: '{"added":true,"length":1}', is_error: false }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] } },
      ],
      messages: [[{ text: 'Back again.' }]],
    });
    await t.run('assistant.send', { text: 'Continue' });
    const resumed = await t.idle();
    expect(resumed.error).toBeNull();
    const starts = readLog().filter((e) => e.type === 'start');
    expect(starts).toHaveLength(2);
    expect(starts[1].resume).toBe('sess-r');
    expect(starts[1].mcpUrl).not.toBe(first.mcpUrl);
    // The stopped call shows as declined (the decline reached the fake before it was killed) or as stopped (it did not).
    const texts = resumed.items.map((i) => (i.kind === 'tool' ? `tool:${i.name}:${i.status === 'declined' || i.status === 'error' ? 'ended' : i.status}` : `${i.kind}:${i.text}`));
    expect(texts).toEqual(['user:Wipe', 'tool:test_wipe:ended', 'user:Earlier question', 'tool:test_add:ok', 'assistant:Earlier answer', 'user:Continue', 'assistant:Back again.']);

    await t.run('assistant.cancel');
    await until(() => !alive(starts[1].pid));
    writeScript({ sessionId: 'sess-new', failResume: true, messages: [[{ text: 'Fresh start.' }]] });
    await t.run('assistant.send', { text: 'Hello?' });
    const fresh = await t.idle();
    expect(fresh.error).toBeNull();
    expect(fresh.sessionId).toBe('sess-new');
    expect(t.ui).toMatchObject({ assistant: { provider: 'claude-code', sessionId: 'sess-new' } });
    const later = readLog().filter((e) => e.type === 'start').slice(2);
    expect(later.map((e) => e.resume)).toEqual(['sess-r', null]);
    const tail = fresh.items.slice(-3).map((i) => (i.kind === 'tool' ? i.name : i.text));
    expect(tail[0]).toBe('Hello?');
    expect(tail[1]).toContain('could not be resumed');
    expect(tail[2]).toBe('Fresh start.');

    await t.run('assistant.clear');
    expect(t.ui).toEqual({});
    expect((await t.state()).sessionId).toBeNull();
  });

  it('keeps the stored session when a resumed process fails without saying the session is gone', async () => {
    const t = await setupClaudeCode();
    await t.host.projects.setUiState(t.project.id, { assistant: { provider: 'claude-code', sessionId: 'sess-k', items: [] } });
    await assistantModule.onProjectOpen!(t.project, t.host);
    writeScript({ crashResume: 'fake-claude: out of memory', messages: [[{ text: 'Never sent.' }]] });
    await t.run('assistant.send', { text: 'Hello' });
    const failed = await t.idle();
    expect(failed.error).toContain('out of memory');
    expect(failed.sessionId).toBe('sess-k');
    expect(t.ui).toMatchObject({ assistant: { sessionId: 'sess-k' } });
    expect(readLog().filter((e) => e.type === 'start').map((e) => e.resume)).toEqual(['sess-k']);
    expect(failed.items.some((i) => i.kind === 'assistant' && i.text.includes('could not be resumed'))).toBe(false);
  });

  it('tells the echo of the new message from a replayed earlier message with the same text by isReplay', async () => {
    const t = await setupClaudeCode();
    await t.host.projects.setUiState(t.project.id, { assistant: { provider: 'claude-code', sessionId: 'sess-e', items: [] } });
    await assistantModule.onProjectOpen!(t.project, t.host);
    writeScript({
      expectResume: 'sess-e',
      replay: [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Continue' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] } },
      ],
      messages: [[{ text: 'Back again.' }]],
    });
    await t.run('assistant.send', { text: 'Continue' });
    const final = await t.idle();
    expect(final.error).toBeNull();
    expect(final.items.map((i) => (i.kind === 'tool' ? i.name : `${i.kind}:${i.text}`))).toEqual(['user:Continue', 'assistant:Earlier answer', 'user:Continue', 'assistant:Back again.']);
  });

  it('closing the project kills the process; reopening it restores the session and the transcript, and replayed history is then ignored', async () => {
    const t = await setupClaudeCode();
    writeScript({ sessionId: 'sess-c', messages: [[{ text: 'Hi.' }]] });
    await t.run('assistant.send', { text: 'Hi' });
    const before = await t.idle();
    const start = readLog().find((e) => e.type === 'start')!;
    expect(alive(start.pid)).toBe(true);
    await assistantModule.onProjectClose!(t.project, t.host);
    expect(await until(() => !alive(start.pid))).toBe(true);
    await assistantModule.onProjectOpen!(t.project, t.host);
    const reopened = await t.state();
    expect(reopened.items).toEqual(before.items);
    expect(reopened.sessionId).toBe('sess-c');

    writeScript({ expectResume: 'sess-c', replay: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Replayed twice if this shows' }] } }], messages: [[{ text: 'Still here.' }]] });
    await t.run('assistant.send', { text: 'Still there?' });
    const resumed = await t.idle();
    const texts = resumed.items.map((i) => (i.kind === 'tool' ? i.name : i.text));
    expect(texts).toEqual(['Hi', 'Hi.', 'Still there?', 'Still here.']);
    expect((t.ui['assistant'] as { items: unknown[] }).items).toHaveLength(4);

    await t.run('assistant.clear');
    expect(t.ui).toEqual({});
    expect((await t.state()).items).toEqual([]);
  });

  it('passes the model and effort from Settings, and starts again on the same session when they change', async () => {
    const t = await setupClaudeCode();
    writeScript({ sessionId: 'sess-m', messages: [[{ text: 'One.' }], [{ text: 'Two.' }], [{ text: 'Three.' }]] });
    await t.run('assistant.send', { text: 'First' });
    await t.idle();
    expect(readLog().filter((e) => e.type === 'start').map((e) => [e.model, e.effort])).toEqual([[null, null]]);

    await t.host.config.update({ ai: { claudeCodeModel: 'opus', claudeCodeEffort: 'high' } });
    await t.run('assistant.send', { text: 'Second' });
    await t.idle();
    let starts = readLog().filter((e) => e.type === 'start');
    expect(starts.map((e) => [e.model, e.effort, e.resume])).toEqual([
      [null, null, null],
      ['opus', 'high', 'sess-m'],
    ]);
    expect(await until(() => !alive(starts[0].pid))).toBe(true);

    // Unchanged settings keep the process.
    await t.run('assistant.send', { text: 'Third' });
    const final = await t.idle();
    starts = readLog().filter((e) => e.type === 'start');
    expect(starts).toHaveLength(2);
    expect(final.items.map((i) => (i.kind === 'tool' ? i.name : i.text))).toEqual(['First', 'One.', 'Second', 'Two.', 'Third', 'Three.']);
  });

  it('tells a running process about changed levels with the next message, and only then', async () => {
    const t = await setupClaudeCode();
    writeScript({ sessionId: 'sess-l', messages: [[{ text: 'One.' }], [{ text: 'Two.' }], [{ text: 'Three.' }]] });
    await t.run('assistant.send', { text: 'First' });
    await t.idle();
    const ground = t.project.doc.levels[t.project.doc.building.stack[0]] as { name: string };
    expect(readLog().find((e) => e.type === 'start')!.systemPrompt).toContain(`- ${ground.name} (id`);
    ground.name = 'Piano nobile';
    await t.run('assistant.send', { text: 'Second' });
    await t.idle();
    await t.run('assistant.send', { text: 'Third' });
    const final = await t.idle();
    const messages = readLog().filter((e) => e.type === 'message').map((e) => e.text!);
    expect(messages[0]).toBe('First');
    expect(messages[1]).toMatch(/^<app-context>[\s\S]*- Piano nobile \(id [\s\S]*<\/app-context>\n\nSecond$/);
    expect(messages[2]).toBe('Third');
    // One process throughout, and the transcript shows the user's own words.
    expect(readLog().filter((e) => e.type === 'start')).toHaveLength(1);
    expect(final.items.map((i) => (i.kind === 'tool' ? i.name : i.text))).toEqual(['First', 'One.', 'Second', 'Two.', 'Third', 'Three.']);
  });

  it('refuses a model name that would read as a flag', async () => {
    const { host } = setup();
    expect(() => ConfigPatchSchema.parse({ ai: { claudeCodeModel: '--dangerously-skip-permissions' } })).toThrow();
    expect(ConfigPatchSchema.parse({ ai: { claudeCodeModel: 'claude-opus-5-5[1m]' } })).toEqual({ ai: { claudeCodeModel: 'claude-opus-5-5[1m]' } });
    expect(host.config.get().ai.claudeCodeEffort).toBe('');
  });

  it('does not restore a stored Claude Code chat into an API chat, and Clear removes it there too', async () => {
    const { run, host, state, project, ui } = setup();
    await assistantModule.onStart!(host);
    const stored = { provider: 'claude-code', sessionId: 'sess-x', items: [{ kind: 'user', id: 'msg_1', text: 'From Claude Code', at: '2026-10-27T00:00:00.000Z' }] };
    await host.projects.setUiState(project.id, { assistant: stored });
    await assistantModule.onProjectOpen!(project, host);
    expect((await state()).items).toEqual([]);
    expect(ui).toEqual({ assistant: stored });
    await run('assistant.clear');
    expect(ui).toEqual({});
  });

  it('stores nothing for the API provider', async () => {
    const { run, host, idle, ui } = setup();
    await assistantModule.onStart!(host);
    await host.secrets.set(ANTHROPIC_KEY, 'sk-test-key');
    fake.script({ text: 'Hello.' });
    await run('assistant.send', { text: 'Hi' });
    await idle();
    expect(ui).toEqual({});
  });

  it('resolves an npm install\'s .cmd shim to its cli.js and runs that through this executable as Node', async () => {
    // The layout `npm i -g @anthropic-ai/claude-code` leaves on Windows: a shim next to node_modules.
    const prefix = path.join(dir, 'npm-prefix');
    const cli = path.join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.copyFileSync(FAKE_CLAUDE, cli);
    const shim = path.join(prefix, 'claude.cmd');
    fs.writeFileSync(shim, '@ECHO off\r\nnode "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
    const launch = findClaude(shim);
    expect(launch).toMatchObject({ file: process.execPath, prefix: [cli], resolved: cli });
    expect((launch as { env: NodeJS.ProcessEnv }).env['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(await probeClaudeCode(shim)).toMatchObject({ found: true, version: '9.9.9', loggedIn: true, resolved: cli });
    // A shim without its cli.js is reported, not run through a shell.
    const bare = path.join(dir, 'bare', 'claude.cmd');
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    fs.writeFileSync(bare, '@ECHO off\r\n');
    expect(findClaude(bare)).toMatchObject({ error: expect.stringContaining('shell shim') });
    // A name without a path is looked up on PATH; the shim is found through PATHEXT, so on Windows only.
    if (process.platform === 'win32') {
      const saved = process.env['PATH'];
      process.env['PATH'] = `${prefix}${path.delimiter}${saved ?? ''}`;
      try {
        expect(findClaude('')).toMatchObject({ resolved: cli });
      } finally {
        process.env['PATH'] = saved;
      }
    }
  });
});
