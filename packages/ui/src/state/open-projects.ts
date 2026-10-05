import { Service, computed, inject, signal } from '@angular/core';
import type { OpenProject, SaveStatus } from '@studio/core';
import { AppState } from './app-state';

/** The projects open in the host, mirrored for the shell (title bar, status bar) and modules. */
@Service()
export class OpenProjects {
  private readonly app = inject(AppState);
  private readonly list = signal<OpenProject[]>([]);

  readonly projects = this.list.asReadonly();
  /** The project on screen. */
  readonly current = computed(() => this.list().find((p) => p.id === this.app.activeProjectId()) ?? null);

  set(projects: OpenProject[]): void {
    this.list.set(projects);
  }

  upsert(project: OpenProject): void {
    this.list.update((list) => (list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [...list, project]));
  }

  remove(id: string): void {
    this.list.update((list) => list.filter((p) => p.id !== id));
  }

  setSave(id: string, save: SaveStatus): void {
    this.list.update((list) => list.map((p) => (p.id === id ? { ...p, save } : p)));
  }

  get(id: string): OpenProject | undefined {
    return this.list().find((p) => p.id === id);
  }
}
