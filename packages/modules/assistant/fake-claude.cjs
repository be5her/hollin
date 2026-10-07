#!/usr/bin/env node
'use strict';
/*
 * A stand-in for the Claude Code binary, for the unit tests and the smoke test: the real one is never
 * run there. It answers `--version` and `auth status --json`, and in headless mode it reads stream-json
 * user turns from stdin and plays a scripted conversation back on stdout as stream-json lines, calling
 * the app's real MCP server over HTTP for every scripted tool call (the calls are never short-circuited).
 *
 * Environment:
 *   FAKE_CLAUDE_SCRIPT      a JSON file { sessionId?, expectResume?, failResume?, replay?: [events],
 *                           messages: [[turn, ...], ...] }: each stdin message consumes the next entry
 *                           (the file is rewritten, so a queue outlives a process); a turn is
 *                           { text?, tools?: [{ name, input }], error? }.
 *   FAKE_CLAUDE_LOG         a JSONL file this script appends to: what it was started with, every
 *                           message it got and every MCP call it made.
 *   FAKE_CLAUDE_LOGGED_OUT  when set, `auth status` says not logged in.
 * No dependencies: it runs under Node or under the app's executable as Node.
 */
const fs = require('node:fs');
const readline = require('node:readline');

const argv = process.argv.slice(2);
const logFile = process.env.FAKE_CLAUDE_LOG;
const log = (entry) => {
  if (logFile) fs.appendFileSync(logFile, `${JSON.stringify({ ...entry, pid: process.pid, at: Date.now() })}\n`);
};

if (argv[0] === '--version' || argv[0] === '-v') {
  process.stdout.write('9.9.9 (Claude Code)\n');
  process.exit(0);
}
if (argv[0] === 'auth' && argv[1] === 'status') {
  const loggedIn = !process.env.FAKE_CLAUDE_LOGGED_OUT;
  process.stdout.write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none' })}\n`);
  process.exit(loggedIn ? 0 : 1);
}

// ---- flags ----
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('-')) continue;
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) {
    flags[arg.replace(/^-+/, '')] = next;
    i++;
  } else flags[arg.replace(/^-+/, '')] = true;
}

const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
if (!scriptPath) {
  process.stderr.write('fake-claude: FAKE_CLAUDE_SCRIPT is not set\n');
  process.exit(2);
}
const readScript = () => JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
const writeScript = (script) => fs.writeFileSync(scriptPath, JSON.stringify(script));

const mcpConfig = JSON.parse(flags['mcp-config'] || '{"mcpServers":{}}');
const [serverName, server] = Object.entries(mcpConfig.mcpServers)[0] || ['none', { url: '' }];
const mcpUrl = server.url;
const resume = typeof flags.resume === 'string' ? flags.resume : null;
let script = readScript();

log({ type: 'start', argv, resume, mcpUrl, serverName, systemPrompt: flags['append-system-prompt'] || '', allowedTools: flags.allowedTools, disallowedTools: flags.disallowedTools, tools: flags.tools, strict: Boolean(flags['strict-mcp-config']), maxTurns: flags['max-turns'], cwd: process.cwd() });

if (resume && script.failResume) {
  process.stderr.write(`No conversation found with session ID: ${resume}\n`);
  process.exit(1);
}
if (script.expectResume && resume !== script.expectResume) {
  process.stderr.write(`fake-claude: expected --resume ${script.expectResume}, got ${resume}\n`);
  process.exit(3);
}

const sessionId = resume || script.sessionId || `sess-${Date.now()}`;
const out = (obj) => process.stdout.write(`${JSON.stringify({ ...obj, session_id: sessionId })}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

out({ type: 'system', subtype: 'init', model: 'fake-model', tools: [], mcp_servers: [{ name: serverName, status: mcpUrl ? 'connected' : 'failed' }], cwd: process.cwd() });
if (resume && Array.isArray(script.replay)) for (const event of script.replay) out(event);

// ---- a minimal MCP client over Streamable HTTP ----
let rpcId = 0;
let mcpSession = null;
async function rpc(method, params) {
  const id = method.startsWith('notifications/') ? undefined : ++rpcId;
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
  if (mcpSession) headers['mcp-session-id'] = mcpSession;
  const res = await fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }) });
  const session = res.headers.get('mcp-session-id');
  if (session) mcpSession = session;
  if (id === undefined) return undefined;
  const type = res.headers.get('content-type') || '';
  const body = await res.text();
  const messages = [];
  if (type.includes('text/event-stream')) {
    for (const chunk of body.split(/\n\n+/)) {
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (data) messages.push(JSON.parse(data));
    }
  } else if (body.trim()) {
    const parsed = JSON.parse(body);
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const answer = messages.find((m) => m.id === id);
  if (!answer) throw new Error(`MCP ${method}: no answer (HTTP ${res.status})`);
  if (answer.error) throw new Error(`MCP ${method}: ${answer.error.message}`);
  return answer.result;
}
async function callTool(name, input) {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '9.9.9' } });
  await rpc('notifications/initialized', {});
  return rpc('tools/call', { name: `${name}`, arguments: input || {} });
}

// ---- turns ----
let toolCount = 0;
async function stream(text) {
  out({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant', content: [] } } });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  const words = text.split(/(?<=\s)/);
  for (const word of words) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } } });
    await sleep(5);
  }
  out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
  out({ type: 'stream_event', event: { type: 'message_stop' } });
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

async function answer(userText) {
  script = readScript();
  const turns = script.messages && script.messages.length ? script.messages.shift() : [{ text: `(fake-claude has no script for: ${userText})` }];
  writeScript(script);
  let last = '';
  let rounds = 0;
  for (const turn of turns) {
    if (turn.error) {
      out({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [turn.error], num_turns: rounds, result: null });
      return;
    }
    if (turn.text) {
      await stream(turn.text);
      last = turn.text;
    }
    for (const tool of turn.tools || []) {
      rounds++;
      const id = `toolu_${process.pid}_${++toolCount}`;
      const fullName = `mcp__${serverName}__${tool.name}`;
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: fullName, input: tool.input || {} }] } });
      let result;
      try {
        result = await callTool(tool.name, tool.input);
      } catch (err) {
        result = { content: [{ type: 'text', text: JSON.stringify({ code: 'MCP_ERROR', message: err.message }) }], isError: true };
      }
      log({ type: 'call', name: tool.name, input: tool.input || {}, isError: Boolean(result.isError), result: result.content });
      const content = (result.content || []).map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : c.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } } : c));
      out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: Boolean(result.isError) }] } });
    }
  }
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: rounds + 1, result: last, duration_ms: 1 });
}

let chain = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type !== 'user') return;
  const content = msg.message && msg.message.content;
  const text = typeof content === 'string' ? content : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  log({ type: 'message', text });
  // The real binary marks the echo of a stdin turn with `isReplay: true` (2.1.283).
  if (flags['replay-user-messages']) out({ ...msg, isReplay: true });
  chain = chain.then(() => answer(text)).catch((err) => {
    process.stderr.write(`fake-claude: ${err.stack || err}\n`);
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [String(err.message || err)], result: null });
  });
});
rl.on('close', () => {
  chain.then(() => process.exit(0));
});
