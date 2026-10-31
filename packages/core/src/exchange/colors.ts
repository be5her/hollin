import type { DrawingColor } from './drawing';

/*
 * The printable palette of the SVG and PDF writers: each colour role of a plan drawing as a hex
 * colour for paper, warm ink on a white sheet (the paper is the screen's, the sheet is the printer's).
 * Core never imports the viewport, so the plan theme's light colours (`--plan-*` in styles.css) are
 * mirrored here by hand; the identity's print table is design/identity/04-canvas.md section (e).
 */

export const PRINT_COLORS: Readonly<Record<DrawingColor, string>> = Object.freeze({
  fg: '#231f1c',
  muted: '#7b7064',
  wall: '#3b3531',
  wallLine: '#231f1c',
  room: '#8b9a6b',
  slab: '#e9e1d2',
  dim: '#3f5390',
  connector: '#4b433d',
  decor: '#8c6b4a',
  warning: '#b8841f',
});

/** A `#rrggbb` colour as red, green and blue in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
