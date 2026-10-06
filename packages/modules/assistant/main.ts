import { AsyncLocalStorage } from 'node:async_hooks';
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
  type AssistantEvent,
  type ChatSnapshot,
  type CommandMeta,
  type HostApi,
  type MutationRequest,
  type PendingConfirmation,
  type ProjectApi,
  type TranscriptItem,
} from '@studio/core';
import { z } from 'zod';
import { ANTHROPIC_KEY } from '../settings/main';
import { describeApiError, runLoop, type ToolOutcome } from './loop';

/**
 * The in-app assistant: a chat per open project, run in main against the Claude API with the command
 * registry as its tools. The key never leaves main; tool calls run as `caller: 'assistant'` with the
 * model as the agent, so every edit is a labelled, undoable transaction attributed to the assistant;
 * mutating commands pause the run until the user allows or declines them in the chat. The chat lives
 * in memory while the project is open and is never stored.
 */

/** Points the SDK at another server: the smoke test's fake API, or a proxy. Never set in normal use. */
const BASE_URL_ENV = 'STUDIO_AI_BASE_URL';

interface Chat {
  projectId: string;
  project: ProjectApi;
  items: TranscriptItem[];
  /** The conversation as the API sees it (text, tool calls and results). Trimmed back when a run fails, so it never ends mid-round. */
  messages: Anthropic.MessageParam[];
  status: ChatSnapshot['status'];
  error: string | null;
  run: { controller: AbortController } | null;
  confirm: (PendingConfirmation & { resolve: (allow: boolean) => void }) | null;
}

const chats = new Map<string, Chat>();
/** The chat whose tool call is running, so `confirmMutation` knows where to ask. */
const running = new AsyncLocalStorage<Chat>();

const now = () => new Date().toISOString();

function snapshot(chat: Chat, host: HostApi): ChatSnapshot {
  return { projectId: chat.projectId, status: chat.status, error: chat.error, items: chat.items, confirm: chat.confirm ? { id: chat.confirm.id, command: chat.confirm.command, input: chat.confirm.input } : null, model: host.config.get().ai.model };
}

function emit(host: HostApi, chat: Chat, event: AssistantEvent): void {
  host.emit('assistant.event', { projectId: chat.projectId, event });
}

const changed = (host: HostApi, chat: Chat) => emit(host, chat, { type: 'changed', state: snapshot(chat, host) });

function chatFor(project: ProjectApi): Chat {
  let chat = chats.get(project.id);
  if (!chat) {
    chat = { projectId: project.id, project, items: [], messages: [], status: 'idle', error: null, run: null, confirm: null };
    chats.set(project.id, chat);
  }
  chat.project = project;
  return chat;
}

/** Stops a run: the API call is aborted and a pending confirmation counts as declined. */
function cancel(chat: Chat): void {
  chat.confirm?.resolve(false);
  chat.run?.controller.abort();
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

function systemPrompt(host: HostApi, project: ProjectApi): Anthropic.TextBlockParam[] {
  const stable = [
    `You are the design assistant built into ${BRANDING.productName}, a desktop app for designing buildings, floor plans and interiors. The user is an architect, engineer or interior designer working in the app; they see the plan change as you work.`,
    'Your tools are the app\'s own commands. Read before you change (plan_describe, building_get), make changes with the editing tools (several steps as one plan_apply batch with a clear label), and look at the result (view_snapshot, rules_check). Every edit you make is undoable and listed in the history under your name.',
    'Reply briefly in plain text (no markdown headings or tables): what you did, what you found, what you suggest. Ask when a request is ambiguous in a way that matters; otherwise make reasonable choices and say what they were.',
    DESIGN_GUIDELINES,
  ].join('\n\n');
  const levels = deriveLevels(project.doc).map((l) => `- ${l.name} (id ${l.id}): elevation ${l.elevation} mm, height ${l.height} mm${l.isGround ? ', the ground level' : ''}`);
  const units = host.config.get().units;
  const live = [`The open project is "${project.name}" (id ${project.id}). Its levels, bottom to top:`, ...levels, `The user's display units are ${units.system}; tool inputs and outputs are always millimetres.`].join('\n');
  return [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: live },
  ];
}

function summarize(meta: CommandMeta, input: unknown, outcome: ToolOutcome): string {
  if (!outcome.ok) return outcome.error.message;
  if (meta.id === 'plan.apply' && input && typeof input === 'object' && typeof (input as { label?: unknown }).label === 'string') return (input as { label: string }).label;
  return '';
}

async function run(host: HostApi, chat: Chat, text: string): Promise<void> {
  const key = host.secrets.get(ANTHROPIC_KEY);
  if (!key) throw new StudioError('UNAVAILABLE', 'Add a Claude API key in Settings to use the assistant.');
  const model = host.config.get().ai.model;
  const controller = new AbortController();
  chat.run = { controller };
  chat.status = 'running';
  chat.error = null;
  chat.items.push({ kind: 'user', id: newId('msg'), text, at: now() });
  const before = chat.messages.length;
  chat.messages.push({ role: 'user', content: text });
  changed(host, chat);

  const client = new Anthropic({ apiKey: key, baseURL: process.env[BASE_URL_ENV] || undefined, maxRetries: 1 });
  const { tools, byName } = toolsFor(host);
  const toolItems = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>();
  try {
    await runLoop(
      {
        client,
        model,
        system: systemPrompt(host, chat.project),
        tools,
        signal: controller.signal,
        newId,
        execute: async (name, input) => {
          const meta = byName.get(name);
          if (!meta) return { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `There is no tool named ${name}.` } };
          try {
            const result = await running.run(chat, () => host.execute(meta.id, input, { caller: 'assistant', agent: model, host, project: meta.scope === 'project' ? chat.project : undefined }));
            return { ok: true, result, output: meta.output };
          } catch (err) {
            return { ok: false, error: toErrorPayload(err) };
          }
        },
        events: {
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
        },
      },
      chat.messages,
    );
  } catch (err) {
    // A failed or stopped run never leaves the conversation mid-round: the API history goes back to before this message.
    chat.messages.length = before;
    if (!controller.signal.aborted) {
      chat.error = describeApiError(err);
      if (!(err instanceof Anthropic.APIError)) console.error('[assistant] run failed', err);
    }
  } finally {
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
  },
  onProjectClose: (project) => {
    const chat = chats.get(project.id);
    if (!chat) return;
    cancel(chat);
    chats.delete(project.id);
  },
  commands: [
    defineCommand({
      id: 'assistant.status',
      title: 'Assistant status',
      description: 'Whether the assistant can run: a key is set, and which model it uses.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => ({ keySet: ctx.host.secrets.has(ANTHROPIC_KEY), persistent: ctx.host.secrets.persistent, model: ctx.host.config.get().ai.model }),
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
      description: 'Starts a run of the assistant with this message; the reply streams as assistant.event events. Refused while a run is going or when no key is set.',
      scope: 'project',
      hidden: true,
      input: projectScoped(z.object({ text: z.string().trim().min(1).max(20_000) })),
      handler: async ({ text }, ctx) => {
        const chat = chatFor(ctx.project!);
        if (chat.run) throw new StudioError('CONFLICT', 'The assistant is still working on the last message.');
        if (!ctx.host.secrets.has(ANTHROPIC_KEY)) throw new StudioError('UNAVAILABLE', 'Add a Claude API key in Settings to use the assistant.');
        void run(ctx.host, chat, text);
        return { started: true };
      },
    }),
    defineCommand({
      id: 'assistant.cancel',
      title: 'Stop the assistant',
      description: 'Stops the current run; a pending confirmation counts as declined.',
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
      description: 'Forgets the conversation (not the edits it made, which stay in the history). Refused while a run is going.',
      scope: 'project',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => {
        const chat = chatFor(ctx.project!);
        if (chat.run) throw new StudioError('CONFLICT', 'Stop the assistant first.');
        chat.items = [];
        chat.messages = [];
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
