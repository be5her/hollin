import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The four house footprints a tinted Home sheet can carry, picked from the project id with the tint. */
const DOODLES = [
  'M-70 40 V-20 L0 -60 L70 -20 V40 Z M-20 40 V0 H20 V40 M-70 -20 H70',
  'M-80 30 H80 M-80 30 V-30 H-10 L0 -50 L10 -30 H80 V30 M-50 30 V-10 H-20 V30 M30 -5 H60 V15 H30 Z',
  'M-70 40 H70 M-60 40 V-10 L0 -55 L60 -10 V40 M-25 40 V5 H25 V40 M30 -40 V-55 H42 V-30',
  'M-80 40 H80 M-80 40 V-20 H0 V40 M0 -20 L40 -50 L80 -20 V40 M-50 10 H-30 M20 -10 H60',
] as const;

/**
 * The faint pencil doodle of a house on a Home card without a thumbnail: one of four footprints in ink at
 * 55 %, with a dimension tick in the plan's dimension colour. It fills its box; the sheet's tint is the parent's.
 */
@Component({
  selector: 'x-house-doodle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 340 236" width="100%" height="100%" class="block" focusable="false">
      <g transform="translate(170 108)" fill="none" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" style="stroke: var(--fg)">
        <path [attr.d]="path()" />
        <path d="M-70 62 H70 M-70 56 V68 M70 56 V68" stroke-width="1" opacity="0.7" style="stroke: var(--plan-dim)" />
      </g>
    </svg>
  `,
})
export class HouseDoodle {
  /** Which footprint, 0 to 3 (taken modulo 4). */
  readonly variant = input(0);
  protected readonly path = computed(() => DOODLES[((this.variant() % 4) + 4) % 4]);
}

/**
 * The pencil sketch of one room for the empty moments (first launch, the empty project): walls, a door swing,
 * a window, a 4 000 mm dimension and the terracotta pencil, in the plan's colours so both themes follow.
 */
@Component({
  selector: 'x-room-sketch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 240 150" width="100%" height="100%" class="block" focusable="false">
      <g fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--fg)">
        <path d="M40 30 H200 V118 H40 Z" />
        <path d="M40 70 V96" stroke-width="4" style="stroke: var(--canvas)" />
        <path d="M40 96 H66" />
        <path d="M66 96 A26 26 0 0 0 40 70" stroke-dasharray="2 4" stroke-width="1.2" />
        <path d="M90 30 H140" stroke-width="5" style="stroke: var(--canvas)" />
        <path d="M90 28 H140 M90 32 H140" stroke-width="1" />
        <path d="M40 134 H200 M40 128 V140 M200 128 V140" stroke-width="1.2" style="stroke: var(--plan-dim)" />
        <path d="M100 60 H150 M100 72 H140" stroke-width="1.2" style="stroke: var(--plan-decor)" />
        <path d="M160 100 l16 -16" stroke-width="2.2" style="stroke: var(--accent)" />
        <path d="M176 84 l6 -6 l3 3 l-6 6 Z" style="stroke: var(--accent); fill: var(--accent)" />
      </g>
      <text x="120" y="131" text-anchor="middle" font-size="9" style="font-family: var(--font-mono); fill: var(--plan-dim); paint-order: stroke; stroke: var(--canvas); stroke-width: 6px">4 000 mm</text>
    </svg>
  `,
})
export class RoomSketch {}
