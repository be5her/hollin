import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';

/**
 * Otto's mark: a mulberry tile (`--ai`) with Otto's room on it, a square outlined in `--ai-fg` with the pen, a dot,
 * still on its top-right corner. Drawn at 28, 24, 20, 16 and 14 px; it follows the theme through the variables.
 */
@Component({
  selector: 'x-otto-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0 leading-none', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false" class="block">
      <rect width="64" height="64" rx="14" style="fill: var(--ai)" />
      <rect x="17" y="20" width="28" height="28" rx="2.5" fill="none" stroke-width="5" style="stroke: var(--ai-fg)" />
      <circle cx="45" cy="20" r="7" style="fill: var(--ai-fg)" />
    </svg>
  `,
})
export class OttoMark {
  /** Side in pixels: 28, 24, 20, 16 or 14. */
  readonly size = input(28, { transform: numberAttribute });
}
