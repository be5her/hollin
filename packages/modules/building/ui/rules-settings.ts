import { Component, computed, inject, linkedSignal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { defaultConfig, type RuleLimits } from '@studio/core';
import { AppState, HostBridge, Input, Label, LengthInput, Toasts, Units } from '@studio/ui';

type LengthKey = Exclude<keyof RuleLimits, 'maxRampSlope'>;

const LENGTHS: { key: LengthKey; label: string }[] = [
  { key: 'maxRiser', label: 'Highest riser' },
  { key: 'minRiser', label: 'Lowest riser' },
  { key: 'minTread', label: 'Shallowest tread' },
  { key: 'minStairWidth', label: 'Narrowest stair' },
  { key: 'comfortMin', label: '2 × riser + tread, from' },
  { key: 'comfortMax', label: '2 × riser + tread, to' },
  { key: 'stairCutHeight', label: 'Plan cut above the floor' },
];

/** Settings > Rules: the limits stairs and ramps are checked against, in display units. */
@Component({
  selector: 'x-rules-settings',
  imports: [FormField, Input, Label, LengthInput],
  template: `
    <p class="text-xs text-muted mb-3">Stairs and ramps are checked against these limits; what breaks them shows in a project's Warnings. A stair's own riser and tread values take precedence.</p>
    <div class="grid grid-cols-2 gap-x-4 gap-y-2.5 max-w-lg">
      @for (field of lengths; track field.key) {
        <div>
          <label xLabel [for]="'rule-' + field.key">{{ field.label }}</label>
          <input xInput xLength class="font-mono" [id]="'rule-' + field.key" [formField]="draftForm[field.key]" (commit)="save(field.key, $event)" [attr.data-testid]="'rule-' + field.key" />
        </div>
      }
      <div>
        <label xLabel for="rule-maxRampSlope">Steepest ramp (%)</label>
        <input xInput class="font-mono" id="rule-maxRampSlope" [formField]="draftForm.maxRampSlope" (blur)="saveSlope()" (keydown.enter)="$any($event.target).blur()" data-testid="rule-maxRampSlope" />
      </div>
    </div>
  `,
})
export class RulesSettings {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly units = inject(Units);

  protected readonly lengths = LENGTHS;
  private readonly limits = computed(() => this.app.config()?.rules ?? defaultConfig().rules);
  protected readonly draft = linkedSignal(() => {
    const limits = this.limits();
    const out = { maxRampSlope: String(limits.maxRampSlope) } as Record<keyof RuleLimits, string>;
    for (const { key } of LENGTHS) out[key] = this.units.length(limits[key]);
    return out;
  });
  protected readonly draftForm = form(this.draft);

  protected save(key: LengthKey, mm: number | null): void {
    if (mm === null || mm <= 0) return;
    void this.patch({ [key]: mm });
  }

  protected saveSlope(): void {
    const value = Number(this.draft().maxRampSlope.replace('%', '').trim());
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      this.toasts.notify('The slope must be a percentage above 0 and at most 100.', 'error');
      this.draft.update((d) => ({ ...d, maxRampSlope: String(this.limits().maxRampSlope) }));
      return;
    }
    if (value !== this.limits().maxRampSlope) void this.patch({ maxRampSlope: value });
  }

  private async patch(rules: Partial<RuleLimits>): Promise<void> {
    try {
      await this.host.invoke('config.update', { patch: { rules } }, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
