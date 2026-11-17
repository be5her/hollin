import { BRANDING } from '../branding';
import { StudioError } from '../errors';
import type { Vec2 } from '../geometry/vec';
import { hasRtl } from '../i18n/text';
import { arabicVisual, presentationBase, stripBidiControls } from './arabic-shape';
import { PRINT_COLORS, hexToRgb } from './colors';
import type { DrawingColor, DrawingFill, DrawingLayer, DrawingSegment, DrawingStroke, DrawingText, PlanDrawing } from './drawing';
import { baselineDrop, drawingArea, halfTurns, layoutPage, textWidthEm, titleBlock, toPaper, winAnsi, winAnsiCode, type PageLayout, type PaperOrientation, type PaperSize } from './paper';
import { readTrueType, subsetTrueType, type TrueTypeFont } from './truetype';

/*
 * Plan drawings as a hand-written PDF 1.4, one page per drawing: true vectors at a drawing scale,
 * strokes with round caps and joins, arcs as cubic Béziers (a quarter turn at most each), fills
 * even-odd with an ExtGState alpha for tints, texts in the standard Helvetica (and Courier for
 * monospaced texts) with WinAnsiEncoding, a title block. A drawing larger than the sheet at its
 * scale is clipped to the drawing area (inside the margins, above the title block). The file is
 * assembled as bytes, so the xref offsets are byte offsets whatever the strings hold.
 *
 * A text with right-to-left letters (Arabic) is shaped and put into visual order here
 * (`arabicVisual`), then written in runs: Latin and digits in Helvetica (or Courier) as any text,
 * Arabic in a TrueType face the caller passes (`arabicFont`), embedded as a subset under a Type0 font
 * (`CIDFontType2`, `Identity-H`, a `W` array of the glyphs used and a `ToUnicode` map back to the
 * letters), each text wrapped in an `ActualText` span holding it in logical order. A document
 * without such text is written exactly as before, without the face.
 */

export interface PdfOptions {
  page?: PaperSize;
  orientation?: PaperOrientation;
  /** The scale's denominator (100 for 1:100), or `fit`: per page, the largest plotting scale that fits the margins. Default 100. */
  scale?: number | 'fit';
  /** The date in the title blocks; today by default. */
  date?: string;
  /** Compresses each content stream (zlib, as node's `deflateSync`), written with `/Filter /FlateDecode`; streams are stored raw without it. */
  deflate?: (bytes: Uint8Array) => Uint8Array;
  /**
   * A TrueType face (the file's bytes) whose presentation forms write the Arabic texts: IBM Plex Sans Arabic
   * in the app. Embedded (a subset) only when a text needs it; a text with Arabic letters and no face fails
   * with UNAVAILABLE (`errors.exchange.noArabicFont`) rather than writing `?`.
   */
  arabicFont?: Uint8Array;
  /** The face's file, named in that error. */
  arabicFontName?: string;
}

/** A piece of a text line in one font, in visual order: WinAnsi bytes in the standard font, or glyphs of the embedded face. */
export type PdfTextRun =
  | { font: 'standard'; bytes: number[]; width: number }
  /** `glyphs`: each glyph, the letters it stands for in logical order (`text`) and, for a mark, where it is moved to over the letter before it (font units, x from that letter's end). */
  | { font: 'embedded'; glyphs: { id: number; dx: number; dy: number; text: string }[]; width: number };

/** Marks drawn under their letter (kasra, kasratan, hamza and alef below ...); the others go above. */
const BELOW_MARKS = new Set([0x0650, 0x064d, 0x0655, 0x0656, 0x065c, 0x065f, 0x06e3, 0x06ea, 0x06ed]);
/** The gap between a letter and the mark above or below it, font units per 1000. */
const MARK_GAP = 60;

/**
 * A line with right-to-left letters as the PDF writes it: shaped and in visual order, then split into runs
 * of the standard font (what WinAnsi encodes: Latin, digits, punctuation) and of the embedded face (the
 * rest it has a glyph for; `?` in the standard font otherwise). Spaces between two runs of the face stay
 * in it. Widths in em; a mark moves onto the letter before it (centred, above or below it, stacked) and
 * takes no width.
 */
export function pdfTextRuns(text: string, font: TrueTypeFont, options: { mono?: boolean; bold?: boolean; direction?: 'ltr' | 'rtl' } = {}): PdfTextRun[] {
  const visual = [...arabicVisual(text, options.direction)].map((c) => c.codePointAt(0)!);
  const runs: PdfTextRun[] = [];
  const em = (units: number) => units / font.unitsPerEm;
  const gap = (MARK_GAP * font.unitsPerEm) / 1000;
  /** The last letter of the face a mark sits on, and how high its marks reach so far. */
  let base: { box: [number, number, number, number]; advance: number; top: number; bottom: number } | null = null;
  for (let i = 0; i < visual.length; i++) {
    const cp = visual[i];
    const code = winAnsiCode(cp);
    const glyph = code === null ? font.glyph(cp) : 0;
    const last = runs[runs.length - 1];
    const nextOwn = () => {
      for (let j = i + 1; j < visual.length; j++) if (visual[j] !== 0x20) return winAnsiCode(visual[j]) === null && font.glyph(visual[j]) !== 0;
      return false;
    };
    const ownSpace = cp === 0x20 && last?.font === 'embedded' && font.glyph(0x20) !== 0 && nextOwn();
    if (glyph || ownSpace) {
      const id = glyph || font.glyph(0x20);
      const advance = font.advance(id);
      let dx = 0;
      let dy = 0;
      const box = font.glyphBounds(id);
      if (advance === 0 && base && box && /\p{M}/u.test(String.fromCodePoint(cp))) {
        dx = (base.box[0] + base.box[2]) / 2 - (box[0] + box[2]) / 2 - base.advance;
        if (BELOW_MARKS.has(cp)) {
          dy = base.bottom - gap - box[3];
          base.bottom = dy + box[1];
        } else {
          dy = base.top + gap - box[1];
          base.top = dy + box[3];
        }
      } else if (advance > 0) {
        const b = box ?? [0, 0, advance, 0];
        base = { box: b, advance, top: Math.max(b[3], 0), bottom: Math.min(b[1], 0) };
      }
      const run = last?.font === 'embedded' ? last : runs[runs.push({ font: 'embedded', glyphs: [], width: 0 }) - 1];
      if (run.font !== 'embedded') continue;
      run.glyphs.push({ id, dx, dy, text: glyph ? presentationBase(cp) : ' ' });
      run.width += em(advance);
      continue;
    }
    base = null;
    const byte = code ?? 63;
    const run = last?.font === 'standard' ? last : runs[runs.push({ font: 'standard', bytes: [], width: 0 }) - 1];
    if (run.font !== 'standard') continue;
    run.bytes.push(byte);
    run.width = textWidthEm(run.bytes, options.mono, options.bold);
  }
  return runs;
}

/** Glyph ids as a hex string of two bytes each (Identity-H). */
const glyphHex = (ids: readonly number[]) => `<${ids.map((g) => g.toString(16).toUpperCase().padStart(4, '0')).join('')}>`;

export interface PdfPage {
  drawing: PlanDrawing;
  /** The project's name: adds the title block (project, level, scale, date). */
  title?: string;
}

const PT = 72 / 25.4;

/** WinAnsi bytes as a PDF literal string, ASCII only: parentheses and backslashes escaped, the rest of the bytes outside printable ASCII as octal. */
function pdfString(bytes: readonly number[]): string {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

/** A PDF text string (the document information) in UTF-16BE with its byte order mark, written as hex, so any name comes through. */
export function pdfTextString(text: string): string {
  let hex = '<FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return hex + '>';
}

const n = (v: number): string => {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
};

const rgb = (hex: string) => hexToRgb(hex).map((c) => n(c)).join(' ');

/** An arc as cubic Béziers, a quarter turn at most each: [control 1, control 2, end] in world mm. */
export function arcToBeziers(seg: Extract<DrawingSegment, { k: 'arc' }>): [Vec2, Vec2, Vec2][] {
  const count = Math.max(1, Math.ceil(Math.abs(seg.sweep) / (Math.PI / 2) - 1e-9));
  const step = seg.sweep / count;
  const k = (4 / 3) * Math.tan(step / 4) * seg.radius;
  const { center: c, radius: r } = seg;
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < count; i++) {
    const t0 = seg.start + i * step;
    const t1 = t0 + step;
    const p0: Vec2 = [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0)];
    const p1: Vec2 = i === count - 1 ? seg.b : [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1)];
    out.push([
      [p0[0] - k * Math.sin(t0), p0[1] + k * Math.cos(t0)],
      [p1[0] + k * Math.sin(t1), p1[1] - k * Math.cos(t1)],
      p1,
    ]);
  }
  return out;
}

/** The embedded face as the pages use it: loaded when a text first needs it, with every glyph used and the letters it stands for. */
interface EmbeddedFace {
  /** The face; throws UNAVAILABLE when the document has none. */
  font(): TrueTypeFont;
  /** Glyph id → the text it stands for, in logical order (for ToUnicode). */
  used: Map<number, string>;
}

/** Builds one page's content stream; `gs` names an alpha's ExtGState (shared by every page). */
function pageContent(drawing: PlanDrawing, layout: PageLayout, title: string | undefined, date: string | undefined, gs: (alpha: number) => string, face: EmbeddedFace): string {
  const ops: string[] = ['1 J 1 j'];
  const p = (w: Vec2): string => {
    const q = toPaper(layout, w);
    return `${n(q[0] * PT)} ${n(q[1] * PT)}`;
  };
  const color = (c: DrawingColor | undefined, layer: DrawingLayer) => PRINT_COLORS[c ?? layer.color];

  const stroke = (s: DrawingStroke, layer: DrawingLayer) => {
    if (!s.segs.length) return;
    const path: string[] = [];
    let at: Vec2 | null = null;
    for (const seg of halfTurns(s.segs)) {
      if (!at || Math.abs(at[0] - seg.a[0]) > 1e-6 || Math.abs(at[1] - seg.a[1]) > 1e-6) path.push(`${p(seg.a)} m`);
      if (seg.k === 'line') path.push(`${p(seg.b)} l`);
      else for (const [c1, c2, e] of arcToBeziers(seg)) path.push(`${p(c1)} ${p(c2)} ${p(e)} c`);
      at = seg.b;
    }
    if (s.closed) path.push('h');
    const dash = s.dash?.length ? `[${s.dash.map((d) => n(d * PT)).join(' ')}] 0 d` : '[] 0 d';
    ops.push(`${rgb(color(s.color, layer))} RG ${n(Math.max(s.width, 0.05) * PT)} w ${dash}`, ...path, 'S');
  };

  const fill = (f: DrawingFill) => {
    const path: string[] = [];
    for (const ring of f.rings) {
      if (ring.length < 3) continue;
      ring.forEach((w, i) => path.push(`${p(w)} ${i ? 'l' : 'm'}`));
      path.push('h');
    }
    if (!path.length) return;
    const tint = f.opacity < 1;
    ops.push(...(tint ? ['q', `/${gs(f.opacity)} gs`] : []), `${rgb(PRINT_COLORS[f.color])} rg`, ...path, 'f*', ...(tint ? ['Q'] : []));
  };

  const textAt = (at: Vec2, value: string, sizeMm: number, rotationDeg: number, align: 'left' | 'center' | 'right', drop: number, hex: string, mono: boolean, bold = false, direction?: 'ltr' | 'rtl') => {
    // A text with right-to-left letters: shaped, reordered and written in runs (below).
    const runs = hasRtl(value) ? pdfTextRuns(value, face.font(), { mono, bold, direction }) : null;
    const bytes = runs ? [] : winAnsi(value);
    if (runs ? !runs.length : !bytes.length) return;
    const r = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const width = (runs ? runs.reduce((sum, run) => sum + run.width, 0) : textWidthEm(bytes, mono, bold)) * sizeMm;
    const shift = align === 'left' ? 0 : align === 'right' ? width : width / 2;
    const dropMm = drop * sizeMm;
    // Back along the text by the alignment, down from the anchor to the baseline.
    const x = at[0] - shift * cos + dropMm * sin;
    const y = at[1] - shift * sin - dropMm * cos;
    const standard = `/${mono ? 'F2' : bold ? 'F3' : 'F1'} ${n(sizeMm * PT)} Tf`;
    const matrix = `${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x * PT)} ${n(y * PT)} Tm`;
    if (!runs) {
      ops.push(`BT ${standard} ${rgb(hex)} rg ${matrix} ${pdfString(bytes)} Tj ET`);
      return;
    }
    const font = face.font();
    const parts: string[] = [];
    for (const run of runs) {
      if (run.font === 'standard') {
        parts.push(standard, `${pdfString(run.bytes)} Tj`);
        continue;
      }
      parts.push(`/F4 ${n(sizeMm * PT)} Tf`);
      // Glyphs in strings; a mark moved over its letter with a kerning step there and back, and raised with Ts.
      let pending: number[] = [];
      const flush = () => {
        if (pending.length) parts.push(`${glyphHex(pending)} Tj`);
        pending = [];
      };
      for (const g of run.glyphs) {
        if (!face.used.has(g.id)) face.used.set(g.id, g.text);
        if (!g.dx && !g.dy) {
          pending.push(g.id);
          continue;
        }
        flush();
        const k = n((-g.dx * 1000) / font.unitsPerEm);
        const rise = n((g.dy / font.unitsPerEm) * sizeMm * PT);
        parts.push(`[${k}] TJ ${rise} Ts ${glyphHex([g.id])} Tj 0 Ts [${n((g.dx * 1000) / font.unitsPerEm)}] TJ`);
      }
      flush();
    }
    // The text in logical order, for copying and searching in readers that honour ActualText.
    ops.push(`/Span << /ActualText ${pdfTextString(stripBidiControls(value))} >> BDC`, `BT ${rgb(hex)} rg ${matrix} ${parts.join(' ')} ET`, 'EMC');
  };

  const text = (t: DrawingText, layer: DrawingLayer) => {
    textAt(toPaper(layout, t.at), t.text, t.height / layout.scale, t.rotation, t.align, baselineDrop(t.baseline), color(t.color, layer), Boolean(t.mono), false, t.direction);
  };

  if (!layout.fits) {
    const area = drawingArea(layout.width, layout.height, title !== undefined);
    ops.push('% Clipped to the drawing area', 'q', `${n(area.minX * PT)} ${n(area.minY * PT)} ${n((area.maxX - area.minX) * PT)} ${n((area.maxY - area.minY) * PT)} re W n`);
  }
  for (const layer of drawing.layers) {
    ops.push(`% ${layer.name.replace(/[\r\n]/g, ' ')}`.replace(/[^\x20-\x7e]/g, '?'));
    for (const prim of layer.primitives) {
      if (prim.type === 'stroke') stroke(prim, layer);
      else if (prim.type === 'fill') fill(prim);
      else text(prim, layer);
    }
  }
  if (!layout.fits) ops.push('Q');
  if (title !== undefined) {
    // Names with Arabic letters are measured as written, in their runs.
    const measure = (value: string, size: number) => (hasRtl(value) ? pdfTextRuns(value, face.font()).reduce((sum, run) => sum + run.width, 0) : textWidthEm(winAnsi(value))) * size;
    const block = titleBlock(layout.width, { title, levelName: drawing.levelName, scale: layout.scale, date, measure });
    ops.push('% Title block', `${rgb(PRINT_COLORS.fg)} RG ${n(0.35 * PT)} w [] 0 d 0 J`);
    for (const [a, b] of block.lines) ops.push(`${n(a[0] * PT)} ${n(a[1] * PT)} m ${n(b[0] * PT)} ${n(b[1] * PT)} l S`);
    for (const t of block.texts) textAt(t.at, t.text, t.size, 0, t.align, 0, t.color ?? PRINT_COLORS.fg, false, t.bold, t.direction);
  }
  return ops.join('\n') + '\n';
}

const ascii = (s: string) => new TextEncoder().encode(s);

/** The PDF date of a moment: `D:YYYYMMDDHHmmSSZ`. */
const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;

/** A text as a CMap's hex string: UTF-16BE. */
const utf16Hex = (text: string) => {
  let hex = '';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
};

/** A subset font's name tag: six capitals from the glyphs it holds, so two different subsets never share a name. */
function subsetTag(glyphs: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const g of glyphs) {
    h ^= g;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + i * 7919;
  }
  return tag;
}

/**
 * The embedded face's objects, numbered from `first`: the Type0 font (Identity-H), its CIDFontType2 (CID =
 * glyph id, the widths of the glyphs used), the font descriptor, the font file (a subset of the glyphs used,
 * deflated when `deflate` is given) and the ToUnicode map from each glyph to the letters it stands for
 * (a lam-alef ligature to lam and alef).
 */
function embeddedFontObjects(font: TrueTypeFont, used: ReadonlyMap<number, string>, first: number, deflate?: (bytes: Uint8Array) => Uint8Array): (Uint8Array | string)[][] {
  const glyphs = [...used.keys()].sort((a, b) => a - b);
  const name = `${subsetTag(glyphs)}+${font.postScriptName}`;
  const scale = (v: number) => n((v * 1000) / font.unitsPerEm);
  // Widths: runs of consecutive glyph ids, `first [w1 w2 ...]`.
  const widths: string[] = [];
  for (let i = 0; i < glyphs.length; ) {
    let j = i;
    while (j + 1 < glyphs.length && glyphs[j + 1] === glyphs[j] + 1) j++;
    widths.push(`${glyphs[i]} [${glyphs.slice(i, j + 1).map((g) => scale(font.advance(g))).join(' ')}]`);
    i = j + 1;
  }
  const file = subsetTrueType(font, glyphs);
  const packed = deflate ? deflate(file) : file;
  const map: string[] = [];
  const mapped = glyphs.filter((g) => used.get(g));
  for (let i = 0; i < mapped.length; i += 100) {
    const block = mapped.slice(i, i + 100);
    map.push(`${block.length} beginbfchar`, ...block.map((g) => `${glyphHex([g])} ${utf16Hex(used.get(g)!)}`), 'endbfchar');
  }
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...map,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  const cmapBytes = ascii(cmap);
  const cmapData = deflate ? deflate(cmapBytes) : cmapBytes;
  const filter = deflate ? ' /Filter /FlateDecode' : '';
  const [x0, y0, x1, y1] = font.bbox;
  return [
    [`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${first + 1} 0 R] /ToUnicode ${first + 4} 0 R >>`],
    [`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${first + 2} 0 R /DW 0 /W [${widths.join(' ')}] /CIDToGIDMap /Identity >>`],
    [
      `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${[x0, y0, x1, y1].map(scale).join(' ')}] /ItalicAngle ${n(font.italicAngle)} /Ascent ${scale(font.ascent)} /Descent ${scale(font.descent)} /CapHeight ${scale(font.capHeight)} /StemV 80 /FontFile2 ${first + 3} 0 R >>`,
    ],
    [`<< /Length ${packed.length} /Length1 ${file.length}${filter} >>\nstream\n`, packed, '\nendstream'],
    [`<< /Length ${cmapData.length}${filter} >>\nstream\n`, cmapData, '\nendstream'],
  ];
}

/** The page layout each drawing gets with these options (the scale `fit` chose, for instance). */
export function pdfLayouts(pages: readonly PdfPage[], options: PdfOptions = {}): PageLayout[] {
  return pages.map((pg) => layoutPage(pg.drawing.bounds, { page: options.page ?? 'A3', orientation: options.orientation ?? 'landscape', scale: options.scale, titleBlock: pg.title !== undefined }));
}

/** Writes plan drawings as a PDF, one page each. */
export function drawingToPdf(pages: readonly PdfPage[], options: PdfOptions = {}): Uint8Array {
  const layouts = pdfLayouts(pages, options);
  const alphas = new Map<string, string>();
  const gs = (alpha: number) => {
    const key = n(alpha);
    let name = alphas.get(key);
    if (!name) alphas.set(key, (name = `GS${alphas.size}`));
    return name;
  };
  const loaded: { font: TrueTypeFont | null } = { font: null };
  const face: EmbeddedFace = {
    used: new Map(),
    font: () => {
      if (loaded.font) return loaded.font;
      const unreadable = () => new StudioError('UNAVAILABLE', { key: 'errors.exchange.noArabicFont', params: { file: options.arabicFontName ?? 'IBMPlexSansArabic-Regular.ttf' } });
      if (!options.arabicFont) throw unreadable();
      try {
        return (loaded.font = readTrueType(options.arabicFont));
      } catch {
        // A damaged or truncated file is the same as none: the text cannot be written.
        throw unreadable();
      }
    },
  };
  const streams = pages.map((pg, i) => {
    const raw = ascii(pageContent(pg.drawing, layouts[i], pg.title, options.date, gs, face));
    return options.deflate ? { data: options.deflate(raw), filter: ' /Filter /FlateDecode' } : { data: raw, filter: '' };
  });

  // Object numbers: 1 catalog, 2 pages, 3 Helvetica, 4 Courier, 5 info, 6 resources, 7 Helvetica Bold, then the ExtGStates, then a page and its content per page,
  // then, when a text used it, the embedded face: its Type0 font, CIDFont, descriptor, file and ToUnicode map.
  const firstGs = 8;
  const firstPage = firstGs + alphas.size;
  const pageObj = (i: number) => firstPage + 2 * i;
  const fontObj = firstPage + 2 * pages.length;
  const embedded = loaded.font && face.used.size ? embeddedFontObjects(loaded.font, face.used, fontObj, options.deflate) : null;
  const objects: (Uint8Array | string)[][] = [];
  const titleText = pages[0]?.title !== undefined ? `${pages[0].title}` : (pages[0]?.drawing.levelName ?? 'Plan');
  objects.push([`<< /Type /Catalog /Pages 2 0 R >>`]);
  objects.push([`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`]);
  objects.push([`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`]);
  objects.push([`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`]);
  objects.push([`<< /Title ${pdfTextString(titleText)} /Producer ${pdfTextString(BRANDING.productName)} /CreationDate (${pdfDate(new Date())}) >>`]);
  const gsEntries = [...alphas.entries()].map(([, name], i) => `/${name} ${firstGs + i} 0 R`).join(' ');
  objects.push([`<< /ProcSet [/PDF /Text] /Font << /F1 3 0 R /F2 4 0 R /F3 7 0 R${embedded ? ` /F4 ${fontObj} 0 R` : ''} >>${gsEntries ? ` /ExtGState << ${gsEntries} >>` : ''} >>`]);
  objects.push([`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`]);
  for (const [alpha] of alphas) objects.push([`<< /Type /ExtGState /ca ${alpha} /CA ${alpha} >>`]);
  pages.forEach((_, i) => {
    const { width, height } = layouts[i];
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width * PT)} ${n(height * PT)}] /Resources 6 0 R /Contents ${pageObj(i) + 1} 0 R >>`]);
    const { data, filter } = streams[i];
    objects.push([`<< /Length ${data.length}${filter} >>\nstream\n`, data, '\nendstream']);
  });
  if (embedded) objects.push(...embedded);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const put = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  };
  put('%PDF-1.4\n');
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const offsets: number[] = [];
  objects.forEach((parts, i) => {
    offsets.push(offset);
    put(`${i + 1} 0 obj\n`);
    for (const part of parts) put(part);
    put('\nendobj\n');
  });
  const xref = offset;
  put(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) put(`${String(o).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
