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
  /** Stairs, ramps, elevators and other connectors: their lines, and the fill of their treads and shafts. */
  connector: string;
  connectorFill: string;
  /** Furniture and lights. */
  decor: string;
  fontSans: string;
  fontMono: string;
}

/** The light placeholder palette, used when no document is available (tests, thumbnails). */
export const LIGHT_THEME: PlanTheme = {
  background: '#f7f7f5',
  fg: '#1d1f22',
  muted: '#676b72',
  accent: '#2f6fda',
  grid: '#e9e9e5',
  gridMajor: '#d6d6d1',
  wall: '#4a4e55',
  wallLine: '#1d1f22',
  room: '#2f6fda',
  slab: '#dcdcd7',
  dim: '#2f6fda',
  underlay: '#9a9ca3',
  snap: '#1f8a4c',
  selection: '#2f6fda',
  warning: '#b7791f',
  connector: '#33363c',
  connectorFill: '#f1f1ee',
  decor: '#8a6a45',
  fontSans: 'system-ui, sans-serif',
  fontMono: 'ui-monospace, monospace',
};

const VARIABLES: Record<keyof PlanTheme, string> = {
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
  connectorFill: '--plan-connector-fill',
  decor: '--plan-decor',
  fontSans: '--font-sans',
  fontMono: '--font-mono',
};

/** Reads the theme from the computed style of `root` (the document element); missing variables keep the light defaults. */
export function readPlanTheme(root: Element): PlanTheme {
  const style = getComputedStyle(root);
  const theme = { ...LIGHT_THEME };
  for (const key of Object.keys(VARIABLES) as (keyof PlanTheme)[]) {
    const value = style.getPropertyValue(VARIABLES[key]).trim();
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
