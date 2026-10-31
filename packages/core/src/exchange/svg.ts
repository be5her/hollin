import type { Box, Vec2 } from '../geometry/vec';
import { PRINT_COLORS } from './colors';
import type { DrawingColor, DrawingFill, DrawingLayer, DrawingStroke, DrawingText, PlanDrawing } from './drawing';
import { PAGE_MARGIN, TITLE_BLOCK, baselineDrop, drawingArea, halfTurns, layoutPage, titleBlock, toPaper, type PageLayout, type PaperOrientation, type PaperSize } from './paper';

/*
 * A plan drawing as one self-contained SVG on paper: user units are paper millimetres with the
 * origin at the sheet's top-left (SVG's y down), `width`/`height` in mm, so it prints at its scale.
 * World y is flipped point by point, which keeps texts upright. One group per drawing layer. A
 * drawing larger than the sheet at its scale is clipped to the drawing area (inside the margins,
 * above the title block), so it never runs over the title block.
 */

export interface SvgOptions {
  /** A sheet to lay the drawing out on (centred inside a 10 mm margin); without one the sheet is the drawing's extent plus the margin. */
  page?: PaperSize;
  orientation?: PaperOrientation;
  /** The scale's denominator (100 for 1:100), or `fit` (with a page) for the largest plotting scale that fits. Default 100. */
  scale?: number | 'fit';
  /** The project's name: adds a title block (project, level, scale, date) and names the document. */
  title?: string;
  /** The date in the title block (YYYY-MM-DD); today by default. */
  date?: string;
}

/** Characters XML 1.0 forbids are dropped, the five special ones escaped. */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SANS_STACK = "'Alegreya Sans', Helvetica, Arial, sans-serif";
const MONO_STACK = "'IBM Plex Mono', ui-monospace, Consolas, monospace";

const num = (v: number): string => {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
};

const isEmpty = (b: Box) => !(b.maxX >= b.minX && b.maxY >= b.minY);

/** The sheet for a drawing: a paper size, or the drawing's extent at the scale plus the margin (and room for the title block). */
export function svgLayout(drawing: PlanDrawing, options: SvgOptions = {}): PageLayout {
  const titled = options.title !== undefined;
  if (options.page) return layoutPage(drawing.bounds, { page: options.page, orientation: options.orientation, scale: options.scale, titleBlock: titled });
  const scale = typeof options.scale === 'number' ? options.scale : 100;
  const b = drawing.bounds;
  const w = isEmpty(b) ? 0 : (b.maxX - b.minX) / scale;
  const h = isEmpty(b) ? 0 : (b.maxY - b.minY) / scale;
  const below = titled ? TITLE_BLOCK.height + 4 : 0;
  const width = Math.max(w + 2 * PAGE_MARGIN, titled ? TITLE_BLOCK.width + 2 * PAGE_MARGIN : 0);
  const height = h + 2 * PAGE_MARGIN + below;
  const worldCenter: Vec2 = isEmpty(b) ? [0, 0] : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  return { width, height, scale, fits: true, worldCenter,paperCenter: [width / 2, PAGE_MARGIN + below + h / 2] };
}

/** Writes a plan drawing as an SVG document (a string). */
export function drawingToSvg(drawing: PlanDrawing, options: SvgOptions = {}): string {
  const layout = svgLayout(drawing, options);
  const { width, height, scale } = layout;
  /** A world point in the SVG's user space (paper mm, y down). */
  const pt = (p: Vec2): string => {
    const q = toPaper(layout, p);
    return `${num(q[0])} ${num(height - q[1])}`;
  };
  const color = (c: DrawingColor | undefined, layer: DrawingLayer) => PRINT_COLORS[c ?? layer.color];

  const stroke = (s: DrawingStroke, layer: DrawingLayer): string => {
    const segs = halfTurns(s.segs);
    if (!segs.length) return '';
    let d = '';
    let at: Vec2 | null = null;
    for (const seg of segs) {
      if (!at || Math.abs(at[0] - seg.a[0]) > 1e-6 || Math.abs(at[1] - seg.a[1]) > 1e-6) d += `M${pt(seg.a)}`;
      if (seg.k === 'line') d += `L${pt(seg.b)}`;
      else {
        const r = num(seg.radius / scale);
        // World counter-clockwise turns clockwise once y points down: SVG's sweep flag 0.
        d += `A${r} ${r} 0 ${Math.abs(seg.sweep) > Math.PI ? 1 : 0} ${seg.sweep > 0 ? 0 : 1} ${pt(seg.b)}`;
      }
      at = seg.b;
    }
    if (s.closed) d += 'Z';
    const dash = s.dash?.length ? ` stroke-dasharray="${s.dash.map(num).join(' ')}"` : '';
    return `<path d="${d}" fill="none" stroke="${color(s.color, layer)}" stroke-width="${num(s.width)}"${dash}/>`;
  };

  const fill = (f: DrawingFill): string => {
    let d = '';
    for (const ring of f.rings) {
      if (ring.length < 3) continue;
      d += ring.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('') + 'Z';
    }
    if (!d) return '';
    const opacity = f.opacity < 1 ? ` fill-opacity="${num(f.opacity)}"` : '';
    return `<path d="${d}" fill="${PRINT_COLORS[f.color]}"${opacity} fill-rule="evenodd" stroke="none"/>`;
  };

  const text = (t: DrawingText, layer: DrawingLayer): string => {
    if (!t.text) return '';
    const size = t.height / scale;
    const r = (t.rotation * Math.PI) / 180;
    const drop = baselineDrop(t.baseline) * size;
    const p = toPaper(layout, t.at);
    // The baseline lies `drop` below the anchor, along the text's own down direction.
    const x = p[0] + drop * Math.sin(r);
    const y = height - (p[1] - drop * Math.cos(r));
    const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
    const rotate = Math.abs(t.rotation) > 1e-9 ? ` transform="rotate(${num(-t.rotation)} ${num(x)} ${num(y)})"` : '';
    const family = t.mono ? MONO_STACK : SANS_STACK;
    return `<text x="${num(x)}" y="${num(y)}" font-size="${num(size)}" font-family="${family}" text-anchor="${anchor}" fill="${color(t.color, layer)}"${rotate}>${xmlEscape(t.text)}</text>`;
  };

  const docTitle = options.title !== undefined ? `${options.title} - ${drawing.levelName}` : drawing.levelName;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(width)}mm" height="${num(height)}mm" viewBox="0 0 ${num(width)} ${num(height)}" data-scale="${num(scale)}" data-level="${xmlEscape(drawing.levelId)}">`,
    `<title>${xmlEscape(docTitle)}</title>`,
    `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#ffffff"/>`,
  ];
  if (layout.fits) out.push('<g stroke-linecap="round" stroke-linejoin="round">');
  else {
    const area = drawingArea(width, height, options.title !== undefined);
    out.push(
      `<clipPath id="drawing-area"><rect x="${num(area.minX)}" y="${num(height - area.maxY)}" width="${num(area.maxX - area.minX)}" height="${num(area.maxY - area.minY)}"/></clipPath>`,
      '<g stroke-linecap="round" stroke-linejoin="round" clip-path="url(#drawing-area)">',
    );
  }
  for (const layer of drawing.layers) {
    out.push(`<g id="layer-${xmlEscape(layer.kind)}" data-layer="${xmlEscape(layer.name)}">`, `<title>${xmlEscape(layer.name)}</title>`);
    for (const p of layer.primitives) {
      const s = p.type === 'stroke' ? stroke(p, layer) : p.type === 'fill' ? fill(p) : text(p, layer);
      if (s) out.push(s);
    }
    out.push('</g>');
  }
  out.push('</g>');
  if (options.title !== undefined) {
    const block = titleBlock(width, { title: options.title, levelName: drawing.levelName, scale, date: options.date });
    out.push('<g id="title-block" data-layer="Title block">');
    const d = block.lines.map(([a, b]) => `M${num(a[0])} ${num(height - a[1])}L${num(b[0])} ${num(height - b[1])}`).join('');
    out.push(`<path d="${d}" fill="none" stroke="${PRINT_COLORS.fg}" stroke-width="0.35" stroke-linecap="square"/>`);
    block.texts.forEach((t, i) => {
      if (t.stop) return;
      const weight = t.bold ? ' font-weight="700"' : '';
      // The wordmark's full stop rides on the name's text, so it follows the name in whatever font the reader draws it with.
      const next = block.texts[i + 1];
      const stop = next?.stop ? `<tspan fill="${next.color ?? PRINT_COLORS.fg}">${xmlEscape(next.text)}</tspan>` : '';
      out.push(`<text x="${num(t.at[0])}" y="${num(height - t.at[1])}" font-size="${num(t.size)}" font-family="${SANS_STACK}"${weight} text-anchor="${t.align === 'right' ? 'end' : 'start'}" fill="${t.color ?? PRINT_COLORS.fg}">${xmlEscape(t.text)}${stop}</text>`);
    });
    out.push('</g>');
  }
  out.push('</svg>', '');
  return out.join('\n');
}
