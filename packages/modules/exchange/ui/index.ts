import { inject, untracked } from '@angular/core';
import { AppState, defineModuleUI, type UIAction } from '@studio/ui';
import { ArrowLeftRight } from 'lucide';
import { ExchangeActions } from './exchange-actions';

/**
 * Exports and the DXF import in the UI: the Export dialog and the import dialog, reached from the
 * project tab's toolbar (next to the view switch), the Layers panel's add menu and the palette.
 */
export const exchangeUI = defineModuleUI({
  id: 'exchange',
  title: 'Export and import',
  icon: ArrowLeftRight,
  order: 45,
  availability: 'project',
  tabs: {},
  actions: (): UIAction[] => {
    const app = inject(AppState);
    const exchange = inject(ExchangeActions);
    const project = () => untracked(app.activeProjectId);
    return [
      { id: 'exchange.export', title: 'Export drawing, model or image…', group: 'Projects', keywords: ['pdf', 'svg', 'dxf', 'gltf', 'glb', 'png', 'render', 'print'], run: () => exchange.export(project()!), when: () => project() !== null },
      { id: 'exchange.importDxf', title: 'Import DXF…', group: 'Projects', keywords: ['cad', 'autocad', 'underlay', 'trace'], run: () => exchange.importDxf(project()!), when: () => project() !== null },
    ];
  },
});
