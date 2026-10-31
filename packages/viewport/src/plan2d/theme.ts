/** The colours the plan is drawn with. The renderer reads them from the CSS variables in styles.css, so they follow the theme. */
export interface PlanTheme {
  background: string;
  fg: string;
  muted: string;
  accent: string;
  grid: string;
  gridMajor: string;
  wall: string;
  wallLine: string;
  room: string;
  slab: string;
  dim: string;
  underlay: string;
  snap: string;
  selection: string;
  warning: string;
  /** Stairs, ramps, elevators and other connectors: their lines. */
  connector: string;
  /** Furniture and lights. */
  decor: string;
  /** Otto's ink: what the assistant changed (the halo, its tag, a pending outline). */
  ai: string;
  /** Text on Otto's ink: the tag's words. */
  aiFg: string;
  fontSans: string;
  fontMono: string;
}

/** The light palette, the `:root` block of styles.css (`packages/modules/plan/snapshot-theme.test.ts` keeps them equal), used when no document is available (tests, thumbnails). */
export const LIGHT_THEME: PlanTheme = {
  background: '#f6f1e8',
  fg: '#2a2521',
  muted: '#7b7064',
  accent: '#b9552f',
  grid: '#ebe4d7',
  gridMajor: '#dbd1bf',
  wall: '#3b3531',
  wallLine: '#231f1c',
  room: '#8b9a6b',
  slab: '#e9e1d2',
  dim: '#3f5390',
  underlay: '#a89c8c',
  snap: '#2f8a57',
  selection: '#b9552f',
  warning: '#b8841f',
  connector: '#4b433d',
  decor: '#8c6b4a',
  ai: '#8a3f6f',
  aiFg: '#fbf6ee',
  fontSans: "'Alegreya Sans', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
};

/** The dark palette, the `.dark` block of styles.css (`packages/modules/plan/snapshot-theme.test.ts` keeps them equal): renders asked for in dark (`export.image`) without the window's theme. */
export const DARK_THEME: PlanTheme = {
  background: '#1d1a17',
  fg: '#ebe3d6',
  muted: '#a2968a',
  accent: '#e07c50',
  grid: '#272320',
  gridMajor: '#352f2b',
  wall: '#d8cfc2',
  wallLine: '#f3ece1',
  room: '#a4b385',
  slab: '#2a2623',
  dim: '#91a4e0',
  underlay: '#7a7066',
  snap: '#6fcf8a',
  selection: '#e07c50',
  warning: '#e2b24a',
  connector: '#e3dacc',
  decor: '#d4a97a',
  ai: '#d892bd',
  aiFg: '#1d1a17',
  fontSans: "'Alegreya Sans', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
};

/** The CSS variable each plan colour is read from. */
export const PLAN_THEME_VARIABLES: Record<keyof PlanTheme, string> = {
  background: '--canvas',
  fg: '--fg',
  muted: '--muted',
  accent: '--accent',
  grid: '--plan-grid',
  gridMajor: '--plan-grid-major',
  wall: '--plan-wall',
  wallLine: '--plan-wall-line',
  room: '--plan-room',
  slab: '--plan-slab',
  dim: '--plan-dim',
  underlay: '--plan-underlay',
  snap: '--plan-snap',
  selection: '--plan-selection',
  warning: '--plan-warning',
  connector: '--plan-connector',
  decor: '--plan-decor',
  ai: '--plan-ai',
  aiFg: '--ai-fg',
  fontSans: '--font-sans',
  fontMono: '--font-mono',
};

/** Reads the theme from the computed style of `root` (the document element); missing variables keep the light defaults. */
export function readPlanTheme(root: Element): PlanTheme {
  const style = getComputedStyle(root);
  const theme = { ...LIGHT_THEME };
  for (const key of Object.keys(PLAN_THEME_VARIABLES) as (keyof PlanTheme)[]) {
    const value = style.getPropertyValue(PLAN_THEME_VARIABLES[key]).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

/** `#rrggbb` with an alpha, as `rgba()`; other colour strings are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
