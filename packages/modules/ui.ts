import type { ModuleUI } from '@studio/ui';
import { assistantUI } from './assistant/ui';
import { buildingUI } from './building/ui';
import { decorUI } from './decor/ui';
import { editUI } from './edit/ui';
import { exchangeUI } from './exchange/ui';
import { libraryUI } from './library/ui';
import { planUI } from './plan/ui';
import { rulesUI } from './rules/ui';
import { settingsUI } from './settings/ui';

/** The Angular side of every feature module. */
export const uiModules: ModuleUI[] = [libraryUI, buildingUI, planUI, decorUI, exchangeUI, editUI, rulesUI, settingsUI, assistantUI];
