import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { authorText, type SnapshotInfo } from '@studio/core';
import { Button, Dialogs, HostBridge, I18n, Icon, Input, Label, OpenProjects, TextArea, Toasts, invokeResource, relativeTime } from '@studio/ui';
import { Camera, RotateCcw, X } from 'lucide';
import { splitTags } from './library-actions';

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
        <label xLabel for="project-description">{{ t('library.details.description') }}</label>
        <textarea xTextarea id="project-description" rows="3" class="font-sans" dir="auto" [formField]="detailsForm.description" (blur)="saveDetails()" data-testid="project-description"></textarea>
      </div>
      <div>
        <label xLabel for="project-tags">{{ t('library.details.tags') }}</label>
        <input xInput id="project-tags" dir="auto" [placeholder]="t('library.tags.placeholder')" [formField]="detailsForm.tags" (blur)="saveDetails()" data-testid="project-tags" />
        <p class="text-[11px] text-muted mt-1">{{ t('library.details.tagsHint') }}</p>
      </div>
    </div>
    <div class="flex items-center justify-between px-3 py-1.5 border-y border-edge">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-muted">{{ t('library.details.snapshots') }}</span>
      <button xButton size="sm" variant="primary" [icon]="icons.Camera" (click)="snapshot()" data-testid="snapshot-create">{{ t('library.save') }}</button>
    </div>
    @if (snapshots.value()?.length) {
      <div class="divide-y divide-edge" data-testid="snapshot-list">
        @for (s of snapshots.value(); track s.id) {
          <div class="flex items-center gap-2 px-3 py-2 text-xs" data-testid="snapshot-item" [attr.data-name]="s.name" [attr.data-kind]="s.kind">
            <span class="flex-1 min-w-0">
              <span class="block truncate" dir="auto" [class.text-muted]="s.kind === 'auto'">{{ s.name }}</span>
              <span class="block text-[10px] text-muted"><bdi>{{ s.kind === 'auto' ? t('library.details.automatic') : author(s.createdBy) }}</bdi> · {{ ago(s.createdAt) }}</span>
            </span>
            <button xButton size="sm" variant="ghost" [icon]="icons.RotateCcw" iconClass="size-3.5 rtl:-scale-x-100" (click)="restore(s)" data-testid="snapshot-restore">{{ t('library.details.restore') }}</button>
            <button xButton size="sm" variant="ghost" [icon]="icons.X" (click)="remove(s)" [attr.aria-label]="t('library.details.deleteSnapshot', { name: s.name })" data-testid="snapshot-delete"></button>
          </div>
        }
      </div>
    } @else {
      <p class="px-3 py-2 text-xs text-muted">{{ t('library.details.none') }}</p>
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
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly project = computed(() => this.openProjects.projects().find((p) => p.id === this.projectId()) ?? null);
  protected readonly snapshots = invokeResource<SnapshotInfo[]>('project.snapshot.list', () => ({}), { projectId: () => this.projectId(), refreshOnEvents: ['project.changed'] });
  protected readonly details = linkedSignal<Details>(() => {
    const p = this.project();
    return { description: p?.description ?? '', tags: p?.tags.join(this.t('common.listSeparator')) ?? '' };
  });
  protected readonly detailsForm = form(this.details);

  protected ago(iso: string): string {
    return relativeTime(iso, Date.now(), this.i18n.language());
  }

  /** Who took a snapshot, as stored ("You", "via MCP: …"), in the language of the moment. */
  protected author(createdBy: string): string {
    return authorText(createdBy, this.i18n.language());
  }

  protected async saveDetails(): Promise<void> {
    const p = untracked(this.project);
    const d = untracked(this.details);
    if (!p) return;
    const tags = splitTags(d.tags);
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
    const name = await this.dialogs.prompt({ title: this.t('library.snapshot.title'), label: this.t('library.name'), placeholder: this.t('library.snapshot.placeholder'), confirmLabel: this.t('library.snapshot.confirm') });
    if (!name?.trim()) return;
    try {
      await this.host.invoke('project.snapshot.create', { name: name.trim() }, this.projectId());
      this.toasts.notify(this.t('library.snapshot.saved', { name: name.trim() }), 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async restore(s: SnapshotInfo): Promise<void> {
    const ok = await this.dialogs.confirm({ title: this.t('library.snapshot.restoreTitle', { name: s.name }), message: this.t('library.snapshot.restoreMessage'), confirmLabel: this.t('library.details.restore') });
    if (!ok) return;
    try {
      await this.host.invoke('project.snapshot.restore', { snapshotId: s.id }, this.projectId());
      this.toasts.notify(this.t('library.restored', { name: s.name }), 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async remove(s: SnapshotInfo): Promise<void> {
    const ok = await this.dialogs.confirm({ title: this.t('library.snapshot.deleteTitle', { name: s.name }), message: this.t('library.delete.message'), danger: true, confirmLabel: this.t('library.delete.confirm') });
    if (!ok) return;
    try {
      await this.host.invoke('project.snapshot.delete', { snapshotId: s.id }, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
