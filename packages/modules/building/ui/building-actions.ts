import { Service, computed, inject, type Signal } from '@angular/core';
import { deriveLevels, levelRemovalImpact, type DerivedLevel, type ProjectDoc } from '@studio/core';
import { Dialogs, HostBridge, ProjectDocs, ProjectView, Toasts, Units, type FormDialogField } from '@studio/ui';

const KIND_NAMES: Record<string, string> = { stair: 'stair', ladder: 'ladder', ramp: 'ramp', elevator: 'elevator', escalator: 'escalator' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The commands the building panels run, with errors shown as toasts. */
@Service()
export class BuildingActions {
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly dialogs = inject(Dialogs);
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly units = inject(Units);

  async run<T = unknown>(projectId: string, id: string, input: unknown): Promise<T | undefined> {
    try {
      return await this.host.invoke<T>(id, input, projectId);
    } catch (err) {
      this.toasts.error(err);
      return undefined;
    }
  }

  /** The active level of a project (see `ProjectView.activeLevel`); the plan view follows the same choice. */
  activeLevel(projectId: Signal<string | null>, doc: Signal<ProjectDoc | undefined>): Signal<string | null> {
    return this.view.activeLevel(projectId, doc);
  }

  setActiveLevel(projectId: string, levelId: string): void {
    this.view.setActiveLevel(projectId, levelId);
  }

  levels(doc: Signal<ProjectDoc | undefined>): Signal<DerivedLevel[]> {
    return computed(() => {
      const d = doc();
      return d ? deriveLevels(d) : [];
    });
  }

  async addLevel(projectId: string, position: unknown, options: { name?: string; height?: number; slabThickness?: number } = {}): Promise<void> {
    const result = await this.run<{ id: string }>(projectId, 'building.level.add', { position, ...options });
    if (result) this.setActiveLevel(projectId, result.id);
  }

  /** Asks for the new level's name, height and slab, then adds it at position. */
  async addLevelWith(projectId: string, position: unknown, title: string): Promise<void> {
    const values = await this.dialogs.form({
      title,
      fields: [
        { key: 'name', label: 'Name', value: '', validate: () => null },
        this.lengthField('height', 'Floor to floor', 3000, true),
        this.lengthField('slab', 'Slab', 200, false),
      ],
      confirmLabel: 'Add level',
    });
    if (!values) return;
    const name = values['name'].trim();
    await this.addLevel(projectId, position, {
      ...(name ? { name } : {}),
      height: this.units.parseLength(values['height'])!,
      slabThickness: this.units.parseLength(values['slab'])!,
    });
  }

  /** Asks for a mezzanine's name, offset above its host, height and slab, then adds it. */
  async addMezzanine(projectId: string, host: DerivedLevel): Promise<void> {
    const offset = Math.round(host.height / 2);
    const values = await this.dialogs.form({
      title: `Add a mezzanine in "${host.name}"`,
      message: 'A mezzanine sits at an offset above a stacked level and moves with it.',
      fields: [
        { key: 'name', label: 'Name', value: `${host.name} mezzanine`, validate: (t) => (t.trim() ? null : 'Give it a name') },
        this.lengthField('offset', 'Above the floor by', offset, false),
        this.lengthField('height', 'Height', host.height - offset, true),
        this.lengthField('slab', 'Slab', 200, false),
      ],
      confirmLabel: 'Add mezzanine',
    });
    if (!values) return;
    const result = await this.run<{ id: string }>(projectId, 'building.level.add', {
      name: values['name'].trim(),
      mezzanineOf: { levelId: host.id, offset: this.units.parseLength(values['offset'])! },
      height: this.units.parseLength(values['height'])!,
      slabThickness: this.units.parseLength(values['slab'])!,
    });
    if (result) this.setActiveLevel(projectId, result.id);
  }

  /** Asks which stacked level a mezzanine should be placed from, and moves it there. */
  async rehost(projectId: string, level: DerivedLevel): Promise<void> {
    const doc = this.docs.read(projectId)?.doc;
    if (!doc || level.placement !== 'offset') return;
    const hosts = deriveLevels(doc).filter((l) => l.placement === 'stack').reverse();
    const values = await this.dialogs.form({
      title: `Move "${level.name}"`,
      message: "It keeps its elevation if the new level reaches it; otherwise it sits on that level's floor.",
      fields: [{ key: 'host', label: 'Placed from', value: level.hostLevelId ?? '', options: hosts.map((l) => ({ value: l.id, label: `${l.name} (${this.units.length(l.elevation)})` })) }],
      confirmLabel: 'Move',
    });
    if (values && values['host'] !== level.hostLevelId) await this.setHost(projectId, level.id, values['host']);
  }

  async setHost(projectId: string, levelId: string, hostLevelId: string): Promise<void> {
    await this.run(projectId, 'building.level.update', { levelId, hostLevelId });
  }

  private lengthField(key: string, label: string, mm: number, positive: boolean): FormDialogField {
    return {
      key,
      label,
      value: this.units.length(mm),
      mono: true,
      validate: (text) => {
        const value = this.units.parseLength(text);
        if (value === null) return 'Not a length';
        return positive ? (value > 0 ? null : 'Must be more than 0') : value >= 0 ? null : 'Cannot be negative';
      },
    };
  }

  async duplicate(projectId: string, levelId: string): Promise<void> {
    const result = await this.run<{ id: string }>(projectId, 'building.level.duplicate', { levelId });
    if (result) this.setActiveLevel(projectId, result.id);
  }

  /** Removes a level after listing what goes with it (an empty level that nothing reaches goes at once). */
  async remove(projectId: string, level: DerivedLevel): Promise<void> {
    const doc = this.docs.read(projectId)?.doc;
    if (!doc) return;
    const impact = levelRemovalImpact(doc, level.id);
    if (impact.last) return void this.toasts.notify('A building needs at least one level.', 'error');
    if (impact.blockedBy.length) {
      const names = impact.blockedBy.map((l) => `"${l.name}"`).join(', ');
      return void this.toasts.notify(`Move or remove ${names} first: ${impact.blockedBy.length === 1 ? 'it is' : 'they are'} placed from "${level.name}".`, 'error');
    }
    const details: string[] = [];
    const counts = Object.entries(impact.entities).map(([type, n]) => plural(n!, type));
    if (counts.length) details.push(`Everything on it: ${counts.join(', ')}`);
    if (impact.connectorsRemoved.length) details.push(`Removed with it: ${impact.connectorsRemoved.map((c) => c.name ?? KIND_NAMES[c.kind]).join(', ')}`);
    if (impact.stopsDropped.length) details.push(`No longer stopping here: ${impact.stopsDropped.map((c) => c.name ?? 'elevator').join(', ')}`);
    if (impact.spansCut) details.push(`Cut short to their own level: ${plural(impact.spansCut, 'column, shaft or void', 'columns, shafts or voids')} reaching up to it`);
    if (details.length) {
      const moves = level.placement === 'offset' ? '' : level.isBasement ? ' Basements below it move up.' : ' Levels above it move down.';
      const ok = await this.dialogs.confirm({ title: `Remove "${level.name}"?`, message: `You can undo this.${moves}`, details, danger: true, confirmLabel: 'Remove' });
      if (!ok) return;
    }
    await this.run(projectId, 'building.level.remove', { levelId: level.id });
  }
}
