import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpCallEntry } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

/** The MCP server over real HTTP, with the SDK's own client in both protocol eras. */
export async function smokeMcp(smoke: Smoke): Promise<void> {
  smoke.section('mcp');
  const status = await smoke.run<{ running: boolean; port: number; url: string }>('mcp.status');
  smoke.check('the MCP server listens on the private port', status.running && status.url.endsWith(`:${status.port}/mcp`), status);
  const base = `http://127.0.0.1:${status.port}`;

  const health = await fetch(`${base}/health`);
  smoke.check('GET /health answers 200', health.status === 200 && ((await health.json()) as { ok: boolean }).ok);
  smoke.check('GET /mcp answers 405 (stateless)', (await fetch(status.url)).status === 405);
  const foreign = await fetch(status.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://example.com' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  smoke.check('requests from web pages are refused', foreign.status === 403, foreign.status);

  for (const mode of ['legacy', 'auto'] as const) {
    const era = mode === 'legacy' ? '2025 client' : '2026 client';
    const client = new Client({ name: `smoke-agent-${mode}`, version: '1.0' }, { versionNegotiation: { mode } });
    await client.connect(new StreamableHTTPClientTransport(new URL(status.url)));
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    smoke.check(`${era}: every visible command is a tool`, smoke.host.registry.list().filter((c) => !c.hidden).every((c) => names.has(c.id.replace(/[^A-Za-z0-9_-]/g, '_'))));
    smoke.check(`${era}: hidden commands are not tools`, !names.has('config_update') && !names.has('ai_key_set') && !names.has('ai_key_status'));
    const destroy = tools.find((t) => t.name === 'smoke_destroy');
    smoke.check(`${era}: mutating tools say so`, destroy?.annotations?.destructiveHint === true && /Gated/.test(destroy.description ?? ''), destroy);
    const hints = (name: string) => tools.find((t) => t.name === name)?.annotations;
    smoke.check(`${era}: queries are read-only, edits neither read-only nor destructive`, hints('plan_describe')?.readOnlyHint === true && hints('rules_check')?.readOnlyHint === true && hints('plan_wall_add')?.readOnlyHint === false && hints('plan_wall_add')?.destructiveHint === false, [hints('plan_describe'), hints('plan_wall_add')]);

    const before = smoke.events.length;
    const echo = text(await client.callTool({ name: 'smoke_echo', arguments: { text: 'hi' } }));
    smoke.check(`${era}: tool calls run as the MCP caller, attributed to the agent`, echo.text === 'hi' && echo.caller === 'mcp' && echo.agent === `smoke-agent-${mode} 1.0`, echo);
    smoke.check(`${era}: calls are announced for the call log`, smoke.eventsSince(before, 'mcp.call').some((c) => c.tool === 'smoke.echo' && c.agent === `smoke-agent-${mode} 1.0` && c.caller === 'mcp'));

    const blocked = await client.callTool({ name: 'smoke_destroy', arguments: {} });
    smoke.check(`${era}: mutating tools are refused until allowed`, blocked.isError === true && text(blocked).code === 'MUTATION_BLOCKED', text(blocked));
    smoke.check(`${era}: conditional tools let reads through`, text(await client.callTool({ name: 'smoke_maybe', arguments: { write: false } })).wrote === false);
    const write = await client.callTool({ name: 'smoke_maybe', arguments: { write: true } });
    smoke.check(`${era}: conditional tools refuse writes`, text(write).code === 'MUTATION_BLOCKED');
    const noProject = await client.callTool({ name: 'smoke_where', arguments: {} });
    smoke.check(`${era}: project tools without a project fail with NO_PROJECT`, text(noProject).code === 'NO_PROJECT', text(noProject));
    await client.close();
  }

  {
    const reader = new Client({ name: 'smoke-reader', version: '1.0' });
    await reader.connect(new StreamableHTTPClientTransport(new URL(status.url)));
    const { resources } = await reader.listResources();
    const uris = resources.map((r) => r.uri).sort();
    smoke.check('the document schema and the design guidelines are resources', uris.join() === 'studio://guidelines,studio://schema/document', uris);
    const schema = JSON.parse(((await reader.readResource({ uri: 'studio://schema/document' })).contents[0] as { text: string }).text) as { properties?: Record<string, unknown> };
    smoke.check('the schema resource describes the document', Boolean(schema.properties?.levelData && schema.properties.connectors));
    const guidelines = ((await reader.readResource({ uri: 'studio://guidelines' })).contents[0] as { text: string }).text;
    smoke.check('the guidelines resource says lengths are millimetres', guidelines.includes('millimetres') && guidelines.includes('plan_apply'));
    const { prompts } = await reader.listPrompts();
    const prompt = await reader.getPrompt({ name: 'design-house', arguments: { storeys: '3' } });
    smoke.check('the design-house prompt asks for a 3-storey house with a central stair', prompts.some((p) => p.name === 'design-house') && /3-storey house .* central stair/.test((prompt.messages[0].content as { text: string }).text));
    smoke.check('and the furnish-room prompt is offered', prompts.some((p) => p.name === 'furnish-room'));
    const instructions = reader.getInstructions() ?? '';
    smoke.check('the server instructions point to the guidelines resource and every prompt', instructions.includes('studio://guidelines') && prompts.every((p) => instructions.includes(p.name)), instructions);
    await reader.close();
  }

  await smoke.run('config.update', { patch: { mcp: { allowMutations: true } } });
  const client = new Client({ name: 'smoke-agent', version: '2.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.url)));
  smoke.check('mutating tools run once the user allows them', text(await client.callTool({ name: 'smoke_destroy', arguments: {} })).destroyed === true);
  await client.close();
  await smoke.run('config.update', { patch: { mcp: { allowMutations: false } } });

  // An `assistant` token nobody issued is just another MCP client.
  const impostor = new Client({ name: 'smoke-impostor', version: '1.0' });
  await impostor.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?assistant=bogus-token`)));
  const asImpostor = text(await impostor.callTool({ name: 'smoke_echo', arguments: { text: 'hi' } }));
  smoke.check('an unknown assistant token stays an ordinary MCP caller', asImpostor.caller === 'mcp' && asImpostor.agent === 'smoke-impostor 1.0', asImpostor);
  smoke.check('and its mutating calls are still gated by Settings', text(await impostor.callTool({ name: 'smoke_destroy', arguments: {} })).code === 'MUTATION_BLOCKED');
  await impostor.close();

  const calls = await smoke.run<McpCallEntry[]>('mcp.calls');
  smoke.check('the call log keeps the latest calls with their outcome', calls.some((c) => c.tool === 'smoke.destroy' && c.ok) && calls.some((c) => c.error === 'MUTATION_BLOCKED'), calls.length);

  // Moving the server to another port restarts it there.
  const moved = status.port + 1;
  await smoke.run('config.update', { patch: { mcp: { port: moved } } });
  const after = await smoke.run<{ running: boolean; port: number }>('mcp.status');
  const reachable = await fetch(`http://127.0.0.1:${moved}/health`).then((r) => r.ok, () => false);
  smoke.check('changing the port restarts the server there', after.running && after.port === moved && reachable, after);
  const old = await fetch(`${base}/health`).then(() => true, () => false);
  smoke.check('the old port is closed', !old);
  await smoke.run('config.update', { patch: { mcp: { enabled: false } } });
  smoke.check('turning the server off stops it', !(await smoke.run<{ running: boolean }>('mcp.status')).running);
  await smoke.run('config.update', { patch: { mcp: { enabled: true, port: status.port } } });
  smoke.check('turning it back on starts it', (await smoke.run<{ running: boolean }>('mcp.status')).running);
}
