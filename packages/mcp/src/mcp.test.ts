import { createServer } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CommandRegistry, StudioError, defineCommand, testHost, type McpCallEntry, type ProjectApi } from '@studio/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agentFromUserAgent, decodeAgentSession, encodeAgentSession, identifyAgent } from './agent';
import { startMcpServer, toolDescription, toolNameFor, type RunningMcpServer } from './index';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const projects: Record<string, ProjectApi> = { prj_a: { id: 'prj_a', name: 'House A' }, prj_b: { id: 'prj_b', name: 'House B' } };

function registry(): CommandRegistry {
  const r = new CommandRegistry();
  r.registerModule({
    id: 'test',
    commands: [
      defineCommand({ id: 'test.add', title: 'Add', description: 'Adds two numbers.', scope: 'global', input: z.object({ a: z.number(), b: z.number() }), handler: async ({ a, b }) => ({ sum: a + b }) }),
      defineCommand({
        id: 'test.where',
        title: 'Where',
        description: 'Names the project and the agent.',
        scope: 'project',
        input: z.object({}),
        handler: async (_input, ctx) => ({ project: ctx.project!.id, agent: ctx.agent, caller: ctx.caller }),
      }),
      defineCommand({ id: 'test.wipe', title: 'Wipe', description: 'Deletes data.', scope: 'global', mutating: true, input: z.object({}), handler: async () => 'wiped' }),
      defineCommand({ id: 'test.hidden', title: 'Hidden', description: 'Plumbing.', scope: 'global', hidden: true, input: z.object({}), handler: async () => 'ok' }),
      defineCommand({
        id: 'test.fail',
        title: 'Fail',
        description: 'Always fails.',
        scope: 'global',
        input: z.object({}),
        handler: async () => {
          throw new StudioError('NOT_FOUND', 'nothing here');
        },
      }),
    ],
  });
  return r;
}

const text = (result: unknown) => JSON.parse(((result as { content: { text: string }[] }).content)[0].text);

describe('MCP server over HTTP', () => {
  let running: RunningMcpServer | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  async function start(config: Parameters<typeof testHost>[0] = {}) {
    const calls: McpCallEntry[] = [];
    const port = await freePort();
    running = await startMcpServer({
      registry: registry(),
      host: testHost(config),
      port,
      name: 'studio-test',
      version: '1.0.0',
      resolveProject: async (hint) => {
        if (!hint) return projects.prj_a;
        if (!projects[hint]) throw new StudioError('NOT_FOUND', `No project ${hint}`);
        return projects[hint];
      },
      onCall: (entry) => calls.push(entry),
    });
    return { url: running.url, port, calls };
  }

  for (const mode of ['legacy', 'auto'] as const) {
    it(`serves a ${mode === 'legacy' ? '2025' : '2026'} client: tools, results, errors, attribution`, async () => {
      const { url, calls } = await start();
      const client = new Client({ name: 'test-agent', version: '1.2.3' }, { versionNegotiation: { mode } });
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['test_add', 'test_fail', 'test_where', 'test_wipe']);
      const wipe = tools.find((t) => t.name === 'test_wipe')!;
      expect(wipe.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(wipe.description).toContain('Gated');
      expect(tools.find((t) => t.name === 'test_add')!.annotations).toMatchObject({ readOnlyHint: true });
      expect(Object.keys((tools.find((t) => t.name === 'test_where')!.inputSchema as { properties: object }).properties)).toContain('projectId');

      expect(text(await client.callTool({ name: 'test_add', arguments: { a: 2, b: 3 } }))).toEqual({ sum: 5 });
      expect(text(await client.callTool({ name: 'test_where', arguments: {} }))).toEqual({ project: 'prj_a', agent: 'test-agent 1.2.3', caller: 'mcp' });
      expect(text(await client.callTool({ name: 'test_where', arguments: { projectId: 'prj_b' } }))).toMatchObject({ project: 'prj_b' });

      const missing = await client.callTool({ name: 'test_where', arguments: { projectId: 'prj_x' } });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toMatchObject({ code: 'NOT_FOUND' });

      const failed = await client.callTool({ name: 'test_fail', arguments: {} });
      expect(failed.isError).toBe(true);
      expect(text(failed)).toEqual({ code: 'NOT_FOUND', message: 'nothing here' });

      const blocked = await client.callTool({ name: 'test_wipe', arguments: {} });
      expect(text(blocked)).toMatchObject({ code: 'MUTATION_BLOCKED' });

      expect(calls.map((c) => [c.tool, c.ok, c.agent])).toEqual([
        ['test.add', true, 'test-agent 1.2.3'],
        ['test.where', true, 'test-agent 1.2.3'],
        ['test.where', true, 'test-agent 1.2.3'],
        ['test.where', false, 'test-agent 1.2.3'],
        ['test.fail', false, 'test-agent 1.2.3'],
        ['test.wipe', false, 'test-agent 1.2.3'],
      ]);
      expect(calls[3].error).toBe('NOT_FOUND');
      await client.close();
    });
  }

  it('lets mutations through once the user allows them, and binds a project from the URL', async () => {
    const { url } = await start({ config: { mcp: { allowMutations: true } } });
    const client = new Client({ name: 'test-agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}?project=prj_b`)));
    expect(text(await client.callTool({ name: 'test_wipe', arguments: {} }))).toBe('wiped');
    expect(text(await client.callTool({ name: 'test_where', arguments: {} }))).toMatchObject({ project: 'prj_b' });
    await client.close();
  });

  it('answers health checks, refuses other methods and foreign origins', async () => {
    const { url, port } = await start();
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, name: 'studio-test', version: '1.0.0' });
    expect((await fetch(url)).status).toBe(405);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
    const foreign = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(foreign.status).toBe(403);
  });

  it('names a client that skips the handshake after its User-Agent', async () => {
    const { url, calls } = await start();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'curl-agent/8.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'test_add', arguments: { a: 1, b: 1 } } }),
    });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ tool: 'test.add', ok: true, agent: 'curl-agent 8.0' });
  });
});

describe('agent identity', () => {
  it('round-trips the session id and falls back to the User-Agent', () => {
    const id = encodeAgentSession({ name: 'claude-code', version: '2.1.0' });
    expect(decodeAgentSession(id)).toEqual({ name: 'claude-code', version: '2.1.0' });
    expect(decodeAgentSession('other.abc')).toBeNull();
    expect(agentFromUserAgent('claude-code/2.1.0 (cli)')).toMatchObject({ name: 'claude-code', version: '2.1.0' });
    expect(agentFromUserAgent(undefined).name).toBe('unknown');
  });

  it('prefers per-request client info, then initialize, then the session header', () => {
    const meta = { _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'modern', version: '9' } } };
    expect(identifyAgent({}, [{ method: 'tools/call', params: meta }])).toMatchObject({ agent: { name: 'modern', version: '9' }, sessionId: null });
    const init = identifyAgent({}, [{ method: 'initialize', params: { clientInfo: { name: 'legacy', version: '1' } } }]);
    expect(init.agent.name).toBe('legacy');
    expect(identifyAgent({ 'mcp-session-id': init.sessionId! }, [{ method: 'tools/list' }]).agent.name).toBe('legacy');
  });

  it('names tools and describes gating', () => {
    expect(toolNameFor('plan.wall.add')).toBe('plan_wall_add');
    const base = { id: 'x', module: 'm', title: 'X', description: 'Does x.', scope: 'global', hidden: false, noInput: true } as const;
    expect(toolDescription({ ...base, mutating: false, conditional: false })).toBe('Does x.');
    expect(toolDescription({ ...base, mutating: true, conditional: true })).toMatch(/Read-only calls always work/);
  });
});
