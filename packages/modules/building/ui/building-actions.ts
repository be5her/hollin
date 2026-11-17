import { Service, computed, inject, type Signal } from '@angular/core';
import { deriveLevels, isMessageKey, levelRemovalImpact, type DerivedLevel, type ProjectDoc } from '@studio/core';
import { Dialogs, HostBridge, I18n, ProjectDocs, ProjectView, Toasts, Units, type FormDialogField } from '@studio/ui';


/** The commands the building panels run, with errors shown as toasts. */
@Service()
export class BuildingActions {
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly dialogs = inject(Dialogs);
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly units = inject(Units);
  private readonly t = inject(I18n).t;

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
        { key: 'name', label: this.t('building.levels.name'), value: '', validate: () => null },
        this.lengthField('height', this.t('building.levels.height'), 3000, true),
        this.lengthField('slab', this.t('building.levels.slab'), 200, false),
      ],
      confirmLabel: this.t('building.add.confirm'),
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
      title: this.t('building.mezzanine.title', { name: host.name }),
      message: this.t('building.mezzanine.message'),
      fields: [
        { key: 'name', label: this.t('building.levels.name'), value: this.t('building.mezzanine.defaultName', { name: host.name }), validate: (text) => (text.trim() ? null : this.t('building.mezzanine.nameRequired')) },
        this.lengthField('offset', this.t('building.mezzanine.offset'), offset, false),
        this.lengthField('height', this.t('building.mezzanine.height'), host.height - offset, true),
        this.lengthField('slab', this.t('building.levels.slab'), 200, false),
      ],
      confirmLabel: this.t('building.mezzanine.confirm'),
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
      title: this.t('building.rehost.title', { name: level.name }),
      message: this.t('building.rehost.message'),
      fields: [{ key: 'host', label: this.t('building.levels.placedFrom'), value: level.hostLevelId ?? '', options: hosts.map((l) => ({ value: l.id, label: this.t('building.rehost.option', { name: l.name, elevation: this.units.length(l.elevation) }) })) }],
      confirmLabel: this.t('building.rehost.confirm'),
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
        if (value === null) return this.t('building.field.notLength');
        return positive ? (value > 0 ? null : this.t('building.field.positive')) : value >= 0 ? null : this.t('building.field.notNegative');
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
    const t = this.t;
    if (impact.last) return void this.toasts.notify(t('building.remove.last'), 'error');
    if (impact.blockedBy.length) {
      const names = impact.blockedBy.map((l) => t('building.remove.quoted', { name: l.name })).join(t('common.listSeparator'));
      return void this.toasts.notify(t('building.remove.blocked', { names, level: level.name, count: impact.blockedBy.length }), 'error');
    }
    const list = (items: string[]) => items.join(t('common.listSeparator'));
    const details: string[] = [];
    const counts = Object.entries(impact.entities).map(([type, n]) => {
      const key = `plan.count.${type}`;
      return isMessageKey(key) ? t(key, { count: n! }) : `${n} ${type}s`;
    });
    if (counts.length) details.push(t('building.remove.everything', { list: list(counts) }));
    if (impact.connectorsRemoved.length) details.push(t('building.remove.connectors', { list: list(impact.connectorsRemoved.map((c) => c.name ?? t(`tools.noun.${c.kind}`))) }));
    if (impact.stopsDropped.length) details.push(t('building.remove.stops', { list: list(impact.stopsDropped.map((c) => c.name ?? t('tools.noun.elevator'))) }));
    if (impact.spansCut) details.push(t('building.remove.spans', { count: impact.spansCut }));
    if (details.length) {
      const message = level.placement === 'offset' ? t('building.remove.undo') : level.isBasement ? t('building.remove.basementsMove') : t('building.remove.levelsMove');
      const ok = await this.dialogs.confirm({ title: t('building.remove.title', { name: level.name }), message, details, danger: true, confirmLabel: t('building.remove.confirm') });
      if (!ok) return;
    }
    await this.run(projectId, 'building.level.remove', { levelId: level.id });
  }
}
