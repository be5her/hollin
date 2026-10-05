import type { ModuleUI } from '@studio/ui';
import { libraryUI } from './library/ui';
import { settingsUI } from './settings/ui';

/** The Angular side of every feature module. */
export const uiModules: ModuleUI[] = [libraryUI, settingsUI];
