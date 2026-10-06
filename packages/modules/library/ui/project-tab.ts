import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { Button, EmptyState, HostBridge, Icon, IconButton, OpenProjects, ProjectDocs, ProjectPanels, ProjectView, Toasts, UiActions, relativeTime, type Tab, type TabComponent } from '@studio/ui';
import { Copy, Download, Redo2, Save, Trash2, Undo2 } from 'lucide';
import { LibraryActions } from './library-actions';

/**
 * A project's tab: its name, save state and actions on top; below, the panels modules contribute:
 * the left column (levels, layers), the main view in the centre, and the right column as tabs
 * (history, project details and snapshots).
 */
@Component({
  selector: 'x-project-tab',
  imports: [Button, EmptyState, FormField, Icon, IconButton, NgComponentOutlet],
  templateUrl: './project-tab.html',
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'project-tab' },
})
export class ProjectTab implements TabComponent {
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly openProjects = inject(OpenProjects);
  private readonly docs = inject(ProjectDocs);
  private readonly panels = inject(ProjectPanels);
  private readonly view = inject(ProjectView);
  private readonly ui = inject(UiActions);
  protected readonly actions = inject(LibraryActions);

  readonly tab = input.required<Tab>();

  protected readonly icons = { Copy, Download, Redo2, Save, Trash2, Undo2 };
  protected readonly projectId = computed(() => this.tab().projectId ?? null);
  protected readonly project = computed(() => {
    const id = this.projectId();
    return id ? (this.openProjects.projects().find((p) => p.id === id) ?? null) : null;
  });
  protected readonly docState = computed(() => this.docs.read(this.projectId()));
  protected readonly loadError = computed(() => this.docs.errors()[this.projectId() ?? '']);
  protected readonly left = computed(() => this.panels.panels().filter((p) => p.side === 'left'));
  protected readonly centers = computed(() => this.panels.panels().filter((p) => p.side === 'center'));
  /** The main view: the one chosen for this project, else the first registered (the plan). */
  protected readonly center = computed(() => {
    const id = this.projectId();
    const chosen = id ? this.view.get<string | null>(id, 'centerView', null) : null;
    return this.centers().find((p) => p.id === chosen) ?? this.centers()[0] ?? null;
  });
  protected readonly centerId = computed(() => this.center()?.id ?? '');
  protected readonly right = computed(() => this.panels.panels().filter((p) => p.side === 'right'));
  protected readonly rightPanel = computed(() => {
    const id = this.projectId();
    const chosen = id ? this.view.get<string | null>(id, 'rightPanel', null) : null;
    return this.right().find((p) => p.id === chosen) ?? this.right()[0] ?? null;
  });

  protected readonly name = linkedSignal(() => ({ name: this.project()?.name ?? '' }));
  protected readonly nameForm = form(this.name, (p) => {
    required(p.name, { message: 'A project needs a name' });
  });

  protected ago(iso: string | null | undefined): string {
    return relativeTime(iso);
  }

  protected chooseRight(id: string): void {
    const projectId = this.projectId();
    if (projectId) this.view.set(projectId, 'rightPanel', id);
  }

  protected chooseCenter(id: string): void {
    const projectId = this.projectId();
    if (projectId) this.view.set(projectId, 'centerView', id);
  }

  protected undo(): void {
    this.ui.run('edit.undo');
  }

  protected redo(): void {
    this.ui.run('edit.redo');
  }

  protected async saveName(): Promise<void> {
    const p = untracked(this.project);
    const name = untracked(this.name).name.trim();
    if (!p || !name || name === p.name) return;
    try {
      await this.host.invoke('project.update', { id: p.id, name }, null);
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
}
