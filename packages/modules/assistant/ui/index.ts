import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { Sparkles } from 'lucide';
import { AssistantPanel } from './assistant-panel';
import { OttoPresence } from './otto-presence';

/** Otto, the assistant: its chat panel in the project tab's right column, and its state on the status bar. */
export const assistantUI = defineModuleUI({
  id: 'assistant',
  title: 'Otto',
  icon: Sparkles,
  order: 30,
  availability: 'project',
  tabs: {},
  setup: () => {
    inject(ProjectPanels).register({ id: 'assistant', title: 'Otto', mark: 'otto', side: 'right', order: 12, component: AssistantPanel });
    inject(OttoPresence);
  },
});
