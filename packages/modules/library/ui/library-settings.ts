import { Component, inject, signal } from '@angular/core';
import type { LibraryInfo } from '@studio/core';
import { Button, Dialogs, HostBridge, I18n, Icon, Toasts, invokeResource } from '@studio/ui';
import { FolderInput, RefreshCw, TriangleAlert } from 'lucide';

/** Settings > Library: where the projects live, and moving them. */
@Component({
  selector: 'x-library-settings',
  imports: [Button, Icon],
  template: `
    <p class="text-xs text-muted mb-3">{{ t('library.settings.note') }}</p>
    @if (info.value(); as lib) {
      <div class="flex items-center gap-2">
        <code class="flex-1 text-xs font-mono bg-surface border border-edge rounded-md px-2 py-1.5 truncate text-start" dir="ltr" data-testid="library-path" [title]="lib.path">{{ lib.path }}</code>
        <button xButton size="sm" [icon]="icons.FolderInput" [loading]="busy()" (click)="move()" data-testid="library-move">{{ t('library.settings.move') }}</button>
        <button xButton size="sm" variant="ghost" [icon]="icons.RefreshCw" (click)="reindex()" [title]="t('library.settings.rescanHint')" data-testid="library-rescan">{{ t('library.settings.rescan') }}</button>
      </div>
      <p class="text-[11px] text-muted mt-1" data-testid="library-count">{{ t('library.settings.count', { count: lib.projects, trashed: lib.trashed }) }}@if (lib.isDefault) {<span> · {{ t('library.settings.default') }}</span>}</p>
      @if (lib.warning) {
        <p class="flex items-start gap-1.5 text-xs text-warning mt-2"><svg [xIcon]="icons.TriangleAlert" class="size-3.5 shrink-0 mt-px"></svg>{{ lib.warning }}</p>
      }
    }
  `,
})
export class LibrarySettings {
  private readonly host = inject(HostBridge);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);

  protected readonly icons = { FolderInput, RefreshCw, TriangleAlert };
  protected readonly t = inject(I18n).t;
  protected readonly info = invokeResource<LibraryInfo>('library.info', () => ({}), { projectId: null, refreshOnEvents: ['library.changed'] });
  protected readonly busy = signal(false);

  protected async move(): Promise<void> {
    try {
      const { path } = await this.host.invoke<{ path: string | null }>('app.pickFolder', { title: this.t('library.settings.pick') }, null);
      if (!path) return;
      const check = await this.host.invoke<{ empty: boolean; hasLibrary: boolean; warning: string | null }>('library.checkFolder', { path }, null);
      let mode: 'move' | 'adopt' = 'move';
      if (check.hasLibrary) {
        const ok = await this.dialogs.confirm({ title: this.t('library.settings.adoptTitle'), message: this.t('library.settings.adoptMessage'), confirmLabel: this.t('library.settings.adoptConfirm') });
        if (!ok) return;
        mode = 'adopt';
      } else if (!check.empty) {
        this.toasts.notify(this.t('library.settings.notEmpty'), 'error');
        return;
      } else {
        const ok = await this.dialogs.confirm({
          title: this.t('library.settings.moveTitle'),
          message: `${check.warning ? `${check.warning} ` : ''}${this.t('library.settings.moveMessage')}`,
          confirmLabel: this.t('library.settings.moveConfirm'),
        });
        if (!ok) return;
      }
      this.busy.set(true);
      await this.host.invoke('library.move', { path, mode }, null);
      this.toasts.notify(this.t(mode === 'move' ? 'library.settings.moved' : 'library.settings.switched'), 'success');
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async reindex(): Promise<void> {
    try {
      const { projects, models } = await this.host.invoke<{ projects: number; models: number }>('library.reindex', {}, null);
      const found = { projects: this.t('library.settings.foundProjects', { count: projects }), models: this.t('library.settings.foundModels', { count: models }) };
      this.toasts.notify(this.t('library.settings.found', found), 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
