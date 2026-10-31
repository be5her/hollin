import { SOLID_COLORS, type SolidKind } from '@studio/core';

/** The colours the 3D view is drawn with. The renderer reads them from the CSS variables in styles.css, so they follow the theme. */
export interface SceneTheme {
  background: string;
  /** The lines drawn along the solids' edges. */
  edge: string;
  wall: string;
  slab: string;
  column: string;
  glass: string;
  connector: string;
  rail: string;
  car: string;
  /** The box drawn for an imported model while it loads, or when it cannot be. */
  standIn: string;
}

/** The light palette, the `:root` block of styles.css, used when no document is available (tests, snapshots); its solid colours are core's `SOLID_COLORS`, which the glTF export writes. */
export const LIGHT_SCENE_THEME: SceneTheme = {
  background: '#f6f1e8',
  edge: '#3a332e',
  wall: SOLID_COLORS.wall,
  slab: SOLID_COLORS.slab,
  column: SOLID_COLORS.column,
  glass: SOLID_COLORS.glass,
  connector: SOLID_COLORS.connector,
  rail: SOLID_COLORS.rail,
  car: SOLID_COLORS.car,
  standIn: '#a69b8e',
};

/** The dark palette, the `.dark` block of styles.css (`packages/modules/plan/snapshot-theme.test.ts` keeps them equal): renders asked for in dark (`export.image`) without the window's theme. */
export const DARK_SCENE_THEME: SceneTheme = {
  background: '#1d1a17',
  edge: '#141210',
  wall: '#c4b9a8',
  slab: '#6f6358',
  column: '#a89c8c',
  glass: '#6e93ab',
  connector: '#a8947a',
  rail: '#d8cfc2',
  car: '#e07c50',
  standIn: '#5f574f',
};

/** The CSS variable each scene colour is read from. */
export const SCENE_THEME_VARIABLES: Record<keyof SceneTheme, string> = {
  background: '--canvas',
  edge: '--scene-edge',
  wall: '--scene-wall',
  slab: '--scene-slab',
  column: '--scene-column',
  glass: '--scene-glass',
  connector: '--scene-connector',
  rail: '--scene-rail',
  car: '--scene-car',
  standIn: '--scene-stand-in',
};

/** Reads the theme from the computed style of `root` (the document element); missing variables keep the light defaults. */
export function readSceneTheme(root: Element): SceneTheme {
  const style = getComputedStyle(root);
  const theme = { ...LIGHT_SCENE_THEME };
  for (const key of Object.keys(SCENE_THEME_VARIABLES) as (keyof SceneTheme)[]) {
    const value = style.getPropertyValue(SCENE_THEME_VARIABLES[key]).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

/** The theme colour a kind of solid is drawn in (frames, leaves and finishes without a material: the walls'). */
export const kindColor = (theme: SceneTheme, kind: SolidKind): string => (kind === 'frame' || kind === 'leaf' || kind === 'finish' ? theme.wall : theme[kind]);
