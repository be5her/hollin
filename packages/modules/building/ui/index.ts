import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { Building2 } from 'lucide';
import { LayersPanel } from './layers-panel';
import { LevelsPanel } from './levels-panel';
import { SectionView } from './section-view';

/** The building's levels and layers in the project tab, and a section through it as the main view. */
export const buildingUI = defineModuleUI({
  id: 'building',
  title: 'Building',
  icon: Building2,
  order: 10,
  availability: 'project',
  tabs: {},
  setup: () => {
    const panels = inject(ProjectPanels);
    panels.register({ id: 'levels', title: 'Levels', side: 'left', order: 10, component: LevelsPanel });
    panels.register({ id: 'layers', title: 'Layers', side: 'left', order: 20, component: LayersPanel });
    panels.register({ id: 'section', title: 'Section', side: 'center', order: 100, component: SectionView });
  },
});
