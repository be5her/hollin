import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  BRANDING,
  DESIGN_GUIDELINES,
  StudioError,
  defineCommand,
  defineModule,
  deriveLevels,
  newId,
  toErrorPayload,
  toolNameFor,
  type AssistantCaller,
  type AssistantEvent,
  type AssistantStatus,
  type ChatSnapshot,
  type ClaudeCodeStatus,
  type CommandMeta,
  type HostApi,
  type MutationRequest,
  type PendingConfirmation,
  type ProjectApi,
  type TranscriptItem,
} from '@studio/core';
import { z } from 'zod';
import { ANTHROPIC_KEY } from '../settings/main';
import { ClaudeCodeProvider, MCP_OFF_MESSAGE, probeClaudeCode, type ClaudeCodeEvents, type HistoryItem } from './claude-code';
import { describeApiError, runLoop, type LoopEvents, type ToolOutcome } from './loop';

/**
 * The in-app assistant: a chat per open project, run in main, with the command registry as its tools.
 * Two providers: the Claude API with the user's key (the default; `loop.ts`), or the user's own
 * installed, logged-in Claude Code driven as a subprocess whose tools come over the app's MCP server
 * (`claude-code.ts`). Either way tool calls run as `caller: 'assistant'` with the model or the Claude
 * Code version as the agent, so every edit is a labelled, undoable transaction attributed to the
 * assistant, and mutating commands pause the run until the user allows or declines them in the chat.
 * The chat lives in memory while the project is open; the only thing stored is the Claude Code
 * session id, as per-machine view state, so a chat can be resumed.
 */

/** Points the SDK at another server: the smoke test's fake API, or a proxy. Never set in normal use. */
const BASE_URL_ENV = 'STUDIO_AI_BASE_URL';
/** The view-state key the Claude Code session id lives under (`.local/ui.json`). */
const UI_KEY = 'assistant';

interface ChatProvider {
  readonly kind: 'api' | 'claude-code';
  send(text: string, events: ClaudeCodeEvents, signal: AbortSignal): Promise<void>;
  stop(): void;
  dispose(): void;
}

interface Chat {
  projectId: string;
  project: ProjectApi;
  items: TranscriptItem[];
  status: ChatSnapshot['status'];
  error: string | null;
  run: { controller: AbortController } | null;
  confirm: (PendingConfirmation & { resolve: (allow: boolean) => void }) | null;
  provider: ChatProvider | null;
  /** The Claude Code session this chat continues, loaded from the project's view state. */
  sessionId: string | null;
}

const chats = new Map<string, Chat>();
/** The chat whose tool call is running, so `confirmMutation` knows where to ask. */
const running = new AsyncLocalStorage<Chat>();
/** Per-process tokens of spawned Claude Code processes, for the MCP server to recognise them. */
const tokens = new Map<string, Chat>();
/** What `claude --version` and `claude auth status` said, per configured path. */
let probe: { path: string; status: Promise<ClaudeCodeStatus> } | null = null;

const now = () => new Date().toISOString();

function snapshot(chat: Chat, host: HostApi): ChatSnapshot {
  const ai = host.config.get().ai;
  return {
    projectId: chat.projectId,
    status: chat.status,
    error: chat.error,
    items: chat.items,
    confirm: chat.confirm ? { id: chat.confirm.id, command: chat.confirm.command, input: chat.confirm.input } : null,
    model: ai.model,
    provider: ai.provider,
    sessionId: ai.provider === 'claude-code' ? chat.sessionId : null,
  };
}

function emit(host: HostApi, chat: Chat, event: AssistantEvent): void {
  host.emit('assistant.event', { projectId: chat.projectId, event });
}

const changed = (host: HostApi, chat: Chat) => emit(host, chat, { type: 'changed', state: snapshot(chat, host) });

function chatFor(project: ProjectApi): Chat {
  let chat = chats.get(project.id);
  if (!chat) {
    chat = { projectId: project.id, project, items: [], status: 'idle', error: null, run: null, confirm: null, provider: null, sessionId: null };
    chats.set(project.id, chat);
  }
  chat.project = project;
  return chat;
}

/** Stops a run: the API call is aborted or the Claude Code process killed, and a pending confirmation counts as declined. */
function cancel(chat: Chat): void {
  chat.confirm?.resolve(false);
  chat.run?.controller.abort();
  chat.provider?.stop();
}

function dropProvider(chat: Chat): void {
  chat.provider?.dispose();
  chat.provider = null;
}

/** Asks the user, in the chat whose tool call this is. Outside a chat (a direct assistant call) there is nobody to ask: declined. */
async function confirmMutation(host: HostApi, request: MutationRequest): Promise<boolean> {
  const chat = running.getStore();
  if (!chat || !chat.run || chat.run.controller.signal.aborted) return false;
  const id = newId('cfm');
  try {
    return await new Promise<boolean>((resolve) => {
      chat.confirm = { id, command: request.command, input: request.input, resolve };
      chat.status = 'waiting';
      changed(host, chat);
    });
  } finally {
    chat.confirm = null;
    chat.status = 'running';
    changed(host, chat);
  }
}

/** A Claude Code process the assistant spawned: its calls run as the assistant, inside its chat, against its project. */
function identifyAssistant(host: HostApi, token: string): AssistantCaller | undefined {
  const chat = tokens.get(token);
  if (!chat || !chat.run) return undefined;
  return { agent: claudeCodeAgent(), projectId: chat.projectId, run: (fn) => running.run(chat, fn) };
}

// ---------- Claude Code status ----------

function claudeCodeStatus(host: HostApi, refresh = false): Promise<ClaudeCodeStatus> {
  const configured = host.config.get().ai.claudeCodePath;
  if (!probe || probe.path !== configured || refresh) probe = { path: configured, status: probeClaudeCode(configured) };
  return probe.status;
}

let lastVersion: string | undefined;
const claudeCodeAgent = () => `claude-code ${lastVersion ?? 'unknown'}`;

function markLoggedIn(loggedIn: boolean): void {
  if (probe) probe.status = probe.status.then((s) => (s.found ? { ...s, loggedIn } : s));
}

async function status(host: HostApi, refresh = false): Promise<AssistantStatus> {
  const ai = host.config.get().ai;
  const mcp = host.mcpStatus();
  const claudeCode = ai.provider === 'claude-code' ? await claudeCodeStatus(host, refresh) : null;
  if (claudeCode?.version) lastVersion = claudeCode.version;
  return { provider: ai.provider, model: ai.model, keySet: host.secrets.has(ANTHROPIC_KEY), persistent: host.secrets.persistent, mcp: { running: mcp.running, url: mcp.url }, claudeCode };
}

/** Why a message cannot be sent right now, as the error `assistant.send` throws. */
async function readiness(host: HostApi): Promise<void> {
  const ai = host.config.get().ai;
  if (ai.provider === 'api') {
    if (!host.secrets.has(ANTHROPIC_KEY)) throw new StudioError('UNAVAILABLE', 'Add a Claude API key in Settings to use the assistant.');
    return;
  }
  if (!host.mcpStatus().running) throw new StudioError('UNAVAILABLE', MCP_OFF_MESSAGE);
  const cc = await claudeCodeStatus(host);
  if (!cc.found) throw new StudioError('UNAVAILABLE', `Claude Code not found: ${cc.error ?? cc.path}`);
  if (cc.loggedIn === false) throw new StudioError('UNAVAILABLE', 'Claude Code is not logged in: run `claude` in a terminal and log in.');
  lastVersion = cc.version;
}

// ---------- the tools and the system prompt (shared by both providers) ----------

/** The tools: every non-hidden command, named and described as for MCP. */
function toolsFor(host: HostApi): { tools: Anthropic.Tool[]; byName: Map<string, CommandMeta> } {
  const byName = new Map<string, CommandMeta>();
  const tools: Anthropic.Tool[] = [];
  for (const meta of host.listCommands()) {
    if (meta.hidden) continue;
    const schema = host.inputSchema(meta.id);
    if (!schema) continue;
    const name = toolNameFor(meta.id);
    byName.set(name, meta);
    const gate = meta.conditional ? ' Calls that delete or overwrite data pause until the user allows them in the chat.' : meta.mutating ? ' Deletes or overwrites data: the run pauses until the user allows it in the chat.' : '';
    const scope = meta.scope === 'project' ? ' Acts on the open project.' : '';
    tools.push({ name, description: `${meta.description}${scope}${gate}`, input_schema: schema as Anthropic.Tool['input_schema'] });
  }
  return { tools, byName };
}

const STABLE_PROMPT = [
  `You are the design assistant built into ${BRANDING.productName}, a desktop app for designing buildings, floor plans and interiors. The user is an architect, engineer or interior designer working in the app; they see the plan change as you work.`,
  'Your tools are the app\'s own commands. Read before you change (plan_describe, building_get), make changes with the editing tools (several steps as one plan_apply batch with a clear label), and look at the result (view_snapshot, rules_check). Every edit you make is undoable and listed in the history under your name.',
  'Reply briefly in plain text (no markdown headings or tables): what you did, what you found, what you suggest. Ask when a request is ambiguous in a way that matters; otherwise make reasonable choices and say what they were.',
  DESIGN_GUIDELINES,
].join('\n\n');

function livePrompt(host: HostApi, project: ProjectApi): string {
  const levels = deriveLevels(project.doc).map((l) => `- ${l.name} (id ${l.id}): elevation ${l.elevation} mm, height ${l.height} mm${l.isGround ? ', the ground level' : ''}`);
  const units = host.config.get().units;
  return [`The open project is "${project.name}" (id ${project.id}). Its levels, bottom to top:`, ...levels, `The user's display units are ${units.system}; tool inputs and outputs are always millimetres.`].join('\n');
}

function systemPrompt(host: HostApi, project: ProjectApi): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: STABLE_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: livePrompt(host, project) },
  ];
}

function summarize(meta: CommandMeta, input: unknown, outcome: ToolOutcome): string {
  if (!outcome.ok) return outcome.error.message;
  if (meta.id === 'plan.apply' && input && typeof input === 'object' && typeof (input as { label?: unknown }).label === 'string') return (input as { label: string }).label;
  return '';
}

// ---------- providers ----------

/** The Claude API with the user's key: the loop in `loop.ts` over a conversation kept per chat. */
class ApiProvider implements ChatProvider {
  readonly kind = 'api' as const;
  /** The conversation as the API sees it (text, tool calls and results). Trimmed back when a run fails, so it never ends mid-round. */
  private messages: Anthropic.MessageParam[] = [];

  constructor(private readonly host: HostApi, private readonly chat: Chat) {}

  async send(text: string, events: LoopEvents, signal: AbortSignal): Promise<void> {
    const key = this.host.secrets.get(ANTHROPIC_KEY);
    if (!key) throw new StudioError('UNAVAILABLE', 'Add a Claude API key in Settings to use the assistant.');
    const model = this.host.config.get().ai.model;
    const client = new Anthropic({ apiKey: key, baseURL: process.env[BASE_URL_ENV] || undefined, maxRetries: 1 });
    const { tools, byName } = toolsFor(this.host);
    const before = this.messages.length;
    this.messages.push({ role: 'user', content: text });
    try {
      await runLoop(
        {
          client,
          model,
          system: systemPrompt(this.host, this.chat.project),
          tools,
          signal,
          newId,
          execute: async (name, input) => {
            const meta = byName.get(name);
            if (!meta) return { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `There is no tool named ${name}.` } };
            try {
              const result = await running.run(this.chat, () => this.host.execute(meta.id, input, { caller: 'assistant', agent: model, host: this.host, project: meta.scope === 'project' ? this.chat.project : undefined }));
              return { ok: true, result, output: meta.output };
            } catch (err) {
              return { ok: false, error: toErrorPayload(err) };
            }
          },
          events,
        },
        this.messages,
      );
    } catch (err) {
      this.messages.length = before;
      throw err;
    }
  }

  stop(): void {}

  dispose(): void {
    this.messages = [];
  }
}

function claudeCodeProvider(host: HostApi, chat: Chat): ClaudeCodeProvider {
  return new ClaudeCodeProvider({
    configuredPath: () => host.config.get().ai.claudeCodePath,
    cwd: path.join(host.dataDir ?? path.join(os.tmpdir(), BRANDING.dataDirName), 'claude-code'),
    serverName: BRANDING.mcpServerName,
    mcpUrl: () => {
      const mcp = host.mcpStatus();
      return mcp.running ? mcp.url : null;
    },
    projectId: chat.projectId,
    systemPrompt: () => `${STABLE_PROMPT}\n\n${livePrompt(host, chat.project)}`,
    sessionId: () => chat.sessionId,
    tokens: {
      issue: () => {
        const token = randomBytes(32).toString('base64url');
        tokens.set(token, chat);
        return token;
      },
      revoke: (token) => void tokens.delete(token),
    },
  });
}

function providerFor(host: HostApi, chat: Chat): ChatProvider {
  const kind = host.config.get().ai.provider;
  if (chat.provider && chat.provider.kind !== kind) dropProvider(chat);
  chat.provider ??= kind === 'claude-code' ? claudeCodeProvider(host, chat) : new ApiProvider(host, chat);
  return chat.provider;
}

/** Stores or forgets the Claude Code session in the project's view state (this machine only; never the design, snapshots or exports). */
function rememberSession(host: HostApi, chat: Chat, sessionId: string | null): void {
  if (chat.sessionId === sessionId) return;
  chat.sessionId = sessionId;
  host.projects.setUiState(chat.projectId, { [UI_KEY]: sessionId ? { provider: 'claude-code', sessionId } : null }).catch((err) => console.warn('[assistant] could not store the session id', err));
}

async function loadSession(host: HostApi, chat: Chat): Promise<void> {
  try {
    const stored = (await host.projects.uiState(chat.projectId))[UI_KEY] as { sessionId?: unknown } | undefined;
    chat.sessionId = typeof stored?.sessionId === 'string' ? stored.sessionId : null;
  } catch {
    chat.sessionId = null;
  }
}

/** A replayed message as a transcript item. */
function historyItem(item: HistoryItem, byName: Map<string, CommandMeta>): TranscriptItem {
  if (item.kind === 'user') return { kind: 'user', id: newId('msg'), text: item.text, at: now() };
  if (item.kind === 'assistant') return { kind: 'assistant', id: newId('msg'), text: item.text, at: now() };
  const meta = byName.get(item.name);
  const outcome = item.outcome;
  return {
    kind: 'tool',
    id: item.id,
    name: item.name,
    command: meta?.id ?? item.name,
    title: meta?.title ?? item.name,
    input: item.input,
    status: !outcome ? 'ok' : outcome.ok ? 'ok' : outcome.error.code === 'MUTATION_DECLINED' ? 'declined' : 'error',
    summary: meta && outcome ? summarize(meta, item.input, outcome) : '',
    at: now(),
  };
}

async function run(host: HostApi, chat: Chat, text: string): Promise<void> {
  const provider = providerFor(host, chat);
  const controller = new AbortController();
  chat.run = { controller };
  chat.status = 'running';
  chat.error = null;
  const userItem: TranscriptItem = { kind: 'user', id: newId('msg'), text, at: now() };
  chat.items.push(userItem);
  changed(host, chat);

  const { byName } = toolsFor(host);
  const toolItems = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>();
  const events: ClaudeCodeEvents = {
    text: (id, delta) => {
      let item = chat.items.find((i): i is Extract<TranscriptItem, { kind: 'assistant' }> => i.kind === 'assistant' && i.id === id);
      if (!item) {
        item = { kind: 'assistant', id, text: '', at: now() };
        chat.items.push(item);
        changed(host, chat);
      }
      item.text += delta;
      emit(host, chat, { type: 'text', id, delta });
    },
    toolStart: (id, name, input) => {
      const meta = byName.get(name);
      const item: Extract<TranscriptItem, { kind: 'tool' }> = { kind: 'tool', id, name, command: meta?.id ?? name, title: meta?.title ?? name, input, status: 'running', summary: '', at: now() };
      toolItems.set(id, item);
      chat.items.push(item);
      changed(host, chat);
    },
    toolEnd: (id, outcome) => {
      const item = toolItems.get(id);
      if (!item) return;
      const meta = byName.get(item.name);
      item.status = outcome.ok ? 'ok' : outcome.error.code === 'MUTATION_DECLINED' ? 'declined' : 'error';
      item.summary = meta ? summarize(meta, item.input, outcome) : outcome.ok ? '' : outcome.error.message;
      changed(host, chat);
    },
    note: (id, text) => {
      chat.items.push({ kind: 'assistant', id, text, at: now() });
      changed(host, chat);
    },
    session: (id) => {
      rememberSession(host, chat, id);
      if (id) markLoggedIn(true);
      changed(host, chat);
    },
    history: (items) => {
      const at = chat.items.indexOf(userItem);
      chat.items.splice(at < 0 ? chat.items.length : at, 0, ...items.map((i) => historyItem(i, byName)));
      changed(host, chat);
    },
    authFailure: () => markLoggedIn(false),
  };
  try {
    await provider.send(text, events, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) {
      chat.error = describeApiError(err);
      if (!(err instanceof Anthropic.APIError) && !(err instanceof StudioError)) console.error('[assistant] run failed', err);
    }
  } finally {
    // A call still shown as running when the run ends (stopped mid-call, or the process died) is over.
    for (const item of toolItems.values()) {
      if (item.status !== 'running') continue;
      item.status = 'error';
      item.summary = controller.signal.aborted ? 'Stopped.' : 'The run ended before the call did.';
    }
    chat.run = null;
    chat.status = 'idle';
    changed(host, chat);
  }
}

const projectScoped = <T extends z.ZodObject<z.ZodRawShape>>(input: T) => input;

export const assistantModule = defineModule({
  id: 'assistant',
  onStart: (host) => {
    host.confirmMutation = (request) => confirmMutation(host, request);
    host.identifyAssistant = (token) => identifyAssistant(host, token);
    // A Claude Code process holds the server's URL: when the server stops or moves, the process goes and the next message starts a fresh one.
    host.on('mcp.status', (mcp) => {
      for (const chat of chats.values()) {
        const provider = chat.provider;
        if (!(provider instanceof ClaudeCodeProvider) || !provider.alive || (mcp.running && provider.url === mcp.url)) continue;
        provider.stop();
        chat.items.push({ kind: 'assistant', id: newId('msg'), text: mcp.running ? 'The MCP server moved; the next message starts Claude Code again.' : 'The MCP server was turned off; Claude Code was stopped.', at: now() });
        changed(host, chat);
      }
    });
  },
  onStop: () => {
    for (const chat of chats.values()) {
      cancel(chat);
      dropProvider(chat);
    }
    chats.clear();
  },
  onProjectOpen: async (project, host) => {
    const chat = chatFor(project);
    await loadSession(host, chat);
    changed(host, chat);
  },
  onProjectClose: (project) => {
    const chat = chats.get(project.id);
    if (!chat) return;
    cancel(chat);
    dropProvider(chat);
    chats.delete(project.id);
  },
  commands: [
    defineCommand({
      id: 'assistant.status',
      title: 'Assistant status',
      description: 'Whether the assistant can run: the provider, a key is set, which model, the MCP server, and for Claude Code whether it was found and is logged in. `refresh` probes Claude Code again.',
      scope: 'global',
      hidden: true,
      input: z.object({ refresh: z.boolean().optional() }),
      handler: async ({ refresh }, ctx) => status(ctx.host, refresh === true),
    }),
    defineCommand({
      id: 'assistant.state',
      title: 'Assistant chat',
      description: "The project's chat with the assistant: its transcript, whether a run is going and any pending confirmation.",
      scope: 'project',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => snapshot(chatFor(ctx.project!), ctx.host),
    }),
    defineCommand({
      id: 'assistant.send',
      title: 'Send a message to the assistant',
      description: 'Starts a run of the assistant with this message; the reply streams as assistant.event events. Refused while a run is going, when no key is set, or when Claude Code or the MCP server it needs is not available.',
      scope: 'project',
      hidden: true,
      input: projectScoped(z.object({ text: z.string().trim().min(1).max(20_000) })),
      handler: async ({ text }, ctx) => {
        const chat = chatFor(ctx.project!);
        if (chat.run) throw new StudioError('CONFLICT', 'The assistant is still working on the last message.');
        await readiness(ctx.host);
        void run(ctx.host, chat, text);
        return { started: true };
      },
    }),
    defineCommand({
      id: 'assistant.cancel',
      title: 'Stop the assistant',
      description: 'Stops the current run (the Claude Code process is killed; the next message resumes its session); a pending confirmation counts as declined.',
      scope: 'project',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => {
        const chat = chats.get(ctx.project!.id);
        if (chat) cancel(chat);
        return { stopped: Boolean(chat?.run) };
      },
    }),
    defineCommand({
      id: 'assistant.clear',
      title: 'Clear the assistant chat',
      description: 'Forgets the conversation (not the edits it made, which stay in the history) and, with Claude Code, its session. Refused while a run is going.',
      scope: 'project',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => {
        const chat = chatFor(ctx.project!);
        if (chat.run) throw new StudioError('CONFLICT', 'Stop the assistant first.');
        dropProvider(chat);
        rememberSession(ctx.host, chat, null);
        chat.items = [];
        chat.error = null;
        changed(ctx.host, chat);
        return { cleared: true };
      },
    }),
    defineCommand({
      id: 'assistant.confirm.reply',
      title: 'Answer the assistant\'s confirmation',
      description: 'Allows or declines the mutating command the assistant is waiting on.',
      scope: 'project',
      hidden: true,
      input: z.object({ id: z.string(), allow: z.boolean() }),
      handler: async ({ id, allow }, ctx) => {
        const chat = chats.get(ctx.project!.id);
        if (!chat?.confirm || chat.confirm.id !== id) throw new StudioError('NOT_FOUND', 'That confirmation is no longer pending.');
        chat.confirm.resolve(allow);
        return { answered: true };
      },
    }),
  ],
});
