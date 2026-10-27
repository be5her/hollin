import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geometry/vec';
import { drawingBounds, planDrawing, type DrawingLayer, type DrawingSegment, type PlanDrawing } from './drawing';
import { dxfLineweight, dxfNumber, dxfString, drawingToDxf } from './dxf';
import { decodeDxfString, dxfPairs, readDxfEntities, type DxfEntity } from './dxf-read';
import { drawingHouse } from './house.fixture';

const near = (a: Vec2, b: Vec2, tolerance = 0.001) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
const closeTo = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const normDeg = (radians: number) => (((radians * 180) / Math.PI) % 360 + 360) % 360;

/** A drawing of one layer from hand-made strokes. */
function drawingOf(primitives: DrawingLayer['primitives']): PlanDrawing {
  const layers: DrawingLayer[] = [{ kind: 'shapes', name: 'Shapes', color: 'wallLine', hatch: false, primitives }];
  return { levelId: 'lvl', levelName: 'Test', units: { system: 'metric', metricUnit: 'mm', imperialStyle: 'ft-in', precision: 0, fraction: 16 }, bounds: drawingBounds(layers), layers };
}

const arc = (center: Vec2, radius: number, start: number, sweep: number): DrawingSegment => ({
  k: 'arc',
  a: [center[0] + radius * Math.cos(start), center[1] + radius * Math.sin(start)],
  b: [center[0] + radius * Math.cos(start + sweep), center[1] + radius * Math.sin(start + sweep)],
  center,
  radius,
  start,
  sweep,
});

describe('drawingToDxf', () => {
  const { doc, ground } = drawingHouse();
  const drawing = planDrawing(doc, ground);
  const dxf = drawingToDxf(drawing);
  const read = readDxfEntities(dxf);

  it('writes an R2000 file in millimetres with its sections in order and LF line ends', () => {
    expect(dxf.includes('\r')).toBe(false);
    const pairs = dxfPairs(dxf);
    const sections = pairs.flatMap((p, i) => (p.code === 0 && p.value === 'SECTION' ? [pairs[i + 1].value] : []));
    expect(sections).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
    expect(pairs[pairs.length - 1]).toEqual({ code: 0, value: 'EOF' });
    const header = (name: string) => pairs[pairs.findIndex((p) => p.code === 9 && p.value === name) + 1];
    expect(header('$ACADVER').value).toBe('AC1015');
    expect(header('$INSUNITS')).toEqual({ code: 70, value: '4' });
    expect(read.insUnits).toBe(4);
    // The extent is the drawing's.
    const extmin = pairs.findIndex((p) => p.code === 9 && p.value === '$EXTMIN');
    expect(Number(pairs[extmin + 1].value)).toBeCloseTo(drawing.bounds.minX, 6);
    expect(Number(pairs[extmin + 2].value)).toBeCloseTo(drawing.bounds.minY, 6);
    // Handles are unique hex and below $HANDSEED.
    const handles = pairs.filter((p, i) => (p.code === 5 || p.code === 105) && pairs[i - 1]?.code === 0).map((p) => parseInt(p.value, 16));
    expect(new Set(handles).size).toBe(handles.length);
    expect(parseInt(header('$HANDSEED').value, 16)).toBeGreaterThan(Math.max(...handles));
    // The tables AutoCAD and LibreCAD expect.
    const tables = pairs.flatMap((p, i) => (p.code === 0 && p.value === 'TABLE' ? [pairs[i + 1].value] : []));
    expect(tables).toEqual(['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']);
    expect(dxf).toContain('\n*Model_Space\n');
    expect(dxf).toContain('\n*Paper_Space\n');
    expect(dxf).toContain('\nACAD_GROUP\n');
  });

  it('writes one layer per drawing layer, with a colour and a dashed line type', () => {
    expect(read.layers).toEqual(['0', ...drawing.layers.map((l) => l.name)]);
    const layers = new Set(read.entities.map((e) => e.layer));
    for (const l of drawing.layers) if (l.primitives.some((p) => p.type !== 'fill')) expect(layers.has(l.name)).toBe(true);
    expect(dxf).toMatch(/\n {2}2\nDASHED\n/);
    expect(dxf).toMatch(/\n {2}6\nDASHED\n/);
  });

  it('round-trips every stroke and text: polylines within 0.001 mm, arcs with their centre and radius', () => {
    const expected: DxfEntity['type'][] = [];
    let hatches = 0;
    for (const layer of drawing.layers) {
      for (const p of layer.primitives) {
        if (p.type === 'fill') hatches += layer.hatch ? 1 : 0;
        else if (p.type === 'text') expected.push('TEXT');
        else if (p.segs.length === 1 && p.segs[0].k === 'line' && !p.closed) expected.push('LINE');
        else if (p.segs.length === 1 && p.segs[0].k === 'arc') expected.push(Math.abs(p.segs[0].sweep) >= 2 * Math.PI - 1e-9 ? 'CIRCLE' : 'ARC');
        else expected.push('LWPOLYLINE');
      }
    }
    expect(read.entities.map((e) => e.type)).toEqual(expected);
    expect(read.skipped).toEqual({ HATCH: hatches });
    expect(hatches).toBe(2); // the walls' poché and the column's

    let i = 0;
    for (const layer of drawing.layers) {
      for (const p of layer.primitives) {
        if (p.type === 'fill') continue;
        const e = read.entities[i++];
        expect(e.layer).toBe(layer.name);
        if (p.type === 'text') {
          if (e.type !== 'TEXT') throw new Error('expected a text');
          expect(e.text).toBe(p.text);
          expect(e.height).toBeCloseTo(p.height, 6);
          expect(near(e.at, p.at)).toBe(true);
          continue;
        }
        if (e.type === 'LINE') {
          expect(near(e.a, p.segs[0].a) && near(e.b, p.segs[0].b)).toBe(true);
        } else if (e.type === 'ARC' || e.type === 'CIRCLE') {
          const s = p.segs[0];
          if (s.k !== 'arc') throw new Error('expected an arc');
          expect(near(e.center, s.center)).toBe(true);
          expect(e.radius).toBeCloseTo(s.radius, 6);
          if (e.type === 'ARC') {
            const [from, to] = s.sweep >= 0 ? [s.start, s.start + s.sweep] : [s.start + s.sweep, s.start];
            expect(closeTo(e.start, normDeg(from), 1e-6)).toBe(true);
            expect(closeTo(e.end, normDeg(to), 1e-6)).toBe(true);
          }
        } else if (e.type === 'LWPOLYLINE') {
          expect(e.closed).toBe(p.closed);
          const points = [...p.segs.map((s) => s.a), ...(p.closed ? [] : [p.segs[p.segs.length - 1].b])];
          expect(e.points).toHaveLength(points.length);
          e.points.forEach((q, k) => expect(near(q, points[k])).toBe(true));
          p.segs.forEach((s, k) => expect(e.bulges[k]).toBeCloseTo(s.k === 'arc' ? Math.tan(s.sweep / 4) : 0, 9));
        } else throw new Error(`unexpected ${e.type}`);
      }
    }
  });

  it("writes the door's swing as an ARC as wide as the door", () => {
    const arcs = read.entities.filter((e): e is Extract<DxfEntity, { type: 'ARC' }> => e.type === 'ARC' && e.layer === 'Doors and windows');
    expect(arcs).toHaveLength(1);
    expect(arcs[0].radius).toBeCloseTo(900, 6);
    expect((arcs[0].end - arcs[0].start + 360) % 360).toBeCloseTo(90, 6);
  });

  it('writes texts on one line in ASCII, escaping the rest, and reads them back', () => {
    expect(dxf).toContain('m\\U+00B2');
    expect(read.entities.some((e) => e.type === 'TEXT' && e.text === '25.23 m²')).toBe(true);
    expect(dxfString('a\nb · c')).toBe('a b \\U+00B7 c');
    expect(decodeDxfString('\\U+00B2')).toBe('²');
  });

  it('gives a counter-clockwise arc a positive bulge and a clockwise one a negative bulge', () => {
    const ccw = arc([0, 0], 1000, 0, Math.PI / 2);
    const cw = arc([3000, 0], 1000, Math.PI / 2, -Math.PI / 2);
    const text = drawingToDxf(
      drawingOf([
        { type: 'stroke', segs: [{ k: 'line', a: [-1000, 0], b: ccw.a }, ccw], closed: false, width: 0.25 },
        { type: 'stroke', segs: [{ k: 'line', a: [3000, 2000], b: cw.a }, cw], closed: false, width: 0.25 },
        { type: 'stroke', segs: [cw], closed: false, width: 0.25 },
        { type: 'stroke', segs: [{ ...arc([0, 5000], 500, 0, 2 * Math.PI), b: [500, 5000] }], closed: true, width: 0.25 },
        { type: 'stroke', segs: [{ k: 'line', a: [-500, 8000], b: [500, 8000] }, { ...arc([500, 9000], 1000, -Math.PI / 2, 2 * Math.PI), b: [500, 8000] }], closed: false, width: 0.25 },
      ]),
    );
    const [first, second, third, circle, turn] = readDxfEntities(text).entities;
    if (first.type !== 'LWPOLYLINE' || second.type !== 'LWPOLYLINE' || third.type !== 'ARC' || circle.type !== 'CIRCLE' || turn.type !== 'LWPOLYLINE') throw new Error('unexpected entities');
    expect(first.bulges).toEqual([0, expect.any(Number), 0]);
    expect(first.bulges[1]).toBeCloseTo(Math.tan(Math.PI / 8), 9);
    expect(first.bulges[1]).toBeGreaterThan(0);
    expect(near(first.points[2], [0, 1000])).toBe(true);
    expect(second.bulges[1]).toBeCloseTo(-Math.tan(Math.PI / 8), 9);
    // DXF arcs run counter-clockwise: the clockwise quarter from 90° to 0° is written from 0° to 90°.
    expect([third.start, third.end]).toEqual([0, 90]);
    expect(circle.radius).toBe(500);
    // A whole turn inside a polyline is split into two half turns (bulge 1 each).
    expect(turn.bulges).toEqual([0, 1, 1, 0]);
    expect(near(turn.points[2], [500, 10000])).toBe(true);
  });

  it('formats numbers without exponents and maps pen widths to DXF lineweights', () => {
    expect(dxfNumber(1e-12)).toBe('0');
    expect(dxfNumber(-0)).toBe('0');
    expect(dxfNumber(1234.5)).toBe('1234.5');
    expect(dxfNumber(-0.0000123)).toBe('-0.0000123');
    expect(dxfLineweight(0.5)).toBe(50);
    expect(dxfLineweight(0.18)).toBe(18);
    expect(dxfLineweight(0.7)).toBe(70);
  });

  it('writes an empty drawing as a valid file', () => {
    const empty = drawingToDxf(drawingOf([]));
    const r = readDxfEntities(empty);
    expect(r.entities).toEqual([]);
    expect(r.layers).toEqual(['0', 'Shapes']);
    expect(empty.endsWith('  0\nEOF\n')).toBe(true);
  });

  it('reads CRLF files and skips paper space', () => {
    const crlf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '25.4', '21', '0', '0', 'LINE', '67', '1', '8', 'B', '10', '0', '20', '0', '11', '1', '21', '1', '0', 'POINT', '8', 'A', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n');
    const r = readDxfEntities(crlf);
    expect(r.insUnits).toBe(1);
    expect(r.entities).toEqual([{ type: 'LINE', layer: 'A', a: [0, 0], b: [25.4, 0] }]);
    expect(r.skipped).toEqual({ POINT: 1 });
  });
});
