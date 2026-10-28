import { inject } from '@angular/core';
import { SETTINGS_LATE, SettingsSections, defineModuleUI } from '@studio/ui';
import { Download } from 'lucide';
import { UpdateNotices } from './update-notices';
import { UpdatesSettings } from './updates-settings';

/** In-app updates: the Updates section of Settings (before About) and the toasts that announce a version. No panel, no palette entries. */
export const updatesUI = defineModuleUI({
  id: 'updates',
  title: 'Updates',
  icon: Download,
  order: 1010,
  availability: 'always',
  tabs: {},
  setup: () => {
    inject(UpdateNotices).start();
    inject(SettingsSections).register({ id: 'updates', title: 'Updates', order: SETTINGS_LATE, component: UpdatesSettings });
  },
});
