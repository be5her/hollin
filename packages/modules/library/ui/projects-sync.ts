import { DestroyRef, Service, effect, inject, untracked } from '@angular/core';
import type { OpenProject, ProjectSummary } from '@studio/core';
import { AppState, HostBridge, OpenProjects, TabsState, Toasts, UiActions, type UIAction } from '@studio/ui';

export const PROJECT_TAB = 'project.editor';
const tabKey = (id: string) => `${PROJECT_TAB}:${id}`;

/**
 * Keeps the project tabs in step with the projects open in the host: a project opened anywhere
 * (the Home screen, the palette, an MCP agent) gets a tab; closing the tab closes the project; the
 * tab on screen tells the host which project agents act on by default.
 */
@Service()
export class ProjectsSync {
  private readonly host = inject(HostBridge);
  private readonly app = inject(AppState);
  private readonly tabs = inject(TabsState);
  private readonly open = inject(OpenProjects);
  private readonly toasts = inject(Toasts);
  private readonly actions = inject(UiActions);
  private started = false;
  private offRecent: (() => void) | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    const destroy = inject(DestroyRef);
    const offs = [
      this.host.on('project.changed', (event) => void this.changed(event)),
      this.host.on('library.changed', () => void this.refreshRecent()),
    ];
    destroy.onDestroy(() => offs.forEach((off) => off()));

    this.tabs.onClose(PROJECT_TAB, async (tab) => {
      if (tab.projectId) await this.host.invoke('project.close', { id: tab.projectId }, null);
    });

    // The project on screen is the one agents act on by default.
    let last: string | null | undefined;
    effect(() => {
      const id = this.app.activeProjectId();
      if (!this.app.ready() || id === last) return;
      last = id;
      untracked(() => void this.host.invoke('project.focus', { id }, null).catch(() => {}));
    });

    void this.load();
    void this.refreshRecent();
  }

  private async load(): Promise<void> {
    try {
      const { projects, current } = await this.host.invoke<{ projects: OpenProject[]; current: string | null }>('project.openList', {}, null);
      this.open.set(projects);
      for (const p of projects) this.ensureTab(p, p.id === current);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  private ensureTab(project: OpenProject, activate: boolean): void {
    const existing = this.tabs.find(tabKey(project.id));
    if (existing) {
      if (existing.title !== project.name) this.tabs.update(existing.id, { title: project.name });
      if (activate) this.tabs.activate(existing.id);
      return;
    }
    this.tabs.open({ type: PROJECT_TAB, title: project.name, projectId: project.id, data: { key: project.id } }, { singletonKey: tabKey(project.id), activate });
  }

  private async changed(event: { projectId: string; kind: string; focus?: boolean; save?: OpenProject['save'] }): Promise<void> {
    if (event.kind === 'closed') {
      this.open.remove(event.projectId);
      const tab = this.tabs.find(tabKey(event.projectId));
      if (tab) this.tabs.closeWhere((t) => t.id === tab.id);
      return;
    }
    if (event.kind === 'save' && event.save) {
      this.open.setSave(event.projectId, event.save);
      return;
    }
    if (event.kind === 'opened' || event.kind === 'updated') {
      const { projects } = await this.host.invoke<{ projects: OpenProject[] }>('project.openList', {}, null);
      this.open.set(projects);
      const project = projects.find((p) => p.id === event.projectId);
      if (project) this.ensureTab(project, event.kind === 'opened' && event.focus === true);
    }
  }

  /** Palette entries to open the most recent projects by name. */
  private async refreshRecent(): Promise<void> {
    try {
      const recent = await this.host.invoke<ProjectSummary[]>('project.list', { sort: 'opened' }, null);
      this.offRecent?.();
      const entries: UIAction[] = recent.slice(0, 20).map((p) => ({
        id: `project.openRecent.${p.id}`,
        title: `Open project: ${p.name}`,
        group: 'Projects',
        keywords: p.tags,
        run: () => this.openProject(p.id),
      }));
      this.offRecent = this.actions.register(entries);
    } catch {
      // The palette simply lacks the shortcuts.
    }
  }

  async openProject(id: string): Promise<void> {
    try {
      await this.host.invoke('project.open', { id }, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  /** The tab id of an open project, for tests and focus handling. */
  tabOf(id: string): string | undefined {
    return untracked(() => this.tabs.find(tabKey(id))?.id);
  }
}
