import type { Vec2 } from '../geometry/vec';

/*
 * A small, tolerant DXF reader: group-code pairs in, the drawing units, the layer names and the
 * model-space entities the plan cares about out. LF or CRLF; \U+XXXX escapes decoded. Anything it
 * does not know is counted and skipped. Milestone 9, step 5 grows it into the importer's reader.
 */

export type DxfEntity =
  | { type: 'LINE'; layer: string; a: Vec2; b: Vec2 }
  /** `bulges[i]` is the arc from vertex i to the next (tan of a quarter of the sweep, positive counter-clockwise). */
  | { type: 'LWPOLYLINE'; layer: string; points: Vec2[]; bulges: number[]; closed: boolean }
  /** Angles in degrees; DXF arcs run counter-clockwise from `start` to `end`. */
  | { type: 'ARC'; layer: string; center: Vec2; radius: number; start: number; end: number }
  | { type: 'CIRCLE'; layer: string; center: Vec2; radius: number }
  /** `at` is the alignment point when the text is aligned (72/73 set), else the insertion point; rotation in degrees. */
  | { type: 'TEXT'; layer: string; at: Vec2; height: number; rotation: number; text: string; halign: number; valign: number };

export interface DxfEntities {
  /** `$INSUNITS` (4 = millimetres), or null when the header does not say. */
  insUnits: number | null;
  /** The names in the LAYER table, in file order. */
  layers: string[];
  entities: DxfEntity[];
  /** Entity types met in model space and skipped, with how many of each. */
  skipped: Record<string, number>;
}

export interface DxfPair {
  code: number;
  value: string;
}

/** The file as group-code pairs; a malformed code ends the reading there. */
export function dxfPairs(text: string): DxfPair[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) break;
    out.push({ code, value: lines[i + 1] });
  }
  return out;
}

/** Decodes \U+XXXX escapes. */
export function decodeDxfString(value: string): string {
  return value.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

const num = (value: string | undefined, fallback = 0): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
};

/** Reads the units, the layer names and the model-space LINE, LWPOLYLINE, ARC, CIRCLE and TEXT entities of a DXF. */
export function readDxfEntities(text: string): DxfEntities {
  const pairs = dxfPairs(text);
  const result: DxfEntities = { insUnits: null, layers: [], entities: [], skipped: {} };
  let section = '';
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0 && p.value.trim() === 'SECTION') {
      section = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.trim() : '';
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'ENDSEC') {
      section = '';
      i++;
      continue;
    }
    if (section === 'HEADER' && p.code === 9 && p.value.trim() === '$INSUNITS') {
      const v = pairs[i + 1];
      if (v?.code === 70) result.insUnits = Math.trunc(num(v.value));
      i += 2;
      continue;
    }
    if ((section === 'TABLES' || section === 'ENTITIES') && p.code === 0) {
      // One record: its pairs up to the next 0.
      const type = p.value.trim();
      let j = i + 1;
      while (j < pairs.length && pairs[j].code !== 0) j++;
      const body = pairs.slice(i + 1, j);
      if (section === 'TABLES' && type === 'LAYER') {
        const name = body.find((q) => q.code === 2);
        if (name) result.layers.push(decodeDxfString(name.value.trim()));
      } else if (section === 'ENTITIES') readEntity(type, body, result);
      i = j;
      continue;
    }
    i++;
  }
  return result;
}

function readEntity(type: string, body: DxfPair[], result: DxfEntities): void {
  const first = (code: number) => body.find((q) => q.code === code)?.value;
  // Paper space entities are not part of the plan.
  if (first(67)?.trim() === '1') return;
  const layer = decodeDxfString((first(8) ?? '0').trim());
  const at = (code: number): Vec2 => [num(first(code)), num(first(code + 10))];
  switch (type) {
    case 'LINE':
      result.entities.push({ type, layer, a: at(10), b: at(11) });
      return;
    case 'LWPOLYLINE': {
      const points: Vec2[] = [];
      const bulges: number[] = [];
      let x: number | null = null;
      for (const q of body) {
        if (q.code === 10) {
          x = num(q.value);
        } else if (q.code === 20 && x !== null) {
          points.push([x, num(q.value)]);
          bulges.push(0);
          x = null;
        } else if (q.code === 42 && bulges.length) bulges[bulges.length - 1] = num(q.value);
      }
      result.entities.push({ type, layer, points, bulges, closed: (Math.trunc(num(first(70))) & 1) === 1 });
      return;
    }
    case 'ARC':
      result.entities.push({ type, layer, center: at(10), radius: num(first(40)), start: num(first(50)), end: num(first(51)) });
      return;
    case 'CIRCLE':
      result.entities.push({ type, layer, center: at(10), radius: num(first(40)) });
      return;
    case 'TEXT': {
      const halign = Math.trunc(num(first(72)));
      const valign = Math.trunc(num(first(73)));
      const aligned = (halign !== 0 || valign !== 0) && first(11) !== undefined;
      result.entities.push({ type, layer, at: aligned ? at(11) : at(10), height: num(first(40)), rotation: num(first(50)), text: decodeDxfString(first(1) ?? ''), halign, valign });
      return;
    }
    default:
      result.skipped[type] = (result.skipped[type] ?? 0) + 1;
  }
}
