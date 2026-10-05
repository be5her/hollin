import { Component, computed, inject, input, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { BRANDING, thumbnailUrl, type LibraryInfo, type ProjectSummary } from '@studio/core';
import {
  Button,
  ContextMenu,
  Dialogs,
  EmptyState,
  HostBridge,
  Icon,
  Input,
  Select,
  Toasts,
  hueOf,
  initials,
  invokeResource,
  relativeTime,
  type Tab,
  type TabComponent,
} from '@studio/ui';
import { ArchiveRestore, Download, Plus, Search, Trash2, TriangleAlert, Upload } from 'lucide';
import { LibraryActions } from './library-actions';
import { ProjectsSync } from './projects-sync';

/**
 * The Home tab: every project in the library as a card (thumbnail, name, when it changed, tags),
 * with search, tag filters and sorting; New, Import, and the trash.
 */
@Component({
  selector: 'x-library-home',
  imports: [Button, EmptyState, FormField, Icon, Input, Select],
  templateUrl: './library-home.html',
  host: { class: 'flex-1 overflow-auto', 'data-testid': 'library-home' },
})
export class LibraryHome implements TabComponent {
  private readonly host = inject(HostBridge);
  private readonly sync = inject(ProjectsSync);
  private readonly menu = inject(ContextMenu);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  protected readonly actions = inject(LibraryActions);

  readonly tab = input.required<Tab>();

  protected readonly icons = { ArchiveRestore, Download, Plus, Search, Trash2, TriangleAlert, Upload };
  protected readonly productName = BRANDING.productName;
  protected readonly filters = signal({ query: '', sort: 'recent' as 'recent' | 'name' | 'created' | 'opened' });
  protected readonly filterForm = form(this.filters);
  protected readonly selectedTags = signal<string[]>([]);
  protected readonly showTrash = signal(false);

  protected readonly projects = invokeResource<ProjectSummary[]>(
    'project.list',
    () => ({ query: this.filters().query, sort: this.filters().sort, tags: this.selectedTags(), trashed: this.showTrash() }),
    { projectId: null, refreshOnEvents: ['library.changed'] },
  );
  protected readonly tags = invokeResource<{ tag: string; count: number }[]>('project.tags', () => ({}), { projectId: null, refreshOnEvents: ['library.changed'] });
  protected readonly info = invokeResource<LibraryInfo>('library.info', () => ({}), { projectId: null, refreshOnEvents: ['library.changed'] });
  protected readonly filtering = computed(() => Boolean(this.filters().query.trim() || this.selectedTags().length));

  protected thumb(p: ProjectSummary): string | null {
    return thumbnailUrl(p);
  }

  protected placeholder(p: ProjectSummary): { label: string; background: string } {
    const hue = hueOf(p.id);
    return { label: initials(p.name), background: `linear-gradient(135deg, hsl(${hue} 45% 52%), hsl(${(hue + 40) % 360} 50% 40%))` };
  }

  protected ago(iso: string | null): string {
    return relativeTime(iso);
  }

  protected toggleTag(tag: string): void {
    this.selectedTags.update((tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]));
  }

  protected clearFilters(): void {
    this.filters.update((f) => ({ ...f, query: '' }));
    this.selectedTags.set([]);
  }

  protected open(p: ProjectSummary): void {
    if (p.trashedAt) return;
    void this.sync.openProject(p.id);
  }

  protected showMenu(event: MouseEvent, p: ProjectSummary): void {
    if (p.trashedAt) {
      this.menu.open(event, [
        { label: 'Restore', select: () => void this.actions.restore(p), testId: 'project-menu-restore' },
        { label: 'Delete permanently…', danger: true, select: () => void this.actions.deleteForever(p), testId: 'project-menu-delete' },
      ]);
      return;
    }
    this.menu.open(event, [
      { label: 'Open', select: () => this.open(p), testId: 'project-menu-open' },
      'separator',
      { label: 'Rename…', select: () => void this.actions.rename(p), testId: 'project-menu-rename' },
      { label: 'Edit tags…', select: () => void this.actions.editTags(p), testId: 'project-menu-tags' },
      { label: 'Duplicate', select: () => void this.actions.duplicate(p), testId: 'project-menu-duplicate' },
      { label: 'Export…', select: () => void this.actions.exportProject(p), testId: 'project-menu-export' },
      'separator',
      { label: 'Move to trash', danger: true, select: () => void this.actions.trash(p), testId: 'project-menu-trash' },
    ]);
  }

  protected async emptyTrash(): Promise<void> {
    const count = this.info.value()?.trashed ?? 0;
    const ok = await this.dialogs.confirm({ title: `Delete ${count} project${count === 1 ? '' : 's'} permanently?`, message: 'Projects in the trash are deleted for good. This cannot be undone.', danger: true, confirmLabel: 'Empty trash' });
    if (!ok) return;
    try {
      const { deleted } = await this.host.invoke<{ deleted: number }>('library.trash.empty', {}, null);
      this.toasts.notify(`Deleted ${deleted} project${deleted === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
