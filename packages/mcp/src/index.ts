import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { DESIGN_GUIDELINES, ProjectDocSchema, StudioError, isImageResult, splitImageResult, toErrorPayload, toolNameFor, type AssistantCaller, type CommandMeta, type CommandRegistry, type HostApi, type McpCallEntry, type ProjectApi } from '@studio/core';
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
  /**
   * Recognises a Claude Code process the in-app assistant spawned, by the `assistant` URL parameter
   * (a per-process token). Its calls run as `caller: 'assistant'` under the returned agent name,
   * inside `run` (so the chat's confirmation finds them) and against the returned project; the
   * Settings > MCP mutation switch is not consulted. Unknown tokens stay ordinary MCP callers.
   */
  identifyAssistant?(token: string): AssistantCaller | undefined;
}

export interface RunningMcpServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export { toolNameFor };

/** The document's JSON Schema, served as a resource so agents can read what a project holds. */
export const DOCUMENT_SCHEMA_URI = 'studio://schema/document';
export const GUIDELINES_URI = 'studio://guidelines';
let documentSchema: string | undefined;

/** The tool description: the command's own, plus the project it runs against and whether it is gated (in Settings for MCP agents, in the chat for the assistant's own Claude Code). */
export function toolDescription(meta: CommandMeta, gate: 'settings' | 'chat' = 'settings'): string {
  const refused = gate === 'chat' ? 'the user is asked in the chat first and may decline' : 'it is refused unless the user has allowed it in Settings > MCP';
  return [
    meta.description,
    meta.scope === 'project' ? 'Acts on the project open in the app, or the one named by the `projectId` argument.' : '',
    meta.conditional ? `Read-only calls always work; for calls that delete or overwrite data ${refused}.` : meta.mutating ? `Gated: deletes or overwrites data, so ${refused}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface CallScope {
  agent: McpAgent;
  /** The `project` URL parameter. */
  projectHint: string | null;
  /** Set when the `assistant` URL parameter named a Claude Code process the assistant spawned. */
  assistant: AssistantCaller | null;
}

/**
 * A fresh McpServer for one HTTP request. Every non-hidden command becomes a tool whose input schema
 * is the command's zod schema; project-scope tools also take an optional `projectId`. The document
 * schema and the design guidelines are resources, and `design-house` a prompt to start from.
 */
export function buildMcpServer(opts: McpServerOptions, scope: CallScope): McpServer {
  const server = new McpServer({ name: opts.name, version: opts.version }, opts.instructions ? { instructions: opts.instructions } : undefined);
  const agent = scope.assistant?.agent ?? agentLabel(scope.agent);
  const caller = scope.assistant ? 'assistant' : 'mcp';
  const wrap = scope.assistant ? scope.assistant.run.bind(scope.assistant) : <T>(fn: () => Promise<T>) => fn();

  server.registerResource(
    'document-schema',
    DOCUMENT_SCHEMA_URI,
    { title: 'Document schema', description: 'The JSON Schema of a project document: the building, levels, layers, entities and connectors.', mimeType: 'application/schema+json' },
    async (uri) => {
      documentSchema ??= JSON.stringify(z.toJSONSchema(ProjectDocSchema, { io: 'input', unrepresentable: 'any' }), null, 2);
      return { contents: [{ uri: uri.href, mimeType: 'application/schema+json', text: documentSchema }] };
    },
  );
  server.registerResource(
    'design-guidelines',
    GUIDELINES_URI,
    { title: 'Design guidelines', description: 'How the model is organised (millimetres, derived elevations, rooms from walls, connectors as intent) and how to work on a design well.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DESIGN_GUIDELINES }] }),
  );
  server.registerPrompt(
    'furnish-room',
    {
      title: 'Furnish a room',
      description: 'Furnish, light and finish one room of the project open in the app.',
      argsSchema: z.object({
        room: z.string().optional().describe('The room, by name (default: the largest room on the ground floor)'),
        style: z.string().optional().describe('A style to follow, e.g. "warm Scandinavian" (default: calm and practical)'),
      }),
    },
    async ({ room, style }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Furnish ${room?.trim() ? `the room "${room.trim()}"` : 'the largest room on the ground floor'} of the project open in the app, in a ${style?.trim() || 'calm and practical'} style. Read the design guidelines resource first (its furnishing section), then plan_describe to see the room, its area, doors and windows. Choose furniture for what the room is for with catalog_search and place it in one plan_apply batch with a clear label, every piece inside the room, turned to face it and clear of doors and walkways; add light (a lamp placed withLight, or decor_light_add); give the floor and the walls a finish with decor_material_set. Then check with plan_describe that every piece stands in the room and look at it with view_snapshot (the plan, then view "3d" with display "cutaway" by day and at night). Report what you placed and why.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'design-house',
    {
      title: 'Design a house',
      description: 'Design a house of N storeys around a central stair in the project open in the app.',
      argsSchema: z.object({
        storeys: z.string().optional().describe('How many storeys (default 3)'),
        footprint: z.string().optional().describe('Footprint in metres, e.g. "12 x 9" (default 12 x 9)'),
      }),
    },
    async ({ storeys, footprint }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Design a ${storeys?.trim() || '3'}-storey house with a footprint of about ${footprint?.trim() || '12 x 9'} m around a central stair, in the project open in the app. Read the design guidelines resource first, then plan_describe and building_get to see what is there. Add the levels you need, draw each floor's walls as one plan_apply batch with a clear label (exterior walls 250 mm, interior 120 mm), place a door into every room and windows into every habitable room, name every room, add the stair from the ground floor to the top with building_connector_add, and finish by checking rules_check and view_snapshot of every level. Report the rooms and areas per floor when you are done.`,
          },
        },
      ],
    }),
  );

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
        description: toolDescription(meta, scope.assistant ? 'chat' : 'settings'),
        inputSchema,
        annotations: { title: meta.title, readOnlyHint: !meta.mutating, destructiveHint: meta.mutating, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        const started = performance.now();
        let projectId: string | undefined;
        try {
          const { projectId: chosen, ...rest } = args;
          const input = takesProjectId ? rest : args;
          // The assistant's own Claude Code is bound to its chat's project, whatever it asks for.
          const hint = scope.assistant ? scope.assistant.projectId : (takesProjectId && typeof chosen === 'string' && chosen) || scope.projectHint;
          const project = meta.scope === 'project' ? await opts.resolveProject(hint) : undefined;
          projectId = project?.id;
          const result = await wrap(() => opts.registry.execute(meta.id, input, { caller, agent, host: opts.host, project }));
          opts.onCall?.({ tool: meta.id, agent, caller, projectId, ok: true, durationMs: performance.now() - started, at: new Date().toISOString() });
          if (meta.output === 'image' && isImageResult(result)) {
            const { image, rest } = splitImageResult(result);
            return { content: [{ type: 'image' as const, data: image.data, mimeType: image.mimeType }, { type: 'text' as const, text: JSON.stringify(rest, null, 2) }] };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null, null, 2) }] };
        } catch (err) {
          const payload = toErrorPayload(err);
          if (!(err instanceof StudioError)) console.error(`[mcp] ${meta.id} failed`, err);
          opts.onCall?.({ tool: meta.id, agent, caller, projectId, ok: false, error: payload.code, durationMs: performance.now() - started, at: new Date().toISOString() });
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
    // The token is checked and dropped here: it is never logged or kept on the scope.
    const token = url.searchParams.get('assistant');
    const assistant = (token && opts.identifyAssistant?.(token)) || null;
    const scope: CallScope = { agent, projectHint: url.searchParams.get('project'), assistant };
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
