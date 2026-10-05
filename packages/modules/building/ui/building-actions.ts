import { Service, computed, inject, type Signal } from '@angular/core';
import { deriveLevels, type DerivedLevel, type ProjectDoc } from '@studio/core';
import { Dialogs, HostBridge, ProjectDocs, ProjectView, Toasts } from '@studio/ui';

/** The commands the building panels run, with errors shown as toasts. */
@Service()
export class BuildingActions {
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly dialogs = inject(Dialogs);
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);

  async run<T = unknown>(projectId: string, id: string, input: unknown): Promise<T | undefined> {
    try {
      return await this.host.invoke<T>(id, input, projectId);
    } catch (err) {
      this.toasts.error(err);
      return undefined;
    }
  }

  /** The active level of a project: the stored choice while it exists, else the ground floor. */
  activeLevel(projectId: Signal<string | null>, doc: Signal<ProjectDoc | undefined>): Signal<string | null> {
    return computed(() => {
      const id = projectId();
      const d = doc();
      if (!id || !d) return null;
      const stored = this.view.get<string | null>(id, 'activeLevel', null);
      return stored && d.levels[stored] ? stored : d.building.groundLevelId;
    });
  }

  setActiveLevel(projectId: string, levelId: string): void {
    this.view.set(projectId, 'activeLevel', levelId);
  }

  levels(doc: Signal<ProjectDoc | undefined>): Signal<DerivedLevel[]> {
    return computed(() => {
      const d = doc();
      return d ? deriveLevels(d) : [];
    });
  }

  async addLevel(projectId: string, position: unknown, options: { name?: string } = {}): Promise<void> {
    const result = await this.run<{ id: string }>(projectId, 'building.level.add', { position, ...options });
    if (result) this.setActiveLevel(projectId, result.id);
  }

  async duplicate(projectId: string, levelId: string): Promise<void> {
    const result = await this.run<{ id: string }>(projectId, 'building.level.duplicate', { levelId });
    if (result) this.setActiveLevel(projectId, result.id);
  }

  async remove(projectId: string, level: DerivedLevel): Promise<void> {
    const doc = this.docs.read(projectId)?.doc;
    const count = Object.keys(doc?.levelData[level.id]?.entities ?? {}).length;
    if (count) {
      const ok = await this.dialogs.confirm({ title: `Remove "${level.name}"?`, message: `It holds ${count} item${count === 1 ? '' : 's'}. Levels above it move down. You can undo this.`, danger: true, confirmLabel: 'Remove' });
      if (!ok) return;
    }
    await this.run(projectId, 'building.level.remove', { levelId: level.id });
  }

  async rename(projectId: string, level: DerivedLevel): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Rename level', label: 'Name', defaultValue: level.name, confirmLabel: 'Rename' });
    if (name?.trim() && name.trim() !== level.name) await this.run(projectId, 'building.level.update', { levelId: level.id, name: name.trim() });
  }
}
