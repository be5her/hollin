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
  isImageResult,
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
  type ToolItem,
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
  /** True when the transcript came from the view state: history the stream replays is then already shown. */
  restored: boolean;
  /** Stop was pressed and the run, or the Claude Code process it ran in, has not ended yet. */
  stopping: boolean;
  /** Images tool calls returned (snapshots), by tool item id, for the cards; in memory only, gone with the chat. */
  images: Map<string, { mimeType: string; data: string }>;
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
    stopping: chat.stopping,
  };
}

function emit(host: HostApi, chat: Chat, event: AssistantEvent): void {
  host.emit('assistant.event', { projectId: chat.projectId, event });
}

const changed = (host: HostApi, chat: Chat) => emit(host, chat, { type: 'changed', state: snapshot(chat, host) });

function chatFor(project: ProjectApi): Chat {
  let chat = chats.get(project.id);
  if (!chat) {
    chat = { projectId: project.id, project, items: [], status: 'idle', error: null, run: null, confirm: null, provider: null, sessionId: null, restored: false, stopping: false, images: new Map() };
    chats.set(project.id, chat);
  }
  chat.project = project;
  return chat;
}

/** Stops a run: the API call is aborted or the Claude Code process killed, and a pending confirmation counts as declined. */
function cancel(chat: Chat, host?: HostApi): void {
  if (chat.run && host && !chat.stopping) {
    chat.stopping = true;
    changed(host, chat);
  }
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
  if (!probe || probe.path !== configured || refresh) {
    // Announced, so the status bar can say "checking Claude Code…" while `claude --version` and `claude auth status` run.
    host.emit('assistant.probe', { checking: true });
    const status = probeClaudeCode(configured);
    probe = { path: configured, status };
    void status.finally(() => {
      if (probe?.status === status) host.emit('assistant.probe', { checking: false });
    });
  }
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
  `You are Otto, the assistant built into ${BRANDING.productName}, a desktop app for planning buildings, floor plans, interiors and decor. The people you work with are homeowners and hobbyists planning their own place, not professionals. They see the plan change as you work: you are the second author on their sheet, and they keep every decision that loses something.`,
  'Your tools are the app\'s own commands. Read before you change (plan_describe, building_get), make changes with the editing tools (several steps as one plan_apply batch), and look at the result (view_snapshot, rules_check). Give every plan_apply a short verb-phrase label, such as "Add a 3 m wall and a door": it names the step in the undo history, the card in the chat and the status bar. Every edit you make is one undo step, signed Otto in the history, and the user can take it back with Ctrl+Z. Tool inputs and outputs are always millimetres.',
  [
    'How you write:',
    '- Lead with what happened: the result first ("Added a 3 000 mm wall between the kitchen and the hall"), then one sentence of how or why, then at most one question.',
    '- Every length carries its unit: millimetres for what you measured or drew (3 000 mm), metres only when echoing the user ("the 3 m wall you asked for"); areas in m² with one decimal. Never "about" for something you can measure.',
    '- Names, not ids: the kitchen, the north wall, the stair to the upper floor. Use an id only when two things have no other name.',
    '- Say the choice you made ("200 mm thick like the others", "the door opens into the bedroom") instead of asking for every detail, and offer the flip in a few words.',
    '- One question at a time, with the alternatives inside it, and only when the answer changes the drawing.',
    '- Do not guess what you have not read: read the plan or take a snapshot first and say that you looked ("I looked at the ground floor in 3D from the hall side"). When you still cannot tell, say what you need from the user.',
    '- Ask before deleting: a call that deletes or overwrites anything pauses until the user allows it in the chat. Before it, say what goes with it ("takes its 900 mm door with it"); never argue for the delete.',
    '- Errors name the fact and the way out: what did not land, what the plan is now, what you or the user can do. Apologise at most once and never blame the app.',
    '- "I" for you, "you" for the user; never "we" or "let\'s".',
    '- Plain text: no headings, tables or bold, no list longer than three items, no exclamation marks. Never "I\'d be happy to", "Great question", "Certainly" or "Absolutely".',
    '- Past tense for what is done, present for what is running. No promises about later turns.',
  ].join('\n'),
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

/** The level a call names (`levelId`, or the one level every step of a batch names), as its name. */
function levelOf(project: ProjectApi, input: unknown): string | undefined {
  const named = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const id = (value as { levelId?: unknown }).levelId;
    if (typeof id === 'string') named.add(id);
  };
  visit(input);
  const steps = (input as { steps?: unknown } | null)?.steps;
  if (Array.isArray(steps)) for (const step of steps) visit((step as { input?: unknown } | null)?.input);
  if (named.size !== 1) return undefined;
  return project.doc.levels[[...named][0]]?.name;
}

/** What a snapshot showed, for its card: `plan`, or `3D` with the lighting. */
function viewOf(input: unknown): string {
  const i = (input ?? {}) as { view?: unknown; lighting?: unknown };
  return i.view === '3d' ? `3D${i.lighting === 'night' ? ', night' : ''}` : 'plan';
}

/** What the card's second line can say before the call runs: from the command's meta and its input. */
function describeCall(item: ToolItem, meta: CommandMeta | undefined, project: ProjectApi): void {
  if (meta?.readOnly) item.readOnly = true;
  const steps = (item.input as { steps?: unknown } | null)?.steps;
  if (meta?.id === 'plan.apply' && Array.isArray(steps)) item.ops = steps.length;
  const level = levelOf(project, item.input);
  if (level) item.level = level;
  if (meta?.id === 'view.snapshot') {
    item.view = viewOf(item.input);
    if (item.view !== 'plan' && !(item.input as { levelId?: unknown } | null)?.levelId) item.level = 'Building';
  }
}

/** The id of the newest undo step, to tell afterwards whether a call left one. */
function newestStep(project: ProjectApi): string | undefined {
  try {
    return project.history().undo[0]?.id;
  } catch {
    return undefined;
  }
}

/** After a call: the undo step it left (signed by the assistant) gives the card its level and layer; an image is kept for the card. */
function describeOutcome(chat: Chat, item: ToolItem, outcome: ToolOutcome, topBefore: string | undefined): void {
  if (!outcome.ok) return;
  const top = chat.project.history().undo[0];
  if (top && top.id !== topBefore && top.author.kind === 'assistant') {
    item.undoable = true;
    if (top.level) item.level = top.level;
    if (top.layer) item.layer = top.layer;
  }
  if (outcome.output === 'image' && isImageResult(outcome.result)) {
    const { mimeType, data } = outcome.result as { mimeType: string; data: string };
    chat.images.set(item.id, { mimeType, data });
    item.image = { mimeType };
  }
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
    modelAndEffort: () => {
      const ai = host.config.get().ai;
      return { model: ai.claudeCodeModel, effort: ai.claudeCodeEffort };
    },
    cwd: path.join(host.dataDir ?? path.join(os.tmpdir(), BRANDING.dataDirName), 'claude-code'),
    serverName: BRANDING.mcpServerName,
    mcpUrl: () => {
      const mcp = host.mcpStatus();
      return mcp.running ? mcp.url : null;
    },
    projectId: chat.projectId,
    systemPrompt: () => STABLE_PROMPT,
    liveContext: () => livePrompt(host, chat.project),
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

/** How much of a chat is kept across restarts: the last items, tool inputs cut, so `.local/ui.json` stays small. */
const MAX_STORED_ITEMS = 200;
const MAX_STORED_INPUT = 2000;

interface StoredChat {
  provider: 'claude-code';
  sessionId: string | null;
  items: TranscriptItem[];
}

function storedItems(items: TranscriptItem[]): TranscriptItem[] {
  return items.slice(-MAX_STORED_ITEMS).map((item) => {
    if (item.kind !== 'tool') return item;
    // The image lives in memory only: a reopened chat shows the card without it.
    const { image: _image, ...rest } = item;
    const text = JSON.stringify(item.input) ?? '';
    return text.length > MAX_STORED_INPUT ? { ...rest, input: `${text.slice(0, MAX_STORED_INPUT)}…` } : rest;
  });
}

/**
 * Stores the Claude Code chat (its session id and transcript) in the project's view state, this machine
 * only, never the design, snapshots or exports; nothing when there is nothing to continue. The API
 * provider's chat is not stored: its conversation is the API history, images included.
 */
function storeChat(host: HostApi, chat: Chat): void {
  if (host.config.get().ai.provider !== 'claude-code') return;
  const value: StoredChat | null = chat.sessionId || chat.items.length ? { provider: 'claude-code', sessionId: chat.sessionId, items: storedItems(chat.items) } : null;
  host.projects.setUiState(chat.projectId, { [UI_KEY]: value }).catch((err) => console.warn('[assistant] could not store the chat', err));
}

function rememberSession(host: HostApi, chat: Chat, sessionId: string | null): void {
  if (chat.sessionId === sessionId) return;
  chat.sessionId = sessionId;
  storeChat(host, chat);
}

const isItem = (value: unknown): value is TranscriptItem => typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string' && typeof (value as { id?: unknown }).id === 'string';

/** Loads the stored Claude Code chat, only while Claude Code is the provider: an API chat starts empty. */
async function loadChat(host: HostApi, chat: Chat): Promise<void> {
  try {
    const raw = (await host.projects.uiState(chat.projectId))[UI_KEY] as Partial<StoredChat> | undefined;
    const stored = host.config.get().ai.provider === 'claude-code' && (raw?.provider ?? 'claude-code') === 'claude-code' ? raw : undefined;
    chat.sessionId = typeof stored?.sessionId === 'string' ? stored.sessionId : null;
    chat.items = Array.isArray(stored?.items) ? stored.items.filter(isItem) : [];
    chat.restored = chat.items.length > 0;
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
    ...(meta?.readOnly ? { readOnly: true } : {}),
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
  const toolItems = new Map<string, ToolItem>();
  /** The newest undo step when each call started, to tell whether the call left one. */
  const topBefore = new Map<string, string | undefined>();
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
      const item: ToolItem = { kind: 'tool', id, name, command: meta?.id ?? name, title: meta?.title ?? name, input, status: 'running', summary: '', at: now() };
      try {
        describeCall(item, meta, chat.project);
      } catch (err) {
        console.warn('[assistant] could not describe a call', err);
      }
      topBefore.set(id, newestStep(chat.project));
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
      try {
        describeOutcome(chat, item, outcome, topBefore.get(id));
      } catch (err) {
        console.warn('[assistant] could not describe a call', err);
      }
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
      // A transcript loaded from the view state already holds what the stream would replay.
      if (chat.restored) return;
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
      item.status = controller.signal.aborted ? 'stopped' : 'error';
      item.summary = controller.signal.aborted ? 'Stopped.' : 'The run ended before the call did.';
    }
    chat.run = null;
    chat.status = 'idle';
    changed(host, chat);
    storeChat(host, chat);
    if (chat.stopping) {
      // A killed Claude Code process reports its exit a little after the run ends: the chat says it is stopping until then.
      if (provider instanceof ClaudeCodeProvider) await provider.whenStopped().catch(() => {});
      chat.stopping = false;
      if (chats.get(chat.projectId) === chat) changed(host, chat);
    }
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
    await loadChat(host, chat);
    changed(host, chat);
  },
  onProjectClose: (project, host) => {
    const chat = chats.get(project.id);
    if (!chat) return;
    cancel(chat);
    dropProvider(chat);
    storeChat(host, chat);
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
        const going = Boolean(chat?.run);
        if (chat) cancel(chat, ctx.host);
        return { stopped: going };
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
        chat.items = [];
        chat.images.clear();
        chat.error = null;
        chat.sessionId = null;
        chat.restored = false;
        // Whichever provider runs now: a stored Claude Code chat goes too.
        ctx.host.projects.setUiState(chat.projectId, { [UI_KEY]: null }).catch((err) => console.warn('[assistant] could not remove the stored chat', err));
        changed(ctx.host, chat);
        return { cleared: true };
      },
    }),
    defineCommand({
      id: 'assistant.image',
      title: 'Image of an assistant tool call',
      description: 'The image a tool call in the chat returned (a snapshot), as { mimeType, data } in base64, while the project stays open.',
      scope: 'project',
      hidden: true,
      readOnly: true,
      input: z.object({ id: z.string() }),
      handler: async ({ id }, ctx) => {
        const image = chats.get(ctx.project!.id)?.images.get(id);
        if (!image) throw new StudioError('NOT_FOUND', 'That image is no longer kept.');
        return image;
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
