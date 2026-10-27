import type { Box, Vec2 } from '../geometry/vec';
import type { DrawingSegment } from './drawing';

/*
 * Paper for the SVG and PDF writers: sheet sizes, the plotting scales, fitting a drawing on a sheet
 * and the title block, all in paper millimetres with y up.
 */

export const PAPER_SIZES = ['A4', 'A3', 'A2', 'A1', 'Letter', 'Tabloid'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export type PaperOrientation = 'portrait' | 'landscape';

/** Width and height in portrait, mm. */
const PORTRAIT: Record<PaperSize, readonly [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
};

/** The scales `fit` picks from (the denominators of 1:20 ... 1:1000), largest drawing first. */
export const PLOT_SCALES = [20, 25, 50, 100, 200, 250, 500, 1000] as const;
/** The white border round the sheet, mm. */
export const PAGE_MARGIN = 10;
/** The title block in the bottom-right corner, mm. */
export const TITLE_BLOCK = { width: 90, height: 24 } as const;

export function paperSize(page: PaperSize, orientation: PaperOrientation): { width: number; height: number } {
  const [w, h] = PORTRAIT[page];
  return orientation === 'landscape' ? { width: h, height: w } : { width: w, height: h };
}

export interface PageOptions {
  page?: PaperSize;
  orientation?: PaperOrientation;
  /** The denominator (100 for 1:100), or `fit` for the largest plotting scale that fits. Default 100. */
  scale?: number | 'fit';
  /** Whether a title block takes the bottom of the sheet. */
  titleBlock?: boolean;
}

/** Where a drawing sits on a sheet: the sheet's size, the scale, and the world point at the centre of the area left for the drawing. */
export interface PageLayout {
  width: number;
  height: number;
  scale: number;
  /** The world point (mm) placed at `paperCenter`. */
  worldCenter: Vec2;
  /** The centre of the drawing area on the sheet, paper mm, y up. */
  paperCenter: Vec2;
}

/** The area left for the drawing inside the margins (and above the title block), paper mm, y up. */
export function drawingArea(width: number, height: number, titleBlock: boolean): Box {
  return { minX: PAGE_MARGIN, minY: PAGE_MARGIN + (titleBlock ? TITLE_BLOCK.height + 4 : 0), maxX: width - PAGE_MARGIN, maxY: height - PAGE_MARGIN };
}

const isEmpty = (b: Box) => !(b.maxX >= b.minX && b.maxY >= b.minY);

/** The largest plotting scale at which `bounds` (world mm) fits in a `width` × `height` mm area; past 1:1000, the next thousand that fits. */
export function fitScale(bounds: Box, width: number, height: number): number {
  if (isEmpty(bounds)) return 100;
  const need = Math.max((bounds.maxX - bounds.minX) / Math.max(width, 1e-9), (bounds.maxY - bounds.minY) / Math.max(height, 1e-9));
  for (const s of PLOT_SCALES) if (need <= s + 1e-9) return s;
  return Math.ceil(need / 1000) * 1000;
}

/** Lays a drawing's bounds out on a sheet, centred in the drawing area. */
export function layoutPage(bounds: Box, options: PageOptions = {}): PageLayout {
  const { width, height } = paperSize(options.page ?? 'A3', options.orientation ?? 'landscape');
  const area = drawingArea(width, height, options.titleBlock ?? false);
  const scale = options.scale === 'fit' ? fitScale(bounds, area.maxX - area.minX, area.maxY - area.minY) : (options.scale ?? 100);
  const worldCenter: Vec2 = isEmpty(bounds) ? [0, 0] : [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  return { width, height, scale, worldCenter, paperCenter: [(area.minX + area.maxX) / 2, (area.minY + area.maxY) / 2] };
}

/** A world point on the sheet, paper mm, y up. */
export function toPaper(layout: PageLayout, p: Vec2): Vec2 {
  return [(p[0] - layout.worldCenter[0]) / layout.scale + layout.paperCenter[0], (p[1] - layout.worldCenter[1]) / layout.scale + layout.paperCenter[1]];
}

export interface TitleBlockInfo {
  /** The project's name. */
  title: string;
  levelName: string;
  scale: number;
  /** As printed, e.g. `2026-10-27`; today by default. */
  date?: string;
}

export interface TitleBlockText {
  at: Vec2;
  text: string;
  /** Font size, paper mm. */
  size: number;
  align: 'left' | 'right';
}

/** The title block's frame (lines) and texts in paper mm, y up, in the bottom-right corner of a `width` × `height` sheet. */
export function titleBlock(width: number, info: TitleBlockInfo): { lines: [Vec2, Vec2][]; texts: TitleBlockText[] } {
  const x1 = width - PAGE_MARGIN;
  const x0 = x1 - TITLE_BLOCK.width;
  const y0 = PAGE_MARGIN;
  const y1 = y0 + TITLE_BLOCK.height;
  const ym = y0 + 8;
  const lines: [Vec2, Vec2][] = [
    [[x0, y0], [x1, y0]],
    [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]],
    [[x0, y1], [x0, y0]],
    [[x0, ym], [x1, ym]],
  ];
  const texts: TitleBlockText[] = [
    { at: [x0 + 3, y1 - 6.5], text: info.title, size: 4, align: 'left' },
    { at: [x0 + 3, y1 - 12.5], text: info.levelName, size: 3, align: 'left' },
    { at: [x0 + 3, y0 + 2.8], text: `Scale 1:${formatScale(info.scale)}`, size: 2.8, align: 'left' },
    { at: [x1 - 3, y0 + 2.8], text: info.date ?? today(), size: 2.8, align: 'right' },
  ];
  return { lines, texts };
}

const formatScale = (scale: number) => String(Math.round(scale * 1000) / 1000);

/** Today as YYYY-MM-DD, local time. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How far below a text's anchor its baseline lies, as a fraction of the font size (cap height about 0.72 em). */
export function baselineDrop(baseline: 'bottom' | 'middle' | 'top'): number {
  return baseline === 'middle' ? 0.36 : baseline === 'top' ? 0.72 : 0;
}

/** Splits full-turn arcs in two, for formats where one arc command cannot hold a whole circle. */
export function halfTurns(segs: readonly DrawingSegment[]): DrawingSegment[] {
  const out: DrawingSegment[] = [];
  for (const s of segs) {
    if (s.k === 'arc' && Math.abs(s.sweep) >= 2 * Math.PI - 1e-9) {
      const half = s.sweep / 2;
      const mid: Vec2 = [s.center[0] + s.radius * Math.cos(s.start + half), s.center[1] + s.radius * Math.sin(s.start + half)];
      out.push({ ...s, b: mid, sweep: half }, { ...s, a: mid, start: s.start + half, sweep: half });
    } else out.push(s);
  }
  return out;
}
