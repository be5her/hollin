import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MATERIALS, builtinMaterial, itemModel, itemSize, parseRef, type Entity } from '@studio/core';
import { AngleInput, HostBridge, Input, LengthInput, ProjectDocs, Select, Toasts, Units } from '@studio/ui';

type Item = Extract<Entity, { type: 'item' }>;

interface Draft {
  x: string;
  y: string;
  height: string;
  rotation: string;
  w: string;
  d: string;
  h: string;
}

/**
 * A selected furniture item in the Properties panel: its model, where it stands (x, y and its
 * height above the floor) and its turn, its size typed in display units (stored as a scale of the
 * model's own size, so the model stays the truth), and a material for each of its slots. Every
 * change is `plan.entity.update` with the change number the panel saw.
 */
@Component({
  selector: 'x-item-properties',
  imports: [AngleInput, FormField, Input, LengthInput, Select],
  template: `
    @let e = item();
    @let m = model();
    <div class="text-xs text-muted" data-testid="item-model">
      Model <span class="text-fg">{{ m.name }}</span>
      <span class="block font-mono text-[11px] truncate" [title]="e.asset">{{ e.asset }}</span>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <label><span class="block text-xs font-medium text-muted mb-1">X</span><input xInput xLength class="font-mono" [formField]="f.x" (commit)="setAt(0, $event)" data-testid="item-x" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Y</span><input xInput xLength class="font-mono" [formField]="f.y" (commit)="setAt(1, $event)" data-testid="item-y" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Above the floor</span><input xInput xLength class="font-mono" [formField]="f.height" (commit)="setAt(2, $event)" data-testid="item-height" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Turn</span><input xInput xAngle class="font-mono" [formField]="f.rotation" (commit)="setRotation($event)" data-testid="item-rotation" /></label>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <label><span class="block text-xs font-medium text-muted mb-1">Width</span><input xInput xLength #tw="xLength" class="font-mono" [formField]="f.w" (commit)="setSize(0, $event)" data-testid="item-w" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Depth</span><input xInput xLength class="font-mono" [formField]="f.d" (commit)="setSize(1, $event)" data-testid="item-d" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Height</span><input xInput xLength class="font-mono" [formField]="f.h" (commit)="setSize(2, $event)" data-testid="item-h" /></label>
    </div>
    @if (tw.invalid()) {
      <span class="block text-[11px] text-danger -mt-1.5">Not a length</span>
    }
    @if (e.scale[0] < 0) {
      <div class="text-[11px] text-muted -mt-1">Mirrored</div>
    }
    @if (m.slots.length) {
      <div class="text-[11px] font-medium text-muted uppercase tracking-wide mt-1">Materials</div>
      @for (slot of m.slots; track slot) {
        <label class="flex items-center gap-2">
          <span class="w-16 shrink-0 text-xs text-muted capitalize truncate">{{ slot }}</span>
          <select xSelect class="flex-1 min-w-0 h-7 text-xs" (change)="setMaterial(slot, $any($event.target).value)" [attr.data-testid]="'item-slot-' + slot">
            <option value="" [selected]="!e.materials[slot]">Default · {{ defaultName(slot) }}</option>
            @for (mat of materials; track mat.id) {
              <option [value]="'builtin:' + mat.id" [selected]="e.materials[slot] === 'builtin:' + mat.id">{{ mat.name }}</option>
            }
            @if (paintOf(slot); as paint) {
              <option [value]="'paint:' + paint" selected>Colour {{ paint }}</option>
            }
          </select>
          <input type="color" class="size-7 shrink-0 rounded border border-edge bg-transparent cursor-pointer" [value]="colorOf(slot)" (change)="setMaterial(slot, 'paint:' + $any($event.target).value)" [attr.aria-label]="'Colour of ' + slot" [attr.data-testid]="'item-color-' + slot" />
        </label>
      }
    }
  `,
  host: { class: 'flex flex-col gap-2.5', 'data-testid': 'item-editor' },
})
export class ItemProperties {
  private readonly docs = inject(ProjectDocs);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();
  readonly item = input.required<Item>();

  protected readonly materials = MATERIALS;
  private readonly state = computed(() => this.docs.read(this.projectId()));
  protected readonly model = computed(() => itemModel(this.item().asset, this.state()?.doc.assets ?? {}));

  protected readonly draft = linkedSignal<{ item: Item; model: ReturnType<typeof itemModel> }, Draft>({
    source: computed(() => ({ item: this.item(), model: this.model() })),
    computation: ({ item, model }) => {
      const len = (mm: number) => this.units.length(mm);
      const size = itemSize(item, model);
      return { x: len(item.at[0]), y: len(item.at[1]), height: len(item.at[2]), rotation: this.units.angle(item.rotation[2]), w: len(size[0]), d: len(size[1]), h: len(size[2]) };
    },
  });
  protected readonly f = form(this.draft);

  private async update(set: Record<string, unknown>): Promise<void> {
    const s = untracked(this.state);
    try {
      await this.host.invoke('plan.entity.update', { id: untracked(this.item).id, set, ...(s ? { baseSeq: s.seq, epoch: s.epoch } : {}) }, untracked(this.projectId));
    } catch (err) {
      this.toasts.error(err);
      this.draft.set(untracked(this.draft));
    }
  }

  protected setAt(axis: 0 | 1 | 2, mm: number | null): void {
    if (mm === null) return;
    const at = [...untracked(this.item).at];
    at[axis] = mm;
    void this.update({ at });
  }

  protected setRotation(degrees: number | null): void {
    if (degrees === null) return;
    const r = untracked(this.item).rotation;
    void this.update({ rotation: [r[0], r[1], degrees] });
  }

  /** A size typed in display units becomes the scale of the model's own size on that axis (a mirrored item stays mirrored). */
  protected setSize(axis: 0 | 1 | 2, mm: number | null): void {
    if (mm === null || mm <= 0) return;
    const e = untracked(this.item);
    const own = untracked(this.model).size[axis];
    const scale = [...e.scale];
    scale[axis] = Math.sign(e.scale[axis] || 1) * (mm / Math.max(own, 1e-6));
    void this.update({ scale });
  }

  protected setMaterial(slot: string, ref: string): void {
    const e = untracked(this.item);
    const materials = { ...e.materials };
    if (ref) materials[slot] = ref;
    else delete materials[slot];
    void this.update({ materials });
  }

  /** The name of a slot's default material. */
  protected defaultName(slot: string): string {
    const ref = this.model().recipe?.slots[slot];
    const parsed = ref ? parseRef(ref) : null;
    return parsed?.k === 'builtin' ? (builtinMaterial(parsed.id)?.name ?? parsed.id) : 'the model';
  }

  /** The paint colour a slot is given, if it is a plain colour. */
  protected paintOf(slot: string): string | null {
    const parsed = parseRef(this.item().materials[slot] ?? '');
    return parsed?.k === 'paint' ? parsed.color : null;
  }

  /** The colour a slot shows, for the colour picker. */
  protected colorOf(slot: string): string {
    const ref = this.item().materials[slot] ?? this.model().recipe?.slots[slot] ?? '';
    const parsed = parseRef(ref);
    if (parsed?.k === 'paint') return parsed.color;
    if (parsed?.k === 'builtin') return builtinMaterial(parsed.id)?.color ?? '#b0b0b0';
    return '#b0b0b0';
  }
}
