import type { SolidKind } from '@studio/core';

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

/** The light placeholder palette, used when no document is available (tests, snapshots). */
export const LIGHT_SCENE_THEME: SceneTheme = {
  background: '#f7f7f5',
  edge: '#3b3e44',
  wall: '#e9e6df',
  slab: '#c9c6bf',
  column: '#d9d5cc',
  glass: '#8fb8de',
  connector: '#d8cfc0',
  rail: '#5a5e66',
  car: '#2f6fda',
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

/** The theme colour a kind of solid is drawn in (frames and leaves without a material: the walls'). */
export const kindColor = (theme: SceneTheme, kind: SolidKind): string => (kind === 'frame' || kind === 'leaf' ? theme.wall : theme[kind]);
