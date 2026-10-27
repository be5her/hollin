import { BRANDING } from '../branding';
import type { Vec2 } from '../geometry/vec';
import { PRINT_COLORS, hexToRgb } from './colors';
import type { DrawingColor, DrawingFill, DrawingLayer, DrawingSegment, DrawingStroke, DrawingText, PlanDrawing } from './drawing';
import { baselineDrop, halfTurns, layoutPage, textWidthEm, titleBlock, toPaper, winAnsi, type PageLayout, type PaperOrientation, type PaperSize } from './paper';

/*
 * Plan drawings as a hand-written PDF 1.4, one page per drawing: true vectors at a drawing scale,
 * strokes with round caps and joins, arcs as cubic Béziers (a quarter turn at most each), fills
 * even-odd with an ExtGState alpha for tints, texts in the standard Helvetica (and Courier for
 * monospaced texts) with WinAnsiEncoding, a title block. The file is assembled as bytes, so the
 * xref offsets are byte offsets whatever the strings hold.
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
}

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

/** Builds one page's content stream; `gs` names an alpha's ExtGState (shared by every page). */
function pageContent(drawing: PlanDrawing, layout: PageLayout, title: string | undefined, date: string | undefined, gs: (alpha: number) => string): string {
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

  const textAt = (at: Vec2, value: string, sizeMm: number, rotationDeg: number, align: 'left' | 'center' | 'right', drop: number, hex: string, mono: boolean) => {
    const bytes = winAnsi(value);
    if (!bytes.length) return;
    const r = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const width = textWidthEm(bytes, mono) * sizeMm;
    const shift = align === 'left' ? 0 : align === 'right' ? width : width / 2;
    const dropMm = drop * sizeMm;
    // Back along the text by the alignment, down from the anchor to the baseline.
    const x = at[0] - shift * cos + dropMm * sin;
    const y = at[1] - shift * sin - dropMm * cos;
    ops.push(`BT /${mono ? 'F2' : 'F1'} ${n(sizeMm * PT)} Tf ${rgb(hex)} rg ${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x * PT)} ${n(y * PT)} Tm ${pdfString(bytes)} Tj ET`);
  };

  const text = (t: DrawingText, layer: DrawingLayer) => {
    textAt(toPaper(layout, t.at), t.text, t.height / layout.scale, t.rotation, t.align, baselineDrop(t.baseline), color(t.color, layer), Boolean(t.mono));
  };

  for (const layer of drawing.layers) {
    ops.push(`% ${layer.name.replace(/[\r\n]/g, ' ')}`.replace(/[^\x20-\x7e]/g, '?'));
    for (const prim of layer.primitives) {
      if (prim.type === 'stroke') stroke(prim, layer);
      else if (prim.type === 'fill') fill(prim);
      else text(prim, layer);
    }
  }
  if (title !== undefined) {
    const block = titleBlock(layout.width, { title, levelName: drawing.levelName, scale: layout.scale, date });
    ops.push('% Title block', `${rgb(PRINT_COLORS.fg)} RG ${n(0.35 * PT)} w [] 0 d 0 J`);
    for (const [a, b] of block.lines) ops.push(`${n(a[0] * PT)} ${n(a[1] * PT)} m ${n(b[0] * PT)} ${n(b[1] * PT)} l S`);
    for (const t of block.texts) textAt(t.at, t.text, t.size, 0, t.align, 0, PRINT_COLORS.fg, false);
  }
  return ops.join('\n') + '\n';
}

const ascii = (s: string) => new TextEncoder().encode(s);

/** The PDF date of a moment: `D:YYYYMMDDHHmmSSZ`. */
const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;

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
  const streams = pages.map((pg, i) => {
    const raw = ascii(pageContent(pg.drawing, layouts[i], pg.title, options.date, gs));
    return options.deflate ? { data: options.deflate(raw), filter: ' /Filter /FlateDecode' } : { data: raw, filter: '' };
  });

  // Object numbers: 1 catalog, 2 pages, 3 Helvetica, 4 Courier, 5 info, 6 resources, then the ExtGStates, then a page and its content per page.
  const firstGs = 7;
  const firstPage = firstGs + alphas.size;
  const pageObj = (i: number) => firstPage + 2 * i;
  const objects: (Uint8Array | string)[][] = [];
  const titleText = pages[0]?.title !== undefined ? `${pages[0].title}` : (pages[0]?.drawing.levelName ?? 'Plan');
  objects.push([`<< /Type /Catalog /Pages 2 0 R >>`]);
  objects.push([`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`]);
  objects.push([`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`]);
  objects.push([`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`]);
  objects.push([`<< /Title ${pdfTextString(titleText)} /Producer ${pdfTextString(BRANDING.productName)} /CreationDate (${pdfDate(new Date())}) >>`]);
  const gsEntries = [...alphas.entries()].map(([, name], i) => `/${name} ${firstGs + i} 0 R`).join(' ');
  objects.push([`<< /ProcSet [/PDF /Text] /Font << /F1 3 0 R /F2 4 0 R >>${gsEntries ? ` /ExtGState << ${gsEntries} >>` : ''} >>`]);
  for (const [alpha] of alphas) objects.push([`<< /Type /ExtGState /ca ${alpha} /CA ${alpha} >>`]);
  pages.forEach((_, i) => {
    const { width, height } = layouts[i];
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width * PT)} ${n(height * PT)}] /Resources 6 0 R /Contents ${pageObj(i) + 1} 0 R >>`]);
    const { data, filter } = streams[i];
    objects.push([`<< /Length ${data.length}${filter} >>\nstream\n`, data, '\nendstream']);
  });

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
