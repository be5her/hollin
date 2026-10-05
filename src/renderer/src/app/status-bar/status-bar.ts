import { Component, computed, inject } from '@angular/core';
import { AppState, Icon } from '@studio/ui';
import { Moon, Plug, Ruler, Sun } from 'lucide';
import { ShellActions } from '../shell-actions';

/** The project on the left; units, the MCP server and the theme on the right. */
@Component({
  selector: 'footer[xStatusBar]',
  imports: [Icon],
  template: `
    <span class="truncate" data-testid="status-project">{{ tabTitle() }}</span>
    <div class="flex-1"></div>
    <button type="button" class="flex items-center gap-1 hover:text-fg" title="Display units" data-testid="status-units" (click)="shell.openSettings('units')">
      <svg [xIcon]="icons.Ruler" class="size-3"></svg>{{ unitsLabel() }}
    </button>
    <button type="button" class="flex items-center gap-1 hover:text-fg" [title]="mcp()?.error ?? 'MCP server'" data-testid="status-mcp" (click)="shell.openSettings('mcp')">
      <svg [xIcon]="icons.Plug" class="size-3"></svg>
      <span class="size-1.5 rounded-full" [class]="mcp()?.running ? 'bg-success' : 'bg-danger'"></span>
      MCP {{ mcp()?.running ? ':' + mcp()?.port : 'off' }}
    </button>
    <button type="button" class="hover:text-fg" title="Toggle theme" aria-label="Toggle theme" data-testid="status-theme" (click)="shell.toggleTheme()">
      <svg [xIcon]="theme() === 'dark' ? icons.Sun : icons.Moon" class="size-3"></svg>
    </button>
  `,
  host: { class: 'flex items-center h-6 px-3 gap-3 text-[11px] border-t border-edge bg-surface text-muted shrink-0 select-none' },
})
export class StatusBar {
  private readonly app = inject(AppState);
  protected readonly shell = inject(ShellActions);

  protected readonly icons = { Moon, Plug, Ruler, Sun };
  protected readonly mcp = this.app.mcpStatus;
  protected readonly theme = this.app.resolvedTheme;
  protected readonly tabTitle = computed(() => (this.app.hasProject() ? '' : 'No project open'));
  protected readonly unitsLabel = computed(() => {
    const units = this.app.units();
    if (!units) return '';
    return units.system === 'metric' ? units.metricUnit : units.imperialStyle === 'ft-in' ? `ft-in, 1/${units.fraction}"` : `in, 1/${units.fraction}"`;
  });
}
