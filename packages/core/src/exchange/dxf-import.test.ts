import { describe, expect, it } from 'vitest';
import { addLayerOps, addLevelOps } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction, type Op } from '../doc/ops';
import type { Entity, ProjectDoc } from '../doc/schema';
import { arcGeometry, signedArea } from '../geometry/path';
import { planDrawing } from './drawing';
import { drawingToDxf } from './dxf';
import { dxfLayerSummary, dxfToOps, dxfUnitScale, type DxfImportOptions } from './dxf-import';
import { readDxf } from './dxf-read';
import { drawingHouse } from './house.fixture';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

/** Imports a DXF text into the ground floor of a fresh project, applied through a transaction. */
function importInto(text: string, options: DxfImportOptions = {}, base = newProjectDoc({ name: 'Import' })) {
  const levelId = base.building.groundLevelId;
  const result = dxfToOps(readDxf(text), base, levelId, options);
  const doc = commit(base, result.ops);
  const entities = Object.values(doc.levelData[levelId].entities);
  const onLayer = (name: string) => {
    const layer = Object.values(doc.layers).find((l) => l.levelId === levelId && l.name === name);
    return entities.filter((e) => e.layerId === layer?.id);
  };
  return { result, doc, levelId, entities, onLayer };
}

type Shape = Extract<Entity, { type: 'shape' }>;
type Separator = Extract<Entity, { type: 'separator' }>;
type Label = Extract<Entity, { type: 'label' }>;

/** A DXF from a template string: one code or value per line, indentation dropped. */
const dxfText = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .join('\n');

/** One ENTITIES section around some records, with an optional header and layer table. */
const entitiesDxf = (body: string, header = '', tables = '') =>
  [
    '0\nSECTION\n2\nHEADER',
    header && dxfText(header),
    '0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER',
    tables && dxfText(tables),
    '0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES',
    dxfText(body),
    '0\nENDSEC\n0\nEOF\n',
  ]
    .filter(Boolean)
    .join('\n');

describe('dxfToOps', () => {
  it("imports the writer's plan back: wall outlines with the walls' areas, labels with the room names, arcs kept", () => {
    const { doc: house, ground } = drawingHouse();
    const text = drawingToDxf(planDrawing(house, ground));
    // A fresh level of the same house.
    const added = addLevelOps(house, { position: 'top', name: 'Traced' });
    const base = commit(house, added.ops);
    const file = readDxf(text);
    const result = dxfToOps(file, base, added.levelId);
    const doc = commit(base, result.ops);
    expect(result.scale).toBe(1);
    const entities = Object.values(doc.levelData[added.levelId].entities);
    const layerNamed = (name: string) => Object.values(doc.layers).find((l) => l.levelId === added.levelId && l.name === name)!;
    const walls = entities.filter((e): e is Shape => e.type === 'shape' && e.layerId === layerNamed('DXF Walls').id);
    const expected = 9200 * 6200 - 8800 * 5800 + 100 * 5800 - 900 * 100 - 1200 * 200;
    const area = walls.reduce((sum, s) => sum + signedArea(s.path), 0);
    expect(walls.length).toBeGreaterThan(0);
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.001);
    expect(walls.every((s) => s.path.closed && s.filled === false)).toBe(true);
    const labels = entities.filter((e): e is Label => e.type === 'label').map((l) => l.text);
    expect(labels).toEqual(expect.arrayContaining(['Living', 'Kitchen', 'Entrance']));
    // The house's shape keeps its arc.
    const shapes = entities.filter((e): e is Shape => e.type === 'shape' && e.layerId === layerNamed('DXF Shapes').id);
    expect(shapes.some((s) => s.path.v.some((v) => v.s?.k === 'arc' && Math.abs(v.s.bulge - 0.5) < 1e-6))).toBe(true);
    // The door's swing is an open arc: a separator with one arc segment.
    const swing = entities.filter((e): e is Separator => e.type === 'separator' && e.layerId === layerNamed('DXF Doors and windows').id && e.path.v[0].s?.k === 'arc');
    expect(swing).toHaveLength(1);
    expect(result.counts.layers).toBe(new Set(entities.map((e) => e.layerId)).size);
    expect(result.skipped).toEqual({ HATCH: 2 });
    expect(dxfLayerSummary(file).find((l) => l.name === 'Walls')?.entities).toBe(walls.length);
  });

  it('turns an LWPOLYLINE with a bulge into a shape with an arc of the right radius', () => {
    const { result, entities } = importInto(
      entitiesDxf(`
        0
        LWPOLYLINE
        8
        Walls
        90
        4
        70
        1
        10
        0
        20
        0
        10
        1000
        20
        0
        10
        1000
        20
        1000
        42
        1
        10
        0
        20
        1000
      `),
    );
    expect(result.counts).toEqual({ shapes: 1, separators: 0, labels: 0, layers: 1 });
    const shape = entities[0] as Shape;
    expect(shape.path.closed).toBe(true);
    const arcAt = shape.path.v.findIndex((v) => v.s?.k === 'arc');
    expect(arcAt).toBe(2);
    const s = shape.path.v[2].s;
    if (s?.k !== 'arc') throw new Error('no arc');
    expect(arcGeometry(shape.path.v[2].p, shape.path.v[3].p, s.bulge).radius).toBeCloseTo(500, 6);
    expect(signedArea(shape.path)).toBeCloseTo(1000 * 1000 + (Math.PI * 500 * 500) / 2, 0);
  });

  it('makes a closed POLYLINE a shape, an ARC and a LINE separators, a CIRCLE a shape', () => {
    const { result, entities } = importInto(
      entitiesDxf(`
        0
        POLYLINE
        8
        P
        70
        1
        0
        VERTEX
        10
        0
        20
        0
        0
        VERTEX
        10
        100
        20
        0
        0
        VERTEX
        10
        100
        20
        100
        0
        SEQEND
        0
        ARC
        8
        P
        10
        0
        20
        0
        40
        500
        50
        0
        51
        90
        0
        LINE
        8
        P
        10
        0
        20
        0
        11
        10
        21
        0
        0
        CIRCLE
        8
        P
        10
        5000
        20
        0
        40
        250
      `),
    );
    expect(result.counts).toEqual({ shapes: 2, separators: 2, labels: 0, layers: 1 });
    const [triangle, arc, line, circle] = entities as [Shape, Separator, Separator, Shape];
    expect(triangle.path.v.map((v) => v.p)).toEqual([[0, 0], [100, 0], [100, 100]]);
    expect(arc.type).toBe('separator');
    expect(arc.path.v.map((v) => v.p)).toEqual([[500, 0], [0, 500]]);
    expect(arc.path.v[0].s).toEqual({ k: 'arc', bulge: expect.closeTo(Math.tan(Math.PI / 8), 9) });
    expect(line.path).toEqual({ closed: false, v: [{ p: [0, 0] }, { p: [10, 0] }] });
    expect(signedArea(circle.path)).toBeCloseTo(Math.PI * 250 * 250, 3);
  });

  it('scales an inches file by 25.4, adds the origin, and honours a scale given', () => {
    const line = `
      0
      LINE
      8
      A
      10
      1
      20
      2
      11
      3
      21
      2
    `;
    const inches = entitiesDxf(line, `9\n$INSUNITS\n70\n1`);
    const { result, entities } = importInto(inches, { origin: [100, -100] });
    expect(result.scale).toBe(25.4);
    expect((entities[0] as Separator).path.v.map((v) => v.p)).toEqual([[125.4, -49.2], [176.2, -49.2]]);
    expect((importInto(inches, { scale: 1000 }).entities[0] as Separator).path.v[1].p).toEqual([3000, 2000]);
    expect(dxfUnitScale(6)).toBe(1000);
    expect(dxfUnitScale(0)).toBe(1);
    expect(dxfUnitScale(null)).toBe(1);
  });

  it('makes labels of texts, MTEXT stripped, empty ones skipped', () => {
    const { result, entities } = importInto(
      entitiesDxf(`
        0
        TEXT
        8
        Notes
        1
        ${'   '}
        0
        MTEXT
        8
        Notes
        10
        0
        20
        0
        40
        200
        71
        5
        1
        {\\fArial|b1;Hello}\\PWorld
        0
        TEXT
        8
        Notes
        10
        0
        20
        0
        40
        100
        50
        -90
        72
        1
        73
        2
        11
        50
        21
        60
        1
        Door
      `),
      { textHeight: undefined },
    );
    const [mtext, text] = entities as [Label, Label];
    expect(mtext).toMatchObject({ type: 'label', text: 'Hello World', at: [0, 0], size: 200, rotation: 0 });
    expect(text).toMatchObject({ text: 'Door', at: [50, 60], size: 100, rotation: -90 });
    expect(result.counts.labels).toBe(2);
    expect(result.skipped).toEqual({ 'TEXT (empty)': 1 });
  });

  it('imports frozen or off layers hidden, reuses a layer of the same name, filters by layer', () => {
    const body = `
      0
      LINE
      8
      Walls
      10
      0
      20
      0
      11
      1000
      21
      0
      0
      LINE
      8
      Hidden
      10
      0
      20
      0
      11
      0
      21
      1000
    `;
    const tables = `
      0
      LAYER
      2
      Walls
      70
      0
      62
      7
      0
      LAYER
      2
      Hidden
      70
      1
      62
      1
    `;
    let base = newProjectDoc({ name: 'Import' });
    const existing = addLayerOps(base, { levelId: base.building.groundLevelId, kind: 'interior', name: 'DXF Walls' });
    base = commit(base, existing.ops);
    const { result, doc } = importInto(entitiesDxf(body, '', tables), {}, base);
    expect(result.layers.map((l) => [l.name, l.created, l.visible])).toEqual([
      ['DXF Walls', false, true],
      ['DXF Hidden', true, false],
    ]);
    expect(result.layers[0].id).toBe(existing.layerId);
    expect(doc.layers[result.layers[1].id].visible).toBe(false);
    expect(Object.values(doc.layers).filter((l) => l.name === 'DXF Walls')).toHaveLength(1);
    const filtered = importInto(entitiesDxf(body, '', tables), { layers: ['hidden'], layerPrefix: 'CAD: ' });
    expect(filtered.result.layers.map((l) => l.name)).toEqual(['CAD: Hidden']);
    expect(filtered.entities).toHaveLength(1);
  });

  it('skips and counts a degenerate polyline', () => {
    const { result, entities } = importInto(
      entitiesDxf(`
        0
        LWPOLYLINE
        8
        A
        90
        2
        70
        1
        10
        5
        20
        5
        10
        5
        20
        5
        0
        LINE
        8
        A
        10
        1
        20
        1
        11
        1
        21
        1
      `),
    );
    expect(entities).toHaveLength(0);
    expect(result.layers).toHaveLength(0);
    expect(result.skipped).toEqual({ 'LWPOLYLINE (degenerate)': 1, 'LINE (degenerate)': 1 });
  });
});
