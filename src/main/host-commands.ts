import nodePath from 'node:path';
import { BRANDING, ConfigPatchSchema, StudioError, defineCommand, toolInputSchema, type ConfigPatch } from '@studio/core';
import { z } from 'zod';
import type { Host } from './host';

/** Commands the host itself owns: app info, config and the MCP server. */
export function hostCommands(host: Host) {
  return [
    defineCommand({
      id: 'app.info',
      title: 'App info',
      description: `Name, version and platform of ${BRANDING.productName}, the state of its MCP server, and whether this build can update itself (updates).`,
      scope: 'global',
      readOnly: true,
      input: z.object({}),
      handler: async () => ({
        productName: BRANDING.productName,
        version: host.opts.version,
        platform: host.opts.platform,
        runtime: host.opts.runtime ?? {},
        dataDir: host.opts.userDataDir,
        secretsPersistent: host.secrets.persistent,
        mcp: host.mcpStatus(),
        /** Whether this build can update itself (it has an update feed and can install). */
        updates: Boolean(host.opts.updater) && host.opts.updater!.status().state !== 'unsupported',
      }),
    }),
    defineCommand({
      id: 'config.get',
      title: 'Read settings',
      description: 'Returns the app settings: appearance, display units and precision, MCP server, assistant model. Secrets are never included.',
      scope: 'global',
      readOnly: true,
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
        return toolInputSchema(entry.command.input);
      },
    }),
    defineCommand({
      id: 'mcp.status',
      title: 'MCP server status',
      description: 'Whether the MCP server is running, and its URL.',
      scope: 'global',
      readOnly: true,
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
    // Native dialogs, for the UI only: agents pass paths directly.
    defineCommand({
      id: 'app.pickFile',
      title: 'Pick a file',
      description: 'Opens a native file picker and returns the chosen path, or null.',
      scope: 'global',
      hidden: true,
      input: z.object({ title: z.string().optional(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional(), defaultPath: z.string().optional() }),
      handler: async (options, ctx) => {
        if (ctx.caller !== 'ui' || !host.api.dialogs) throw new StudioError('INVALID_INPUT', 'File pickers are only available in the app window');
        return { path: (await host.api.dialogs.pickFile(options)) ?? null };
      },
    }),
    defineCommand({
      id: 'app.pickSavePath',
      title: 'Pick where to save',
      description: 'Opens a native save dialog and returns the chosen path, or null.',
      scope: 'global',
      hidden: true,
      input: z.object({ title: z.string().optional(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional(), defaultPath: z.string().optional() }),
      handler: async (options, ctx) => {
        if (ctx.caller !== 'ui' || !host.api.dialogs) throw new StudioError('INVALID_INPUT', 'File pickers are only available in the app window');
        return { path: (await host.api.dialogs.pickSavePath(options)) ?? null };
      },
    }),
    defineCommand({
      id: 'app.pickFolder',
      title: 'Pick a folder',
      description: 'Opens a native folder picker and returns the chosen path, or null.',
      scope: 'global',
      hidden: true,
      input: z.object({ title: z.string().optional(), defaultPath: z.string().optional() }),
      handler: async (options, ctx) => {
        if (ctx.caller !== 'ui' || !host.api.dialogs) throw new StudioError('INVALID_INPUT', 'Folder pickers are only available in the app window');
        return { path: (await host.api.dialogs.pickFolder(options)) ?? null };
      },
    }),
    defineCommand({
      id: 'app.revealPath',
      title: 'Show in folder',
      description: "Shows a file in the system's file manager, selected (the Show action of an export's toast).",
      scope: 'global',
      hidden: true,
      input: z.object({ path: z.string().min(1) }),
      handler: async ({ path }, ctx) => {
        if (ctx.caller !== 'ui' || !host.api.dialogs) throw new StudioError('INVALID_INPUT', 'Showing files is only available in the app window');
        if (!nodePath.isAbsolute(path)) throw new StudioError('INVALID_INPUT', 'path must be a full (absolute) file path.');
        host.api.dialogs.reveal(path);
        return { path };
      },
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
