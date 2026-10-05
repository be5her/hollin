import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Who is calling, as the client reports it. Self-reported: the UI labels it "via MCP". */
export interface McpAgent {
  name: string;
  version: string | null;
  userAgent: string | null;
}

export const SESSION_HEADER = 'mcp-session-id';
/** Where 2026-07-28 (modern) clients put their identity on every request. */
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const SESSION_PREFIX = 'studio';
const MAX_NAME = 100;

/** A JSON-RPC message, as far as the HTTP layer looks into it. */
export interface RpcMessage {
  id?: string | number | null;
  method?: string;
  params?: {
    name?: unknown;
    arguments?: unknown;
    clientInfo?: { name?: unknown; version?: unknown };
    _meta?: Record<string, unknown>;
  };
  result?: unknown;
  error?: unknown;
}

export function rpcMessages(body: unknown): RpcMessage[] {
  return (Array.isArray(body) ? body : [body]).filter((m): m is RpcMessage => typeof m === 'object' && m !== null);
}

/**
 * The server keeps no sessions, so the session id itself carries who a 2025-era client said it is in
 * `initialize`: `studio.<base64url of [name, version]>.<random>`. Clients send it back on every later request.
 */
export function encodeAgentSession(agent: Pick<McpAgent, 'name' | 'version'>): string {
  const who = Buffer.from(JSON.stringify([agent.name.slice(0, MAX_NAME), agent.version?.slice(0, MAX_NAME) ?? null])).toString('base64url');
  return `${SESSION_PREFIX}.${who}.${randomUUID().replace(/-/g, '')}`;
}

export function decodeAgentSession(sessionId: string): Pick<McpAgent, 'name' | 'version'> | null {
  const [prefix, who] = sessionId.split('.');
  if (prefix !== SESSION_PREFIX || !who) return null;
  try {
    const [name, version] = JSON.parse(Buffer.from(who, 'base64url').toString('utf8')) as unknown[];
    if (typeof name !== 'string' || !name) return null;
    return { name: name.slice(0, MAX_NAME), version: typeof version === 'string' ? version.slice(0, MAX_NAME) : null };
  } catch {
    return null;
  }
}

/** The first product of a User-Agent, e.g. `claude-code/2.1.0 (cli)` gives claude-code 2.1.0. */
export function agentFromUserAgent(userAgent: string | undefined): McpAgent {
  const [, name, version] = /^\s*([^\s/()]+)(?:\/(\S+))?/.exec(userAgent ?? '') ?? [];
  return { name: name?.slice(0, MAX_NAME) ?? 'unknown', version: version?.slice(0, MAX_NAME) ?? null, userAgent: userAgent?.trim() || null };
}

function infoAgent(info: unknown, userAgent: string | null): McpAgent | null {
  if (typeof info !== 'object' || info === null) return null;
  const { name, version } = info as { name?: unknown; version?: unknown };
  if (typeof name !== 'string' || !name.trim()) return null;
  return { name: name.trim().slice(0, MAX_NAME), version: typeof version === 'string' ? version.slice(0, MAX_NAME) : null, userAgent };
}

/**
 * Who is calling, in order: the per-request client info of a 2026 client, the client info of a 2025
 * `initialize` (which also gets a session id to hand back), the session id a 2025 client sends back,
 * else the User-Agent.
 */
export function identifyAgent(headers: IncomingHttpHeaders, messages: RpcMessage[]): { agent: McpAgent; sessionId: string | null } {
  const fallback = agentFromUserAgent(headers['user-agent']);
  for (const message of messages) {
    const modern = infoAgent(message.params?._meta?.[CLIENT_INFO_META_KEY], fallback.userAgent);
    if (modern) return { agent: modern, sessionId: null };
  }
  const init = messages.find((m) => m.method === 'initialize');
  const legacy = infoAgent(init?.params?.clientInfo, fallback.userAgent);
  if (legacy) return { agent: legacy, sessionId: encodeAgentSession(legacy) };
  const header = headers[SESSION_HEADER];
  const known = decodeAgentSession((Array.isArray(header) ? header[0] : header) ?? '');
  return { agent: known ? { ...known, userAgent: fallback.userAgent } : fallback, sessionId: null };
}

/** The label transactions and the call log use for an agent, e.g. `claude-code 2.1.0`. */
export function agentLabel(agent: Pick<McpAgent, 'name' | 'version'>): string {
  return agent.version ? `${agent.name} ${agent.version}` : agent.name;
}
