import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geometry/vec';
import { readDxf, readDxfEntities, sampleBSpline, stripMtext, type DxfEntity } from './dxf-read';

/** A DXF from a template string: one code or value per line, indentation dropped. */
const dxfText = (s: string, eol = '\n') =>
  s
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .join(eol) + eol;

const only = <T extends DxfEntity['type']>(entities: DxfEntity[], type: T) => entities.filter((e): e is Extract<DxfEntity, { type: T }> => e.type === type);
const near = (a: Vec2, b: Vec2, tolerance = 1e-6) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;

describe('readDxf', () => {
  it('reads the header units and extents, the layer table with its flags, and drops a BOM', () => {
    const file = readDxf(
      '\uFEFF' +
        dxfText(`
          0
          SECTION
          2
          HEADER
          9
          $INSUNITS
          70
          6
          9
          $EXTMIN
          10
          -1.5
          20
          2
          30
          0
          9
          $EXTMAX
          10
          10
          20
          8
          30
          0
          0
          ENDSEC
          0
          SECTION
          2
          TABLES
          0
          TABLE
          2
          LAYER
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
          Frozen
          70
          1
          62
          3
          0
          LAYER
          2
          Off
          70
          0
          62
          -5
          0
          ENDTAB
          0
          ENDSEC
          0
          EOF
        `),
    );
    expect(file.insUnits).toBe(6);
    expect(file.extents).toEqual({ min: [-1.5, 2], max: [10, 8] });
    expect(file.layers).toEqual([
      { name: 'Walls', color: 7, off: false, frozen: false },
      { name: 'Frozen', color: 3, off: false, frozen: true },
      { name: 'Off', color: 5, off: true, frozen: false },
    ]);
  });

  it('reads POLYLINE / VERTEX / SEQEND with bulges and closure, and skips meshes', () => {
    const file = readDxf(
      dxfText(`
        0
        SECTION
        2
        ENTITIES
        0
        POLYLINE
        8
        P
        66
        1
        70
        1
        0
        VERTEX
        8
        P
        10
        0
        20
        0
        0
        VERTEX
        8
        P
        10
        100
        20
        0
        42
        0.5
        0
        VERTEX
        8
        P
        10
        100
        20
        100
        0
        SEQEND
        0
        POLYLINE
        8
        P
        70
        16
        0
        VERTEX
        10
        0
        20
        0
        0
        SEQEND
        0
        ENDSEC
        0
        EOF
      `),
    );
    expect(file.entities).toEqual([{ type: 'POLYLINE', layer: 'P', points: [[0, 0], [100, 0], [100, 100]], bulges: [0, 0.5, 0], closed: true }]);
    expect(file.skipped).toEqual({ 'POLYLINE (mesh)': 1 });
  });

  it('reads an LWPOLYLINE with bulges in a CRLF file', () => {
    const file = readDxf(
      dxfText(
        `
        0
        SECTION
        2
        ENTITIES
        0
        LWPOLYLINE
        8
        A
        90
        2
        70
        0
        10
        0
        20
        0
        42
        -1
        10
        200
        20
        0
        0
        ENDSEC
        0
        EOF
      `,
        '\r\n',
      ),
    );
    expect(file.entities).toEqual([{ type: 'LWPOLYLINE', layer: 'A', points: [[0, 0], [200, 0]], bulges: [-1, 0], closed: false }]);
  });

  it('flattens an ELLIPSE to points within its extent, full or partial', () => {
    const ellipse = (start: number, end: number) =>
      only(
        readDxf(
          dxfText(`
            0
            SECTION
            2
            ENTITIES
            0
            ELLIPSE
            8
            E
            10
            1000
            20
            0
            11
            200
            21
            0
            40
            0.5
            41
            ${start}
            42
            ${end}
            0
            ENDSEC
          `),
        ).entities,
        'ELLIPSE',
      )[0];
    const full = ellipse(0, 2 * Math.PI);
    expect(full.closed).toBe(true);
    expect(full.points).toHaveLength(64);
    const xs = full.points.map((p) => p[0]);
    const ys = full.points.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(800, 6);
    expect(Math.max(...xs)).toBeCloseTo(1200, 6);
    expect(Math.min(...ys)).toBeCloseTo(-100, 6);
    expect(Math.max(...ys)).toBeCloseTo(100, 6);
    const half = ellipse(0, Math.PI);
    expect(half.closed).toBe(false);
    expect(near(half.points[0], [1200, 0])).toBe(true);
    expect(near(half.points[half.points.length - 1], [800, 0])).toBe(true);
    expect(half.points.every((p) => p[1] >= -1e-9)).toBe(true);
  });

  it('evaluates a cubic SPLINE from its knots near its control hull, and falls back to fit points', () => {
    const file = readDxf(
      dxfText(`
        0
        SECTION
        2
        ENTITIES
        0
        SPLINE
        8
        S
        70
        8
        71
        3
        72
        8
        73
        4
        40
        0
        40
        0
        40
        0
        40
        0
        40
        1
        40
        1
        40
        1
        40
        1
        10
        0
        20
        0
        10
        100
        20
        200
        10
        200
        20
        -200
        10
        300
        20
        0
        0
        SPLINE
        8
        S
        71
        5
        11
        0
        21
        0
        11
        50
        21
        50
        11
        100
        21
        0
        0
        ENDSEC
      `),
    );
    const [cubic, fit] = only(file.entities, 'SPLINE');
    expect(near(cubic.points[0], [0, 0])).toBe(true);
    expect(near(cubic.points[cubic.points.length - 1], [300, 0])).toBe(true);
    // A Bézier: the middle at (150, 0), a quarter at the Bernstein sum.
    const bezier = (t: number): Vec2 => {
      const c = [[0, 0], [100, 200], [200, -200], [300, 0]];
      const w = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
      return [w.reduce((s, k, i) => s + k * c[i][0], 0), w.reduce((s, k, i) => s + k * c[i][1], 0)];
    };
    expect(near(cubic.points[8], bezier(0.5))).toBe(true);
    expect(near(cubic.points[4], bezier(0.25))).toBe(true);
    expect(cubic.points.every((p) => p[0] >= 0 && p[0] <= 300 && Math.abs(p[1]) <= 200)).toBe(true);
    expect(fit.points).toEqual([[0, 0], [50, 50], [100, 0]]);
    expect(sampleBSpline(3, [0, 1], [[0, 0]])).toBeNull();
  });

  it('expands an INSERT with its scale, rotation and base point, layer 0 taking the reference’s layer, one nesting deep', () => {
    const file = readDxf(
      dxfText(`
        0
        SECTION
        2
        BLOCKS
        0
        BLOCK
        8
        0
        2
        B
        10
        10
        20
        0
        0
        LINE
        8
        0
        10
        10
        20
        0
        11
        20
        21
        0
        0
        CIRCLE
        8
        Own
        10
        10
        20
        5
        40
        1
        0
        ENDBLK
        0
        BLOCK
        2
        OUTER
        10
        0
        20
        0
        0
        INSERT
        8
        0
        2
        B
        10
        0
        20
        0
        0
        ENDBLK
        0
        BLOCK
        2
        DEEP
        10
        0
        20
        0
        0
        INSERT
        8
        0
        2
        OUTER
        10
        0
        20
        0
        0
        ENDBLK
        0
        ENDSEC
        0
        SECTION
        2
        ENTITIES
        0
        INSERT
        8
        Doors
        2
        B
        10
        100
        20
        100
        41
        2
        42
        2
        50
        90
        0
        INSERT
        8
        Nested
        2
        OUTER
        10
        1000
        20
        0
        0
        INSERT
        8
        Deep
        2
        DEEP
        10
        0
        20
        0
        0
        INSERT
        8
        X
        2
        MISSING
        0
        ENDSEC
      `),
    );
    expect(file.blocks.map((b) => b.name)).toEqual(['B', 'OUTER', 'DEEP']);
    const lines = only(file.entities, 'LINE');
    expect(lines).toHaveLength(2);
    expect(lines[0].layer).toBe('Doors');
    expect(near(lines[0].a, [100, 100]) && near(lines[0].b, [100, 120])).toBe(true);
    const circle = only(file.entities, 'CIRCLE')[0];
    expect(circle.layer).toBe('Own');
    expect(near(circle.center, [90, 100])).toBe(true);
    expect(circle.radius).toBeCloseTo(2, 9);
    // OUTER holds B at its origin: B's line lands at 1000 on the reference's layer.
    expect(lines[1].layer).toBe('Nested');
    expect(near(lines[1].a, [1000, 0]) && near(lines[1].b, [1010, 0])).toBe(true);
    // DEEP > OUTER > B is two levels of nesting: B is not expanded.
    expect(file.skipped).toEqual({ 'INSERT (nested)': 1, 'INSERT (no block)': 1 });
  });

  it('turns arcs under a non-uniform block scale into points, and mirrors one whose extrusion faces down', () => {
    const file = readDxf(
      dxfText(`
        0
        SECTION
        2
        BLOCKS
        0
        BLOCK
        2
        C
        10
        0
        20
        0
        0
        CIRCLE
        10
        0
        20
        0
        40
        10
        0
        ENDBLK
        0
        ENDSEC
        0
        SECTION
        2
        ENTITIES
        0
        INSERT
        8
        I
        2
        C
        41
        2
        42
        1
        0
        ARC
        8
        M
        10
        100
        20
        0
        40
        10
        50
        0
        51
        90
        230
        -1
        0
        ENDSEC
      `),
    );
    const [ellipse] = only(file.entities, 'POLYLINE');
    expect(ellipse.closed).toBe(true);
    expect(Math.max(...ellipse.points.map((p) => p[0]))).toBeCloseTo(20, 9);
    expect(Math.max(...ellipse.points.map((p) => p[1]))).toBeCloseTo(10, 9);
    const [arc] = only(file.entities, 'ARC');
    // Seen from below, the arc around (100, 0) from 0° to 90° is the arc around (-100, 0) from 90° to 180°.
    expect(near(arc.center, [-100, 0])).toBe(true);
    expect(arc.start).toBeCloseTo(90, 9);
    expect(arc.end).toBeCloseTo(180, 9);
  });

  it('reads TEXT and MTEXT with their formatting codes stripped', () => {
    const file = readDxf(
      dxfText(`
        0
        SECTION
        2
        ENTITIES
        0
        MTEXT
        8
        T
        10
        5
        20
        6
        40
        2.5
        71
        5
        3
        {\\fArial|b1;Hello}
        1
        \\PWorld
        0
        MTEXT
        8
        T
        11
        0
        21
        1
        1
        \\H2.5x;\\C1;Red\\~and \\Lunder\\l 45%%d \\S1/2; \\{x\\}
        0
        TEXT
        8
        T
        10
        1
        20
        2
        40
        3
        50
        30
        1
        %%c50 \\U+00B2
        0
        ENDSEC
      `),
    );
    const [first, second] = only(file.entities, 'MTEXT');
    expect(first).toEqual({ type: 'MTEXT', layer: 'T', at: [5, 6], height: 2.5, rotation: 0, text: 'Hello\nWorld', attach: 5 });
    expect(second.text).toBe('Red and under 45° 1/2 {x}');
    expect(second.rotation).toBeCloseTo(90, 9);
    expect(only(file.entities, 'TEXT')[0]).toMatchObject({ at: [1, 2], height: 3, rotation: 30, text: '⌀50 ²' });
    expect(stripMtext('A\\PB\\~C')).toBe('A\nB C');
  });

  it('skips paper space, counts unknown entities, and keeps readDxfEntities working', () => {
    const text = dxfText(`
      0
      SECTION
      2
      ENTITIES
      0
      LINE
      8
      A
      10
      0
      20
      0
      11
      1
      21
      0
      0
      LINE
      67
      1
      8
      A
      10
      0
      20
      0
      11
      1
      21
      1
      0
      HATCH
      8
      A
      0
      WIPEOUT
      8
      A
      0
      HATCH
      8
      A
      0
      ENDSEC
      0
      EOF
    `);
    const file = readDxf(text);
    expect(file.entities).toHaveLength(1);
    expect(file.paperSpace).toBe(1);
    expect(file.skipped).toEqual({ HATCH: 2, WIPEOUT: 1 });
    expect(readDxfEntities(text)).toEqual({ insUnits: null, layers: [], entities: file.entities, skipped: file.skipped });
  });
});
