import { Service, signal, type Type } from '@angular/core';

export interface SettingsSection {
  id: string;
  title: string;
  /** Sort position among the sections. Below `SETTINGS_LATE` a section comes after Units; from it on, after the Assistant, just before About. */
  order: number;
  component: Type<unknown>;
}

/** The order from which a module's section follows the app's own sections (Updates), right before About. */
export const SETTINGS_LATE = 900;

/** Sections modules add to the Settings tab, e.g. the library's location. */
@Service()
export class SettingsSections {
  private readonly list = signal<SettingsSection[]>([]);

  readonly sections = this.list.asReadonly();

  register(section: SettingsSection): void {
    this.list.update((list) => [...list.filter((s) => s.id !== section.id), section].sort((a, b) => a.order - b.order));
  }
}
