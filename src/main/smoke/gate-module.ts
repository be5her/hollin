import { defineCommand, defineModule, type ModuleMain } from '@studio/core';
import { z } from 'zod';

/**
 * Commands registered only in smoke runs, so the registry's checks and the MCP gates are exercised
 * before real destructive commands exist: a plain one, a mutating one and one that decides per call.
 */
export const smokeModules: ModuleMain[] = [
  defineModule({
    id: 'smoke',
    commands: [
      defineCommand({
        id: 'smoke.echo',
        title: 'Smoke: echo',
        description: 'Returns the text it was given, repeated. Smoke test only.',
        scope: 'global',
        input: z.object({ text: z.string().min(1).describe('Text to return'), times: z.number().int().min(1).max(5).default(1) }),
        handler: async ({ text, times }, ctx) => ({ text: text.repeat(times), caller: ctx.caller, agent: ctx.agent ?? null }),
      }),
      defineCommand({
        id: 'smoke.destroy',
        title: 'Smoke: destroy',
        description: 'Pretends to delete data. Smoke test only.',
        scope: 'global',
        mutating: true,
        input: z.object({}),
        handler: async () => ({ destroyed: true }),
      }),
      defineCommand({
        id: 'smoke.maybe',
        title: 'Smoke: maybe write',
        description: 'Reads, or pretends to write when asked to. Smoke test only.',
        scope: 'global',
        mutating: ({ write }) => write,
        input: z.object({ write: z.boolean() }),
        handler: async ({ write }) => ({ wrote: write }),
      }),
      defineCommand({
        id: 'smoke.where',
        title: 'Smoke: which project',
        description: 'Names the project it runs against. Smoke test only.',
        scope: 'project',
        input: z.object({}),
        handler: async (_input, ctx) => ({ project: ctx.project!.id }),
      }),
    ],
  }),
];
