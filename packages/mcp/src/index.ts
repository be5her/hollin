import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { StudioError, toErrorPayload, type CommandMeta, type CommandRegistry, type HostApi, type McpCallEntry, type ProjectApi } from '@studio/core';
import { z } from 'zod';
import { SESSION_HEADER, agentLabel, identifyAgent, rpcMessages, type McpAgent } from './agent';

export * from './agent';

export const MCP_PATH = '/mcp';
const MAX_BODY = 4 * 1024 * 1024;

export interface McpServerOptions {
  registry: CommandRegistry;
  host: HostApi;
  port: number;
  /** Server name reported to clients. */
  name: string;
  version: string;
  /** Short orientation for agents, sent as the server's instructions. */
  instructions?: string;
  /**
   * The project a call acts on: the one named by the `project` URL parameter or the `projectId`
   * argument, else the one on screen. Throws NOT_FOUND for a project that does not exist.
   */
  resolveProject(hint: string | null): Promise<ProjectApi | undefined>;
  onCall?(entry: McpCallEntry): void;
}

export interface RunningMcpServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export function toolNameFor(commandId: string): string {
  return commandId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** The tool description: the command's own, plus the project it runs against and whether it is gated. */
export function toolDescription(meta: CommandMeta): string {
  return [
    meta.description,
    meta.scope === 'project' ? 'Acts on the project open in the app, or the one named by the `projectId` argument.' : '',
    meta.conditional
      ? 'Read-only calls always work; calls that delete or overwrite data are refused unless the user has allowed it in Settings > MCP.'
      : meta.mutating
        ? 'Gated: deletes or overwrites data, so it is refused unless the user has allowed it in Settings > MCP.'
        : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface CallScope {
  agent: McpAgent;
  /** The `project` URL parameter. */
  projectHint: string | null;
}

/**
 * A fresh McpServer for one HTTP request. Every non-hidden command becomes a tool whose input schema
 * is the command's zod schema; project-scope tools also take an optional `projectId`.
 */
export function buildMcpServer(opts: McpServerOptions, scope: CallScope): McpServer {
  const server = new McpServer({ name: opts.name, version: opts.version }, opts.instructions ? { instructions: opts.instructions } : undefined);
  const agent = agentLabel(scope.agent);

  for (const meta of opts.registry.list()) {
    if (meta.hidden) continue;
    const command = opts.registry.get(meta.id)!.command;
    const takesProjectId = meta.scope === 'project' && !('projectId' in command.input.shape);
    const inputSchema = takesProjectId
      ? command.input.extend({ projectId: z.string().optional().describe('Project to act on. Defaults to the project open in the app.') })
      : command.input;

    server.registerTool(
      toolNameFor(meta.id),
      {
        title: meta.title,
        description: toolDescription(meta),
        inputSchema,
        annotations: { title: meta.title, readOnlyHint: !meta.mutating, destructiveHint: meta.mutating, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        const started = performance.now();
        let projectId: string | undefined;
        try {
          const { projectId: chosen, ...rest } = args;
          const input = takesProjectId ? rest : args;
          const hint = (takesProjectId && typeof chosen === 'string' && chosen) || scope.projectHint;
          const project = meta.scope === 'project' ? await opts.resolveProject(hint) : undefined;
          projectId = project?.id;
          const result = await opts.registry.execute(meta.id, input, { caller: 'mcp', agent, host: opts.host, project });
          opts.onCall?.({ tool: meta.id, agent, projectId, ok: true, durationMs: performance.now() - started, at: new Date().toISOString() });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null, null, 2) }] };
        } catch (err) {
          const payload = toErrorPayload(err);
          if (!(err instanceof StudioError)) console.error(`[mcp] ${meta.id} failed`, err);
          opts.onCall?.({ tool: meta.id, agent, projectId, ok: false, error: payload.code, durationMs: performance.now() - started, at: new Date().toISOString() });
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], isError: true };
        }
      },
    );
  }
  return server;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

/**
 * Streamable HTTP on 127.0.0.1: POST /mcp and GET /health. Stateless: every POST gets a fresh server
 * from `createMcpHandler`, which answers 2026-07-28 clients directly and 2025-era clients through the
 * SDK's stateless fallback. Host and Origin are checked so web pages cannot reach the server.
 */
export async function startMcpServer(opts: McpServerOptions): Promise<RunningMcpServer> {
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port}`);
    if (url.pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Use GET' }, { allow: 'GET, HEAD' });
      return json(res, 200, { ok: true, name: opts.name, version: opts.version });
    }
    if (url.pathname !== MCP_PATH) return json(res, 404, { error: 'Not found' });
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'This MCP server is stateless: send POST requests only.' }, { allow: 'POST' });
    }

    let body: unknown;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      return json(res, status, { jsonrpc: '2.0', id: null, error: { code: -32700, message: status === 413 ? 'Request body too large' : 'Parse error' } });
    }

    const messages = rpcMessages(body);
    const { agent, sessionId } = identifyAgent(req.headers, messages);
    // No session is kept: the id only tells later requests which client this is.
    if (sessionId) res.setHeader(SESSION_HEADER, sessionId);
    const scope: CallScope = { agent, projectHint: url.searchParams.get('project') };
    // 'auto' answers with plain JSON unless a tool emits progress before its result.
    const handler = createMcpHandler(() => buildMcpServer(opts, scope), { legacy: 'stateless', responseMode: 'auto' });
    res.on('close', () => void handler.close());
    await toNodeHandler(handler)(req, res, body);
  };

  const httpServer: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[mcp] request failed', err);
      if (!res.headersSent) json(res, 500, { error: toErrorPayload(err) });
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return {
    port: opts.port,
    url: `http://127.0.0.1:${opts.port}${MCP_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  };
}
