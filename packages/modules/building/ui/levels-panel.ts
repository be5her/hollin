import { Component, ElementRef, computed, inject, input, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { DerivedLevel } from '@studio/core';
import { Autofocus, ContextMenu, DropMarker, Icon, IconButton, Input, Label, ProjectDocs, SectionHeader, Select, Toasts, Units, dragReorder } from '@studio/ui';
import { ArrowDownToLine, Copy, GripVertical, Layers2, Plus } from 'lucide';
import { BuildingActions } from './building-actions';

interface LevelDraft {
  name: string;
  elevation: string;
  height: string;
  slab: string;
}

/** The building's levels from top to bottom, with their elevations; the active level's details below. */
@Component({
  selector: 'x-levels-panel',
  imports: [Autofocus, DropMarker, FormField, Icon, IconButton, Input, Label, SectionHeader, Select],
  templateUrl: './levels-panel.html',
  host: { class: 'flex flex-col', 'data-testid': 'levels-panel' },
})
export class LevelsPanel {
  private readonly docs = inject(ProjectDocs);
  private readonly menu = inject(ContextMenu);
  private readonly toasts = inject(Toasts);
  protected readonly units = inject(Units);
  protected readonly actions = inject(BuildingActions);
  private readonly list = viewChild<ElementRef<HTMLDivElement>>('list');

  readonly projectId = input.required<string>();

  protected readonly icons = { ArrowDownToLine, Copy, GripVertical, Layers2, Plus };
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  protected readonly levels = this.actions.levels(this.doc);
  /** Top to bottom, as a section reads. */
  protected readonly display = computed(() => [...this.levels()].reverse());
  protected readonly active = this.actions.activeLevel(computed(() => this.projectId()), this.doc);
  protected readonly activeLevel = computed(() => this.levels().find((l) => l.id === this.active()) ?? null);

  protected readonly draft = linkedSignal<DerivedLevel | null, LevelDraft>({
    source: this.activeLevel,
    computation: (level) => ({
      name: level?.name ?? '',
      elevation: level ? this.units.length(level.elevation) : '',
      height: level ? this.units.length(level.height) : '',
      slab: level ? this.units.length(level.slabThickness) : '',
    }),
  });
  protected readonly draftForm = form(this.draft);
  /** The stacked levels a mezzanine can be placed from, top to bottom. */
  protected readonly hosts = computed(() => this.display().filter((l) => l.placement === 'stack'));

  /** The level whose name is being edited in its row, and the text. */
  protected readonly renaming = signal<string | null>(null);
  protected readonly renameDraft = signal({ name: '' });
  protected readonly renameForm = form(this.renameDraft);

  protected readonly reorder = dragReorder(
    'y',
    () => this.list()?.nativeElement,
    (id, to) => {
      // Slots count from the top of the list; the stack counts from the bottom.
      const others = this.display().filter((l) => l.placement === 'stack' && l.id !== id).length;
      void this.actions.run(this.projectId(), 'building.level.move', { levelId: id, index: others - to });
    },
  );

  protected select(level: DerivedLevel): void {
    if (!this.reorder.suppressClick()) this.actions.setActiveLevel(this.projectId(), level.id);
  }

  /** Saves one field of the active level when it loses focus, if it changed and reads as a length. */
  protected async save(field: keyof LevelDraft): Promise<void> {
    const level = untracked(this.activeLevel);
    if (!level) return;
    const value = untracked(this.draft)[field].trim();
    if (field === 'name') {
      if (value && value !== level.name) await this.actions.run(this.projectId(), 'building.level.update', { levelId: level.id, name: value });
      return;
    }
    const mm = this.units.parseLength(value);
    const current = field === 'elevation' ? level.elevation : field === 'height' ? level.height : level.slabThickness;
    if (mm === null) {
      this.toasts.notify(`"${value}" is not a length`, 'error');
      this.draft.update((d) => ({ ...d, [field]: this.units.length(current) }));
      return;
    }
    if (Math.abs(mm - current) < 0.0005) return;
    const key = field === 'slab' ? 'slabThickness' : field;
    await this.actions.run(this.projectId(), 'building.level.update', { levelId: level.id, [key]: mm });
  }

  protected startRename(level: DerivedLevel): void {
    this.renameDraft.set({ name: level.name });
    this.renaming.set(level.id);
  }

  /** Enter or leaving the field saves the name; Escape (`cancel`) drops it. */
  protected async finishRename(level: DerivedLevel, cancel = false): Promise<void> {
    if (untracked(this.renaming) !== level.id) return;
    this.renaming.set(null);
    const name = untracked(this.renameDraft).name.trim();
    if (!cancel && name && name !== level.name) await this.actions.run(this.projectId(), 'building.level.update', { levelId: level.id, name });
  }

  protected rowKey(event: KeyboardEvent, level: DerivedLevel): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') this.select(level);
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename(level);
    }
  }

  protected setHost(level: DerivedLevel, hostLevelId: string): void {
    if (hostLevelId && hostLevelId !== level.hostLevelId) void this.actions.setHost(this.projectId(), level.id, hostLevelId);
  }

  protected showMenu(event: MouseEvent, level: DerivedLevel): void {
    const id = this.projectId();
    const stacked = level.placement === 'stack';
    this.menu.open(event, [
      { label: 'Rename', select: () => this.startRename(level), testId: 'level-menu-rename' },
      { label: 'Duplicate', select: () => void this.actions.duplicate(id, level.id), disabled: !stacked, testId: 'level-menu-duplicate' },
      { label: 'Add level above…', select: () => void this.actions.addLevelWith(id, { above: level.id }, `Add a level above "${level.name}"`), disabled: !stacked, testId: 'level-menu-add-above' },
      { label: 'Add level below…', select: () => void this.actions.addLevelWith(id, { below: level.id }, `Add a level below "${level.name}"`), disabled: !stacked, testId: 'level-menu-add-below' },
      stacked
        ? { label: 'Add mezzanine…', select: () => void this.actions.addMezzanine(id, level), testId: 'level-menu-mezzanine' }
        : { label: 'Move to another level…', select: () => void this.actions.rehost(id, level), testId: 'level-menu-rehost' },
      { label: 'Make ground floor', select: () => void this.actions.run(id, 'building.level.update', { levelId: level.id, ground: true }), disabled: !stacked || level.isGround, testId: 'level-menu-ground' },
      'separator',
      { label: 'Remove level…', danger: true, select: () => void this.actions.remove(id, level), testId: 'level-menu-remove' },
    ]);
  }

  protected showAddMenu(event: MouseEvent): void {
    const id = this.projectId();
    const levels = this.levels();
    const stacked = levels.filter((l) => l.placement === 'stack');
    this.menu.open(event, [
      { label: 'Level on top', select: () => void this.actions.addLevel(id, 'top'), testId: 'level-add-top' },
      { label: 'Basement below', select: () => void this.actions.addLevel(id, stacked.length ? { below: stacked[0].id } : 'bottom'), testId: 'level-add-basement' },
    ]);
  }
}
