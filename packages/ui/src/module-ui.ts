import type { InputSignal, Type } from '@angular/core';
import type { IconNode } from './icon/icon';
import type { UIAction } from './state/ui-actions';
import type { Tab } from './state/tabs-state';

/** What every tab component receives from the shell. */
export interface TabComponent {
  readonly tab: InputSignal<Tab>;
}

/**
 * The renderer half of a module. The shell reads it to draw the activity bar and the sidebar, and to
 * resolve tab components by type.
 */
export interface ModuleUI {
  id: string;
  title: string;
  icon: IconNode;
  /** Sort position in the activity bar. */
  order: number;
  /** `project` modules are disabled until a project is on screen. */
  availability: 'project' | 'always';
  /** The sidebar panel, if the module has one. */
  sidebar?: Type<unknown>;
  /** Tab components keyed by tab type, e.g. `project.editor`. */
  tabs: Record<string, Type<TabComponent>>;
  /** Palette entries. Called once in an injection context, so actions can inject the module's services. */
  actions?: () => UIAction[];
}

export function defineModuleUI(mod: ModuleUI): ModuleUI {
  return mod;
}
