import { defineModuleUI } from '@studio/ui';
import { Settings } from 'lucide';
import { SettingsTab } from './settings-tab';

/** Settings live in a tab, opened from the title bar gear, the palette or Ctrl+,. No sidebar panel. */
export const settingsUI = defineModuleUI({
  id: 'settings',
  title: 'Settings',
  icon: Settings,
  order: 1000,
  availability: 'always',
  tabs: { 'settings.main': SettingsTab },
});
