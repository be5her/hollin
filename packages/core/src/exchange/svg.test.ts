import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geometry/vec';
import { drawingBounds, planDrawing, type DrawingLayer, type PlanDrawing } from './drawing';
import { drawingHouse } from './house.fixture';
import { BRANDING } from '../branding';
import { PAGE_MARGIN, TITLE_BLOCK, paperSize } from './paper';
import { drawingToSvg, svgLayout, xmlEscape } from './svg';

/** Every tag opened is closed, in order (self-closing ones aside); comments and the XML declaration skipped. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, self] = m;
    if (self) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0;
}

const attr = (xml: string, name: string) => new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(xml)?.[1];

function drawingOf(primitives: DrawingLayer['primitives']): PlanDrawing {
  const layers: DrawingLayer[] = [{ kind: 'shapes', name: 'Shapes & <things>', color: 'wallLine', hatch: false, primitives }];
  return { levelId: 'lvl', levelName: 'Ground "A" & B', units: { system: 'metric', metricUnit: 'mm', imperialStyle: 'ft-in', precision: 0, fraction: 16 }, bounds: drawingBounds(layers), layers };
}

describe('drawingToSvg', () => {
  const { doc, ground } = drawingHouse();
  const drawing = planDrawing(doc, ground);

  it('writes a well-formed document with no external references', () => {
    const svg = drawingToSvg(drawing, { title: 'House' });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
    expect(balanced(svg)).toBe(true);
    expect(svg).not.toMatch(/href=|url\(|@import/);
    expect(svg).toContain(`<title>House - ${xmlEscape(drawing.levelName)}</title>`);
  });

  it('sizes the sheet from the bounds at the scale, in millimetres', () => {
    const svg = drawingToSvg(drawing, { scale: 50 });
    const b = drawing.bounds;
    const w = (b.maxX - b.minX) / 50 + 2 * PAGE_MARGIN;
    const h = (b.maxY - b.minY) / 50 + 2 * PAGE_MARGIN;
    const box = attr(svg, 'viewBox')!.split(' ').map(Number);
    expect(box[0]).toBe(0);
    expect(box[1]).toBe(0);
    expect(box[2]).toBeCloseTo(w, 3);
    expect(box[3]).toBeCloseTo(h, 3);
    expect(attr(svg, 'width')).toBe(`${box[2]}mm`);
    expect(attr(svg, 'height')).toBe(`${box[3]}mm`);
    // The bounds' corners land on the margin: the drawing's extent is the viewBox less the margins.
    const layout = svgLayout(drawing, { scale: 50 });
    expect(layout.paperCenter[0]).toBeCloseTo(w / 2, 6);
  });

  it('draws the title block bottom-right: a frame, a rule and the wordmark, project, level, scale and date', () => {
    const svg = drawingToSvg(drawing, { page: 'A3', orientation: 'landscape', scale: 50, title: 'Kitchen extension', date: '2026-10-31' });
    const block = svg.slice(svg.indexOf('<g id="title-block"'), svg.indexOf('</svg>'));
    // A3 landscape 420 x 297: the frame spans x 320..410, y (down) 263..287, the rule 8 mm below the top.
    expect(block).toContain('M320 287L410 287M410 287L410 263M410 263L320 263M320 263L320 287M320 271L410 271');
    expect(block).toContain('stroke-width="0.35"');
    const texts = [...block.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)" font-family="[^"]*"(?: font-weight="(\d+)")? text-anchor="(\w+)" fill="(#\w+)">([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), weight: m[4], anchor: m[5], fill: m[6], text: m[7] }));
    expect(texts.map((t) => t.text)).toEqual([BRANDING.productName, '.', 'Kitchen extension', xmlEscape(drawing.levelName), 'Scale 1:50', '2026-10-31']);
    expect(texts[0]).toMatchObject({ x: 323, y: 269, weight: '700', anchor: 'start', fill: '#231f1c' });
    expect(texts[1]).toMatchObject({ y: 269, weight: '700', fill: '#b9552f' });
    expect(texts[2]).toMatchObject({ x: 407, y: 269, size: 4, anchor: 'end' });
    expect(texts[3]).toMatchObject({ x: 323, y: 276, size: 3 });
    expect(texts[4]).toMatchObject({ x: 323, y: 284.2, size: 2.8 });
    expect(texts[5]).toMatchObject({ x: 407, y: 284.2, anchor: 'end' });
    expect(block).toContain('font-family="\'Alegreya Sans\', Helvetica, Arial, sans-serif"');
  });

  it("prints in the paper palette's inks on a white sheet", () => {
    const svg = drawingToSvg(drawing, { title: 'House' });
    expect(svg).toContain('fill="#ffffff"/>');
    expect(svg).toContain('stroke="#231f1c"');
    expect(svg).toContain('fill="#3b3531"');
    expect(svg).not.toMatch(/#1f5fbf|#000000/);
  });

  it('takes a paper size and orientation, and fits the scale', () => {
    const svg = drawingToSvg(drawing, { page: 'A3', orientation: 'landscape', scale: 'fit', title: 'House', date: '2026-10-27' });
    const { width, height } = paperSize('A3', 'landscape');
    expect(attr(svg, 'viewBox')).toBe(`0 0 ${width} ${height}`);
    expect(attr(svg, 'width')).toBe('420mm');
    expect(attr(svg, 'data-scale')).toBe('50');
    expect(svg).toContain('>Scale 1:50</text>');
    expect(svg).toContain('>2026-10-27</text>');
    expect(svg).toContain('>House</text>');
    // Without a page, the title block widens a narrow sheet and adds its height below.
    const tiny = drawingOf([{ type: 'stroke', segs: [{ k: 'line', a: [0, 0], b: [100, 0] }], closed: false, width: 0.25 }]);
    const box = attr(drawingToSvg(tiny, { title: 'T' }), 'viewBox')!.split(' ').map(Number);
    expect(box[2]).toBe(TITLE_BLOCK.width + 2 * PAGE_MARGIN);
    expect(box[3]).toBe(2 * PAGE_MARGIN + TITLE_BLOCK.height + 4);
  });

  it('writes an empty drawing as a well-formed sheet', () => {
    const empty = drawingOf([]);
    const svg = drawingToSvg(empty, { title: 'House', date: '2026-10-27' });
    expect(balanced(svg)).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('>Scale 1:100</text>');
    expect(svgLayout(empty).fits).toBe(true);
    expect(balanced(drawingToSvg(empty, { page: 'A4', scale: 'fit' }))).toBe(true);
  });

  it('says when a drawing does not fit the sheet at a fixed scale; a sheet sized from the drawing always does', () => {
    expect(svgLayout(drawing, { page: 'A4', orientation: 'portrait', scale: 20 }).fits).toBe(false);
    expect(svgLayout(drawing, { page: 'A4', orientation: 'portrait', scale: 'fit' }).fits).toBe(true);
    expect(svgLayout(drawing, { scale: 20 }).fits).toBe(true);
  });

  it('clips a drawing larger than the sheet to the drawing area, leaving the title block clear', () => {
    // Rendered in Chromium, the house at 1:20 on A4 ran over the margins and under the title block.
    const svg = drawingToSvg(drawing, { page: 'A4', orientation: 'portrait', scale: 20, title: 'House', date: '2026-10-28' });
    expect(balanced(svg)).toBe(true);
    // A4 portrait: 10 mm margins, the title block's 24 mm and a 4 mm gap at the bottom (y down: the area starts 10 mm from the top).
    const top = 297 - PAGE_MARGIN;
    const bottom = PAGE_MARGIN + TITLE_BLOCK.height + 4;
    expect(svg).toContain(`<clipPath id="drawing-area"><rect x="${PAGE_MARGIN}" y="${297 - top}" width="${210 - 2 * PAGE_MARGIN}" height="${top - bottom}"/></clipPath>`);
    const clipped = svg.indexOf('clip-path="url(#drawing-area)"');
    expect(clipped).toBeGreaterThan(svg.indexOf('<clipPath'));
    expect(clipped).toBeLessThan(svg.indexOf('<g id="layer-'));
    // The drawing's group closes before the title block opens: the title block is not clipped.
    expect(svg.lastIndexOf('</g>', svg.indexOf('<g id="title-block"'))).toBeGreaterThan(svg.lastIndexOf('<g id="layer-'));
    expect(drawingToSvg(drawing, { page: 'A3', scale: 100, title: 'House' })).not.toContain('clip-path');
    expect(drawingToSvg(drawing, { scale: 20 })).not.toContain('clip-path');
  });

  it('writes one group per layer, named, back to front', () => {
    const svg = drawingToSvg(drawing);
    const groups = [...svg.matchAll(/<g id="layer-([\w-]+)" data-layer="([^"]*)">/g)].map((m) => [m[1], m[2]]);
    expect(groups).toEqual(drawing.layers.map((l) => [l.kind, xmlEscape(l.name)]));
    for (const name of ['Living', 'Kitchen']) expect(svg).toContain(`>${name}</text>`);
  });

  it('writes arcs as A commands with the sweep flipped for y down, and a full circle as two', () => {
    const quarter = (sweep: number): PlanDrawing =>
      drawingOf([{ type: 'stroke', segs: [{ k: 'arc', a: [1000, 0], b: [0, 1000 * Math.sign(sweep)] as Vec2, center: [0, 0], radius: 1000, start: 0, sweep }], closed: false, width: 0.25 }]);
    const ccw = drawingToSvg(quarter(Math.PI / 2), { scale: 100 });
    expect(ccw).toMatch(/A10 10 0 0 0 /);
    const cw = drawingToSvg(quarter(-Math.PI / 2), { scale: 100 });
    expect(cw).toMatch(/A10 10 0 0 1 /);
    const big = drawingToSvg(
      drawingOf([{ type: 'stroke', segs: [{ k: 'arc', a: [1000, 0], b: [0, -1000], center: [0, 0], radius: 1000, start: 0, sweep: 1.5 * Math.PI }], closed: false, width: 0.25 }]),
    );
    expect(big).toMatch(/A10 10 0 1 0 /);
    const circle = drawingToSvg(drawingOf([{ type: 'stroke', segs: [{ k: 'arc', a: [500, 0], b: [500, 0], center: [0, 0], radius: 500, start: 0, sweep: 2 * Math.PI }], closed: true, width: 0.25 }]));
    expect(circle.match(/A5 5 /g)?.length).toBe(2);
    // The door's swing in the house is an arc too.
    expect(drawingToSvg(drawing)).toMatch(/<path d="M[^"]*A[\d.]+ [\d.]+ 0 [01] [01] /);
  });

  it('flips y so the drawing reads as the plan, and keeps texts upright', () => {
    const d = drawingOf([
      { type: 'stroke', segs: [{ k: 'line', a: [0, 0], b: [0, 1000] }], closed: false, width: 0.25 },
      { type: 'text', at: [0, 500], text: 'Up', height: 200, rotation: 90, align: 'left', baseline: 'bottom' },
    ]);
    const svg = drawingToSvg(d, { scale: 100 });
    // The line goes from the bottom of the sheet (larger y) to the top.
    const m = /<path d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(m[2])).toBeGreaterThan(Number(m[4]));
    expect(Number(m[2]) - Number(m[4])).toBeCloseTo(10, 6);
    expect(svg).toMatch(/font-size="2"[^>]*transform="rotate\(-90 /);
  });

  it('escapes every string', () => {
    const d = drawingOf([{ type: 'text', at: [0, 0], text: 'Bath <1> & "Shower" \u0001', height: 200, rotation: 0, align: 'center', baseline: 'middle', mono: true }]);
    const svg = drawingToSvg(d, { title: "O'Brien & Co" });
    expect(svg).toContain('>Bath &lt;1&gt; &amp; &quot;Shower&quot; </text>');
    expect(svg).toContain('data-layer="Shapes &amp; &lt;things&gt;"');
    expect(svg).toContain('<title>O&apos;Brien &amp; Co - Ground &quot;A&quot; &amp; B</title>');
    expect(svg).toContain('monospace');
    expect(balanced(svg)).toBe(true);
  });

  it('writes fills even-odd with their tint', () => {
    const svg = drawingToSvg(drawing);
    expect(svg).toMatch(/fill-rule="evenodd"/);
    expect(svg).toMatch(/fill-opacity="0\.\d+"/);
  });
});
