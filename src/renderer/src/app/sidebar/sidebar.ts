import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { AppState, EmptyState, I18n } from '@studio/ui';
import { moduleById } from '../modules';

/** The active module's panel under its title. Project modules wait for a project on screen. */
@Component({
  selector: 'aside[xSidebar]',
  imports: [EmptyState, NgComponentOutlet],
  template: `
    @if (module(); as mod) {
      <div class="flex items-center h-9 px-3 heading-panel text-fg border-b border-edge shrink-0">{{ label(mod.title) }}</div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        @if (blocked()) {
          <x-empty-state [title]="t('shell.sidebar.noProject')" [hint]="t('shell.sidebar.noProjectHint')" />
        } @else if (mod.sidebar) {
          <ng-container *ngComponentOutlet="mod.sidebar" />
        }
      </div>
    }
  `,
  host: { '[class]': 'module() ? "flex flex-col w-[280px] border-e border-edge bg-surface shrink-0 min-h-0" : "hidden"', 'data-testid': 'sidebar' },
})
export class Sidebar {
  private readonly app = inject(AppState);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly label = this.i18n.label;

  protected readonly module = computed(() => {
    const mod = moduleById(this.app.activeModule());
    return mod?.sidebar ? mod : undefined;
  });
  protected readonly blocked = computed(() => this.module()?.availability === 'project' && !this.app.hasProject());
}
