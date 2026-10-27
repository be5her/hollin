import type { DrawingColor } from './drawing';

/*
 * The printable palette of the SVG and PDF writers: each colour role of a plan drawing as a hex
 * colour for paper, near-black lines on white with the plan theme's accents kept recognisable.
 * Core never imports the viewport, so the plan theme's light colours are mirrored here, darkened.
 */

export const PRINT_COLORS: Readonly<Record<DrawingColor, string>> = Object.freeze({
  fg: '#111111',
  muted: '#5c6066',
  wall: '#3a3d42',
  wallLine: '#000000',
  room: '#1f5fbf',
  slab: '#d4d4cf',
  dim: '#1f5fbf',
  connector: '#222428',
  decor: '#7a5a35',
  warning: '#a8681a',
});

/** A `#rrggbb` colour as red, green and blue in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
