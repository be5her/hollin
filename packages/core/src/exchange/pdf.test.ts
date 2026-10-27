import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { drawingBounds, planDrawing, type DrawingLayer, type PlanDrawing } from './drawing';
import { drawingHouse } from './house.fixture';
import { arcToBeziers, drawingToPdf, pdfLayouts, textWidthEm, winAnsi } from './pdf';

/** The file as one byte per character, so string indices are byte offsets. */
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

interface Parsed {
  text: string;
  offsets: number[];
  objects: Map<number, string>;
}

/** Reads the xref table from `startxref` and every object it points at. */
function parse(bytes: Uint8Array): Parsed {
  const text = latin1(bytes);
  const start = Number(/startxref\n(\d+)\n%%EOF\n?$/.exec(text)![1]);
  expect(text.slice(start, start + 5)).toBe('xref\n');
  const lines = text.slice(start).split('\n');
  const [first, count] = lines[1].split(' ').map(Number);
  expect(first).toBe(0);
  const offsets: number[] = [];
  for (let i = 1; i < count; i++) {
    const entry = lines[2 + i];
    expect(entry).toMatch(/^\d{10} 00000 n $/);
    offsets.push(Number(entry.slice(0, 10)));
  }
  const objects = new Map<number, string>();
  offsets.forEach((o, i) => {
    const end = text.indexOf('\nendobj\n', o);
    objects.set(i + 1, text.slice(o, end));
  });
  return { text, offsets, objects };
}

function drawingOf(primitives: DrawingLayer['primitives'], levelName = 'Test'): PlanDrawing {
  const layers: DrawingLayer[] = [{ kind: 'rooms', name: 'Rooms', color: 'room', hatch: false, primitives }];
  return { levelId: 'lvl', levelName, units: { system: 'metric', metricUnit: 'mm', imperialStyle: 'ft-in', precision: 0, fraction: 16 }, bounds: drawingBounds(layers), layers };
}

/** The decoded content stream of every page, in page order. */
function pageContents(p: Parsed, inflate = false): string[] {
  const pagesObj = p.objects.get(2)!;
  const kids = [.../\/Kids \[([^\]]*)\]/.exec(pagesObj)![1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  return kids.map((k) => {
    const page = p.objects.get(k)!;
    expect(page).toMatch(/\/Type \/Page /);
    const contents = Number(/\/Contents (\d+) 0 R/.exec(page)![1]);
    const obj = p.objects.get(contents)!;
    const length = Number(/\/Length (\d+)/.exec(obj)![1]);
    const begin = obj.indexOf('stream\n') + 'stream\n'.length;
    const data = obj.slice(begin, obj.length - '\nendstream'.length);
    expect(data.length).toBe(length);
    return inflate ? inflateSync(Buffer.from(data, 'latin1')).toString('latin1') : data;
  });
}

describe('drawingToPdf', () => {
  const { doc, ground, upper } = drawingHouse();
  const drawings = [planDrawing(doc, ground), planDrawing(doc, upper)];
  const pages = drawings.map((drawing) => ({ drawing, title: 'House' }));

  it('writes a PDF 1.4 whose xref offsets point at their objects', () => {
    const bytes = drawingToPdf(pages, { date: '2026-10-27' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const p = parse(bytes);
    expect(p.text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(p.text.trimEnd().endsWith('%%EOF')).toBe(true);
    p.offsets.forEach((o, i) => expect(p.text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(p.text).toMatch(new RegExp(`trailer\\n<< /Size ${p.offsets.length + 1} /Root 1 0 R`));
  });

  it('has one page per entry, each with its content stream of the stated length', () => {
    const p = parse(drawingToPdf(pages));
    expect(/\/Type \/Pages [^>]*\/Count (\d+)/.exec(p.text)![1]).toBe('2');
    expect(p.text.match(/\/Type \/Page /g)?.length).toBe(2);
    const contents = pageContents(p);
    expect(contents).toHaveLength(2);
    expect(contents[0]).toContain(`(${drawings[0].levelName}) Tj`);
    expect(contents[1]).toContain(`(${drawings[1].levelName}) Tj`);
    expect(contents[0]).toContain('(Living) Tj');
    expect(contents[0]).toContain('(House) Tj');
    // Strokes with round caps and joins, Béziers for the arcs, even-odd fills, tints through an ExtGState.
    expect(contents[0]).toMatch(/^1 J 1 j\n/);
    expect(contents[0]).toMatch(/ c\n/);
    expect(contents[0]).toMatch(/\nf\*\n/);
    expect(contents[0]).toMatch(/\/GS\d+ gs/);
    expect(p.text).toMatch(/\/Type \/ExtGState \/ca 0\.\d+/);
    expect(p.text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
  });

  it('sizes pages and fits the scale', () => {
    const p = parse(drawingToPdf(pages, { page: 'A3', orientation: 'landscape', scale: 'fit' }));
    expect(p.text).toContain('/MediaBox [0 0 1190.551 841.89]');
    // A3's drawing area is 400 × 249 mm under the title block: the ground floor (with its shape out to 12 m, the dimension and the label) needs 1:50, the bare upper floor fits at 1:25.
    const layouts = pdfLayouts(pages, { page: 'A3', orientation: 'landscape', scale: 'fit' });
    expect(layouts.map((l) => l.scale)).toEqual([50, 25]);
    expect(pageContents(p)[0]).toContain('(Scale 1:50) Tj');
    expect(pdfLayouts(pages, { page: 'A4', orientation: 'portrait', scale: 'fit' })[0].scale).toBe(100);
    expect(pdfLayouts(pages, { scale: 200 })[0].scale).toBe(200);
    const portrait = parse(drawingToPdf(pages.slice(0, 1), { page: 'Letter', orientation: 'portrait' }));
    expect(portrait.text).toContain('/MediaBox [0 0 612 792]');
  });

  it('compresses content streams through the deflate hook', () => {
    let calls = 0;
    const bytes = drawingToPdf(pages, {
      deflate: (raw) => {
        calls++;
        return deflateSync(raw);
      },
    });
    expect(calls).toBe(2);
    const p = parse(bytes);
    expect(p.text.match(/\/Filter \/FlateDecode/g)?.length).toBe(2);
    const contents = pageContents(p, true);
    expect(contents[0]).toContain('(Living) Tj');
    expect(bytes.length).toBeLessThan(drawingToPdf(pages).length);
  });

  it('writes texts in WinAnsi: m² comes through, the rest becomes ?, and offsets stay right', () => {
    expect(winAnsi('12 m²')).toEqual([49, 50, 32, 109, 0xb2]);
    expect(winAnsi('€ – ☃')).toEqual([0x80, 32, 0x96, 32, 63]);
    const d = drawingOf([{ type: 'text', at: [0, 0], text: 'Café (12 m²) \\ ☃', height: 200, rotation: 30, align: 'center', baseline: 'middle' }], 'Étage ☃');
    const bytes = drawingToPdf([{ drawing: d, title: 'Maison ☃' }]);
    const p = parse(bytes);
    p.offsets.forEach((o, i) => expect(p.text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const content = pageContents(p)[0];
    expect(content).toContain('(Caf\\351 \\(12 m\\262\\) \\\\ ?) Tj');
    expect(content).toContain('(\\311tage ?) Tj');
    // Rotation through the text matrix: cos 30°, sin 30°.
    expect(content).toMatch(/ 0\.866 0\.5 -0\.5 0\.866 [\d.-]+ [\d.-]+ Tm \(Caf/);
    // Only ASCII in the file apart from the binary comment.
    expect(/[^\x00-\x7f]/.test(p.text.slice(15))).toBe(false);
  });

  it('centres texts from Helvetica widths', () => {
    expect(textWidthEm(winAnsi('Living'))).toBeCloseTo((556 + 222 + 500 + 222 + 556 + 556) / 1000, 9);
    expect(textWidthEm(winAnsi('abc'), true)).toBeCloseTo(1.8, 9);
    const at = (align: 'left' | 'center' | 'right') => {
      const d = drawingOf([{ type: 'text', at: [0, 0], text: 'MM', height: 1000, rotation: 0, align, baseline: 'bottom' }]);
      const content = pageContents(parse(drawingToPdf([{ drawing: d }], { scale: 100 })))[0];
      return Number(/1 0 -?0 1 ([\d.-]+) [\d.-]+ Tm/.exec(content)![1]);
    };
    // 'MM' is 1.666 em; at 10 mm on paper that is 16.66 mm, 47.225 pt.
    expect(at('left') - at('center')).toBeCloseTo((16.66 / 2) * (72 / 25.4), 2);
    expect(at('center') - at('right')).toBeCloseTo((16.66 / 2) * (72 / 25.4), 2);
  });

  it('splits arcs into Béziers of a quarter turn at most, on the circle', () => {
    const half = arcToBeziers({ k: 'arc', a: [100, 0], b: [-100, 0], center: [0, 0], radius: 100, start: 0, sweep: Math.PI });
    expect(half).toHaveLength(2);
    expect(half[0][2][0]).toBeCloseTo(0, 9);
    expect(half[0][2][1]).toBeCloseTo(100, 9);
    // The midpoint of a quarter's Bézier lies on the circle within 0.03 %.
    const [c1, c2, e] = half[0];
    const mid = [(100 + 3 * c1[0] + 3 * c2[0] + e[0]) / 8, (0 + 3 * c1[1] + 3 * c2[1] + e[1]) / 8];
    expect(Math.hypot(mid[0], mid[1])).toBeCloseTo(100, 1);
    const cw = arcToBeziers({ k: 'arc', a: [100, 0], b: [0, -100], center: [0, 0], radius: 100, start: 0, sweep: -Math.PI / 2 });
    expect(cw).toHaveLength(1);
    expect(cw[0][0][1]).toBeLessThan(0);
    expect(arcToBeziers({ k: 'arc', a: [100, 0], b: [100, 0], center: [0, 0], radius: 100, start: 0, sweep: 2 * Math.PI })).toHaveLength(4);
  });
});
