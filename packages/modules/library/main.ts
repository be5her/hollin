import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { BRANDING, StudioError, authorOf, defineCommand, defineModule, type CommandContext } from '@studio/core';
import { syncedFolderWarning } from '@studio/core/node';
import { z } from 'zod';

const projectId = z.string().describe('Project id, from project_list');
const name = z.string().trim().min(1, 'A project needs a name').max(200);
const tags = z.array(z.string().trim().min(1).max(40)).max(30);
/** A relative path would resolve against the app's working folder, which no caller can see. */
const fullPath = z.string().min(1).refine((p) => nodePath.isAbsolute(p), 'path must be a full (absolute) path');

function currentId(ctx: CommandContext, id?: string): string {
  const target = id ?? ctx.host.projects.current()?.id;
  if (!target) throw new StudioError('NO_PROJECT', 'No project is open. Name one with `id`, or open one first.');
  return target;
}

/**
 * The project library: listing and searching, creating, opening and closing, renaming, duplicating,
 * the trash, snapshots and single-file packages. Storage lives in @studio/core/node (Library and
 * ProjectService); these commands are the only way in.
 */
export const libraryModule = defineModule({
  id: 'library',
  commands: [
    defineCommand({
      id: 'library.info',
      title: 'Library location',
      description: 'Where the project library is, how many projects and trashed projects it holds, and any warning about it.',
      scope: 'global',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.info(),
    }),
    defineCommand({
      id: 'project.list',
      title: 'List projects',
      description: 'Lists projects in the library, most recently changed first. Filter by text (name, description, tags) or tags; set trashed to list the trash.',
      scope: 'global',
      input: z.object({
        query: z.string().optional().describe('Text to search for'),
        tags: z.array(z.string()).optional().describe('Every listed tag must be present'),
        sort: z.enum(['recent', 'name', 'created', 'opened']).optional(),
        trashed: z.boolean().optional().describe('List the trash instead'),
      }),
      handler: async (query, ctx) => ctx.host.projects.list(query),
    }),
    defineCommand({
      id: 'project.tags',
      title: 'List project tags',
      description: 'Every tag used by a project in the library, with how many projects carry it.',
      scope: 'global',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.tags(),
    }),
    defineCommand({
      id: 'project.current',
      title: 'Current project',
      description: 'The project on screen (the one project tools act on by default), or null.',
      scope: 'global',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.current(),
    }),
    defineCommand({
      id: 'project.create',
      title: 'New project',
      description: 'Creates a project with one ground floor and opens it. Returns the new project.',
      scope: 'global',
      input: z.object({ name, description: z.string().max(4000).optional(), tags: tags.optional(), open: z.boolean().default(true).describe('Open it in a tab') }),
      handler: async ({ open, ...input }, ctx) => {
        const created = await ctx.host.projects.create(input);
        return open ? ctx.host.projects.open(created.id) : created;
      },
    }),
    defineCommand({
      id: 'project.open',
      title: 'Open project',
      description: 'Opens a project in a tab and puts it on screen, so later project tools act on it.',
      scope: 'global',
      input: z.object({ id: projectId }),
      handler: async ({ id }, ctx) => ctx.host.projects.open(id),
    }),
    defineCommand({
      id: 'project.close',
      title: 'Close project',
      description: 'Saves and closes a project (the one on screen unless `id` is given).',
      scope: 'global',
      input: z.object({ id: projectId.optional() }),
      handler: async ({ id }, ctx) => {
        const target = currentId(ctx, id);
        await ctx.host.projects.close(target);
        return { closed: target };
      },
    }),
    defineCommand({
      id: 'project.update',
      title: 'Rename project',
      description: 'Changes the name, description or tags of a project.',
      scope: 'global',
      input: z.object({ id: projectId, name: name.optional(), description: z.string().max(4000).optional(), tags: tags.optional() }),
      handler: async ({ id, ...patch }, ctx) => ctx.host.projects.update(id, patch),
    }),
    defineCommand({
      id: 'project.duplicate',
      title: 'Duplicate project',
      description: 'Copies a project (its current design, assets and thumbnail; not its snapshots) under a new id.',
      scope: 'global',
      input: z.object({ id: projectId, name: name.optional() }),
      handler: async ({ id, name: copyName }, ctx) => ctx.host.projects.duplicate(id, copyName),
    }),
    defineCommand({
      id: 'project.trash',
      title: 'Move project to trash',
      description: 'Closes a project and moves it to the trash, where it can be restored.',
      scope: 'global',
      input: z.object({ id: projectId }),
      handler: async ({ id }, ctx) => ctx.host.projects.trash(id),
    }),
    defineCommand({
      id: 'project.restore',
      title: 'Restore project from trash',
      description: 'Moves a trashed project back into the library.',
      scope: 'global',
      input: z.object({ id: projectId }),
      handler: async ({ id }, ctx) => ctx.host.projects.restore(id),
    }),
    defineCommand({
      id: 'project.delete',
      title: 'Delete project permanently',
      description: 'Deletes a trashed project for good. It cannot be restored.',
      scope: 'global',
      mutating: true,
      input: z.object({ id: projectId }),
      handler: async ({ id }, ctx) => {
        await ctx.host.projects.deleteForever(id);
        return { deleted: id };
      },
    }),
    defineCommand({
      id: 'library.trash.empty',
      title: 'Empty trash',
      description: 'Deletes every trashed project for good.',
      scope: 'global',
      mutating: true,
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.emptyTrash(),
    }),
    defineCommand({
      id: 'project.export',
      title: 'Export project',
      description: `Writes a project to a single .${BRANDING.packageExtension} package file at \`path\` (a full file path). Writes outside the library, so it is gated.`,
      scope: 'global',
      mutating: true,
      input: z.object({ id: projectId, path: fullPath, includeSnapshots: z.boolean().default(false) }),
      handler: async ({ id, path, includeSnapshots }, ctx) => ctx.host.projects.exportProject(id, path, { includeSnapshots }),
    }),
    defineCommand({
      id: 'project.import',
      title: 'Import project',
      description: `Adds the project in a .${BRANDING.packageExtension} package file at \`path\` (a full file path) to the library. Returns the new project; it keeps its id unless the library already has it.`,
      scope: 'global',
      input: z.object({ path: fullPath, open: z.boolean().default(true) }),
      handler: async ({ path, open }, ctx) => {
        const imported = await ctx.host.projects.importProject(path);
        return open ? ctx.host.projects.open(imported.id) : imported;
      },
    }),
    defineCommand({
      id: 'library.move',
      title: 'Move library',
      description: 'Moves the whole project library to the folder at `path` (a full path; mode "move", the folder must be empty), or switches to a library already there (mode "adopt").',
      scope: 'global',
      mutating: true,
      input: z.object({ path: fullPath, mode: z.enum(['move', 'adopt']).default('move') }),
      handler: async ({ path, mode }, ctx) => ctx.host.projects.moveLibrary(path, mode),
    }),
    defineCommand({
      id: 'library.checkFolder',
      title: 'Check a folder for the library',
      description: 'Whether a folder is empty, already holds a library, or is cloud-synced.',
      scope: 'global',
      hidden: true,
      input: z.object({ path: z.string().min(1) }),
      handler: async ({ path }) => {
        const entries = await fs.readdir(path).catch(() => null);
        const hasLibrary = Boolean(await fs.stat(nodePath.join(path, 'library.json')).catch(() => null));
        return { exists: entries !== null, empty: !entries || entries.length === 0, hasLibrary, warning: syncedFolderWarning(path) };
      },
    }),
    defineCommand({
      id: 'library.reindex',
      title: 'Rebuild library index',
      description: 'Rebuilds the project list from the folders on disk.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.reindex(),
    }),
    defineCommand({
      id: 'project.openList',
      title: 'Open projects',
      description: 'The open projects in tab order, with their save state.',
      scope: 'global',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => ({ projects: ctx.host.projects.openProjects(), current: ctx.host.projects.current()?.id ?? null }),
    }),
    defineCommand({
      id: 'project.focus',
      title: 'Show project',
      description: 'Tells the host which project is on screen; agents act on it by default.',
      scope: 'global',
      hidden: true,
      input: z.object({ id: z.string().nullable() }),
      handler: async ({ id }, ctx) => {
        await ctx.host.projects.focus(id);
        return { id };
      },
    }),
    defineCommand({
      id: 'project.thumbnail.set',
      title: 'Set project thumbnail',
      description: 'Stores a PNG thumbnail for a project.',
      scope: 'global',
      hidden: true,
      input: z.object({ id: projectId, png: z.string().min(1).describe('PNG image, base64') }),
      handler: async ({ id, png }, ctx) => ctx.host.projects.setThumbnail(id, new Uint8Array(Buffer.from(png, 'base64'))),
    }),

    // ---------- the project on screen ----------
    defineCommand({
      id: 'project.save',
      title: 'Save project now',
      description: 'Writes pending changes of the project at once (projects also save themselves within seconds).',
      scope: 'project',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.save(ctx.project!.id),
    }),
    defineCommand({
      id: 'project.snapshot.list',
      title: 'List snapshots',
      description: 'The saved versions of the project, newest first: named ones and automatic ones (taken before restores and upgrades).',
      scope: 'project',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.snapshots(ctx.project!.id),
    }),
    defineCommand({
      id: 'project.snapshot.create',
      title: 'Save a snapshot',
      description: 'Saves the current design as a named version that can be restored later.',
      scope: 'project',
      input: z.object({ name: z.string().trim().min(1).max(120) }),
      handler: async ({ name: snapshotName }, ctx) => ctx.host.projects.createSnapshot(ctx.project!.id, snapshotName, authorOf(ctx)),
    }),
    defineCommand({
      id: 'project.snapshot.restore',
      title: 'Restore a snapshot',
      description: 'Brings back the design of a snapshot. The current design is kept as an automatic snapshot first, so this can be reversed.',
      scope: 'project',
      input: z.object({ snapshotId: z.string() }),
      handler: async ({ snapshotId }, ctx) => ctx.host.projects.restoreSnapshot(ctx.project!.id, snapshotId, authorOf(ctx)),
    }),
    defineCommand({
      id: 'project.snapshot.delete',
      title: 'Delete a snapshot',
      description: 'Deletes a snapshot for good.',
      scope: 'project',
      mutating: true,
      input: z.object({ snapshotId: z.string() }),
      handler: async ({ snapshotId }, ctx) => {
        await ctx.host.projects.deleteSnapshot(ctx.project!.id, snapshotId);
        return { deleted: snapshotId };
      },
    }),
  ],
});
