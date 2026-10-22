import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { Entity } from '@studio/core';
import { AngleInput, HostBridge, Input, LengthInput, ProjectDocs, Select, Toasts, Units } from '@studio/ui';

type Light = Extract<Entity, { type: 'light' }>;

interface Draft {
  kind: string;
  x: string;
  y: string;
  height: string;
  lumens: string;
  angle: string;
  tx: string;
  ty: string;
  tz: string;
}

/**
 * A selected light in the Properties panel: its kind, where it is (x, y, height above the floor),
 * its colour and lumens, and a spot's cone and target. Every change is `plan.entity.update` with the
 * change number the panel saw.
 */
@Component({
  selector: 'x-light-properties',
  imports: [AngleInput, FormField, Input, LengthInput, Select],
  template: `
    @let e = light();
    <label>
      <span class="block text-xs font-medium text-muted mb-1">Kind</span>
      <select xSelect class="w-full" [formField]="f.kind" (change)="setKind($any($event.target).value)" data-testid="light-kind">
        <option value="point">Point (a bulb)</option>
        <option value="spot">Spot</option>
        <option value="area">Area (a panel)</option>
      </select>
    </label>
    <div class="grid grid-cols-3 gap-2">
      <label><span class="block text-xs font-medium text-muted mb-1">X</span><input xInput xLength class="font-mono" [formField]="f.x" (commit)="setAt(0, $event)" data-testid="light-x" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Y</span><input xInput xLength class="font-mono" [formField]="f.y" (commit)="setAt(1, $event)" data-testid="light-y" /></label>
      <label><span class="block text-xs font-medium text-muted mb-1">Height</span><input xInput xLength class="font-mono" [formField]="f.height" (commit)="setAt(2, $event)" data-testid="light-height" /></label>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <label>
        <span class="block text-xs font-medium text-muted mb-1">Lumens</span>
        <input xInput class="font-mono" [formField]="f.lumens" (blur)="setLumens()" (keydown.enter)="$any($event.target).blur()" data-testid="light-lumens" />
      </label>
      <label>
        <span class="block text-xs font-medium text-muted mb-1">Colour</span>
        <input type="color" class="h-8 w-full rounded border border-edge bg-transparent cursor-pointer" [value]="e.color" (change)="set({ color: $any($event.target).value })" data-testid="light-color" />
      </label>
    </div>
    @if (e.kind === 'spot') {
      <label>
        <span class="block text-xs font-medium text-muted mb-1">Cone</span>
        <input xInput xAngle class="font-mono" [formField]="f.angle" (commit)="setAngle($event)" data-testid="light-angle" />
      </label>
      <div class="text-[11px] font-medium text-muted uppercase tracking-wide">Aimed at</div>
      <div class="grid grid-cols-3 gap-2">
        <label><span class="block text-xs font-medium text-muted mb-1">X</span><input xInput xLength [allowEmpty]="true" placeholder="below" class="font-mono" [formField]="f.tx" (commit)="setTarget(0, $event)" data-testid="light-tx" /></label>
        <label><span class="block text-xs font-medium text-muted mb-1">Y</span><input xInput xLength [allowEmpty]="true" placeholder="below" class="font-mono" [formField]="f.ty" (commit)="setTarget(1, $event)" /></label>
        <label><span class="block text-xs font-medium text-muted mb-1">Height</span><input xInput xLength [allowEmpty]="true" placeholder="0" class="font-mono" [formField]="f.tz" (commit)="setTarget(2, $event)" /></label>
      </div>
    }
  `,
  host: { class: 'flex flex-col gap-2.5', 'data-testid': 'light-editor' },
})
export class LightProperties {
  private readonly docs = inject(ProjectDocs);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();
  readonly light = input.required<Light>();

  private readonly state = computed(() => this.docs.read(this.projectId()));

  protected readonly draft = linkedSignal<Light, Draft>({
    source: this.light,
    computation: (e) => {
      const len = (mm: number | undefined) => (mm === undefined ? '' : this.units.length(mm));
      return { kind: e.kind, x: len(e.at[0]), y: len(e.at[1]), height: len(e.at[2]), lumens: String(e.intensity), angle: this.units.angle(e.angle ?? 60), tx: len(e.target?.[0]), ty: len(e.target?.[1]), tz: len(e.target?.[2]) };
    },
  });
  protected readonly f = form(this.draft);

  protected async set(set: Record<string, unknown>, unset: string[] = []): Promise<void> {
    const s = untracked(this.state);
    try {
      await this.host.invoke('plan.entity.update', { id: untracked(this.light).id, set, unset, ...(s ? { baseSeq: s.seq, epoch: s.epoch } : {}) }, untracked(this.projectId));
    } catch (err) {
      this.toasts.error(err);
      this.draft.set(untracked(this.draft));
    }
  }

  protected setKind(kind: string): void {
    if (kind === 'spot') void this.set({ kind, angle: untracked(this.light).angle ?? 60 });
    else if (kind === 'point' || kind === 'area') void this.set({ kind }, ['angle', 'target']);
  }

  protected setAt(axis: 0 | 1 | 2, mm: number | null): void {
    if (mm === null) return;
    const at = [...untracked(this.light).at];
    at[axis] = mm;
    void this.set({ at });
  }

  protected setLumens(): void {
    const e = untracked(this.light);
    const value = Number(untracked(this.draft).lumens.replace(/lm/i, '').trim());
    if (!Number.isFinite(value) || value < 0) {
      this.toasts.notify('Lumens: a number, 0 or more (800 is a household bulb).', 'error');
      this.draft.update((d) => ({ ...d, lumens: String(e.intensity) }));
      return;
    }
    if (value !== e.intensity) void this.set({ intensity: value });
  }

  protected setAngle(degrees: number | null): void {
    if (degrees === null || degrees < 1 || degrees > 179) return;
    void this.set({ angle: degrees });
  }

  /** A spot's aim: all three coordinates, a missing one taken from straight below the light; all empty aims it down. */
  protected setTarget(axis: 0 | 1 | 2, mm: number | null): void {
    const e = untracked(this.light);
    const d = untracked(this.draft);
    const parse = (text: string) => (text.trim() === '' ? null : this.units.parseLength(text));
    const values = [parse(d.tx), parse(d.ty), parse(d.tz)];
    values[axis] = mm;
    if (values.every((v) => v === null)) {
      void this.set({}, ['target']);
      return;
    }
    void this.set({ target: [values[0] ?? e.at[0], values[1] ?? e.at[1], values[2] ?? 0] });
  }
}
