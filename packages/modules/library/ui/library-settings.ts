import { Component, inject, signal } from '@angular/core';
import type { LibraryInfo } from '@studio/core';
import { Button, Dialogs, HostBridge, Icon, Toasts, invokeResource } from '@studio/ui';
import { FolderInput, RefreshCw, TriangleAlert } from 'lucide';

/** Settings > Library: where the projects live, and moving them. */
@Component({
  selector: 'x-library-settings',
  imports: [Button, Icon],
  template: `
    <p class="text-xs text-muted mb-3">All projects live in one library folder that the app manages. Move it, for example, to a drive that is backed up.</p>
    @if (info.value(); as lib) {
      <div class="flex items-center gap-2">
        <code class="flex-1 text-xs font-mono bg-surface border border-edge rounded-md px-2 py-1.5 truncate" data-testid="library-path" [title]="lib.path">{{ lib.path }}</code>
        <button xButton size="sm" [icon]="icons.FolderInput" [loading]="busy()" (click)="move()" data-testid="library-move">Move…</button>
        <button xButton size="sm" variant="ghost" [icon]="icons.RefreshCw" (click)="reindex()" title="Rebuild the project list from the folders on disk">Rescan</button>
      </div>
      <p class="text-[11px] text-muted mt-1">{{ lib.projects }} project{{ lib.projects === 1 ? '' : 's' }}, {{ lib.trashed }} in the trash{{ lib.isDefault ? ' · default location' : '' }}</p>
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
  protected readonly info = invokeResource<LibraryInfo>('library.info', () => ({}), { projectId: null, refreshOnEvents: ['library.changed'] });
  protected readonly busy = signal(false);

  protected async move(): Promise<void> {
    try {
      const { path } = await this.host.invoke<{ path: string | null }>('app.pickFolder', { title: 'Choose a folder for the library' }, null);
      if (!path) return;
      const check = await this.host.invoke<{ empty: boolean; hasLibrary: boolean; warning: string | null }>('library.checkFolder', { path }, null);
      let mode: 'move' | 'adopt' = 'move';
      if (check.hasLibrary) {
        const ok = await this.dialogs.confirm({ title: 'Use the library in that folder?', message: 'That folder already holds a library. The app will switch to it; the current library stays where it is.', confirmLabel: 'Use it' });
        if (!ok) return;
        mode = 'adopt';
      } else if (!check.empty) {
        this.toasts.notify('Choose an empty folder for the library.', 'error');
        return;
      } else {
        const ok = await this.dialogs.confirm({
          title: 'Move the library?',
          message: `${check.warning ? `${check.warning} ` : ''}Open projects are saved and reopened. The old folder is removed once the copy is checked.`,
          confirmLabel: 'Move',
        });
        if (!ok) return;
      }
      this.busy.set(true);
      await this.host.invoke('library.move', { path, mode }, null);
      this.toasts.notify(mode === 'move' ? 'Library moved' : 'Switched library', 'success');
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async reindex(): Promise<void> {
    try {
      const { projects } = await this.host.invoke<{ projects: number }>('library.reindex', {}, null);
      this.toasts.notify(`Found ${projects} project${projects === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
