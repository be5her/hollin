import { inject } from '@angular/core';
import { ProjectPanels, SettingsSections, defineModuleUI, type UIAction } from '@studio/ui';
import { FolderOpen } from 'lucide';
import { LibraryActions } from './library-actions';
import { LibraryHome } from './library-home';
import { LibrarySettings } from './library-settings';
import { ProjectDetailsPanel } from './project-details-panel';
import { ProjectTab } from './project-tab';
import { PROJECT_TAB, ProjectsSync } from './projects-sync';

/** The project library: the Home screen, a tab per open project, and their palette entries. */
export const libraryUI = defineModuleUI({
  id: 'library',
  title: 'library.title',
  icon: FolderOpen,
  order: 0,
  availability: 'always',
  home: LibraryHome,
  tabs: { [PROJECT_TAB]: ProjectTab },
  setup: () => {
    inject(ProjectsSync).start();
    inject(SettingsSections).register({ id: 'library', title: 'library.settings.title', order: 15, component: LibrarySettings });
    inject(ProjectPanels).register({ id: 'details', title: 'library.panel.details', side: 'right', order: 20, component: ProjectDetailsPanel });
  },
  actions: (): UIAction[] => {
    const actions = inject(LibraryActions);
    return [
      { id: 'project.new', title: 'library.action.new', group: 'common.group.projects', shortcut: 'Ctrl+N', keywords: ['create'], run: () => actions.create() },
      { id: 'project.importFile', title: 'library.action.import', group: 'common.group.projects', keywords: ['open file', 'package'], run: () => actions.importProject() },
    ];
  },
});
