import { Service, computed, inject, signal, untracked, type Signal, type Type } from '@angular/core';
import type { ProjectDoc } from '@studio/core';
import { HostBridge } from '../host/host-bridge';

/** A panel a module adds to the project tab. Its component gets a `projectId` input. */
export interface ProjectPanel {
  id: string;
  title: string;
  /** Left column, right column (as tabs), or the main view in the centre. */
  side: 'left' | 'right' | 'center';
  order: number;
  component: Type<unknown>;
  /** A count shown on the panel's tab when it is not zero (the Warnings panel). */
  badge?: (projectId: string) => Signal<number>;
  /** A brand mark drawn before the tab's title: `otto` for the assistant's tab. */
  mark?: 'otto';
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
  /** The keys changed since the last flush: only those are sent, since main merges and owns keys of its own (the assistant's session). */
  private readonly pending = new Map<string, Set<string>>();

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
    let keys = this.pending.get(projectId);
    if (!keys) this.pending.set(projectId, (keys = new Set()));
    keys.add(key);
    clearTimeout(this.timers.get(projectId));
    this.timers.set(
      projectId,
      setTimeout(() => {
        const state = untracked(this.state)[projectId];
        const changed = this.pending.get(projectId);
        this.pending.delete(projectId);
        if (!state || !changed?.size) return;
        const patch = Object.fromEntries([...changed].map((k) => [k, state[k] ?? null]));
        void this.host.invoke('project.ui.set', { state: patch }, projectId).catch(() => {});
      }, 400),
    );
  }

  /** The active level of a project: the stored choice while it exists, else the ground floor. Shared by every panel that follows the level. */
  activeLevel(projectId: Signal<string | null>, doc: Signal<ProjectDoc | undefined>): Signal<string | null> {
    return computed(() => {
      const id = projectId();
      const d = doc();
      if (!id || !d) return null;
      const stored = this.get<string | null>(id, 'activeLevel', null);
      return stored && d.levels[stored] ? stored : d.building.groundLevelId;
    });
  }

  setActiveLevel(projectId: string, levelId: string): void {
    this.set(projectId, 'activeLevel', levelId);
  }
}
