import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { PencilRuler } from 'lucide';
import { PlanView } from './plan-view';

/** The 2D editor: the plan of the active level in the centre of the project tab. */
export const planUI = defineModuleUI({
  id: 'plan',
  title: 'Plan',
  icon: PencilRuler,
  order: 20,
  availability: 'project',
  tabs: {},
  setup: () => {
    inject(ProjectPanels).register({ id: 'plan', title: 'Plan', side: 'center', order: 50, component: PlanView });
  },
});
