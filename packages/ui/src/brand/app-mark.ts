import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';

/**
 * The app icon as inline SVG (`resources/icon.svg`, two rooms): your room in ink with the terracotta door swing, the
 * assistant's room in mulberry with the pen dot, on a paper tile with a hairline edge. The icon does not follow the
 * theme: the paper tile reads on both the light and the dark title bar, so the colours are the icon's own.
 */
@Component({
  selector: 'x-app-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0 leading-none', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="64 64 896 896" width="100%" height="100%" aria-hidden="true" focusable="false" class="block">
      <rect x="64" y="64" width="896" height="896" rx="200" fill="#f6f1e8" />
      <rect x="70" y="70" width="884" height="884" rx="194" fill="none" stroke="#d9cebc" stroke-width="12" />
      <path d="M264 640 H464 A200 200 0 0 0 264 440 Z" fill="#b9552f" />
      <path d="M264 640 H464" stroke="#2a2521" stroke-width="24" />
      <g fill="#2a2521">
        <rect x="176" y="256" width="384" height="88" />
        <rect x="176" y="680" width="384" height="88" />
        <rect x="472" y="256" width="88" height="512" />
        <rect x="176" y="256" width="88" height="184" />
        <rect x="176" y="640" width="88" height="128" />
      </g>
      <g fill="#8a3f6f">
        <rect x="560" y="680" width="288" height="88" />
        <rect x="760" y="256" width="88" height="512" />
        <rect x="672" y="256" width="176" height="88" />
        <circle cx="672" cy="300" r="66" />
      </g>
    </svg>
  `,
})
export class AppMark {
  /** Side in pixels (22 in the title bar). */
  readonly size = input(22, { transform: numberAttribute });
}
