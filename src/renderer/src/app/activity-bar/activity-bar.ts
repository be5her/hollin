import { Component, computed, inject } from '@angular/core';
import { AppState, Icon, type ModuleUI } from '@studio/ui';
import { modules } from '../modules';

/** One icon per module panel; clicking the active one hides the sidebar. The shell shows it only when a module has a panel. */
@Component({
  selector: 'nav[xActivityBar]',
  imports: [Icon],
  template: `
    @for (mod of panels; track mod.id) {
      <button
        type="button"
        [title]="enabled(mod) ? mod.title : mod.title + ' (open a project first)'"
        [attr.aria-label]="mod.title"
        [attr.aria-pressed]="mod.id === active()"
        [attr.aria-disabled]="!enabled(mod)"
        class="relative flex items-center justify-center size-9 shrink-0 rounded-md transition-colors"
        [class]="(mod.id === active() ? 'text-fg bg-elevated' : 'text-muted hover:text-fg hover:bg-elevated/60') + (enabled(mod) ? '' : ' opacity-35 cursor-default')"
        data-testid="activity-item"
        [attr.data-module]="mod.id"
        (click)="toggle(mod)"
      >
        @if (mod.id === active()) {
          <span class="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-accent"></span>
        }
        <svg [xIcon]="mod.icon" class="size-[18px]"></svg>
      </button>
    }
  `,
  host: { class: 'flex flex-col items-center w-12 py-1.5 gap-1 border-r border-edge bg-surface shrink-0', 'data-testid': 'activity-bar' },
})
export class ActivityBar {
  private readonly app = inject(AppState);

  protected readonly panels = modules.filter((m) => m.sidebar);
  protected readonly active = this.app.activeModule;
  private readonly hasProject = computed(() => this.app.hasProject());

  protected enabled(mod: ModuleUI): boolean {
    return mod.availability === 'always' || this.hasProject();
  }

  protected toggle(mod: ModuleUI): void {
    if (!this.enabled(mod)) return;
    this.app.activeModule.update((current) => (current === mod.id ? null : mod.id));
  }
}
