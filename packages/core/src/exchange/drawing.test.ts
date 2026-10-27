import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { deriveConnector } from '../geometry/connectors';
import { deriveLevels } from '../doc/derive';
import { drawingHouse } from './house.fixture';
import { drawingCounts, planDrawing, readableAngle, type DrawingLayerKind, type DrawingPrimitive, type DrawingStroke, type DrawingText, type PlanDrawing } from './drawing';

const layerOf = (d: PlanDrawing, kind: DrawingLayerKind) => d.layers.find((l) => l.kind === kind);
const strokes = (prims: readonly DrawingPrimitive[] | undefined) => (prims ?? []).filter((p): p is DrawingStroke => p.type === 'stroke');
const texts = (prims: readonly DrawingPrimitive[] | undefined) => (prims ?? []).filter((p): p is DrawingText => p.type === 'text').map((t) => t.text);

/** The signed area of a closed stroke made of lines (shoelace). */
function ringArea(s: DrawingStroke): number {
  let a = 0;
  for (const seg of s.segs) a += (seg.a[0] * seg.b[1] - seg.b[0] * seg.a[1]) / 2;
  return a;
}

describe('planDrawing', () => {
  const { doc, ground, upper } = drawingHouse();
  const drawing = planDrawing(doc, ground, { limits: DEFAULT_RULE_LIMITS });

  it('draws the level in layers, back to front, with their primitives', () => {
    expect(drawing.levelName).toBe('Ground floor');
    expect(drawing.layers.map((l) => l.kind)).toEqual(['slabs', 'rooms', 'shapes', 'walls', 'columns', 'openings', 'furniture', 'lights', 'connectors', 'dimensions', 'labels']);
    const counts = drawingCounts(drawing);
    // Walls: one poché fill and every outline (the window opens the ring, so one outline here).
    expect(counts.walls).toEqual({ stroke: 1, fill: 1, text: 0 });
    expect(layerOf(drawing, 'walls')?.hatch).toBe(true);
    // Door: two jambs, a leaf and a swing; window: two jambs and two glazing lines.
    expect(counts.openings).toEqual({ stroke: 8, fill: 0, text: 0 });
    // Two rooms: a tint, an outline, a name and an area each; the column stands in the kitchen as an island.
    expect(counts.rooms).toEqual({ stroke: 3, fill: 2, text: 4 });
    expect(counts.columns).toEqual({ stroke: 1, fill: 1, text: 0 });
    expect(counts.dimensions?.text).toBe(1);
    expect(counts.labels).toEqual({ stroke: 0, fill: 0, text: 1 });
    expect(counts.lights).toEqual({ stroke: 9, fill: 1, text: 0 });
    expect(counts.furniture?.fill).toBe(1);
    expect(Number.isFinite(drawing.bounds.minX)).toBe(true);
    expect(drawing.bounds.minX).toBeLessThanOrEqual(-100);
    expect(drawing.bounds.maxX).toBeGreaterThanOrEqual(12000);
  });

  it('draws the joined walls with the openings cut out, outer loops and holes', () => {
    const rings = strokes(layerOf(drawing, 'walls')?.primitives);
    expect(rings.every((r) => r.closed && r.segs.every((s) => s.k === 'line'))).toBe(true);
    const total = rings.reduce((sum, r) => sum + ringArea(r), 0);
    // The ring of outer walls, the partition between its faces, less the door's and the window's cuts.
    const expected = 9200 * 6200 - 8800 * 5800 + 100 * 5800 - 900 * 100 - 1200 * 200;
    expect(Math.abs(total - expected)).toBeLessThan(1);
    // The window cuts the ring open and the door joins the rooms: a single counter-clockwise outline.
    expect(rings.map((r) => Math.sign(ringArea(r)))).toEqual([1]);
    // Upstairs the closed ring has no openings: its outer loop counter-clockwise, its hole clockwise.
    const above = strokes(layerOf(planDrawing(doc, upper), 'walls')?.primitives).map(ringArea).sort((a, b) => a - b);
    expect(above).toHaveLength(2);
    expect(above[0]).toBeCloseTo(-8800 * 5800, 3);
    expect(above[1]).toBeCloseTo(9200 * 6200, 3);
  });

  it("draws a door's swing as an arc as wide as the door, dashed, from the open leaf to the far jamb", () => {
    const arcs = strokes(layerOf(drawing, 'openings')?.primitives).filter((s) => s.segs[0]?.k === 'arc');
    expect(arcs).toHaveLength(1);
    const arc = arcs[0].segs[0];
    if (arc.k !== 'arc') throw new Error('not an arc');
    expect(arc.radius).toBeCloseTo(900, 6);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI / 2, 9);
    expect(arcs[0].dash?.length).toBeGreaterThan(0);
    // The hinge is on the wall's line, at the door's start jamb.
    expect(arc.center[0]).toBeCloseTo(4500, 6);
    expect(arc.center[1]).toBeCloseTo(3000 - 450, 6);
  });

  it("writes each room's name and area at its label point", () => {
    const words = texts(layerOf(drawing, 'rooms')?.primitives);
    expect(words).toEqual(expect.arrayContaining(['Living', 'Kitchen', '25.23 m²', `${Math.round((8900 - 4550) * 5800) / 1e6} m²`]));
  });

  it('draws dimensions through dimensionGeometry, with their reading', () => {
    const dims = layerOf(drawing, 'dimensions')!;
    expect(texts(dims.primitives)).toEqual(['9000 mm']);
    // The dimension line, two extension lines and two ticks.
    expect(strokes(dims.primitives)).toHaveLength(5);
    expect(strokes(dims.primitives)[0].segs[0]).toMatchObject({ a: [0, -800], b: [9000, -800] });
  });

  it('keeps arcs as arcs and texts readable', () => {
    const shape = strokes(layerOf(drawing, 'shapes')?.primitives)[0];
    expect(shape.segs.map((s) => s.k)).toEqual(['line', 'arc', 'line', 'line']);
    const arc = shape.segs[1];
    if (arc.k !== 'arc') throw new Error('not an arc');
    expect(arc.sweep).toBeCloseTo(4 * Math.atan(0.5), 12);
    expect(readableAngle(180)).toBe(0);
    expect(readableAngle(270)).toBe(90);
    expect(readableAngle(-45)).toBe(-45);
    expect(readableAngle(300)).toBe(-60);
  });

  it('draws a stair as its plan symbol: treads, the cut, the arrow up, and down from the floor above', () => {
    const levels = deriveLevels(doc);
    const stair = Object.values(doc.connectors).find((c) => c.kind === 'stair')!;
    const g = deriveConnector(stair, levels, DEFAULT_RULE_LIMITS);
    if (g.kind !== 'stair') throw new Error('not a stair');
    const prims = layerOf(drawing, 'connectors')!.primitives;
    const words = texts(prims);
    expect(words).toEqual(expect.arrayContaining(['UP', `${g.risers} R`]));
    const lines = strokes(prims);
    // Every tread line, the dashed ones beyond the cut.
    const treads = lines.filter((s) => s.segs.length === 1 && g.treads.some((t) => Math.hypot(s.segs[0].a[0] - t.a[0], s.segs[0].a[1] - t.a[1]) < 1e-9 && Math.hypot(s.segs[0].b[0] - t.b[0], s.segs[0].b[1] - t.b[1]) < 1e-9));
    expect(treads).toHaveLength(g.treads.length);
    expect(g.cutAlong).not.toBeNull();
    expect(treads.filter((s) => s.dash).length).toBe(g.treads.filter((t) => t.along > g.cutAlong! + 1e-6).length);
    // The elevator's door mark on this floor, heavier than the rest.
    expect(lines.some((s) => s.width >= 0.7)).toBe(true);
    const above = planDrawing(doc, upper);
    expect(texts(layerOf(above, 'connectors')?.primitives)).toContain('DN');
  });

  it('shows entities spanning up from other levels, and leaves out hidden layers and kinds not asked for', () => {
    const above = planDrawing(doc, upper);
    expect(drawingCounts(above).columns).toEqual({ stroke: 1, fill: 1, text: 0 });
    const decor = Object.values(doc.layers).find((l) => l.levelId === ground && l.kind === 'decor')!;
    const hidden = planDrawing({ ...doc, layers: { ...doc.layers, [decor.id]: { ...decor, visible: false } } }, ground);
    expect(layerOf(hidden, 'furniture')).toBeUndefined();
    expect(layerOf(hidden, 'lights')).toBeUndefined();
    expect(layerOf(planDrawing({ ...doc, layers: { ...doc.layers, [decor.id]: { ...decor, visible: false } } }, ground, { skipHidden: false }), 'furniture')).toBeDefined();
    const only = planDrawing(doc, ground, { layers: ['walls', 'dimensions'] });
    expect(only.layers.map((l) => l.kind)).toEqual(['walls', 'dimensions']);
  });

  it('writes lengths and areas in the units asked for', () => {
    const imperial = planDrawing(doc, ground, { units: { system: 'imperial', metricUnit: 'mm', imperialStyle: 'ft-in', precision: 0, fraction: 16 }, layers: ['rooms', 'dimensions'] });
    expect(texts(layerOf(imperial, 'rooms')?.primitives).some((t) => t.endsWith('ft²'))).toBe(true);
    expect(texts(layerOf(imperial, 'dimensions')?.primitives)[0]).toMatch(/'/);
  });

  it('is empty for an unknown level', () => {
    const none = planDrawing(doc, 'lvl_0000000000000000');
    expect(none.layers).toEqual([]);
    expect(Number.isFinite(none.bounds.minX)).toBe(false);
  });
});

