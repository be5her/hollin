import { BRANDING, ConfigPatchSchema, StudioError, defineCommand, type ConfigPatch } from '@studio/core';
import { z } from 'zod';
import type { Host } from './host';

/** Commands the host itself owns: app info, config and the MCP server. */
export function hostCommands(host: Host) {
  return [
    defineCommand({
      id: 'app.info',
      title: 'App info',
      description: `Name, version and platform of ${BRANDING.productName}, and the state of its MCP server.`,
      scope: 'global',
      input: z.object({}),
      handler: async () => ({
        productName: BRANDING.productName,
        version: host.opts.version,
        platform: host.opts.platform,
        runtime: host.opts.runtime ?? {},
        dataDir: host.opts.userDataDir,
        secretsPersistent: host.secrets.persistent,
        mcp: host.mcpStatus(),
      }),
    }),
    defineCommand({
      id: 'config.get',
      title: 'Read settings',
      description: 'Returns the app settings: appearance, display units and precision, MCP server, assistant model. Secrets are never included.',
      scope: 'global',
      input: z.object({}),
      handler: async () => host.config.get(),
    }),
    // Hidden: an agent must never be able to allow its own mutations or move the MCP server.
    defineCommand({
      id: 'config.update',
      title: 'Change settings',
      description: 'Merges a patch into the app settings, section by section.',
      scope: 'global',
      hidden: true,
      input: z.object({ patch: ConfigPatchSchema }),
      handler: async ({ patch }) => {
        const before = host.config.get().mcp;
        const next = await host.config.update(patch as ConfigPatch);
        if (next.mcp.enabled !== before.enabled || next.mcp.port !== before.port) {
          if (next.mcp.enabled) await host.startMcp();
          else await host.stopMcp();
        }
        return next;
      },
    }),
    defineCommand({
      id: 'command.schema',
      title: 'Command input schema',
      description: 'The JSON Schema of a command input, for the palette form.',
      scope: 'global',
      hidden: true,
      input: z.object({ id: z.string() }),
      handler: async ({ id }) => {
        const entry = host.registry.get(id);
        if (!entry) throw new StudioError('NOT_FOUND', `Unknown command "${id}"`);
        return z.toJSONSchema(entry.command.input, { io: 'input', unrepresentable: 'any' });
      },
    }),
    defineCommand({
      id: 'mcp.status',
      title: 'MCP server status',
      description: 'Whether the MCP server is running, and its URL.',
      scope: 'global',
      input: z.object({}),
      handler: async () => host.mcpStatus(),
    }),
    defineCommand({
      id: 'mcp.restart',
      title: 'Restart the MCP server',
      description: 'Restarts the MCP server, e.g. after its port was freed.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async () => {
        if (!host.config.get().mcp.enabled) throw new StudioError('CONFLICT', 'The MCP server is turned off in Settings.');
        await host.startMcp();
        return host.mcpStatus();
      },
    }),
    defineCommand({
      id: 'mcp.calls',
      title: 'Recent MCP calls',
      description: 'The latest calls agents made to the MCP server, oldest first.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async () => host.mcpCalls(),
    }),
    defineCommand({
      id: 'window.titleBarColors',
      title: 'Recolour the window controls',
      description: 'Matches the native window buttons to the theme.',
      scope: 'global',
      hidden: true,
      input: z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/i), symbolColor: z.string().regex(/^#[0-9a-f]{6}$/i) }),
      handler: async (colors) => {
        host.opts.setTitleBarColors?.(colors);
        return { applied: Boolean(host.opts.setTitleBarColors) };
      },
    }),
  ];
}
