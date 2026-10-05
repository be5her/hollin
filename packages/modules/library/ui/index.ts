import { inject } from '@angular/core';
import { SettingsSections, defineModuleUI, type UIAction } from '@studio/ui';
import { FolderOpen } from 'lucide';
import { LibraryActions } from './library-actions';
import { LibraryHome } from './library-home';
import { LibrarySettings } from './library-settings';
import { ProjectTab } from './project-tab';
import { PROJECT_TAB, ProjectsSync } from './projects-sync';

/** The project library: the Home screen, a tab per open project, and their palette entries. */
export const libraryUI = defineModuleUI({
  id: 'library',
  title: 'Projects',
  icon: FolderOpen,
  order: 0,
  availability: 'always',
  home: LibraryHome,
  tabs: { [PROJECT_TAB]: ProjectTab },
  setup: () => {
    inject(ProjectsSync).start();
    inject(SettingsSections).register({ id: 'library', title: 'Library', order: 15, component: LibrarySettings });
  },
  actions: (): UIAction[] => {
    const actions = inject(LibraryActions);
    return [
      { id: 'project.new', title: 'New project', group: 'Projects', shortcut: 'Ctrl+N', keywords: ['create'], run: () => actions.create() },
      { id: 'project.importFile', title: 'Import project…', group: 'Projects', keywords: ['open file', 'package'], run: () => actions.importProject() },
    ];
  },
});
