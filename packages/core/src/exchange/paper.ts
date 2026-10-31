import type { Box, Vec2 } from '../geometry/vec';
import { BRANDING } from '../branding';
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
  /** Whether the drawing fits the area left for it at that scale (a fixed scale may be too large for the sheet). */
  fits: boolean;
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
  const fits = isEmpty(bounds) || ((bounds.maxX - bounds.minX) / scale <= area.maxX - area.minX + 1e-9 && (bounds.maxY - bounds.minY) / scale <= area.maxY - area.minY + 1e-9);
  return { width, height, scale, fits, worldCenter, paperCenter: [(area.minX + area.maxX) / 2, (area.minY + area.maxY) / 2] };
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
  /** Helvetica Bold (the wordmark) instead of Helvetica. */
  bold?: boolean;
  /** Ink, when not the sheet's `fg`. */
  color?: string;
  /**
   * The wordmark's full stop. The PDF places it as its own run after the name (measured in Helvetica Bold);
   * the SVG, whose reader picks the font, writes it as a `<tspan>` of the name's text so it follows the name whatever font draws it.
   */
  stop?: boolean;
}

/** The one colour of the title block: the full stop of the wordmark. */
export const TITLE_BLOCK_ACCENT = '#b9552f';
/** The wordmark's size: a cap height of 3.2 mm in Helvetica, mm. */
const WORDMARK_SIZE = 3.2 / 0.72;

/**
 * The title block's frame (lines) and texts in paper mm, y up, in the bottom-right corner of a `width` × `height` sheet:
 * three rows of 8 mm, the wordmark (the product's name and a terracotta full stop) and the project on top, the level, then the scale and the date.
 */
export function titleBlock(width: number, info: TitleBlockInfo): { lines: [Vec2, Vec2][]; texts: TitleBlockText[] } {
  const x1 = width - PAGE_MARGIN;
  const x0 = x1 - TITLE_BLOCK.width;
  const y0 = PAGE_MARGIN;
  const y1 = y0 + TITLE_BLOCK.height;
  const ym = y1 - 8;
  const lines: [Vec2, Vec2][] = [
    [[x0, y0], [x1, y0]],
    [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]],
    [[x0, y1], [x0, y0]],
    [[x0, ym], [x1, ym]],
  ];
  const room = TITLE_BLOCK.width - 6;
  const name = BRANDING.productName;
  const nameWidth = textWidthEm(winAnsi(name), false, true) * WORDMARK_SIZE;
  const stopWidth = textWidthEm(winAnsi('.'), false, true) * WORDMARK_SIZE;
  const wordmark = nameWidth + stopWidth;
  const texts: TitleBlockText[] = [
    { at: [x0 + 3, y1 - 6], text: name, size: WORDMARK_SIZE, align: 'left', bold: true },
    { at: [x0 + 3 + nameWidth, y1 - 6], text: '.', size: WORDMARK_SIZE, align: 'left', bold: true, color: TITLE_BLOCK_ACCENT, stop: true },
    { at: [x1 - 3, y1 - 6], ...fitText(info.title, 4, Math.max(room - wordmark - 4, 10)), align: 'right' },
    { at: [x0 + 3, y1 - 13], ...fitText(info.levelName, 3, room), align: 'left' },
    { at: [x0 + 3, y0 + 2.8], text: `Scale 1:${formatScale(info.scale)}`, size: 2.8, align: 'left' },
    { at: [x1 - 3, y0 + 2.8], text: info.date ?? today(), size: 2.8, align: 'right' },
  ];
  return { lines, texts };
}

const formatScale = (scale: number) => String(Math.round(scale * 1000) / 1000);

/** How far a title block text may shrink before it is cut short, as a fraction of its size. */
const MIN_SHRINK = 0.7;

/** A title block text that fits `width` mm in Helvetica: shrunk down to 70 % of `size`, then cut short with an ellipsis. */
export function fitText(text: string, size: number, width: number): { text: string; size: number } {
  const em = textWidthEm(winAnsi(text));
  if (em * size <= width) return { text, size };
  const smaller = size * MIN_SHRINK;
  if (em * smaller <= width) return { text, size: width / em };
  const chars = [...text];
  const cut = () => chars.join('').trimEnd() + '…';
  while (chars.length && textWidthEm(winAnsi(cut())) * smaller > width) chars.pop();
  return { text: cut(), size: smaller };
}

/** Today as YYYY-MM-DD, local time. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Helvetica's cap height as a fraction of the font size; a DXF text's height (group 40) is its cap height. */
export const CAP_HEIGHT = 0.72;

/** How far below a text's anchor its baseline lies, as a fraction of the font size. */
export function baselineDrop(baseline: 'bottom' | 'middle' | 'top'): number {
  return baseline === 'middle' ? CAP_HEIGHT / 2 : baseline === 'top' ? CAP_HEIGHT : 0;
}

// ---------- text ----------

/** The code points of Windows-1252's 0x80–0x9F, the rest of WinAnsiEncoding matching Latin-1. */
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** A string as WinAnsiEncoding bytes (the PDF's page text): control characters become spaces, anything else the encoding lacks `?`. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252[c] !== undefined) out.push(CP1252[c]);
    else if (c < 32 || (c >= 0x7f && c < 0xa0)) out.push(32);
    else out.push(63);
  }
  return out;
}

/** Helvetica's advance widths (per 1000 em) for WinAnsi codes 32–126, from the standard AFM. */
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** Helvetica Bold's advance widths (per 1000 em) for WinAnsi codes 32–126, from the standard AFM. */
const HELVETICA_BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/** A few common codes above 127; the rest count as 556. */
const HELVETICA_HIGH: Record<number, number> = { 0xb0: 400, 0xb2: 333, 0xb3: 333, 0xb9: 333, 0xd7: 584, 0xb5: 556, 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x85: 1000, 0x80: 556 };

/** The width of WinAnsi bytes in Helvetica (Helvetica Bold, or Courier), in em. */
export function textWidthEm(bytes: readonly number[], mono = false, bold = false): number {
  if (mono) return bytes.length * 0.6;
  const ascii = bold ? HELVETICA_BOLD_ASCII : HELVETICA_ASCII;
  let w = 0;
  for (const b of bytes) w += b >= 32 && b <= 126 ? ascii[b - 32] : (HELVETICA_HIGH[b] ?? 556);
  return w / 1000;
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
