import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { PencilRuler } from 'lucide';
import { PlanView } from './plan-view';
import { PropertiesPanel } from './properties-panel';
import { SnapshotResponder } from './snapshot-responder';

/** The 2D editor: the plan of the active level in the centre of the project tab, the Properties panel on the right, and the window's half of `view.snapshot`. */
export const planUI = defineModuleUI({
  id: 'plan',
  title: 'Plan',
  icon: PencilRuler,
  order: 20,
  availability: 'project',
  tabs: {},
  setup: () => {
    const panels = inject(ProjectPanels);
    panels.register({ id: 'plan', title: 'Plan', side: 'center', order: 50, component: PlanView });
    panels.register({ id: 'properties', title: 'Properties', side: 'right', order: 5, component: PropertiesPanel });
    inject(SnapshotResponder).start();
  },
});
