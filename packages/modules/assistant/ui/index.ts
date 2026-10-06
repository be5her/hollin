import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { Sparkles } from 'lucide';
import { AssistantPanel } from './assistant-panel';

/** The assistant's chat panel in the project tab's right column. */
export const assistantUI = defineModuleUI({
  id: 'assistant',
  title: 'Assistant',
  icon: Sparkles,
  order: 30,
  availability: 'project',
  tabs: {},
  setup: () => {
    inject(ProjectPanels).register({ id: 'assistant', title: 'Assistant', side: 'right', order: 12, component: AssistantPanel });
  },
});
