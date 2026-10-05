import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import type { SnapshotInfo } from '@studio/core';
import { Button, Dialogs, EmptyState, HostBridge, Icon, Input, Label, OpenProjects, TextArea, Toasts, invokeResource, relativeTime, type Tab, type TabComponent } from '@studio/ui';
import { Camera, Copy, Download, History, RotateCcw, Save, Trash2, X } from 'lucide';
import { LibraryActions } from './library-actions';

interface Details {
  name: string;
  description: string;
  tags: string;
}

/**
 * A project's tab. For now: its details, save state and snapshots. The editor views (plan, 3D)
 * join it as they are built.
 */
@Component({
  selector: 'x-project-tab',
  imports: [Button, EmptyState, FormField, Icon, Input, Label, TextArea],
  templateUrl: './project-tab.html',
  host: { class: 'flex-1 overflow-auto', 'data-testid': 'project-tab' },
})
export class ProjectTab implements TabComponent {
  private readonly host = inject(HostBridge);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly openProjects = inject(OpenProjects);
  protected readonly actions = inject(LibraryActions);

  readonly tab = input.required<Tab>();

  protected readonly icons = { Camera, Copy, Download, History, RotateCcw, Save, Trash2, X };
  protected readonly projectId = computed(() => this.tab().projectId ?? null);
  protected readonly project = computed(() => {
    const id = this.projectId();
    return id ? (this.openProjects.projects().find((p) => p.id === id) ?? null) : null;
  });
  protected readonly snapshots = invokeResource<SnapshotInfo[]>('project.snapshot.list', () => ({}), {
    projectId: () => this.projectId(),
    enabled: () => this.projectId() !== null,
    refreshOnEvents: ['project.changed'],
  });

  /** The details being edited; they follow the stored ones until the user types. */
  protected readonly details = linkedSignal<Details>(() => {
    const p = this.project();
    return { name: p?.name ?? '', description: p?.description ?? '', tags: p?.tags.join(', ') ?? '' };
  });
  protected readonly detailsForm = form(this.details, (path) => {
    required(path.name, { message: 'A project needs a name' });
  });

  protected ago(iso: string | null | undefined): string {
    return relativeTime(iso);
  }

  /** Saves the details when a field loses focus, if they changed. */
  protected async saveDetails(): Promise<void> {
    const p = untracked(this.project);
    const d = untracked(this.details);
    if (!p || this.detailsForm.name().invalid()) return;
    const tags = d.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const patch: Record<string, unknown> = {};
    if (d.name.trim() !== p.name) patch['name'] = d.name.trim();
    if (d.description.trim() !== p.description) patch['description'] = d.description.trim();
    if (tags.join('\u0000') !== p.tags.join('\u0000')) patch['tags'] = tags;
    if (!Object.keys(patch).length) return;
    try {
      await this.host.invoke('project.update', { id: p.id, ...patch }, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async saveNow(): Promise<void> {
    try {
      await this.host.invoke('project.save', {}, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async snapshot(): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Save a snapshot', label: 'Name', placeholder: 'e.g. Concept A, before client review', confirmLabel: 'Save snapshot' });
    if (!name?.trim()) return;
    try {
      await this.host.invoke('project.snapshot.create', { name: name.trim() }, this.projectId());
      this.toasts.notify(`Saved snapshot "${name.trim()}"`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async restore(s: SnapshotInfo): Promise<void> {
    const ok = await this.dialogs.confirm({ title: `Restore "${s.name}"?`, message: 'The design goes back to this snapshot. What it looks like now is kept as an automatic snapshot, so you can come back to it.', confirmLabel: 'Restore' });
    if (!ok) return;
    try {
      await this.host.invoke('project.snapshot.restore', { snapshotId: s.id }, this.projectId());
      this.toasts.notify(`Restored "${s.name}"`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async remove(s: SnapshotInfo): Promise<void> {
    const ok = await this.dialogs.confirm({ title: `Delete snapshot "${s.name}"?`, message: 'It cannot be restored afterwards.', danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await this.host.invoke('project.snapshot.delete', { snapshotId: s.id }, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
