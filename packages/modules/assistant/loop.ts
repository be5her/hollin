import Anthropic from '@anthropic-ai/sdk';
import { isImageResult, splitImageResult, type ErrorPayload } from '@studio/core';

/*
 * The agent loop: one user turn, as many model rounds as the model needs. Each round streams a
 * reply; when the model asks for tools, every call runs through the registry and the results go back
 * in one user message, until the model stops. The loop knows nothing about the UI: it reports what
 * happens through `LoopEvents`.
 */

/** How many rounds of tool calls one user message may cause before the loop stops the model. */
export const MAX_TOOL_ROUNDS = 25;
/** Tool results longer than this are cut, with a note, so one large query does not drown the context. */
const MAX_RESULT_CHARS = 120_000;

export type ToolOutcome = { ok: true; result: unknown; output: 'json' | 'image' } | { ok: false; error: ErrorPayload };

export interface LoopEvents {
  /** Text streamed for the assistant item `id` (created on the first delta). */
  text(id: string, delta: string): void;
  /** A tool call started: the item is shown as running. */
  toolStart(id: string, name: string, input: unknown): void;
  /** A tool call ended. */
  toolEnd(id: string, outcome: ToolOutcome): void;
  /** A note from the loop itself, shown as an assistant item (e.g. the round cap). */
  note(id: string, text: string): void;
}

export interface LoopOptions {
  client: Anthropic;
  model: string;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  execute(name: string, input: unknown): Promise<ToolOutcome>;
  events: LoopEvents;
  signal: AbortSignal;
  newId(prefix: string): string;
}

/** A tool outcome as the content of its `tool_result` block. */
export function toolResultContent(outcome: ToolOutcome): Anthropic.ToolResultBlockParam['content'] {
  if (!outcome.ok) return JSON.stringify(outcome.error);
  if (outcome.output === 'image' && isImageResult(outcome.result)) {
    const { image, rest } = splitImageResult(outcome.result);
    return [
      { type: 'image', source: { type: 'base64', media_type: image.mimeType as 'image/png', data: image.data } },
      { type: 'text', text: JSON.stringify(rest) },
    ];
  }
  const text = JSON.stringify(outcome.result ?? null);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… [cut: ${text.length} characters in all; ask for less at a time]` : text;
}

/**
 * Runs the model against `messages` (the whole conversation so far, ending with the user's message)
 * and appends what the model and the tools said to it. Returns when the model ends its turn, when it
 * is stopped, or after `MAX_TOOL_ROUNDS` rounds of tool calls.
 */
export async function runLoop(options: LoopOptions, messages: Anthropic.MessageParam[]): Promise<void> {
  const { client, model, system, tools, execute, events, signal } = options;
  for (let round = 0; ; round++) {
    const stream = client.messages.stream({ model, max_tokens: 16000, system, tools, messages }, { signal });
    let textId: string | null = null;
    stream.on('text', (delta) => {
      textId ??= options.newId('msg');
      events.text(textId, delta);
    });
    const message = await stream.finalMessage();
    messages.push({ role: 'assistant', content: message.content });

    const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || !calls.length) {
      if (message.stop_reason === 'max_tokens') events.note(options.newId('msg'), 'The reply was cut short by the length limit.');
      return;
    }
    // Every tool_use is answered with a tool_result, even when the call never runs: the API refuses a conversation with an unanswered call.
    const notRun = (call: Anthropic.ToolUseBlock, message: string): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ code: 'UNAVAILABLE', message }), is_error: true });
    if (round >= MAX_TOOL_ROUNDS) {
      messages.push({ role: 'user', content: calls.map((call) => notRun(call, `Not run: the limit of ${MAX_TOOL_ROUNDS} rounds of tool calls was reached.`)) });
      events.note(options.newId('msg'), `Stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls. Send another message to go on.`);
      return;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      if (signal.aborted) {
        results.push(notRun(call, 'Not run: the user stopped the assistant.'));
        continue;
      }
      events.toolStart(call.id, call.name, call.input);
      const outcome = await execute(call.name, call.input);
      events.toolEnd(call.id, outcome);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: toolResultContent(outcome), ...(outcome.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
    if (signal.aborted) return;
  }
}

/** A short, user-facing reason for an API failure. */
export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Claude API refused the key. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'The Claude API key is not allowed to use this model.';
  if (err instanceof Anthropic.RateLimitError) return 'The Claude API is rate-limiting this key. Try again in a moment.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check the connection.';
  if (err instanceof Anthropic.APIError) return `The Claude API answered ${err.status ?? 'with an error'}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
