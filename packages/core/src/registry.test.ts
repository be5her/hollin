import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StudioError, toErrorPayload } from './errors';
import { CommandRegistry, defineCommand, defineModule } from './registry';
import { testHost } from './test-host';
import type { CommandContext, ProjectApi } from './types';

const echo = defineCommand({
  id: 'test.echo',
  title: 'Echo',
  description: 'Returns its input.',
  scope: 'global',
  input: z.object({ text: z.string(), count: z.number().int().min(1).default(1) }),
  handler: async ({ text, count }) => text.repeat(count),
});

const wipe = defineCommand({
  id: 'test.wipe',
  title: 'Wipe',
  description: 'Deletes everything in the project.',
  scope: 'project',
  mutating: true,
  input: z.object({}),
  handler: async (_input, ctx) => `wiped ${ctx.project!.id}`,
});

const query = defineCommand({
  id: 'test.query',
  title: 'Query',
  description: 'Reads, or writes when asked to.',
  scope: 'global',
  mutating: ({ write }) => write,
  input: z.object({ write: z.boolean() }),
  handler: async ({ write }) => (write ? 'wrote' : 'read'),
});

const hidden = defineCommand({
  id: 'test.hidden',
  title: 'Hidden',
  description: 'Plumbing.',
  scope: 'global',
  hidden: true,
  input: z.object({}),
  handler: async () => 'ok',
});

function registry(): CommandRegistry {
  const r = new CommandRegistry();
  r.registerModule(defineModule({ id: 'test', commands: [echo, wipe, query, hidden] }));
  return r;
}

const project = { id: 'prj_1', name: 'House' } as unknown as ProjectApi;

describe('CommandRegistry', () => {
  it('validates input, applies defaults and runs the handler', async () => {
    const ctx: CommandContext = { caller: 'ui', host: testHost() };
    await expect(registry().execute('test.echo', { text: 'ab', count: 2 }, ctx)).resolves.toBe('abab');
    await expect(registry().execute('test.echo', { text: 'ab' }, ctx)).resolves.toBe('ab');
  });

  it('fails an unknown id with UNKNOWN_COMMAND', async () => {
    await expect(registry().execute('nope', {}, { caller: 'ui', host: testHost() })).rejects.toMatchObject({ code: 'UNKNOWN_COMMAND' });
  });

  it('fails a project command without a project with NO_PROJECT, before validating input', async () => {
    await expect(registry().execute('test.wipe', { junk: 1 }, { caller: 'ui', host: testHost() })).rejects.toMatchObject({ code: 'NO_PROJECT' });
  });

  it('writes each validation issue as "path: message"', async () => {
    const err = await registry()
      .execute('test.echo', { text: 1, count: 0 }, { caller: 'ui', host: testHost() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StudioError);
    expect((err as StudioError).code).toBe('INVALID_INPUT');
    expect((err as StudioError).message).toMatch(/text: .+; count: /);
    expect((err as StudioError).details).toEqual([expect.stringMatching(/^text: /), expect.stringMatching(/^count: /)]);
  });

  it('never gates the UI', async () => {
    await expect(registry().execute('test.wipe', {}, { caller: 'ui', host: testHost(), project })).resolves.toBe('wiped prj_1');
  });

  it('refuses mutating commands to MCP callers until the user allows mutations', async () => {
    const blocked = { caller: 'mcp', host: testHost(), project } as const;
    await expect(registry().execute('test.wipe', {}, blocked)).rejects.toMatchObject({ code: 'MUTATION_BLOCKED' });
    const allowed = { caller: 'mcp', host: testHost({ config: { mcp: { allowMutations: true } } }), project } as const;
    await expect(registry().execute('test.wipe', {}, allowed)).resolves.toBe('wiped prj_1');
  });

  it('decides conditional mutations per call, after validation', async () => {
    const ctx = { caller: 'mcp', host: testHost() } as const;
    await expect(registry().execute('test.query', { write: false }, ctx)).resolves.toBe('read');
    await expect(registry().execute('test.query', { write: true }, ctx)).rejects.toMatchObject({ code: 'MUTATION_BLOCKED' });
    await expect(registry().execute('test.query', { write: 'yes' }, ctx)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('asks the user before the assistant runs a mutating command', async () => {
    const asked: string[] = [];
    const yes = testHost({ confirm: (r) => (asked.push(`${r.command.id}:${r.agent}`), true) });
    await expect(registry().execute('test.wipe', {}, { caller: 'assistant', agent: 'claude-opus-5-5', host: yes, project })).resolves.toBe('wiped prj_1');
    expect(asked).toEqual(['test.wipe:claude-opus-5-5']);
    const no = testHost({ confirm: () => false });
    await expect(registry().execute('test.wipe', {}, { caller: 'assistant', host: no, project })).rejects.toMatchObject({ code: 'MUTATION_DECLINED' });
    await expect(registry().execute('test.wipe', {}, { caller: 'assistant', host: testHost(), project })).rejects.toMatchObject({ code: 'MUTATION_BLOCKED' });
  });

  it('lists metadata for the palette and MCP', () => {
    const list = registry().list();
    expect(list.map((c) => c.id)).toEqual(['test.echo', 'test.wipe', 'test.query', 'test.hidden']);
    expect(list.find((c) => c.id === 'test.echo')).toMatchObject({ module: 'test', mutating: false, conditional: false, hidden: false, noInput: false });
    expect(list.find((c) => c.id === 'test.wipe')).toMatchObject({ scope: 'project', mutating: true, conditional: false, noInput: true });
    expect(list.find((c) => c.id === 'test.query')).toMatchObject({ mutating: true, conditional: true });
    expect(list.find((c) => c.id === 'test.hidden')).toMatchObject({ hidden: true });
  });

  it('rejects duplicate commands and modules', () => {
    const r = registry();
    expect(() => r.register('other', echo)).toThrow(/twice/);
    expect(() => r.registerModule({ id: 'test', commands: [] })).toThrow(/twice/);
  });
});

describe('toErrorPayload', () => {
  it('serialises StudioError, rebuilt payloads and anything else', () => {
    expect(toErrorPayload(new StudioError('NOT_FOUND', 'gone'))).toEqual({ code: 'NOT_FOUND', message: 'gone' });
    expect(toErrorPayload({ code: 'CONFLICT', message: 'changed', details: { id: 1 } })).toEqual({ code: 'CONFLICT', message: 'changed', details: { id: 1 } });
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(toErrorPayload(enoent)).toEqual({ code: 'INTERNAL', message: 'no such file' });
    expect(toErrorPayload('boom')).toEqual({ code: 'INTERNAL', message: 'boom' });
  });
});
