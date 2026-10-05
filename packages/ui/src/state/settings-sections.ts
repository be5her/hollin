import { Service, signal, type Type } from '@angular/core';

export interface SettingsSection {
  id: string;
  title: string;
  /** Sort position among the sections. */
  order: number;
  component: Type<unknown>;
}

/** Sections modules add to the Settings tab, e.g. the library's location. */
@Service()
export class SettingsSections {
  private readonly list = signal<SettingsSection[]>([]);

  readonly sections = this.list.asReadonly();

  register(section: SettingsSection): void {
    this.list.update((list) => [...list.filter((s) => s.id !== section.id), section].sort((a, b) => a.order - b.order));
  }
}
