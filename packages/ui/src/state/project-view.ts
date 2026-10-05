import { Service, inject, signal, untracked, type Type } from '@angular/core';
import { HostBridge } from '../host/host-bridge';

/** A panel a module adds to the project tab. Its component gets a `projectId` input. */
export interface ProjectPanel {
  id: string;
  title: string;
  /** Left column, right column (as tabs), or the main view in the centre. */
  side: 'left' | 'right' | 'center';
  order: number;
  component: Type<unknown>;
}

/** The panels of the project tab, contributed by modules (levels and layers, history, details…). */
@Service()
export class ProjectPanels {
  private readonly list = signal<ProjectPanel[]>([]);

  readonly panels = this.list.asReadonly();

  register(panel: ProjectPanel): void {
    this.list.update((list) => [...list.filter((p) => p.id !== panel.id), panel].sort((a, b) => a.order - b.order));
  }
}

/**
 * Per-project view state that is not part of the design: which level is active, which right panel is
 * open. Kept per machine in the project's `.local/ui.json`.
 */
@Service()
export class ProjectView {
  private readonly host = inject(HostBridge);
  private readonly state = signal<Record<string, Record<string, unknown>>>({});
  private readonly loaded = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  get<T>(projectId: string, key: string, fallback: T): T {
    if (!this.loaded.has(projectId)) {
      this.loaded.add(projectId);
      void this.host
        .invoke<Record<string, unknown>>('project.ui.get', {}, projectId)
        .then((stored) => this.state.update((all) => ({ ...all, [projectId]: { ...stored, ...(all[projectId] ?? {}) } })))
        .catch(() => {});
    }
    const value = this.state()[projectId]?.[key];
    return value === undefined ? fallback : (value as T);
  }

  set(projectId: string, key: string, value: unknown): void {
    this.state.update((all) => ({ ...all, [projectId]: { ...(all[projectId] ?? {}), [key]: value } }));
    clearTimeout(this.timers.get(projectId));
    this.timers.set(
      projectId,
      setTimeout(() => {
        const state = untracked(this.state)[projectId];
        if (state) void this.host.invoke('project.ui.set', { state }, projectId).catch(() => {});
      }, 400),
    );
  }
}
