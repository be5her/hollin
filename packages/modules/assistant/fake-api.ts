import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/*
 * A stand-in for the Claude API, for the unit tests and the smoke test: it answers `POST /v1/messages`
 * with scripted turns streamed as server-sent events in the shape the SDK expects, and records every
 * request body so a test can check what the assistant sent (tool results, images, the key header).
 * It never knows real model behaviour; a test queues the turns it wants.
 */

export interface FakeToolCall {
  name: string;
  input: unknown;
  /** The tool_use id; generated when absent. */
  id?: string;
}

/** One scripted reply: some text, then tool calls (which make the turn end with `tool_use`). */
export interface FakeTurn {
  text?: string;
  tools?: FakeToolCall[];
  /** Overrides the stop reason (default: `tool_use` with tools, else `end_turn`). */
  stop?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Answer with this HTTP status and error body instead. */
  error?: { status: number; type: string; message: string };
  /** Holds the answer until `release()`, so a test can look at the app while the model is "thinking". */
  hold?: boolean;
}

export interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  body: FakeMessagesBody;
}

/** The request body as the SDK sends it (only what the tests read). */
export interface FakeMessagesBody {
  model: string;
  system?: unknown;
  tools?: { name: string; description?: string; input_schema: unknown }[];
  messages: { role: 'user' | 'assistant'; content: string | { type: string; [key: string]: unknown }[] }[];
  stream?: boolean;
  max_tokens?: number;
}

const write = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

let turnCounter = 0;

/** The real API's 400 for a `tool_use` without its `tool_result` in the message right after it, or null when every call is answered. */
export function unansweredToolUse(messages: FakeMessagesBody['messages']): string | null {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    const ids = message.content.filter((b) => b.type === 'tool_use').map((b) => b.id as string);
    if (!ids.length) continue;
    const next = messages[i + 1];
    const answered = new Set(next?.role === 'user' && Array.isArray(next.content) ? next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id as string) : []);
    const missing = ids.filter((id) => !answered.has(id));
    if (missing.length) return `messages.${i + 1}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${missing.join(', ')}. Each \`tool_use\` block must have a corresponding \`tool_result\` block in the next message.`;
  }
  return null;
}

export class FakeClaude {
  readonly requests: FakeRequest[] = [];
  private readonly queue: FakeTurn[] = [];
  private server: Server | null = null;
  /** Resolvers waiting for the next request to arrive. */
  private readonly waiters: (() => void)[] = [];
  /** Answers held by a turn's `hold`, let go by `release()`. */
  private readonly holds: (() => void)[] = [];
  url = '';

  /** Queues replies: each request takes the next one; an empty queue answers with a short text. */
  script(...turns: FakeTurn[]): void {
    this.queue.push(...turns);
  }

  reset(): void {
    this.queue.length = 0;
    this.requests.length = 0;
    this.release();
  }

  /** How many answers a `hold` is keeping back. */
  get held(): number {
    return this.holds.length;
  }

  /** Lets every held answer go. */
  release(): void {
    for (const go of this.holds.splice(0)) go();
  }

  /** Resolves once at least `count` requests have been recorded. */
  async received(count: number, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.requests.length < count) {
      if (Date.now() > deadline) return false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return true;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res).catch((err) => this.fail(res, 500, 'api_error', String(err))));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    const { port } = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${port}`;
    return this.url;
  }

  async close(): Promise<void> {
    this.release();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }

  private fail(res: ServerResponse, status: number, type: string, message: string): void {
    if (res.headersSent) return void res.end();
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type, message } }));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) return this.fail(res, 404, 'not_found_error', `No ${req.method} ${req.url}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as FakeMessagesBody;
    this.requests.push({ headers: req.headers as FakeRequest['headers'], body });
    for (const wake of this.waiters.splice(0)) wake();

    // As the real API does: every tool_use must be answered by a tool_result in the next message. The scripted turn is failed, not kept.
    const unanswered = unansweredToolUse(body.messages);
    if (unanswered) {
      this.queue.shift();
      return this.fail(res, 400, 'invalid_request_error', unanswered);
    }
    const turn = this.queue.shift() ?? { text: 'Nothing scripted for this request.' };
    if (turn.hold) await new Promise<void>((resolve) => this.holds.push(resolve));
    if (turn.error) return this.fail(res, turn.error.status, turn.error.type, turn.error.message);
    const id = `msg_fake_${++turnCounter}`;
    const stop = turn.stop ?? (turn.tools?.length ? 'tool_use' : 'end_turn');
    const toolBlocks = (turn.tools ?? []).map((t, i) => ({ type: 'tool_use' as const, id: t.id ?? `toolu_fake_${turnCounter}_${i}`, name: t.name, input: t.input ?? {} }));

    if (!body.stream) {
      const content: unknown[] = [];
      if (turn.text) content.push({ type: 'text', text: turn.text });
      content.push(...toolBlocks);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    write(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    let index = 0;
    if (turn.text) {
      write(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      // Word by word, so the UI really streams.
      for (const piece of turn.text.match(/\S+\s*|\s+/g) ?? [turn.text]) write(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
      write(res, 'content_block_stop', { type: 'content_block_stop', index });
      index++;
    }
    for (const block of toolBlocks) {
      write(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      write(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      write(res, 'content_block_stop', { type: 'content_block_stop', index });
      index++;
    }
    write(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
    write(res, 'message_stop', { type: 'message_stop' });
    res.end();
  }
}
