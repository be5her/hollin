import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { TriangleAlert } from 'lucide';
import { RulesCounts } from './rules-counts';
import { WarningsPanel } from './warnings-panel';

/** The Warnings panel: what the design does against its rules, kept current by main. */
export const rulesUI = defineModuleUI({
  id: 'rules',
  title: 'Warnings',
  icon: TriangleAlert,
  order: 35,
  availability: 'project',
  tabs: {},
  setup: () => {
    const counts = inject(RulesCounts);
    inject(ProjectPanels).register({ id: 'warnings', title: 'Warnings', side: 'right', order: 15, component: WarningsPanel, badge: (projectId) => counts.count(projectId) });
  },
});
