import { addEntityOps, addLayerOps, requireLevel, type NewEntity } from '../doc/builders';
import type { Op } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import type { Path, Vertex } from '../geometry/path';
import { roundMm, type Vec2 } from '../geometry/vec';
import type { DxfEntity, DxfFile } from './dxf-read';
import { CAP_HEIGHT } from './paper';

/*
 * A DXF drawing as edits of one level: a layer per DXF layer (`DXF <name>`, interior kind so it can
 * hold room dividers; layer names compared without case, as DXF does), closed outlines and arcs as
 * unfilled shapes with their arcs, other open lines as separators, texts as labels. The result is a
 * list of ops for one transaction; nothing is applied here.
 */

/** Millimetres per drawing unit for each `$INSUNITS` code (0, unitless, is taken as millimetres). */
export const DXF_UNIT_MM: Readonly<Record<number, number>> = {
  0: 1,
  1: 25.4,
  2: 304.8,
  3: 1_609_344,
  4: 1,
  5: 10,
  6: 1000,
  7: 1_000_000,
  8: 0.0000254,
  9: 0.0254,
  10: 914.4,
  11: 1e-7,
  12: 1e-6,
  13: 0.001,
  14: 100,
  15: 10_000,
  16: 100_000,
  17: 1e12,
  18: 1.495978707e14,
  19: 9.4607304725808e18,
  20: 3.0856775814913673e19,
  21: 1_200_000 / 3937,
  22: 100_000 / 3937,
  23: 3_600_000 / 3937,
  24: 6_336_000_000 / 3937,
};

/** The unit names of `$INSUNITS`, for a UI. */
export const DXF_UNIT_NAMES: Readonly<Record<number, string>> = {
  0: 'unitless',
  1: 'inches',
  2: 'feet',
  3: 'miles',
  4: 'millimetres',
  5: 'centimetres',
  6: 'metres',
  7: 'kilometres',
  8: 'microinches',
  9: 'mils',
  10: 'yards',
  11: 'ångströms',
  12: 'nanometres',
  13: 'microns',
  14: 'decimetres',
  15: 'decametres',
  16: 'hectometres',
  17: 'gigametres',
  18: 'astronomical units',
  19: 'light years',
  20: 'parsecs',
  21: 'US survey feet',
  22: 'US survey inches',
  23: 'US survey yards',
  24: 'US survey miles',
};

/** Millimetres per drawing unit for a `$INSUNITS` value; 1 (millimetres) when absent or unknown. */
export function dxfUnitScale(insUnits: number | null): number {
  return insUnits === null ? 1 : (DXF_UNIT_MM[insUnits] ?? 1);
}

/** The `$INSUNITS` code a file's drawing units are taken as: its own, else inches (1) for an imperial `$MEASUREMENT` (0), else null. */
export function dxfUnits(file: Pick<DxfFile, 'insUnits' | 'measurement'>): number | null {
  return file.insUnits ?? (file.measurement === 0 ? 1 : null);
}

export interface DxfImportOptions {
  /** Millimetres per drawing unit; default from `$INSUNITS` (or `$MEASUREMENT` without it, `dxfUnits`). */
  scale?: number;
  /** Added after scaling, mm. */
  origin?: Vec2;
  /** Put before each DXF layer's name; default `DXF `. */
  layerPrefix?: string;
  /** Only these DXF layers (names compared without case). */
  layers?: readonly string[];
  /** Every label's height in mm, instead of the texts' own (whose DXF height is the capitals', `CAP_HEIGHT` of the font size). */
  textHeight?: number;
}

export interface DxfImportLayer {
  id: string;
  name: string;
  /** The DXF layer it holds. */
  dxfLayer: string;
  /** False when a layer of that name was already on the level. */
  created: boolean;
  visible: boolean;
}

export interface DxfImportResult {
  ops: Op[];
  counts: { shapes: number; separators: number; labels: number; layers: number };
  /** The reader's skipped entity types, plus `<TYPE> (degenerate)` and `<TYPE> (empty)` for what did not make an entity. */
  skipped: Record<string, number>;
  /** Millimetres per drawing unit used. */
  scale: number;
  layers: DxfImportLayer[];
}

/** A DXF layer's summary, for a probe. */
export interface DxfLayerSummary {
  name: string;
  entities: number;
  color: number;
  /** Off or frozen in the DXF: imported hidden. */
  hidden: boolean;
}

/** The layers of the table and those entities name without a table entry, with how many entities each holds (table order first; names compared without case, the first spelling kept). */
export function dxfLayerSummary(file: DxfFile): DxfLayerSummary[] {
  const byKey = new Map<string, DxfLayerSummary>();
  for (const l of file.layers) if (!byKey.has(l.name.toLowerCase())) byKey.set(l.name.toLowerCase(), { name: l.name, entities: 0, color: l.color, hidden: l.off || l.frozen });
  for (const e of file.entities) {
    const key = e.layer.toLowerCase();
    let s = byKey.get(key);
    if (!s) byKey.set(key, (s = { name: e.layer, entities: 0, color: 7, hidden: false }));
    s.entities++;
  }
  return [...byKey.values()];
}

/** The entities' extent in drawing units, or null when there are none. */
export function dxfExtents(file: DxfFile): { min: Vec2; max: Vec2 } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: Vec2, r = 0) => {
    minX = Math.min(minX, p[0] - r);
    minY = Math.min(minY, p[1] - r);
    maxX = Math.max(maxX, p[0] + r);
    maxY = Math.max(maxY, p[1] + r);
  };
  for (const e of file.entities) {
    switch (e.type) {
      case 'LINE':
        add(e.a);
        add(e.b);
        break;
      case 'ARC':
      case 'CIRCLE':
        add(e.center, e.radius);
        break;
      case 'TEXT':
      case 'MTEXT':
        add(e.at);
        break;
      default:
        for (const p of e.points) add(p);
    }
  }
  return Number.isFinite(minX) ? { min: [minX, minY], max: [maxX, maxY] } : null;
}

const DEG = Math.PI / 180;
const MAX_BULGE = 1e6;

/** Degrees in (-180, 180]. */
const normDeg = (d: number) => {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : Object.is(r, -0) ? 0 : r;
};

type Draft = { kind: 'shape' | 'separator'; layer: string; path: Path } | { kind: 'label'; layer: string; text: string; at: Vec2; size: number; rotation: number };

/** Turns a parsed DXF into the ops that add its drawing to a level, in one transaction. */
export function dxfToOps(file: DxfFile, doc: ProjectDoc, levelId: string, options: DxfImportOptions = {}): DxfImportResult {
  requireLevel(doc, levelId);
  const scale = options.scale ?? dxfUnitScale(dxfUnits(file));
  const [ox, oy] = options.origin ?? [0, 0];
  const prefix = options.layerPrefix ?? 'DXF ';
  const only = options.layers ? new Set(options.layers.map((l) => l.toLowerCase())) : null;
  const skipped: Record<string, number> = { ...file.skipped };
  const skip = (key: string) => {
    skipped[key] = (skipped[key] ?? 0) + 1;
  };
  const mm = (p: Vec2): Vec2 => [roundMm(p[0] * scale + ox), roundMm(p[1] * scale + oy)];
  // DXF layer names are compared without case: an entity's layer as the table spells it first, else as the first entity on it does.
  const table = new Map<string, DxfFile['layers'][number]>();
  for (const l of file.layers) if (!table.has(l.name.toLowerCase())) table.set(l.name.toLowerCase(), l);
  const spelling = new Map([...table].map(([key, l]) => [key, l.name]));
  const canonical = (name: string) => {
    const key = name.toLowerCase();
    if (!spelling.has(key)) spelling.set(key, name);
    return spelling.get(key)!;
  };

  const drafts: Draft[] = [];
  for (const e of file.entities) {
    if (only && !only.has(e.layer.toLowerCase())) continue;
    const layer = canonical(e.layer);
    const draft = toDraft(e, layer, mm, scale, options.textHeight);
    if (typeof draft === 'string') skip(`${e.type} (${draft})`);
    else drafts.push(draft);
  }

  // The project layers, in the order their DXF layers first appear.
  const ops: Op[] = [];
  const layers: DxfImportLayer[] = [];
  const layerFor = new Map<string, { id: string; interior: boolean }>();
  const existing = Object.values(doc.layers).filter((l) => l.levelId === levelId);
  let order = existing.reduce((max, l) => Math.max(max, l.order), -1);
  for (const d of drafts) {
    if (layerFor.has(d.layer)) continue;
    const name = `${prefix}${d.layer}`.trim().slice(0, 120).trim() || 'DXF';
    const reuse = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (reuse) {
      layerFor.set(d.layer, { id: reuse.id, interior: reuse.kind === 'interior' });
      layers.push({ id: reuse.id, name: reuse.name, dxfLayer: d.layer, created: false, visible: reuse.visible });
      continue;
    }
    const source = table.get(d.layer.toLowerCase());
    const visible = !(source?.off || source?.frozen);
    const added = addLayerOps(doc, { levelId, kind: 'interior', name });
    order++;
    for (const op of added.ops) ops.push(op.t === 'ins' ? { ...op, v: { ...(op.v as object), order, visible } } : op);
    layerFor.set(d.layer, { id: added.layerId, interior: true });
    layers.push({ id: added.layerId, name, dxfLayer: d.layer, created: true, visible });
  }

  const counts = { shapes: 0, separators: 0, labels: 0, layers: layers.length };
  for (const d of drafts) {
    const target = layerFor.get(d.layer)!;
    let entity: NewEntity;
    if (d.kind === 'label') {
      entity = { type: 'label', text: d.text, at: d.at, size: d.size, rotation: d.rotation };
      counts.labels++;
    } else if (d.kind === 'separator' && target.interior) {
      entity = { type: 'separator', path: d.path };
      counts.separators++;
    } else {
      // A divider needs an interior layer: on a reused layer of another kind an open line stays an open shape.
      entity = { type: 'shape', path: d.path, filled: false };
      counts.shapes++;
    }
    ops.push(...addEntityOps(doc, { levelId, layerId: target.id, entity }).ops);
  }
  return { ops, counts, skipped, scale, layers };
}

/** One DXF entity as what it becomes, or why it becomes nothing. */
function toDraft(e: DxfEntity, layer: string, mm: (p: Vec2) => Vec2, scale: number, textHeight: number | undefined): Draft | 'degenerate' | 'empty' {
  switch (e.type) {
    case 'LINE':
      return polyDraft(layer, [mm(e.a), mm(e.b)], [0, 0], false);
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return polyDraft(layer, e.points.map(mm), e.bulges, e.closed);
    case 'ELLIPSE':
      // An elliptical arc is a curve, not a divider: an open shape, as an arc is.
      return polyDraft(layer, e.points.map(mm), e.points.map(() => 0), e.closed, 'shape');
    case 'SPLINE':
      return polyDraft(layer, e.points.map(mm), e.points.map(() => 0), e.closed);
    case 'CIRCLE': {
      const r = e.radius * scale;
      if (!(r >= 0.001)) return 'degenerate';
      return polyDraft(layer, [mm([e.center[0] + e.radius, e.center[1]]), mm([e.center[0] - e.radius, e.center[1]])], [1, 1], true);
    }
    case 'ARC': {
      if (!(e.radius * scale >= 0.001)) return 'degenerate';
      let sweep = (((e.end - e.start) % 360) + 360) % 360;
      if (sweep < 1e-9) sweep = 360;
      if (sweep >= 360 - 1e-9) return toDraft({ type: 'CIRCLE', layer: e.layer, center: e.center, radius: e.radius }, layer, mm, scale, textHeight);
      const at = (deg: number): Vec2 => mm([e.center[0] + e.radius * Math.cos(deg * DEG), e.center[1] + e.radius * Math.sin(deg * DEG)]);
      return polyDraft(layer, [at(e.start), at(e.start + sweep)], [Math.tan((sweep * DEG) / 4), 0], false, 'shape');
    }
    case 'TEXT':
    case 'MTEXT': {
      const text = e.text.replace(/\s*\n\s*/g, ' ').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500).trim();
      if (!text) return 'empty';
      // DXF heights are the capitals' (what the writer puts in 40); a label's size is the font's.
      const height = e.height > 0 ? e.height : (250 * CAP_HEIGHT) / scale;
      const center = textCenter(e, height, text);
      const size = textHeight ?? (height / CAP_HEIGHT) * scale;
      return { kind: 'label', layer, text, at: mm(center), size: Math.max(roundMm(size), 0.001), rotation: normDeg(e.rotation) };
    }
  }
}

/**
 * Where a text's middle lies, in drawing units: labels are drawn centred on their point, DXF texts
 * hang from a corner or an edge. `height` is the capitals'; the width is estimated (0.6 of the font size per character).
 */
function textCenter(e: Extract<DxfEntity, { type: 'TEXT' | 'MTEXT' }>, height: number, text: string): Vec2 {
  let col: number;
  let dy: number;
  if (e.type === 'MTEXT') {
    const a = Math.min(9, Math.max(1, e.attach)) - 1;
    col = a % 3;
    const lines = Math.max(1, e.text.split('\n').length);
    const blockHeight = height * (1 + (lines - 1) * 1.5);
    dy = (Math.floor(a / 3) - 1) * (blockHeight / 2);
  } else {
    col = e.halign === 0 ? 0 : e.halign === 2 ? 2 : 1;
    dy = e.halign === 4 ? 0 : e.valign === 2 ? 0 : e.valign === 3 ? -height / 2 : height / 2;
  }
  const longest = Math.max(...(e.type === 'MTEXT' ? e.text.split('\n') : [text]).map((l) => l.length));
  const dx = (1 - col) * (longest * (height / CAP_HEIGHT) * 0.6) / 2;
  const r = e.rotation * DEG;
  return [e.at[0] + dx * Math.cos(r) - dy * Math.sin(r), e.at[1] + dx * Math.sin(r) + dy * Math.cos(r)];
}

/**
 * A polyline in mm as a shape (closed) or `open` (a separator, or an open shape for an arc) with its
 * arcs, repeated points removed (a removed point hands its outgoing arc to the point before it), or
 * 'degenerate' under two distinct points.
 */
function polyDraft(layer: string, points: readonly Vec2[], bulges: readonly number[], closed: boolean, open: 'shape' | 'separator' = 'separator'): Draft | 'degenerate' {
  const kept: { p: Vec2; bulge: number }[] = [];
  points.forEach((p, i) => {
    const bulge = bulges[i] ?? 0;
    const last = kept[kept.length - 1];
    if (last && last.p[0] === p[0] && last.p[1] === p[1]) last.bulge = bulge;
    else kept.push({ p, bulge });
  });
  if (closed && kept.length > 1 && kept[0].p[0] === kept[kept.length - 1].p[0] && kept[0].p[1] === kept[kept.length - 1].p[1]) kept.pop();
  if (kept.length < 2) return 'degenerate';
  const isArc = (b: number) => Math.abs(b) > 1e-9;
  // Two points joined twice by straight lines enclose nothing: that is a line.
  if (closed && kept.length === 2 && !kept.some((k) => isArc(k.bulge))) closed = false;
  const v: Vertex[] = kept.map((k, i) => {
    const last = !closed && i === kept.length - 1;
    return !last && isArc(k.bulge) ? { p: k.p, s: { k: 'arc', bulge: Math.max(-MAX_BULGE, Math.min(MAX_BULGE, k.bulge)) } } : { p: k.p };
  });
  return { kind: closed ? 'shape' : open, layer, path: { closed, v } };
}
