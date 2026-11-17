import { Component, computed, inject } from '@angular/core';
import { AppState, I18n, Icon, OpenProjects, ProjectView, relativeTime } from '@studio/ui';
import { CircleAlert, Moon, Plug, Ruler, Sun } from 'lucide';
import { ShellActions } from '../shell-actions';

/** The project and its save state at the start; units, Otto's state, the MCP server and the theme at the end. */
@Component({
  selector: 'footer[xStatusBar]',
  imports: [Icon],
  template: `
    @if (project(); as p) {
      <span class="truncate max-w-80 text-fg/80" dir="auto" data-testid="status-project">{{ p.name }}</span>
      <span class="flex items-center gap-1" data-testid="status-save" [attr.data-state]="p.save.state" [class.text-danger]="p.save.state === 'failed'">
        @switch (p.save.state) {
          @case ('saved') {
            {{ t('shell.status.saved', { ago: savedAgo() }) }}
          }
          @case ('failed') {
            <svg [xIcon]="icons.CircleAlert" class="size-3"></svg>{{ t('shell.status.notSaved') }}
          }
          @default {
            {{ t('shell.status.saving') }}
          }
        }
      </span>
    } @else {
      <span data-testid="status-project">{{ t('shell.status.noProject') }}</span>
    }
    <div class="flex-1"></div>
    <button type="button" class="flex items-center gap-1 hover:text-fg" [title]="t('shell.status.units')" data-testid="status-units" (click)="shell.openSettings('units')">
      <svg [xIcon]="icons.Ruler" class="size-3"></svg><span class="bidi-ltr">{{ unitsLabel() }}</span>
    </button>
    @if (otto(); as o) {
      <button type="button" class="flex items-center gap-1 hover:text-fg max-w-72" [title]="o.text" [attr.aria-label]="o.text" aria-live="polite" data-testid="status-otto" [attr.data-state]="o.state" (click)="openOtto()">
        <span class="size-1.5 rounded-full shrink-0" [class]="(o.tone === 'ai' ? 'bg-ai' : o.tone === 'danger' ? 'bg-danger' : 'bg-muted') + (o.pulse ? ' otto-pulse' : '')" aria-hidden="true" data-testid="status-otto-dot"></span>
        <span class="truncate">{{ o.text }}</span>
      </button>
    }
    <button type="button" class="flex items-center gap-1 hover:text-fg" [title]="mcp()?.error ?? t('shell.status.mcp')" data-testid="status-mcp" (click)="shell.openSettings('mcp')">
      <svg [xIcon]="icons.Plug" class="size-3"></svg>
      <span class="size-1.5 rounded-full" [class]="mcp()?.running ? 'bg-success' : 'bg-danger'"></span>
      @if (mcp()?.running) {
        <span class="bidi-ltr">MCP :{{ mcp()?.port }}</span>
      } @else {
        MCP {{ t('shell.status.mcpOff') }}
      }
    </button>
    <button type="button" class="hover:text-fg" [title]="t('shell.status.theme')" [attr.aria-label]="t('shell.status.theme')" data-testid="status-theme" (click)="shell.toggleTheme()">
      <svg [xIcon]="theme() === 'dark' ? icons.Sun : icons.Moon" class="size-3"></svg>
    </button>
  `,
  styles: `
    .otto-pulse { animation: otto-pulse 1.2s ease-in-out infinite; }
    @keyframes otto-pulse { 50% { opacity: 0.4; } }
    @media (prefers-reduced-motion: reduce) { .otto-pulse { animation: none; } }
  `,
  host: { class: 'flex items-center h-6 px-3 gap-3 text-[11px] border-t border-edge bg-surface text-muted shrink-0 select-none' },
})
export class StatusBar {
  private readonly app = inject(AppState);
  private readonly view = inject(ProjectView);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly shell = inject(ShellActions);
  /** Otto's state in the project on screen, published by the assistant module. */
  protected readonly otto = this.app.assistant;

  protected readonly icons = { CircleAlert, Moon, Plug, Ruler, Sun };
  protected readonly mcp = this.app.mcpStatus;
  protected readonly theme = this.app.resolvedTheme;
  protected readonly project = inject(OpenProjects).current;
  protected readonly savedAgo = computed(() => {
    const save = this.project()?.save;
    return save?.state === 'saved' ? relativeTime(save.savedAt, Date.now(), this.i18n.language()) : '';
  });
  /** Opens the project's Otto tab, or Settings > Assistant while Otto cannot work. */
  protected openOtto(): void {
    const o = this.otto();
    if (!o) return;
    if (o.opens === 'settings') this.shell.openSettings('ai');
    else this.view.set(o.projectId, 'rightPanel', 'assistant');
  }

  protected readonly unitsLabel = computed(() => {
    const units = this.app.units();
    if (!units) return '';
    return units.system === 'metric' ? units.metricUnit : units.imperialStyle === 'ft-in' ? `ft-in, 1/${units.fraction}"` : `in, 1/${units.fraction}"`;
  });
}
