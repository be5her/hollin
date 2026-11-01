import { StudioError, defineCommand, defineModule, type HostApi, type UpdateState } from '@studio/core';
import { z } from 'zod';

const NO_UPDATER: UpdateState = { state: 'unsupported', message: 'this host has no updater' };

const updaterOf = (host: HostApi) => {
  if (!host.updater) throw new StudioError('UNAVAILABLE', 'Updates are not available in this host.');
  return host.updater;
};

/**
 * In-app updates, for the Settings section only. Every command is hidden: an agent must never be
 * able to download or install code, so none of them reaches the palette, MCP or the assistant
 * (`execute` still runs them for the UI and the smoke). Download and install are also mutating. The
 * state is the host's `UpdateState`, announced as `update.changed`.
 */
export const updatesModule = defineModule({
  id: 'updates',
  commands: [
    defineCommand({
      id: 'app.update.status',
      title: 'Update status',
      description: 'Where the in-app update stands: idle, checking, available (with version and notes), up-to-date, downloading (progress), ready, error (message) or unsupported (why).',
      scope: 'global',
      hidden: true,
      readOnly: true,
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.updater?.status() ?? NO_UPDATER,
    }),
    defineCommand({
      id: 'app.update.check',
      title: 'Check for updates',
      description: 'Asks the update feed for a newer version (stable only, or betas too when the beta setting is on) and returns the outcome. Never downloads.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => (ctx.host.updater ? ctx.host.updater.check({ beta: ctx.host.config.get().updates.beta }) : NO_UPDATER),
    }),
    defineCommand({
      id: 'app.update.download',
      title: 'Download the update',
      description: 'Starts downloading the version a check found and returns at once; progress and the end follow as update.changed. CONFLICT when no update was found.',
      scope: 'global',
      hidden: true,
      // It writes an installer outside the library.
      mutating: true,
      input: z.object({}),
      handler: async (_input, ctx) => updaterOf(ctx.host).download(),
    }),
    defineCommand({
      id: 'app.update.install',
      title: 'Restart and install the update',
      description: 'Saves and stops the app the way quitting does, installs the downloaded version and restarts. CONFLICT when no update is ready.',
      scope: 'global',
      hidden: true,
      mutating: true,
      input: z.object({}),
      handler: async (_input, ctx) => {
        await updaterOf(ctx.host).install();
        return ctx.host.updater!.status();
      },
    }),
  ],
});
