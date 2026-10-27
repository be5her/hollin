import type { DrawingColor, DrawingFill, DrawingLayer, DrawingSegment, DrawingStroke, DrawingText, PlanDrawing } from './drawing';
import { CAP_HEIGHT } from './paper';

/*
 * A plan drawing as an AutoCAD R2000 (AC1015) DXF: millimetres ($INSUNITS 4), one layer per drawing
 * layer, lines as LINE / ARC / CIRCLE / LWPOLYLINE (arcs as bulges: tan of a quarter of the sweep,
 * positive counter-clockwise, as in the model's paths), texts as single-line TEXT (group 40 the cap
 * height, 0.72 of the font size the other writers use), poché and marks as solid HATCH. The tables, blocks and objects are the minimum AutoCAD and LibreCAD need to open a file.
 * Lines end with LF; non-ASCII characters are written as \U+XXXX.
 */

export interface DxfOptions {
  /** The drawing scale's denominator (100 for 1:100): dash lengths, given on paper, become model lengths by it. Default 100. */
  scale?: number;
  /** Put before every layer name, e.g. `A-`. */
  layerPrefix?: string;
}

/** AutoCAD colour index per colour role (7 is black on white, white on black). */
export const DXF_COLORS: Record<DrawingColor, number> = { fg: 7, wallLine: 7, connector: 7, wall: 8, muted: 8, slab: 9, room: 5, dim: 4, decor: 32, warning: 40 };

/** The lineweights DXF allows, in hundredths of a millimetre. */
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

/** A paper width in mm as the nearest DXF lineweight. */
export function dxfLineweight(widthMm: number): number {
  const target = widthMm * 100;
  return LINEWEIGHTS.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), LINEWEIGHTS[0]);
}

/** A number as DXF writes it: fixed-point, at most nine decimals, no exponent, no negative zero. */
export function dxfNumber(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(9).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

/** A string as DXF stores it: one line, ASCII, anything else as \U+XXXX. */
export function dxfString(value: string): string {
  let out = '';
  for (const ch of value.replace(/[\r\n]+/g, ' ')) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code < 127) out += ch;
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}

/** A layer name AutoCAD accepts: the forbidden characters replaced. */
export function dxfLayerName(name: string): string {
  return dxfString(name).replace(/[<>/\\":;?*|=`,]/g, '_').slice(0, 255) || 'Layer';
}

const FULL_TURN = 2 * Math.PI - 1e-9;
const deg = (radians: number) => {
  const d = ((radians * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
};

/** Splits full-circle arcs in two, since one bulge cannot hold a whole turn. */
function splitFullArcs(segs: readonly DrawingSegment[]): DrawingSegment[] {
  const out: DrawingSegment[] = [];
  for (const s of segs) {
    if (s.k === 'arc' && Math.abs(s.sweep) >= FULL_TURN) {
      const half = s.sweep / 2;
      const mid: [number, number] = [s.center[0] + s.radius * Math.cos(s.start + half), s.center[1] + s.radius * Math.sin(s.start + half)];
      out.push({ ...s, b: mid, sweep: half }, { ...s, a: mid, start: s.start + half, sweep: half });
    } else out.push(s);
  }
  return out;
}

class Out {
  private readonly parts: string[] = [];
  pair(code: number, value: string | number): void {
    this.parts.push(String(code).padStart(3, ' '), typeof value === 'number' ? (Number.isInteger(value) ? String(value) : dxfNumber(value)) : value);
  }
  num(code: number, value: number): void {
    this.parts.push(String(code).padStart(3, ' '), dxfNumber(value));
  }
  point(code: number, p: readonly number[]): void {
    this.num(code, p[0]);
    this.num(code + 10, p[1]);
    this.num(code + 20, p[2] ?? 0);
  }
  text(): string {
    return this.parts.join('\n') + '\n';
  }
}

/** Writes a plan drawing as an R2000 DXF string. */
export function drawingToDxf(drawing: PlanDrawing, options: DxfOptions = {}): string {
  const scale = options.scale ?? 100;
  const prefix = options.layerPrefix ?? '';
  let seed = 0x10;
  const handle = () => (seed++).toString(16).toUpperCase();

  // Every handle a table, record or block refers to, allocated up front.
  const h = {
    vportTable: handle(),
    vport: handle(),
    ltypeTable: handle(),
    byBlock: handle(),
    byLayer: handle(),
    continuous: handle(),
    layerTable: handle(),
    layer0: handle(),
    styleTable: handle(),
    standard: handle(),
    viewTable: handle(),
    ucsTable: handle(),
    appidTable: handle(),
    acad: handle(),
    dimstyleTable: handle(),
    dimstyle: handle(),
    blockRecordTable: handle(),
    modelRecord: handle(),
    paperRecord: handle(),
    modelBlock: handle(),
    modelEnd: handle(),
    paperBlock: handle(),
    paperEnd: handle(),
    rootDict: handle(),
    groupDict: handle(),
  };

  // Layer names, unique.
  const names = new Map<DrawingLayer, string>();
  const used = new Set(['0']);
  for (const layer of drawing.layers) {
    let name = dxfLayerName(prefix + layer.name);
    for (let i = 2; used.has(name.toUpperCase()); i++) name = dxfLayerName(`${prefix}${layer.name} ${i}`);
    used.add(name.toUpperCase());
    names.set(layer, name);
  }

  // Line types: one per dash pattern used (the first is DASHED, which is always there).
  const ltypes = new Map<string, { name: string; pattern: readonly number[] }>();
  const patternKey = (dash: readonly number[]) => dash.map((d) => dxfNumber(d)).join(',');
  for (const layer of drawing.layers) {
    for (const p of layer.primitives) {
      if (p.type !== 'stroke' || !p.dash?.length) continue;
      const key = patternKey(p.dash);
      if (!ltypes.has(key)) ltypes.set(key, { name: ltypes.size ? `DASHED${ltypes.size + 1}` : 'DASHED', pattern: p.dash });
    }
  }
  if (!ltypes.size) ltypes.set('2,1', { name: 'DASHED', pattern: [2, 1] });
  const ltypeHandles = new Map([...ltypes.values()].map((t) => [t.name, handle()]));
  const layerHandles = new Map(drawing.layers.map((l) => [l, handle()]));

  const b = drawing.bounds;
  const empty = !Number.isFinite(b.minX);
  const min = empty ? [0, 0] : [b.minX, b.minY];
  const max = empty ? [0, 0] : [b.maxX, b.maxY];

  // ---------- TABLES ----------
  const t = new Out();
  t.pair(0, 'SECTION');
  t.pair(2, 'TABLES');
  const table = (name: string, own: string, count: number) => {
    t.pair(0, 'TABLE');
    t.pair(2, name);
    t.pair(5, own);
    t.pair(330, '0');
    t.pair(100, 'AcDbSymbolTable');
    t.pair(70, count);
  };
  const record = (type: string, own: string, owner: string, subclass: string, handleCode = 5) => {
    t.pair(0, type);
    t.pair(handleCode, own);
    t.pair(330, owner);
    t.pair(100, 'AcDbSymbolTableRecord');
    t.pair(100, subclass);
  };

  table('VPORT', h.vportTable, 1);
  record('VPORT', h.vport, h.vportTable, 'AcDbViewportTableRecord');
  t.pair(2, '*ACTIVE');
  t.pair(70, 0);
  t.point(10, [0, 0]);
  t.num(11, 1);
  t.num(21, 1);
  t.num(12, (min[0] + max[0]) / 2);
  t.num(22, (min[1] + max[1]) / 2);
  t.num(13, 0);
  t.num(23, 0);
  t.num(14, 10);
  t.num(24, 10);
  t.num(15, 10);
  t.num(25, 10);
  t.num(16, 0);
  t.num(26, 0);
  t.num(36, 1);
  t.num(17, 0);
  t.num(27, 0);
  t.num(37, 0);
  t.num(40, Math.max(1000, (max[1] - min[1]) * 1.1));
  t.num(41, Math.max(0.5, Math.min(4, (max[0] - min[0] || 1) / (max[1] - min[1] || 1))));
  t.num(42, 50);
  t.num(43, 0);
  t.num(44, 0);
  t.num(50, 0);
  t.num(51, 0);
  t.pair(71, 0);
  t.pair(72, 100);
  t.pair(73, 1);
  t.pair(74, 3);
  t.pair(75, 0);
  t.pair(76, 0);
  t.pair(77, 0);
  t.pair(78, 0);
  t.pair(0, 'ENDTAB');

  table('LTYPE', h.ltypeTable, 3 + ltypes.size);
  for (const [name, own, description] of [
    ['ByBlock', h.byBlock, ''],
    ['ByLayer', h.byLayer, ''],
    ['Continuous', h.continuous, 'Solid line'],
  ] as const) {
    record('LTYPE', own, h.ltypeTable, 'AcDbLinetypeTableRecord');
    t.pair(2, name);
    t.pair(70, 0);
    t.pair(3, description);
    t.pair(72, 65);
    t.pair(73, 0);
    t.num(40, 0);
  }
  for (const lt of ltypes.values()) {
    const pattern = lt.pattern.length % 2 ? [...lt.pattern, ...lt.pattern] : lt.pattern;
    record('LTYPE', ltypeHandles.get(lt.name)!, h.ltypeTable, 'AcDbLinetypeTableRecord');
    t.pair(2, lt.name);
    t.pair(70, 0);
    t.pair(3, 'Dashed __ __ __');
    t.pair(72, 65);
    t.pair(73, pattern.length);
    t.num(40, pattern.reduce((sum, d) => sum + d * scale, 0));
    pattern.forEach((d, i) => {
      t.num(49, (i % 2 ? -1 : 1) * d * scale);
      t.pair(74, 0);
    });
  }
  t.pair(0, 'ENDTAB');

  table('LAYER', h.layerTable, 1 + drawing.layers.length);
  const layerRecord = (name: string, own: string, color: number) => {
    record('LAYER', own, h.layerTable, 'AcDbLayerTableRecord');
    t.pair(2, name);
    t.pair(70, 0);
    t.pair(62, color);
    t.pair(6, 'Continuous');
    t.pair(370, -3);
  };
  layerRecord('0', h.layer0, 7);
  for (const layer of drawing.layers) layerRecord(names.get(layer)!, layerHandles.get(layer)!, DXF_COLORS[layer.color]);
  t.pair(0, 'ENDTAB');

  table('STYLE', h.styleTable, 1);
  record('STYLE', h.standard, h.styleTable, 'AcDbTextStyleTableRecord');
  t.pair(2, 'Standard');
  t.pair(70, 0);
  t.num(40, 0);
  t.num(41, 1);
  t.num(50, 0);
  t.pair(71, 0);
  t.num(42, 2.5);
  t.pair(3, 'txt');
  t.pair(4, '');
  t.pair(0, 'ENDTAB');

  table('VIEW', h.viewTable, 0);
  t.pair(0, 'ENDTAB');
  table('UCS', h.ucsTable, 0);
  t.pair(0, 'ENDTAB');

  table('APPID', h.appidTable, 1);
  record('APPID', h.acad, h.appidTable, 'AcDbRegAppTableRecord');
  t.pair(2, 'ACAD');
  t.pair(70, 0);
  t.pair(0, 'ENDTAB');

  table('DIMSTYLE', h.dimstyleTable, 1);
  t.pair(100, 'AcDbDimStyleTable');
  t.pair(71, 1);
  t.pair(340, h.dimstyle);
  record('DIMSTYLE', h.dimstyle, h.dimstyleTable, 'AcDbDimStyleTableRecord', 105);
  t.pair(2, 'Standard');
  t.pair(70, 0);
  t.pair(0, 'ENDTAB');

  table('BLOCK_RECORD', h.blockRecordTable, 2);
  for (const [name, own] of [
    ['*Model_Space', h.modelRecord],
    ['*Paper_Space', h.paperRecord],
  ] as const) {
    record('BLOCK_RECORD', own, h.blockRecordTable, 'AcDbBlockTableRecord');
    t.pair(2, name);
  }
  t.pair(0, 'ENDTAB');
  t.pair(0, 'ENDSEC');

  // ---------- BLOCKS ----------
  const bl = new Out();
  bl.pair(0, 'SECTION');
  bl.pair(2, 'BLOCKS');
  for (const [name, begin, end, owner, paper] of [
    ['*Model_Space', h.modelBlock, h.modelEnd, h.modelRecord, false],
    ['*Paper_Space', h.paperBlock, h.paperEnd, h.paperRecord, true],
  ] as const) {
    bl.pair(0, 'BLOCK');
    bl.pair(5, begin);
    bl.pair(330, owner);
    bl.pair(100, 'AcDbEntity');
    if (paper) bl.pair(67, 1);
    bl.pair(8, '0');
    bl.pair(100, 'AcDbBlockBegin');
    bl.pair(2, name);
    bl.pair(70, 0);
    bl.point(10, [0, 0]);
    bl.pair(3, name);
    bl.pair(1, '');
    bl.pair(0, 'ENDBLK');
    bl.pair(5, end);
    bl.pair(330, owner);
    bl.pair(100, 'AcDbEntity');
    if (paper) bl.pair(67, 1);
    bl.pair(8, '0');
    bl.pair(100, 'AcDbBlockEnd');
  }
  bl.pair(0, 'ENDSEC');

  // ---------- ENTITIES ----------
  const e = new Out();
  e.pair(0, 'SECTION');
  e.pair(2, 'ENTITIES');
  const entity = (type: string, layer: DrawingLayer, color: DrawingColor | undefined, extra?: { ltype?: string; lineweight?: number }) => {
    e.pair(0, type);
    e.pair(5, handle());
    e.pair(330, h.modelRecord);
    e.pair(100, 'AcDbEntity');
    e.pair(8, names.get(layer)!);
    if (extra?.ltype) e.pair(6, extra.ltype);
    if (color && DXF_COLORS[color] !== DXF_COLORS[layer.color]) e.pair(62, DXF_COLORS[color]);
    if (extra?.lineweight !== undefined) e.pair(370, extra.lineweight);
  };

  const writeStroke = (layer: DrawingLayer, s: DrawingStroke) => {
    if (!s.segs.length) return;
    const style = { ltype: s.dash?.length ? ltypes.get(patternKey(s.dash))?.name : undefined, lineweight: dxfLineweight(s.width) };
    if (s.segs.length === 1 && s.segs[0].k === 'line' && !s.closed) {
      const seg = s.segs[0];
      entity('LINE', layer, s.color, style);
      e.pair(100, 'AcDbLine');
      e.point(10, seg.a);
      e.point(11, seg.b);
      return;
    }
    if (s.segs.length === 1 && s.segs[0].k === 'arc') {
      const seg = s.segs[0];
      if (Math.abs(seg.sweep) >= FULL_TURN) {
        entity('CIRCLE', layer, s.color, style);
        e.pair(100, 'AcDbCircle');
        e.point(10, seg.center);
        e.num(40, seg.radius);
        return;
      }
      // DXF arcs run counter-clockwise from 50 to 51.
      const [from, to] = seg.sweep >= 0 ? [seg.start, seg.start + seg.sweep] : [seg.start + seg.sweep, seg.start];
      entity('ARC', layer, s.color, style);
      e.pair(100, 'AcDbCircle');
      e.point(10, seg.center);
      e.num(40, seg.radius);
      e.pair(100, 'AcDbArc');
      e.num(50, deg(from));
      e.num(51, deg(to));
      return;
    }
    const segs = splitFullArcs(s.segs);
    const vertices: { p: readonly number[]; bulge: number }[] = segs.map((seg) => ({ p: seg.a, bulge: seg.k === 'arc' ? Math.tan(seg.sweep / 4) : 0 }));
    if (!s.closed) vertices.push({ p: segs[segs.length - 1].b, bulge: 0 });
    entity('LWPOLYLINE', layer, s.color, style);
    e.pair(100, 'AcDbPolyline');
    e.pair(90, vertices.length);
    e.pair(70, s.closed ? 1 : 0);
    for (const v of vertices) {
      e.num(10, v.p[0]);
      e.num(20, v.p[1]);
      if (v.bulge !== 0) e.num(42, v.bulge);
    }
  };

  const writeHatch = (layer: DrawingLayer, f: DrawingFill) => {
    const rings = f.rings.filter((r) => r.length >= 3);
    if (!rings.length) return;
    entity('HATCH', layer, f.color);
    e.pair(100, 'AcDbHatch');
    e.point(10, [0, 0]);
    e.num(210, 0);
    e.num(220, 0);
    e.num(230, 1);
    e.pair(2, 'SOLID');
    e.pair(70, 1);
    e.pair(71, 0);
    e.pair(91, rings.length);
    for (const ring of rings) {
      e.pair(92, 2);
      e.pair(72, 0);
      e.pair(73, 1);
      e.pair(93, ring.length);
      for (const p of ring) {
        e.num(10, p[0]);
        e.num(20, p[1]);
      }
      e.pair(97, 0);
    }
    e.pair(75, 0);
    e.pair(76, 1);
    e.pair(98, 0);
  };

  const writeText = (layer: DrawingLayer, x: DrawingText) => {
    const halign = x.align === 'center' ? 1 : x.align === 'right' ? 2 : 0;
    // 0 is the baseline (1 would be the descender line), 2 the middle and 3 the top of the capitals.
    const valign = x.baseline === 'bottom' ? 0 : x.baseline === 'middle' ? 2 : 3;
    entity('TEXT', layer, x.color);
    e.pair(100, 'AcDbText');
    e.point(10, x.at);
    e.num(40, x.height * CAP_HEIGHT);
    e.pair(1, dxfString(x.text));
    if (x.rotation) e.num(50, x.rotation);
    e.pair(7, 'Standard');
    if (halign) e.pair(72, halign);
    e.point(11, x.at);
    e.pair(100, 'AcDbText');
    e.pair(73, valign);
  };

  for (const layer of drawing.layers) {
    for (const p of layer.primitives) {
      if (p.type === 'stroke') writeStroke(layer, p);
      else if (p.type === 'fill') {
        if (layer.hatch || p.mark) writeHatch(layer, p);
      } else writeText(layer, p);
    }
  }
  e.pair(0, 'ENDSEC');

  // ---------- OBJECTS ----------
  const o = new Out();
  o.pair(0, 'SECTION');
  o.pair(2, 'OBJECTS');
  o.pair(0, 'DICTIONARY');
  o.pair(5, h.rootDict);
  o.pair(330, '0');
  o.pair(100, 'AcDbDictionary');
  o.pair(281, 1);
  o.pair(3, 'ACAD_GROUP');
  o.pair(350, h.groupDict);
  o.pair(0, 'DICTIONARY');
  o.pair(5, h.groupDict);
  o.pair(330, h.rootDict);
  o.pair(100, 'AcDbDictionary');
  o.pair(281, 1);
  o.pair(0, 'ENDSEC');
  o.pair(0, 'EOF');

  // ---------- HEADER (last: it needs the next free handle) ----------
  const hd = new Out();
  hd.pair(0, 'SECTION');
  hd.pair(2, 'HEADER');
  hd.pair(9, '$ACADVER');
  hd.pair(1, 'AC1015');
  hd.pair(9, '$DWGCODEPAGE');
  hd.pair(3, 'ANSI_1252');
  hd.pair(9, '$INSBASE');
  hd.point(10, [0, 0]);
  hd.pair(9, '$EXTMIN');
  hd.point(10, min);
  hd.pair(9, '$EXTMAX');
  hd.point(10, max);
  hd.pair(9, '$LIMMIN');
  hd.num(10, min[0]);
  hd.num(20, min[1]);
  hd.pair(9, '$LIMMAX');
  hd.num(10, max[0]);
  hd.num(20, max[1]);
  hd.pair(9, '$LTSCALE');
  hd.num(40, 1);
  hd.pair(9, '$TEXTSTYLE');
  hd.pair(7, 'Standard');
  hd.pair(9, '$CLAYER');
  hd.pair(8, '0');
  hd.pair(9, '$LUNITS');
  hd.pair(70, 2);
  hd.pair(9, '$MEASUREMENT');
  hd.pair(70, 1);
  hd.pair(9, '$INSUNITS');
  hd.pair(70, 4);
  hd.pair(9, '$HANDSEED');
  hd.pair(5, handle());
  hd.pair(0, 'ENDSEC');
  const classes = new Out();
  classes.pair(0, 'SECTION');
  classes.pair(2, 'CLASSES');
  classes.pair(0, 'ENDSEC');

  return hd.text() + classes.text() + t.text() + bl.text() + e.text() + o.text();
}
