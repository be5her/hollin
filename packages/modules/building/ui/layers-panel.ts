import { Component, computed, inject, input } from '@angular/core';
import { LAYER_KINDS, type Layer, type LayerKind } from '@studio/core';
import { ContextMenu, Dialogs, Icon, IconButton, ProjectDocs, SectionHeader } from '@studio/ui';
import { Eye, EyeOff, Lock, LockOpen, Plus } from 'lucide';
import { ExchangeActions } from '../../exchange/ui/exchange-actions';
import { BuildingActions } from './building-actions';

const KIND_LABEL: Record<LayerKind, string> = { structure: 'Structure', interior: 'Interior', decor: 'Decor' };

/** The active level's layers: show or hide, lock, opacity, and what each holds. */
@Component({
  selector: 'x-layers-panel',
  imports: [Icon, IconButton, SectionHeader],
  template: `
    <x-section-header [title]="'Layers' + (levelName() ? ' · ' + levelName() : '')">
      <button xIconButton size="sm" label="Add a layer" (click)="showAddMenu($event)" data-testid="layer-add"><svg [xIcon]="icons.Plus" class="size-3.5"></svg></button>
    </x-section-header>
    <div class="flex flex-col gap-0.5 px-1.5 pb-3" role="list" aria-label="Layers">
      @for (layer of layers(); track layer.id) {
        <div
          role="listitem"
          class="flex flex-col gap-1 px-2 py-1.5 rounded-md hover:bg-elevated text-xs"
          data-testid="layer-row"
          [attr.data-name]="layer.name"
          [attr.data-visible]="layer.visible"
          [attr.data-locked]="layer.locked"
          (contextmenu)="showMenu($event, layer)"
        >
          <div class="flex items-center gap-1.5">
            <button xIconButton size="sm" [label]="layer.visible ? 'Hide ' + layer.name : 'Show ' + layer.name" (click)="toggle(layer, 'visible')" data-testid="layer-visible">
              <svg [xIcon]="layer.visible ? icons.Eye : icons.EyeOff" class="size-3.5"></svg>
            </button>
            <button xIconButton size="sm" [label]="layer.locked ? 'Unlock ' + layer.name : 'Lock ' + layer.name" (click)="toggle(layer, 'locked')" data-testid="layer-locked">
              <svg [xIcon]="layer.locked ? icons.Lock : icons.LockOpen" class="size-3.5" [class.text-warning]="layer.locked"></svg>
            </button>
            <span class="flex-1 truncate" [class.text-muted]="!layer.visible">{{ layer.name }}</span>
            <span class="text-[10px] uppercase tracking-wide text-muted">{{ kindLabel[layer.kind] }}</span>
            <span class="w-6 text-right text-[11px] text-muted tabular-nums" data-testid="layer-count">{{ counts()[layer.id] ?? 0 }}</span>
          </div>
          <label class="flex items-center gap-2 pl-14 text-[10px] text-muted">
            Opacity
            <input
              type="range"
              min="0"
              max="100"
              class="flex-1 accent-accent h-1"
              [value]="layer.opacity * 100"
              (input)="opacity(layer, $event)"
              [attr.aria-label]="'Opacity of ' + layer.name"
              data-testid="layer-opacity"
            />
            <span class="w-8 text-right tabular-nums">{{ Math.round(layer.opacity * 100) }}%</span>
          </label>
        </div>
      } @empty {
        <p class="px-2 text-xs text-muted">No layers on this level.</p>
      }
    </div>
  `,
  host: { class: 'flex flex-col', 'data-testid': 'layers-panel' },
})
export class LayersPanel {
  private readonly docs = inject(ProjectDocs);
  private readonly menu = inject(ContextMenu);
  private readonly dialogs = inject(Dialogs);
  private readonly actions = inject(BuildingActions);
  private readonly exchange = inject(ExchangeActions);

  readonly projectId = input.required<string>();

  protected readonly Math = Math;
  protected readonly icons = { Eye, EyeOff, Lock, LockOpen, Plus };
  protected readonly kindLabel = KIND_LABEL;
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  private readonly active = this.actions.activeLevel(computed(() => this.projectId()), this.doc);
  protected readonly levelName = computed(() => this.doc()?.levels[this.active() ?? '']?.name ?? '');
  protected readonly layers = computed(() => {
    const doc = this.doc();
    const levelId = this.active();
    return doc && levelId ? Object.values(doc.layers).filter((l) => l.levelId === levelId).sort((a, b) => a.order - b.order) : [];
  });
  protected readonly counts = computed(() => {
    const doc = this.doc();
    const levelId = this.active();
    const counts: Record<string, number> = {};
    for (const e of Object.values((doc && levelId && doc.levelData[levelId]?.entities) || {})) counts[e.layerId] = (counts[e.layerId] ?? 0) + 1;
    return counts;
  });

  protected toggle(layer: Layer, key: 'visible' | 'locked'): void {
    void this.actions.run(this.projectId(), 'plan.layer.update', { layerId: layer.id, [key]: !layer[key] });
  }

  protected opacity(layer: Layer, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value) / 100;
    void this.actions.run(this.projectId(), 'plan.layer.update', { layerId: layer.id, opacity: value });
  }

  protected showAddMenu(event: MouseEvent): void {
    const levelId = this.active();
    if (!levelId) return;
    this.menu.open(event, [
      ...LAYER_KINDS.map((kind) => ({ label: `${KIND_LABEL[kind]} layer`, select: () => void this.actions.run(this.projectId(), 'plan.layer.add', { levelId, kind }), testId: `layer-add-${kind}` })),
      'separator',
      // A DXF comes in on layers of its own (`DXF <layer>`), on the panel's level unless the dialog says otherwise.
      { label: 'Import DXF…', select: () => void this.exchange.importDxf(this.projectId(), levelId), testId: 'layer-add-dxf' },
    ]);
  }

  protected showMenu(event: MouseEvent, layer: Layer): void {
    this.menu.open(event, [
      { label: 'Rename…', select: () => void this.rename(layer), testId: 'layer-menu-rename' },
      { label: 'Remove layer', danger: true, select: () => void this.remove(layer), testId: 'layer-menu-remove' },
    ]);
  }

  private async rename(layer: Layer): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Rename layer', label: 'Name', defaultValue: layer.name, confirmLabel: 'Rename' });
    if (name?.trim() && name.trim() !== layer.name) await this.actions.run(this.projectId(), 'plan.layer.update', { layerId: layer.id, name: name.trim() });
  }

  private async remove(layer: Layer): Promise<void> {
    const count = this.counts()[layer.id] ?? 0;
    if (count) {
      const ok = await this.dialogs.confirm({ title: `Remove "${layer.name}" and its ${count} item${count === 1 ? '' : 's'}?`, message: 'You can undo this.', danger: true, confirmLabel: 'Remove' });
      if (!ok) return;
    }
    await this.actions.run(this.projectId(), 'plan.layer.remove', { layerId: layer.id, withEntities: count > 0 });
  }
}
