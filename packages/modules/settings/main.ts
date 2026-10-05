import { defineCommand, defineModule } from '@studio/core';
import { z } from 'zod';

/** The secret name the assistant's Claude API key is stored under. */
export const ANTHROPIC_KEY = 'anthropic-api-key';

/**
 * The settings that are not plain config: the assistant's API key. Every command here is hidden, so
 * agents can neither read nor replace the key; the status only ever says whether one is set.
 */
export const settingsModule = defineModule({
  id: 'settings',
  commands: [
    defineCommand({
      id: 'ai.key.status',
      title: 'Assistant API key status',
      description: 'Whether a Claude API key is set, and whether it is stored encrypted or only kept for this session.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => ({ set: ctx.host.secrets.has(ANTHROPIC_KEY), persistent: ctx.host.secrets.persistent }),
    }),
    defineCommand({
      id: 'ai.key.set',
      title: 'Set the assistant API key',
      description: 'Stores the Claude API key, encrypted with the operating system keychain.',
      scope: 'global',
      hidden: true,
      input: z.object({ key: z.string().trim().min(8, 'That does not look like an API key') }),
      handler: async ({ key }, ctx) => {
        await ctx.host.secrets.set(ANTHROPIC_KEY, key);
        ctx.host.emit('secrets.changed', { name: ANTHROPIC_KEY });
        return { set: true, persistent: ctx.host.secrets.persistent };
      },
    }),
    defineCommand({
      id: 'ai.key.clear',
      title: 'Remove the assistant API key',
      description: 'Deletes the stored Claude API key.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => {
        await ctx.host.secrets.delete(ANTHROPIC_KEY);
        ctx.host.emit('secrets.changed', { name: ANTHROPIC_KEY });
        return { set: false, persistent: ctx.host.secrets.persistent };
      },
    }),
  ],
});
