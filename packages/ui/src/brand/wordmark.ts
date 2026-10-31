import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';
import { BRANDING } from '@studio/core';

/**
 * The product name in Fraunces 600 (the bundled font, `--font-display`) with the terracotta full stop. It is live text
 * set from `BRANDING.productName`, so a rename in `branding.json` needs no artwork; the text is selectable and follows
 * the theme. Sizes: 16 px in the title bar, 40 in About, 56 on first launch.
 */
@Component({
  selector: 'x-wordmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-block whitespace-nowrap font-display font-semibold text-fg',
    '[style.font-size.px]': 'size()',
    style: "line-height: 1; letter-spacing: -0.01em; font-variation-settings: 'SOFT' 80, 'opsz' 18",
  },
  template: `{{ name }}<span class="text-accent">.</span>`,
})
export class Wordmark {
  /** Font size in pixels. */
  readonly size = input(16, { transform: numberAttribute });
  protected readonly name = BRANDING.productName;
}
