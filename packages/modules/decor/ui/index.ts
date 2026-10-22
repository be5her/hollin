import { inject } from '@angular/core';
import { ProjectPanels, defineModuleUI } from '@studio/ui';
import { Sofa } from 'lucide';
import { CatalogPanel } from './catalog-panel';
import { CatalogThumbnails } from './catalog-thumbnails';

/** Decor: the Catalog panel (furniture and materials) in the project tab's right column, and the pictures of imported models. */
export const decorUI = defineModuleUI({
  id: 'decor',
  title: 'Decor',
  icon: Sofa,
  order: 40,
  availability: 'project',
  tabs: {},
  setup: () => {
    inject(ProjectPanels).register({ id: 'catalog', title: 'Catalog', side: 'right', order: 8, component: CatalogPanel });
    inject(CatalogThumbnails).start();
  },
});
