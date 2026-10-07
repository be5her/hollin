import { defineCommand, defineModule } from '@studio/core';
import { z } from 'zod';

/** The document as a whole: loading it into the renderer, undo and redo, the history, view state. */
export const editModule = defineModule({
  id: 'edit',
  commands: [
    defineCommand({
      id: 'doc.get',
      title: 'Load the document',
      description: "The whole project document with its change number, for the renderer's mirror.",
      scope: 'project',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => {
        const project = ctx.project!;
        const { seq, epoch } = project.history();
        return { projectId: project.id, doc: project.doc, seq, epoch, history: project.history() };
      },
    }),
    defineCommand({
      id: 'edit.undo',
      title: 'Undo',
      description:
        'Undoes the newest change to the project, whoever made it. Pass `ifTop` (a change id from edit_history) to undo only if that change is still the newest, so you never undo the user\'s work by accident.',
      scope: 'project',
      input: z.object({ ifTop: z.string().optional() }),
      handler: async ({ ifTop }, ctx) => ctx.project!.undo(ifTop),
    }),
    defineCommand({
      id: 'edit.redo',
      title: 'Redo',
      description: 'Redoes the change that was undone last.',
      scope: 'project',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.project!.redo(),
    }),
    defineCommand({
      id: 'edit.history',
      title: 'Change history',
      description: 'The changes that can be undone (newest first) and redone, with who made each one: you, the assistant, or an agent by name.',
      scope: 'project',
      input: z.object({}),
      handler: async (_input, ctx) => ctx.project!.history(),
    }),
    defineCommand({
      id: 'project.ui.get',
      title: 'Read view state',
      description: 'Per-machine view state of the project (active level, panels).',
      scope: 'project',
      hidden: true,
      input: z.object({}),
      handler: async (_input, ctx) => ctx.host.projects.uiState(ctx.project!.id),
    }),
    defineCommand({
      id: 'project.ui.set',
      title: 'Save view state',
      description: 'Merges per-machine view state of the project over what is stored, key by key (null removes a key).',
      scope: 'project',
      hidden: true,
      input: z.object({ state: z.record(z.string(), z.unknown()) }),
      handler: async ({ state }, ctx) => {
        await ctx.host.projects.setUiState(ctx.project!.id, state);
        return { saved: true };
      },
    }),
  ],
});
