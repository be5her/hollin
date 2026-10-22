import { defineModuleUI } from '@studio/ui';
import { Sofa } from 'lucide';

/** Decor: the furniture catalog, items, lights and materials. */
export const decorUI = defineModuleUI({
  id: 'decor',
  title: 'Decor',
  icon: Sofa,
  order: 40,
  availability: 'project',
  tabs: {},
});
