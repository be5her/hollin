import { Component, computed, input, model } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { formatLength, type UnitSettings } from '@studio/core';
import { cn } from '@studio/ui';

interface Choice<T> {
  value: T;
  label: string;
}

const SYSTEMS: Choice<UnitSettings['system']>[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];
const METRIC_UNITS: Choice<UnitSettings['metricUnit']>[] = [
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
];
const IMPERIAL_STYLES: Choice<UnitSettings['imperialStyle']>[] = [
  { value: 'ft-in', label: `Feet and inches` },
  { value: 'in', label: 'Inches' },
];
const PRECISIONS: Choice<number>[] = [0, 1, 2, 3].map((value) => ({ value, label: value === 0 ? '1' : `0.${'0'.repeat(value - 1)}1` }));
const FRACTIONS: Choice<UnitSettings['fraction']>[] = ([1, 2, 4, 8, 16, 32, 64] as const).map((value) => ({ value, label: value === 1 ? '1"' : `1/${value}"` }));

/**
 * Display units and precision as one control: `<x-units-editor [formField]="form.units" />`.
 * Lengths are always stored in millimetres; this only changes how they are shown and typed.
 */
@Component({
  selector: 'x-units-editor',
  template: `
    <div class="grid grid-cols-[9rem_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
      <span class="text-muted text-xs">System</span>
      <div class="flex gap-1" role="radiogroup" aria-label="Unit system">
        @for (c of systems; track c.value) {
          <button type="button" role="radio" [attr.aria-checked]="value().system === c.value" [class]="chip(value().system === c.value)" [disabled]="disabled()" [attr.data-testid]="'units-system-' + c.value" (click)="set('system', c.value)">{{ c.label }}</button>
        }
      </div>
      @if (value().system === 'metric') {
        <span class="text-muted text-xs">Unit</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Metric unit">
          @for (c of metricUnits; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="value().metricUnit === c.value" [class]="chip(value().metricUnit === c.value)" [disabled]="disabled()" [attr.data-testid]="'units-metric-' + c.value" (click)="set('metricUnit', c.value)">{{ c.label }}</button>
          }
        </div>
        <span class="text-muted text-xs">Precision</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Precision">
          @for (c of precisions; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="value().precision === c.value" [class]="chip(value().precision === c.value)" [disabled]="disabled()" (click)="set('precision', c.value)">{{ c.label }}</button>
          }
        </div>
      } @else {
        <span class="text-muted text-xs">Style</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Imperial style">
          @for (c of imperialStyles; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="value().imperialStyle === c.value" [class]="chip(value().imperialStyle === c.value)" [disabled]="disabled()" (click)="set('imperialStyle', c.value)">{{ c.label }}</button>
          }
        </div>
        <span class="text-muted text-xs">Round to</span>
        <div class="flex gap-1 flex-wrap" role="radiogroup" aria-label="Fraction">
          @for (c of fractions; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="value().fraction === c.value" [class]="chip(value().fraction === c.value)" [disabled]="disabled()" (click)="set('fraction', c.value)">{{ c.label }}</button>
          }
        </div>
      }
      <span class="text-muted text-xs">Example</span>
      <span class="font-mono text-xs" data-testid="units-example">{{ example() }}</span>
    </div>
  `,
})
export class UnitsEditor implements FormValueControl<UnitSettings> {
  readonly value = model.required<UnitSettings>();
  readonly disabled = input(false);

  protected readonly systems = SYSTEMS;
  protected readonly metricUnits = METRIC_UNITS;
  protected readonly imperialStyles = IMPERIAL_STYLES;
  protected readonly precisions = PRECISIONS;
  protected readonly fractions = FRACTIONS;
  /** A typical room width and a door, shown the way the plan will show them. */
  protected readonly example = computed(() => `${formatLength(3213.1, this.value())}  ·  ${formatLength(915, this.value())}`);

  protected set<K extends keyof UnitSettings>(key: K, next: UnitSettings[K]): void {
    this.value.update((units) => ({ ...units, [key]: next }));
  }

  protected chip(selected: boolean): string {
    return cn(
      'h-7 px-2.5 rounded-md border text-xs transition-colors disabled:opacity-50',
      selected ? 'border-accent bg-accent/10 text-fg' : 'border-edge text-muted hover:text-fg hover:bg-elevated',
    );
  }
}
