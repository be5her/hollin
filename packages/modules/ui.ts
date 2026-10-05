import type { ModuleUI } from '@studio/ui';
import { buildingUI } from './building/ui';
import { editUI } from './edit/ui';
import { libraryUI } from './library/ui';
import { settingsUI } from './settings/ui';

/** The Angular side of every feature module. */
export const uiModules: ModuleUI[] = [libraryUI, buildingUI, editUI, settingsUI];
