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
}

/** The light placeholder palette, used when no document is available (tests, snapshots); its solid colours are core's `SOLID_COLORS`, which the glTF export writes. */
export const LIGHT_SCENE_THEME: SceneTheme = {
  background: '#f7f7f5',
  edge: '#3b3e44',
  wall: SOLID_COLORS.wall,
  slab: SOLID_COLORS.slab,
  column: SOLID_COLORS.column,
  glass: SOLID_COLORS.glass,
  connector: SOLID_COLORS.connector,
  rail: SOLID_COLORS.rail,
  car: SOLID_COLORS.car,
};

const VARIABLES: Record<keyof SceneTheme, string> = {
  background: '--canvas',
  edge: '--scene-edge',
  wall: '--scene-wall',
  slab: '--scene-slab',
  column: '--scene-column',
  glass: '--scene-glass',
  connector: '--scene-connector',
  rail: '--scene-rail',
  car: '--scene-car',
};

/** Reads the theme from the computed style of `root` (the document element); missing variables keep the light defaults. */
export function readSceneTheme(root: Element): SceneTheme {
  const style = getComputedStyle(root);
  const theme = { ...LIGHT_SCENE_THEME };
  for (const key of Object.keys(VARIABLES) as (keyof SceneTheme)[]) {
    const value = style.getPropertyValue(VARIABLES[key]).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

/** The theme colour a kind of solid is drawn in (frames, leaves and finishes without a material: the walls'). */
export const kindColor = (theme: SceneTheme, kind: SolidKind): string => (kind === 'frame' || kind === 'leaf' || kind === 'finish' ? theme.wall : theme[kind]);
