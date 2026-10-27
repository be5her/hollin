import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geometry/vec';
import { drawingBounds, planDrawing, type DrawingLayer, type PlanDrawing } from './drawing';
import { drawingHouse } from './house.fixture';
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
