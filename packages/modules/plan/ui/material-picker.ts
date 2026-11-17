import { Component, computed, inject, input, output } from '@angular/core';
import { MATERIALS, builtinMaterial, parseRef } from '@studio/core';
import { I18n, Select } from '@studio/ui';

/**
 * A material for a surface: none, one of the built-in materials, or any colour (`paint:#rrggbb`,
 * from the colour well beside it). Emits the new reference, or null for none.
 */
@Component({
  selector: 'x-material-picker',
  imports: [Select],
  template: `
    <div class="flex items-center gap-2">
      <select xSelect class="flex-1 min-w-0 h-7 text-xs" (change)="pick($any($event.target).value)" [attr.aria-label]="labelText()" [attr.data-testid]="testId()">
        <option value="" [selected]="!value()">{{ i18n.label(noneLabel()) }}</option>
        @for (m of materials; track m.id) {
          <option [value]="'builtin:' + m.id" [selected]="value() === 'builtin:' + m.id">{{ i18n.catalogName('builtin:' + m.id, m.name) }}</option>
        }
        @if (paint(); as color) {
          <option [value]="'paint:' + color" selected>{{ t('plan.material.colour', { color }) }}</option>
        }
        @if (value() === 'mixed') {
          <option value="mixed" selected disabled>{{ t('plan.material.mixed') }}</option>
        }
      </select>
      <input type="color" class="size-7 shrink-0 rounded border border-edge bg-transparent cursor-pointer" [value]="color()" (change)="pick('paint:' + $any($event.target).value)" [attr.aria-label]="t('plan.material.colourOf', { label: labelText() })" [attr.data-testid]="testId() + '-color'" />
    </div>
  `,
})
export class MaterialPicker {
  /** The current reference, `mixed`, or null/undefined for none. */
  readonly value = input<string | null | undefined>(null);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** What the picker is for: a message key (or plain text) shown through `I18n.label`. */
  readonly label = input('plan.material.label');
  readonly noneLabel = input('plan.material.none');
  readonly testId = input('material-picker');
  readonly changed = output<string | null>();

  protected readonly materials = MATERIALS;
  protected readonly labelText = computed(() => this.i18n.label(this.label()));
  protected readonly paint = computed(() => {
    const parsed = parseRef(this.value() ?? '');
    return parsed?.k === 'paint' ? parsed.color : null;
  });
  protected readonly color = computed(() => {
    const parsed = parseRef(this.value() ?? '');
    if (parsed?.k === 'paint') return parsed.color;
    if (parsed?.k === 'builtin') return builtinMaterial(parsed.id)?.color ?? '#cccccc';
    return '#cccccc';
  });

  protected pick(value: string): void {
    if (value === 'mixed') return;
    this.changed.emit(value || null);
  }
}
