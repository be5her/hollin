import type { ModuleMain } from '@studio/core';
import { libraryModule } from './library/main';
import { settingsModule } from './settings/main';

/** The Node side of every feature module, in registration order. Add new modules here and in ../../tsconfig.node.json. */
export const mainModules: ModuleMain[] = [libraryModule, settingsModule];
