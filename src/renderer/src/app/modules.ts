import type { Type } from '@angular/core';
import { uiModules } from '@studio/modules/ui';
import type { ModuleUI, TabComponent } from '@studio/ui';
import { Home } from './home/home';

/** Tabs the shell itself owns, outside any module. */
export const shellTabs: Record<string, Type<TabComponent>> = {
  'shell.home': Home,
};

export const modules: ModuleUI[] = [...uiModules].sort((a, b) => a.order - b.order);

export function resolveTabComponent(type: string): Type<TabComponent> | undefined {
  if (shellTabs[type]) return shellTabs[type];
  for (const mod of modules) {
    if (mod.tabs[type]) return mod.tabs[type];
  }
  return undefined;
}

export function moduleById(id: string | null | undefined): ModuleUI | undefined {
  return modules.find((m) => m.id === id);
}
