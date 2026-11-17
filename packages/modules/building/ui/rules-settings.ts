import { Component, computed, inject, linkedSignal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { defaultConfig, toLatinDigits, type RuleLimits } from '@studio/core';
import { AppState, HostBridge, I18n, Input, Label, LengthInput, Toasts, Units } from '@studio/ui';

type LengthKey = Exclude<keyof RuleLimits, 'maxRampSlope'>;

/** The length limits, each labelled by `building.rules.<key>`. */
const LENGTHS: LengthKey[] = ['maxRiser', 'minRiser', 'minTread', 'minStairWidth', 'comfortMin', 'comfortMax', 'stairCutHeight'];

/** Settings > Rules: the limits stairs and ramps are checked against, in display units. */
@Component({
  selector: 'x-rules-settings',
  imports: [FormField, Input, Label, LengthInput],
  template: `
    <p class="text-xs text-muted mb-3">{{ t('building.rules.intro') }}</p>
    <div class="grid grid-cols-2 gap-x-4 gap-y-2.5 max-w-lg">
      @for (key of lengths; track key) {
        <div>
          <label xLabel [for]="'rule-' + key">{{ label('building.rules.' + key) }}</label>
          <input xInput xLength class="font-mono" [id]="'rule-' + key" [formField]="draftForm[key]" (commit)="save(key, $event)" [attr.data-testid]="'rule-' + key" />
        </div>
      }
      <div>
        <label xLabel for="rule-maxRampSlope">{{ t('building.rules.maxRampSlope') }}</label>
        <input xInput class="font-mono" dir="ltr" id="rule-maxRampSlope" [formField]="draftForm.maxRampSlope" (blur)="saveSlope()" (keydown.enter)="$any($event.target).blur()" data-testid="rule-maxRampSlope" />
      </div>
    </div>
  `,
})
export class RulesSettings {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly units = inject(Units);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** A limit's label by its key (`building.rules.<key>`). */
  protected readonly label = this.i18n.label;

  protected readonly lengths = LENGTHS;
  private readonly limits = computed(() => this.app.config()?.rules ?? defaultConfig().rules);
  protected readonly draft = linkedSignal(() => {
    const limits = this.limits();
    const out = { maxRampSlope: String(limits.maxRampSlope) } as Record<keyof RuleLimits, string>;
    for (const key of LENGTHS) out[key] = this.units.length(limits[key]);
    return out;
  });
  protected readonly draftForm = form(this.draft);

  protected save(key: LengthKey, mm: number | null): void {
    if (mm === null || mm <= 0) return;
    void this.patch({ [key]: mm });
  }

  protected saveSlope(): void {
    const value = Number(toLatinDigits(this.draft().maxRampSlope).replace('%', '').trim());
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      this.toasts.notify(this.t('building.rules.slopeInvalid'), 'error');
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
