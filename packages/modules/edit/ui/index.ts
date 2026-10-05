import { inject, untracked } from '@angular/core';
import { AppState, ProjectPanels, defineModuleUI, type UIAction } from '@studio/ui';
import { History } from 'lucide';
import { EditActions } from './edit-actions';
import { HistoryPanel } from './history-panel';

/** Undo, redo and the history of changes. */
export const editUI = defineModuleUI({
  id: 'edit',
  title: 'History',
  icon: History,
  order: 30,
  availability: 'project',
  tabs: {},
  setup: () => {
    inject(ProjectPanels).register({ id: 'history', title: 'History', side: 'right', order: 10, component: HistoryPanel });
  },
  actions: (): UIAction[] => {
    const app = inject(AppState);
    const edit = inject(EditActions);
    const hasProject = () => untracked(app.activeProjectId) !== null;
    return [
      { id: 'edit.undo', title: 'Undo', group: 'Edit', shortcut: 'Ctrl+Z', run: () => edit.undo(), when: hasProject },
      { id: 'edit.redo', title: 'Redo', group: 'Edit', shortcut: 'Ctrl+Shift+Z', run: () => edit.redo(), when: hasProject },
    ];
  },
});
