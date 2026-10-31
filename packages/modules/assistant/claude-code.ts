import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { StudioError, newId, type ClaudeCodeStatus, type ErrorPayload } from '@studio/core';
import type { LoopEvents, ToolOutcome } from './loop';

/*
 * The Claude Code provider: the user's own installed, logged-in Claude Code, driven as a subprocess
 * in headless mode. One process per chat, started on the first message and kept for the chat's life;
 * user turns go in as stream-json user messages, the reply and the tool events come out as stream-json
 * lines. Its only tools are the app's commands over the app's own MCP server (`--mcp-config` with
 * that one server, `--strict-mcp-config`, every built-in tool off), and the URL carries a per-process
 * token so the server runs those calls as the assistant. The app never touches Claude Code's
 * credentials: it runs the unmodified binary as the user and reads only what it prints.
 */

export const MAX_TURNS = 25;
/** Built-ins Claude Code is told not to use, on top of `--tools ""` which removes the built-in set altogether. */
export const DISALLOWED_TOOLS = 'Bash,Edit,Write,Read,WebFetch,WebSearch';
export const MCP_OFF_MESSAGE = 'The assistant with Claude Code works through the MCP server, which is off. Enable it in Settings or with the button in the chat.';
const STDERR_TAIL = 2000;
/** When set to a file path, every line Claude Code prints (stdout and stderr) is appended to it: for looking at a conversation that went wrong. Never set in normal use. */
const LOG_ENV = 'STUDIO_CLAUDE_CODE_LOG';

function debugLog(kind: 'out' | 'err', text: string): void {
  const file = process.env[LOG_ENV];
  if (!file) return;
  try {
    fs.appendFileSync(file, `${kind} ${text.endsWith('\n') ? text : `${text}\n`}`);
  } catch {
    /* a debug aid only */
  }
}

/** How to start the resolved binary: directly, or as a Node script through this executable. */
export interface ClaudeLaunch {
  file: string;
  /** Arguments that come before Claude Code's own (the script path when run through Node). */
  prefix: string[];
  env: NodeJS.ProcessEnv;
  resolved: string;
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Runs a JavaScript file (the smoke's fake, or an npm install's `cli.js`) with this executable as Node. */
const asNodeScript = (script: string): ClaudeLaunch => ({ file: process.execPath, prefix: [script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, resolved: script });

function launchFor(resolved: string): ClaudeLaunch | { error: string } {
  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return asNodeScript(resolved);
  if (ext === '.cmd' || ext === '.bat') {
    // An npm install leaves a shell shim; its real entry sits next to it. Shims are never run through a shell.
    const cli = path.join(path.dirname(resolved), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (isFile(cli)) return asNodeScript(cli);
    return { error: `${resolved} is a shell shim without its cli.js next to it. Point Settings at the Claude Code executable, or install the native build with \`claude install\`.` };
  }
  return { file: resolved, prefix: [], env: process.env, resolved };
}

/** Finds the Claude Code binary: the configured path, or `claude` on PATH (with PATHEXT on Windows). Never by image name. */
export function findClaude(configured: string): ClaudeLaunch | { error: string } {
  const win = process.platform === 'win32';
  const name = configured.trim() || 'claude';
  const exts = win ? (process.env['PATHEXT'] || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [];
  const withExt = (base: string): string | undefined => {
    if (isFile(base)) return base;
    if (win && !path.extname(base)) {
      for (const ext of exts) {
        for (const candidate of [base + ext.toLowerCase(), base + ext]) if (isFile(candidate)) return candidate;
      }
    }
    return undefined;
  };
  let resolved: string | undefined;
  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) resolved = withExt(path.resolve(name));
  else {
    for (const dir of (process.env['PATH'] || '').split(path.delimiter)) {
      if (!dir) continue;
      resolved = withExt(path.join(dir, name));
      if (resolved) break;
    }
  }
  if (!resolved) return { error: configured.trim() ? `Nothing runnable at ${name}.` : 'No `claude` on PATH. Install Claude Code, or set its path in Settings.' };
  return launchFor(resolved);
}

const exec = (launch: ClaudeLaunch, args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(launch.file, [...launch.prefix, ...args], { env: launch.env, timeout: 10_000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** `claude --version` and `claude auth status --json`: found, which version, logged in. Neither consumes usage. */
export async function probeClaudeCode(configured: string): Promise<ClaudeCodeStatus> {
  const label = configured.trim() || 'claude';
  const launch = findClaude(configured);
  if ('error' in launch) return { path: label, found: false, loggedIn: null, error: launch.error };
  const version = await exec(launch, ['--version']);
  if (!version.stdout.trim()) return { path: label, resolved: launch.resolved, found: true, loggedIn: null, error: `\`${launch.resolved} --version\` failed: ${version.stderr.trim() || `exit ${version.code}`}` };
  const auth = await exec(launch, ['auth', 'status', '--json']);
  let loggedIn: boolean | null = null;
  let error: string | undefined;
  try {
    const parsed = JSON.parse(auth.stdout.trim()) as { loggedIn?: unknown };
    if (typeof parsed.loggedIn === 'boolean') loggedIn = parsed.loggedIn;
  } catch {
    error = `\`claude auth status\` gave no answer${auth.stderr.trim() ? `: ${auth.stderr.trim()}` : ''}`;
  }
  return { path: label, resolved: launch.resolved, found: true, version: version.stdout.trim().split(/\s+/)[0], loggedIn, ...(error ? { error } : {}) };
}

/** The user's own words and Claude Code's answers that a resumed session replayed before this turn. */
export type HistoryItem = { kind: 'user'; text: string } | { kind: 'assistant'; text: string } | { kind: 'tool'; id: string; name: string; input: unknown; outcome: ToolOutcome | null };

export interface ClaudeCodeEvents extends LoopEvents {
  /** The session this chat runs in, from Claude Code's `init` event; null when a stored one could not be resumed and was forgotten. */
  session(id: string | null): void;
  /** The resumed session's earlier messages, when the stream replayed them (before this turn's user item). */
  history(items: HistoryItem[]): void;
  /** Claude Code answered that it is not logged in. */
  authFailure(): void;
}

export interface ClaudeCodeOptions {
  /** `config.ai.claudeCodePath` at spawn time. */
  configuredPath(): string;
  /** `config.ai.claudeCodeModel` / `claudeCodeEffort` at spawn time; empty leaves Claude Code's own default. */
  modelAndEffort(): { model: string; effort: string };
  /** An empty folder the app owns: no project CLAUDE.md is picked up and every chat's session groups under it. */
  cwd: string;
  /** The MCP server's name as the config names it, the base URL while the server runs (null when off). */
  serverName: string;
  mcpUrl(): string | null;
  projectId: string;
  /** The stable part of the prompt, appended to Claude Code's own when a process starts. */
  systemPrompt(): string;
  /** The live part (the project's name, its levels, the display units), read again for every message. */
  liveContext(): string;
  sessionId(): string | null;
  /** A per-process token the MCP server recognises; revoked when the process ends. */
  tokens: { issue(): string; revoke(token: string): void };
}

type TurnEnd = 'done' | 'stopped' | 'resume-failed';
interface Turn {
  text: string;
  resolve(end: TurnEnd): void;
  reject(err: Error): void;
}
interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  mcp_servers?: { name: string; status: string }[];
  event?: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string } };
  message?: { content?: unknown };
  /** On an assistant message: its text is an API error (e.g. not logged in), not a reply; the result carries it too. */
  is_api_error_message?: boolean;
  /** On a user message: our own stdin turn echoed back (`--replay-user-messages`). */
  isReplay?: boolean;
  is_error?: boolean;
  result?: unknown;
  errors?: unknown[];
}
interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  source?: { media_type?: string; data?: string };
}

/** What a logged-out Claude Code says (checked against 2.1.283: "Failed to authenticate: OAuth session expired and could not be refreshed"). */
const AUTH_PATTERN = /not logged in|please run \/login|login expired|failed to authenticate|authentication|invalid api key|oauth/i;

/** How a message carries the live context when it changed since the process was told it, and how a replayed message loses it again. */
const CONTEXT_OPEN = '<app-context>';
const CONTEXT_CLOSE = '</app-context>';
const withContext = (context: string, text: string): string => `${CONTEXT_OPEN}\nThe project changed since you were last told about it; this is how it stands now.\n${context}\n${CONTEXT_CLOSE}\n\n${text}`;
const withoutContext = (text: string): string => (text.startsWith(CONTEXT_OPEN) && text.includes(CONTEXT_CLOSE) ? text.slice(text.indexOf(CONTEXT_CLOSE) + CONTEXT_CLOSE.length).replace(/^\s+/, '') : text);

/**
 * Whether a failure says the resumed session could not be found. What the real binary prints for a
 * lost session was never checked by hand (see the module README), so only an error that names the
 * session id counts ("No conversation found with session ID: <id>" is what the fake prints); a crash,
 * a refused connection or anything else keeps the stored session.
 */
export function sessionNotFound(text: string, sessionId: string): boolean {
  return text.includes(sessionId);
}

/** The text of a user or tool-result content: a string, or the text blocks joined. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/** A `tool_result` block as the loop's outcome: the server's JSON (an error payload when flagged), images kept as images. */
function outcomeOf(block: Block): ToolOutcome {
  const text = contentText(block.content);
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* plain text stays text */
  }
  if (block.is_error) {
    const payload: ErrorPayload = parsed && typeof parsed === 'object' && typeof (parsed as ErrorPayload).code === 'string' ? (parsed as ErrorPayload) : { code: 'INTERNAL', message: text || 'The tool failed.' };
    return { ok: false, error: payload };
  }
  const image = Array.isArray(block.content) ? (block.content as Block[]).find((b) => b.type === 'image' && b.source?.data) : undefined;
  if (image) return { ok: true, output: 'image', result: { mimeType: image.source!.media_type ?? 'image/png', data: image.source!.data!, ...(parsed && typeof parsed === 'object' ? (parsed as object) : {}) } };
  return { ok: true, output: 'json', result: parsed };
}

/** One chat's Claude Code process. */
export class ClaudeCodeProvider {
  readonly kind = 'claude-code' as const;
  private proc: ChildProcess | null = null;
  private token: string | null = null;
  private turn: Turn | null = null;
  private events: ClaudeCodeEvents | null = null;
  private stderrTail = '';
  private stopped = false;
  private resumed: string | null = null;
  /** A turn of this process ended with a successful result: its session was found. */
  private answered = false;
  private echoed = false;
  private replay: HistoryItem[] = [];
  private textId: string | null = null;
  /** The live context this process was last told: in its prompt at start, then with any message after which it had changed. */
  private context = '';
  private deltas = 0;
  private toolNames = new Map<string, string>();
  /** Resolves when the current process has reported its exit, so a killed one is never written to. */
  private exited: Promise<void> = Promise.resolve();
  /** The model and effort the running process was started with. */
  private startedWith = '';
  private settingsKey(): string {
    const { model, effort } = this.opts.modelAndEffort();
    return `${model}|${effort}`;
  }
  /** The MCP base URL the running process was given, so a moved server can be noticed. */
  url: string | null = null;

  constructor(private readonly opts: ClaudeCodeOptions) {}

  get alive(): boolean {
    return this.proc !== null;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  /** Resolves once a process Stop killed has reported its exit (at once when none is going), so the chat can say it is still stopping. */
  whenStopped(): Promise<void> {
    return this.proc && this.stopped ? this.exited : Promise.resolve();
  }

  /** One user turn: starts the process if needed (resuming the stored session), writes the message, returns when Claude Code reports the turn's result. */
  async send(text: string, events: ClaudeCodeEvents, signal: AbortSignal): Promise<void> {
    this.events = events;
    const onAbort = () => this.stop();
    signal.addEventListener('abort', onAbort);
    try {
      for (let attempt = 0; ; attempt++) {
        const resume = this.opts.sessionId();
        // The model or effort changed in Settings since this process started: start again on the same session.
        if (this.proc && !this.stopped && this.startedWith !== this.settingsKey()) this.stop();
        // A process Stop killed may not have reported its exit yet: wait for it rather than write to it.
        if (this.proc && this.stopped) await this.exited;
        if (!this.proc) this.start(resume);
        const end = await this.turnOn(text);
        if (end === 'resume-failed' && attempt === 0 && resume) {
          events.session(null);
          events.note(newId('msg'), 'The earlier Claude Code session could not be resumed; starting a new one.');
          continue;
        }
        return;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Kills the process (by pid, never by image name); the next message starts a fresh one that resumes the session. */
  stop(): void {
    const proc = this.proc;
    if (!proc?.pid) return;
    this.stopped = true;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).on('error', () => proc.kill());
    else proc.kill('SIGKILL');
  }

  dispose(): void {
    this.stop();
  }

  private start(resume: string | null): void {
    const launch = findClaude(this.opts.configuredPath());
    if ('error' in launch) throw new StudioError('UNAVAILABLE', launch.error);
    const base = this.opts.mcpUrl();
    if (!base) throw new StudioError('UNAVAILABLE', MCP_OFF_MESSAGE);
    fs.mkdirSync(this.opts.cwd, { recursive: true });
    const token = this.opts.tokens.issue();
    const url = `${base}?project=${encodeURIComponent(this.opts.projectId)}&assistant=${token}`;
    const name = this.opts.serverName;
    const { model, effort } = this.opts.modelAndEffort();
    this.startedWith = `${model}|${effort}`;
    this.context = this.opts.liveContext();
    const args = [
      ...launch.prefix,
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--replay-user-messages',
      '--max-turns', String(MAX_TURNS),
      '--tools', '',
      '--mcp-config', JSON.stringify({ mcpServers: { [name]: { type: 'http', url } } }),
      '--strict-mcp-config',
      '--allowedTools', `mcp__${name}__*`,
      '--disallowedTools', DISALLOWED_TOOLS,
      '--append-system-prompt', `${this.opts.systemPrompt()}\n\n${this.context}`,
      // Passed on every start, resumes included: a model or effort changed in Settings applies from the next process.
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : []),
      ...(resume ? ['--resume', resume] : []),
    ];
    const proc = spawn(launch.file, args, { cwd: this.opts.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    let exited!: () => void;
    this.exited = new Promise<void>((resolve) => (exited = resolve));
    proc.once('exit', () => exited());
    proc.once('error', () => exited());
    this.token = token;
    this.url = base;
    this.resumed = resume;
    this.answered = false;
    this.stopped = false;
    this.echoed = false;
    this.replay = [];
    this.stderrTail = '';
    this.textId = null;
    this.deltas = 0;
    this.toolNames.clear();
    proc.on('error', (err) => this.ended(`Claude Code could not start: ${err.message}`));
    // A write to a process that has just died reports through the write callback; without this listener the stream would throw.
    proc.stdin!.on('error', () => {});
    proc.on('exit', (code, signal) => this.ended(this.stopped ? null : `Claude Code exited (${signal ?? `code ${code}`})${this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : ''}`));
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      debugLog('err', text);
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL);
    });
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      debugLog('out', line);
      this.onLine(line);
    });
  }

  private turnOn(text: string): Promise<TurnEnd> {
    // The levels (or the name, or the units) changed since this process was told them: the message carries the new state, so the process and its prompt cache are kept.
    const context = this.opts.liveContext();
    const sent = context === this.context ? text : withContext(context, text);
    this.context = context;
    return new Promise<TurnEnd>((resolve, reject) => {
      this.turn = { text, resolve, reject };
      const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: sent }] } });
      this.proc!.stdin!.write(`${line}\n`, (err) => {
        if (err) this.fail(`Could not write to Claude Code: ${err.message}`);
      });
    });
  }

  /** Ends the pending turn and the process. */
  private fail(message: string): void {
    this.settle(new Error(message));
    this.stop();
  }

  private settle(err: Error | null): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    if (!err) return turn.resolve('done');
    if (this.stopped) return turn.resolve('stopped');
    const auth = AUTH_PATTERN.test(err.message) || AUTH_PATTERN.test(this.stderrTail);
    if (auth) this.events?.authFailure();
    // A resumed process that fails before its first answer with an error naming its session lost that session; the caller retries once without --resume. Any other failure keeps the session.
    if (this.resumed && !this.answered && !auth && sessionNotFound(`${err.message}\n${this.stderrTail}`, this.resumed)) return turn.resolve('resume-failed');
    turn.reject(err);
  }

  private ended(message: string | null): void {
    if (this.token) this.opts.tokens.revoke(this.token);
    this.token = null;
    this.proc = null;
    this.url = null;
    this.settle(message === null ? (this.stopped ? new Error('stopped') : new Error('Claude Code exited before answering.')) : new Error(message));
  }

  private onLine(line: string): void {
    let msg: StreamLine;
    try {
      msg = JSON.parse(line) as StreamLine;
    } catch {
      return;
    }
    const events = this.events;
    if (!events) return;
    switch (msg.type) {
      case 'system': {
        if (msg.subtype !== 'init') return;
        if (typeof msg.session_id === 'string') events.session(msg.session_id);
        const server = msg.mcp_servers?.find((s) => s.name === this.opts.serverName);
        if (msg.mcp_servers && (!server || server.status !== 'connected')) this.fail(`Claude Code could not connect to the app's MCP server${server ? ` (${server.status})` : ''}.`);
        return;
      }
      case 'stream_event': {
        if (!this.echoed) return;
        const event = msg.event;
        if (!event) return;
        if (event.type === 'content_block_start') this.textId = null;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
          this.textId ??= newId('msg');
          this.deltas++;
          events.text(this.textId, event.delta.text);
        }
        return;
      }
      case 'assistant': {
        // An API error (not logged in, no connection) comes as a synthetic reply and again in the result: shown once, as the run's error.
        if (msg.is_api_error_message) return;
        const blocks = Array.isArray(msg.message?.content) ? (msg.message!.content as Block[]) : [];
        for (const block of blocks) {
          if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
            const name = this.bareName(block.name);
            this.toolNames.set(block.id, name);
            if (this.echoed) events.toolStart(block.id, name, block.input);
            else this.replay.push({ kind: 'tool', id: block.id, name, input: block.input, outcome: null });
          } else if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            if (!this.echoed) this.replay.push({ kind: 'assistant', text: block.text });
            else if (!this.deltas) events.text(newId('msg'), block.text);
          }
        }
        this.deltas = 0;
        this.textId = null;
        return;
      }
      case 'user': {
        const content = msg.message?.content;
        const blocks = Array.isArray(content) ? (content as Block[]) : [];
        const results = blocks.filter((b) => b.type === 'tool_result' && typeof b.tool_use_id === 'string');
        if (results.length) {
          for (const block of results) {
            const outcome = outcomeOf(block);
            if (this.echoed) events.toolEnd(block.tool_use_id!, outcome);
            else {
              const item = this.replay.find((i): i is Extract<HistoryItem, { kind: 'tool' }> => i.kind === 'tool' && i.id === block.tool_use_id);
              if (item) item.outcome = outcome;
            }
          }
          return;
        }
        const text = contentText(content);
        if (!this.echoed && this.turn && msg.isReplay === true) {
          // Our own message, echoed back (`isReplay`, even when a replayed earlier message has the same text): everything before it was the resumed session's history.
          this.echoed = true;
          if (this.replay.length) events.history(this.replay);
          this.replay = [];
        } else if (!this.echoed && text) this.replay.push({ kind: 'user', text: withoutContext(text) });
        return;
      }
      case 'result': {
        if (!msg.is_error) this.answered = true;
        if (msg.subtype === 'error_max_turns') events.note(newId('msg'), `Stopped after ${MAX_TURNS} rounds of tool calls. Send another message to go on.`);
        if (msg.is_error) {
          const detail = (Array.isArray(msg.errors) ? msg.errors.map(String).join('; ') : '') || (typeof msg.result === 'string' ? msg.result : '') || msg.subtype || 'Claude Code reported an error.';
          this.settle(new Error(detail));
        } else this.settle(null);
        return;
      }
      default:
        return;
    }
  }

  /** `mcp__<server>__plan_apply` → `plan_apply`. */
  private bareName(name: string): string {
    const prefix = `mcp__${this.opts.serverName}__`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  }
}
