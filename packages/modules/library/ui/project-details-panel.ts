import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { SnapshotInfo } from '@studio/core';
import { Button, Dialogs, HostBridge, Icon, Input, Label, OpenProjects, TextArea, Toasts, invokeResource, relativeTime } from '@studio/ui';
import { Camera, RotateCcw, X } from 'lucide';

interface Details {
  description: string;
  tags: string;
}

/** The project's description, tags and snapshots, in the project tab's right column. */
@Component({
  selector: 'x-project-details-panel',
  imports: [Button, FormField, Icon, Input, Label, TextArea],
  template: `
    <div class="flex flex-col gap-3 p-3">
      <div>
        <label xLabel for="project-description">Description</label>
        <textarea xTextarea id="project-description" rows="3" class="font-sans" [formField]="detailsForm.description" (blur)="saveDetails()" data-testid="project-description"></textarea>
      </div>
      <div>
        <label xLabel for="project-tags">Tags</label>
        <input xInput id="project-tags" placeholder="residential, concept" [formField]="detailsForm.tags" (blur)="saveDetails()" data-testid="project-tags" />
        <p class="text-[11px] text-muted mt-1">Separate tags with commas.</p>
      </div>
    </div>
    <div class="flex items-center justify-between px-3 py-1.5 border-y border-edge">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-muted">Snapshots</span>
      <button xButton size="sm" variant="primary" [icon]="icons.Camera" (click)="snapshot()" data-testid="snapshot-create">Save</button>
    </div>
    @if (snapshots.value()?.length) {
      <div class="divide-y divide-edge" data-testid="snapshot-list">
        @for (s of snapshots.value(); track s.id) {
          <div class="flex items-center gap-2 px-3 py-2 text-xs" data-testid="snapshot-item" [attr.data-name]="s.name" [attr.data-kind]="s.kind">
            <span class="flex-1 min-w-0">
              <span class="block truncate" [class.text-muted]="s.kind === 'auto'">{{ s.name }}</span>
              <span class="block text-[10px] text-muted">{{ s.kind === 'auto' ? 'automatic' : s.createdBy }} · {{ ago(s.createdAt) }}</span>
            </span>
            <button xButton size="sm" variant="ghost" [icon]="icons.RotateCcw" (click)="restore(s)" data-testid="snapshot-restore">Restore</button>
            <button xButton size="sm" variant="ghost" [icon]="icons.X" (click)="remove(s)" [attr.aria-label]="'Delete snapshot ' + s.name" data-testid="snapshot-delete"></button>
          </div>
        }
      </div>
    } @else {
      <p class="px-3 py-2 text-xs text-muted">No snapshots yet. Save one before trying something risky.</p>
    }
  `,
  host: { class: 'flex flex-col', 'data-testid': 'project-details' },
})
export class ProjectDetailsPanel {
  private readonly host = inject(HostBridge);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly openProjects = inject(OpenProjects);

  readonly projectId = input.required<string>();

  protected readonly icons = { Camera, RotateCcw, X };
  protected readonly project = computed(() => this.openProjects.projects().find((p) => p.id === this.projectId()) ?? null);
  protected readonly snapshots = invokeResource<SnapshotInfo[]>('project.snapshot.list', () => ({}), { projectId: () => this.projectId(), refreshOnEvents: ['project.changed'] });
  protected readonly details = linkedSignal<Details>(() => {
    const p = this.project();
    return { description: p?.description ?? '', tags: p?.tags.join(', ') ?? '' };
  });
  protected readonly detailsForm = form(this.details);

  protected ago(iso: string): string {
    return relativeTime(iso);
  }

  protected async saveDetails(): Promise<void> {
    const p = untracked(this.project);
    const d = untracked(this.details);
    if (!p) return;
    const tags = d.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const patch: Record<string, unknown> = {};
    if (d.description.trim() !== p.description) patch['description'] = d.description.trim();
    if (tags.join('\u0000') !== p.tags.join('\u0000')) patch['tags'] = tags;
    if (!Object.keys(patch).length) return;
    try {
      await this.host.invoke('project.update', { id: p.id, ...patch }, null);
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
