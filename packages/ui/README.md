# @studio/ui

The renderer's shared pieces: the host bridge and state services, the icon directive, the controls (`button[xButton]`, `input[xInput]`, badges, key caps ...), toasts, dialogs and the context menu. TypeScript sources compiled with the Angular app.

## Brand components (`src/brand/`)

Three small standalone, OnPush components with signal inputs and the artwork inline; no new dependency.

- **`<x-app-mark [size]="22">`**: the app icon (`resources/icon.svg`, two rooms: yours in ink with the terracotta door swing, Otto's in mulberry with the pen dot) on its paper tile with a hairline edge. The icon does not follow the theme; the paper tile reads on the light and the dark title bar alike.
- **`<x-wordmark [size]="16">`**: the product name from `BRANDING.productName` in Fraunces 600 (`font-display`, SOFT 80) with the terracotta full stop (`text-accent`) as a span. **Shipped as live text in the bundled Fraunces, not as outlined paths**: it follows a rename in `branding.json` and the theme with no artwork to redraw. The hand-drawn `design/identity/wordmark.svg` stays the fallback for places without the font (installer, exports) and is not used in the app. Sizes: 16 (title bar), 40 (About), 56 (first launch).
- **`<x-otto-mark [size]="28">`**: Otto's mark, a `--ai` tile with the room outlined in `--ai-fg` and the pen dot; follows the theme. Sizes 28, 24, 20, 16, 14.

The title bar lockup is the app mark (22) and the wordmark (16); see `src/renderer/README.md`.
