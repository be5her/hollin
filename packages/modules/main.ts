import type { ModuleMain } from '@studio/core';
import { assistantModule } from './assistant/main';
import { buildingModule } from './building/main';
import { decorModule } from './decor/main';
import { editModule } from './edit/main';
import { exchangeModule } from './exchange/main';
import { libraryModule } from './library/main';
import { planModule } from './plan/main';
import { rulesModule } from './rules/main';
import { settingsModule } from './settings/main';

/** The Node side of every feature module, in registration order. Add new modules here and in ../../tsconfig.node.json. */
export const mainModules: ModuleMain[] = [libraryModule, buildingModule, planModule, decorModule, editModule, rulesModule, exchangeModule, settingsModule, assistantModule];
