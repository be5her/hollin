import { arcGeometry, arcPoint } from '../geometry/path';
import type { Vec2 } from '../geometry/vec';

/*
 * A tolerant DXF reader: group-code pairs in, the drawing units, the layer table, the block
 * definitions and the model-space entities out, in the file's own units (the caller scales).
 * LF or CRLF, a UTF-8 byte order mark, \U+XXXX escapes. Curves the model has no exact form for
 * (ellipses, splines) come out flattened to points; block references come out expanded with their
 * transform (nested references one level deep). Anything it does not know is counted and skipped.
 */

export type DxfEntity =
  | { type: 'LINE'; layer: string; a: Vec2; b: Vec2 }
  /** `bulges[i]` is the arc from vertex i to the next (tan of a quarter of the sweep, positive counter-clockwise). */
  | { type: 'LWPOLYLINE'; layer: string; points: Vec2[]; bulges: number[]; closed: boolean }
  /** A POLYLINE with its VERTEX records (2D, or 3D flattened to its XY); bulges as for LWPOLYLINE. */
  | { type: 'POLYLINE'; layer: string; points: Vec2[]; bulges: number[]; closed: boolean }
  /** Angles in degrees; DXF arcs run counter-clockwise from `start` to `end`. */
  | { type: 'ARC'; layer: string; center: Vec2; radius: number; start: number; end: number }
  | { type: 'CIRCLE'; layer: string; center: Vec2; radius: number }
  /** An ellipse or elliptical arc flattened to points (64 segments per full turn); `closed` for a full one. */
  | { type: 'ELLIPSE'; layer: string; points: Vec2[]; closed: boolean }
  /** A spline flattened to points: evaluated from its control points and knots up to degree 3, else through its fit points. */
  | { type: 'SPLINE'; layer: string; points: Vec2[]; closed: boolean }
  /** `at` is the alignment point when the text is aligned (72/73 set), else the insertion point; rotation in degrees. */
  | { type: 'TEXT'; layer: string; at: Vec2; height: number; rotation: number; text: string; halign: number; valign: number }
  /** Formatting codes stripped, paragraphs as `\n`; `attach` is DXF's 1 (top left) to 9 (bottom right). */
  | { type: 'MTEXT'; layer: string; at: Vec2; height: number; rotation: number; text: string; attach: number };

export interface DxfLayer {
  name: string;
  /** The AutoCAD colour index (absolute). */
  color: number;
  /** Off: a negative colour in the table. */
  off: boolean;
  /** Frozen: flag 1 of code 70. */
  frozen: boolean;
}

export interface DxfBlockInfo {
  name: string;
  base: Vec2;
  /** How many entity records it holds (nested references included). */
  entities: number;
}

export interface DxfFile {
  /** `$INSUNITS` (4 = millimetres), or null when the header does not say. */
  insUnits: number | null;
  /** `$EXTMIN` / `$EXTMAX` from the header, when present and set. */
  extents: { min: Vec2; max: Vec2 } | null;
  /** The LAYER table, in file order. */
  layers: DxfLayer[];
  blocks: DxfBlockInfo[];
  /** Model-space entities, block references expanded. */
  entities: DxfEntity[];
  /** Entity types met in model space (or in an expanded block) and skipped, with how many of each. */
  skipped: Record<string, number>;
  /** Paper-space entities, which are not part of the plan. */
  paperSpace: number;
}

/** What step 1's reader returned: the layer names only. */
export interface DxfEntities {
  insUnits: number | null;
  layers: string[];
  entities: DxfEntity[];
  skipped: Record<string, number>;
}

export interface DxfPair {
  code: number;
  value: string;
}

/** The file as group-code pairs; a byte order mark is dropped and a malformed code ends the reading there. */
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

/** The `%%` control codes of TEXT and MTEXT: degree, plus-minus, diameter, a literal percent, `%%nnn` by code; underline and overline toggles dropped. */
export function decodeDxfControlCodes(value: string): string {
  return value.replace(/%%(\d{3}|[dDpPcCuUoOkK%])/g, (_, code: string) => {
    if (/^\d{3}$/.test(code)) return String.fromCharCode(Number.parseInt(code, 10));
    switch (code.toLowerCase()) {
      case 'd':
        return '°';
      case 'p':
        return '±';
      case 'c':
        return '⌀';
      case '%':
        return '%';
      default:
        return '';
    }
  });
}

/**
 * MTEXT's text without its formatting: `\P` becomes a line break, `\~` a space, `{...}` groups are
 * opened, `\f \F \H \C \c \W \A \Q \T \p` with their arguments up to `;` and `\L \l \O \o \K \k` are
 * dropped, a stacked fraction `\S1/2;` becomes `1/2`, `\\ \{ \}` are literal, `\U+XXXX` decoded,
 * then the `%%` codes.
 */
export function stripMtext(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '{' || ch === '}') continue;
    if (ch === '^' && value[i + 1] === 'I') {
      out += ' ';
      i++;
      continue;
    }
    if (ch === '^' && value[i + 1] === 'J') {
      out += '\n';
      i++;
      continue;
    }
    if (ch !== '\\' || i + 1 >= value.length) {
      out += ch;
      continue;
    }
    const code = value[i + 1];
    if (code === 'P' || code === 'N' || code === 'X') {
      out += '\n';
      i++;
    } else if (code === '~') {
      out += ' ';
      i++;
    } else if (code === '\\' || code === '{' || code === '}') {
      out += code;
      i++;
    } else if ('LlOoKk'.includes(code)) {
      i++;
    } else if (code === 'U' && /^\+[0-9a-fA-F]{4}/.test(value.slice(i + 2, i + 7))) {
      out += String.fromCharCode(Number.parseInt(value.slice(i + 3, i + 7), 16));
      i += 6;
    } else if (code === 'S') {
      const end = value.indexOf(';', i + 2);
      const body = value.slice(i + 2, end < 0 ? value.length : end);
      out += body.replace(/[#^]/g, '/');
      i = end < 0 ? value.length : end;
    } else if ('fFHCcWAQTp'.includes(code)) {
      const end = value.indexOf(';', i + 2);
      i = end < 0 ? value.length : end;
    } else {
      // An unknown code: keep the character after the backslash.
      out += code;
      i++;
    }
  }
  return decodeDxfControlCodes(out);
}

const num = (value: string | undefined, fallback = 0): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
};

const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;
/** Segments per full turn when a curve is flattened. */
const SEGMENTS_PER_TURN = 64;
/** Samples per knot span when a spline is flattened. */
const SAMPLES_PER_SPAN = 16;

// ---------- affine transforms (x' = a x + c y + e, y' = b x + d y + f) ----------

type Affine = readonly [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const MIRROR_X: Affine = [-1, 0, 0, 1, 0, 0];
const apply = (m: Affine, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const linear = (m: Affine, v: Vec2): Vec2 => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
const det = (m: Affine) => m[0] * m[3] - m[1] * m[2];
/** `outer` after `inner`. */
const compose = (outer: Affine, inner: Affine): Affine => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];
/** True when the transform keeps circles circles (a rotation, a uniform scale, a mirror). */
function isSimilarity(m: Affine): boolean {
  const lx = Math.hypot(m[0], m[1]);
  const ly = Math.hypot(m[2], m[3]);
  const size = Math.max(lx, ly, 1e-12);
  return Math.abs(lx - ly) <= 1e-9 * size && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * size * size;
}
const angleDeg = (v: Vec2) => {
  const d = (Math.atan2(v[1], v[0]) / DEG) % 360;
  return d < 0 ? d + 360 : d;
};

// ---------- flattening ----------

/** Points along an arc from a bulge, its start excluded, its end included. */
function bulgePoints(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  const g = arcGeometry(a, b, bulge);
  const n = Math.max(1, Math.ceil((Math.abs(g.sweep) / TAU) * SEGMENTS_PER_TURN));
  const out: Vec2[] = [];
  for (let i = 1; i < n; i++) out.push(arcPoint(g, i / n));
  out.push(b);
  return out;
}

/** A polyline with bulges as straight points only. */
function flattenBulges(points: readonly Vec2[], bulges: readonly number[], closed: boolean): Vec2[] {
  if (!points.length) return [];
  const out: Vec2[] = [points[0]];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (Math.abs(bulges[i] ?? 0) > 1e-12 && (a[0] !== b[0] || a[1] !== b[1])) out.push(...bulgePoints(a, b, bulges[i]));
    else out.push(b);
  }
  if (closed) out.pop();
  return out;
}

/** Points on an ellipse from `start` to `start + sweep` (radians), both included. */
function ellipsePoints(center: Vec2, major: Vec2, minor: Vec2, start: number, sweep: number, full: boolean): Vec2[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / TAU) * SEGMENTS_PER_TURN));
  const out: Vec2[] = [];
  for (let i = 0; i <= (full ? n - 1 : n); i++) {
    const t = start + (sweep * i) / n;
    out.push([center[0] + major[0] * Math.cos(t) + minor[0] * Math.sin(t), center[1] + major[1] * Math.cos(t) + minor[1] * Math.sin(t)]);
  }
  return out;
}

/** A point of a (rational) B-spline by de Boor's algorithm in the span `k`. */
function deBoor(k: number, t: number, p: number, knots: readonly number[], ctrl: readonly Vec2[], weights: readonly number[]): Vec2 {
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const i = j + k - p;
    const w = weights[i] ?? 1;
    d.push([ctrl[i][0] * w, ctrl[i][1] * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const span = knots[i + p - r + 1] - knots[i];
      const alpha = span === 0 ? 0 : (t - knots[i]) / span;
      d[j] = [(1 - alpha) * d[j - 1][0] + alpha * d[j][0], (1 - alpha) * d[j - 1][1] + alpha * d[j][1], (1 - alpha) * d[j - 1][2] + alpha * d[j][2]];
    }
  }
  const w = d[p][2] || 1;
  return [d[p][0] / w, d[p][1] / w];
}

/** A B-spline of degree 1 to 3 sampled along each knot span, or null when its knots do not fit its control points. */
export function sampleBSpline(degree: number, knots: readonly number[], ctrl: readonly Vec2[], weights: readonly number[] = []): Vec2[] | null {
  const n = ctrl.length;
  const p = degree;
  if (p < 1 || p > 3 || n < p + 1 || knots.length !== n + p + 1) return null;
  for (let i = 1; i < knots.length; i++) if (!(knots[i] >= knots[i - 1])) return null;
  const lo = knots[p];
  const hi = knots[n];
  if (!(hi > lo)) return null;
  const out: Vec2[] = [];
  for (let k = p; k < n; k++) {
    const a = knots[k];
    const b = knots[k + 1];
    if (!(b > a)) continue;
    for (let s = 0; s < SAMPLES_PER_SPAN; s++) out.push(deBoor(k, a + ((b - a) * s) / SAMPLES_PER_SPAN, p, knots, ctrl, weights));
  }
  // The end of the last non-empty span.
  let last = n - 1;
  while (last > p && !(knots[last + 1] > knots[last])) last--;
  out.push(deBoor(last, hi, p, knots, ctrl, weights));
  return out;
}

// ---------- records ----------

interface DxfRecord {
  type: string;
  body: DxfPair[];
}

function records(pairs: readonly DxfPair[]): DxfRecord[] {
  const out: DxfRecord[] = [];
  let current: DxfRecord | null = null;
  for (const p of pairs) {
    if (p.code === 0) {
      current = { type: p.value.trim().toUpperCase(), body: [] };
      out.push(current);
    } else if (current) current.body.push(p);
  }
  return out;
}

/** What one entity record becomes before blocks are expanded. */
type Raw = { kind: 'entity'; entity: DxfEntity } | { kind: 'insert'; layer: string; block: string; at: Vec2; sx: number; sy: number; rotation: number; mirror: boolean } | { kind: 'skip'; type: string };

const firstOf = (body: readonly DxfPair[]) => (code: number) => body.find((q) => q.code === code)?.value;
const allOf = (body: readonly DxfPair[], code: number) => body.filter((q) => q.code === code).map((q) => num(q.value));

/** Points from interleaved x (codeX) / y (codeX + 10) pairs, in order. */
function pointsOf(body: readonly DxfPair[], codeX: number, bulgeCode?: number): { points: Vec2[]; bulges: number[] } {
  const points: Vec2[] = [];
  const bulges: number[] = [];
  let x: number | null = null;
  for (const q of body) {
    if (q.code === codeX) x = num(q.value);
    else if (q.code === codeX + 10 && x !== null) {
      points.push([x, num(q.value)]);
      bulges.push(0);
      x = null;
    } else if (bulgeCode !== undefined && q.code === bulgeCode && bulges.length) bulges[bulges.length - 1] = num(q.value);
  }
  return { points, bulges };
}

/** Reads one stream of entity records (ENTITIES, or a block's), POLYLINE/VERTEX/SEQEND and INSERT/ATTRIB/SEQEND joined. */
function readStream(recs: readonly DxfRecord[], paper: { count: number } | null): Raw[] {
  const out: Raw[] = [];
  for (let i = 0; i < recs.length; i++) {
    const { type, body } = recs[i];
    // A POLYLINE's vertices (or an INSERT's attributes) follow it up to SEQEND.
    let tail: DxfRecord[] = [];
    if (type === 'POLYLINE' || (type === 'INSERT' && Math.trunc(num(firstOf(body)(66))) === 1)) {
      let j = i + 1;
      while (j < recs.length && recs[j].type !== 'SEQEND' && (recs[j].type === 'VERTEX' || recs[j].type === 'ATTRIB')) j++;
      tail = recs.slice(i + 1, j);
      i = j < recs.length && recs[j].type === 'SEQEND' ? j : j - 1;
    }
    if (type === 'SEQEND' || type === 'VERTEX' || type === 'ATTDEF') continue;
    const first = firstOf(body);
    if (first(67)?.trim() === '1') {
      if (paper) paper.count++;
      continue;
    }
    const raw = readEntity(type, body, tail);
    if (raw) out.push(raw);
  }
  return out;
}

function readEntity(type: string, body: readonly DxfPair[], tail: readonly DxfRecord[]): Raw | null {
  const first = firstOf(body);
  const layer = decodeDxfString((first(8) ?? '0').trim());
  const at = (code: number): Vec2 => [num(first(code)), num(first(code + 10))];
  // Entities drawn in their object coordinate system are mirrored in x when it faces down.
  const ocsMirror = num(first(230), 1) < 0;
  const entity = (e: DxfEntity): Raw => ({ kind: 'entity', entity: ocsMirror ? transformEntity(e, MIRROR_X) : e });
  switch (type) {
    case 'LINE':
      return { kind: 'entity', entity: { type, layer, a: at(10), b: at(11) } };
    case 'LWPOLYLINE': {
      const { points, bulges } = pointsOf(body, 10, 42);
      return entity({ type, layer, points, bulges, closed: (Math.trunc(num(first(70))) & 1) === 1 });
    }
    case 'POLYLINE': {
      const flags = Math.trunc(num(first(70)));
      // Polygon meshes (16) and polyface meshes (64) are not outlines.
      if (flags & (16 | 64)) return { kind: 'skip', type: 'POLYLINE (mesh)' };
      const points: Vec2[] = [];
      const bulges: number[] = [];
      for (const v of tail) {
        if (v.type !== 'VERTEX') continue;
        const vf = firstOf(v.body);
        // A spline's frame control points (16) are not on the curve.
        if (Math.trunc(num(vf(70))) & 16) continue;
        points.push([num(vf(10)), num(vf(20))]);
        bulges.push(num(vf(42)));
      }
      const e: DxfEntity = { type, layer, points, bulges, closed: (flags & 1) === 1 };
      // A 3D polyline is in world coordinates already; a 2D one in its OCS.
      return flags & 8 ? { kind: 'entity', entity: e } : entity(e);
    }
    case 'ARC':
      return entity({ type, layer, center: at(10), radius: num(first(40)), start: num(first(50)), end: num(first(51)) });
    case 'CIRCLE':
      return entity({ type, layer, center: at(10), radius: num(first(40)) });
    case 'ELLIPSE': {
      const center = at(10);
      const major = at(11);
      const ratio = num(first(40), 1);
      const nz = num(first(230), 1) < 0 ? -1 : 1;
      const minor: Vec2 = [-major[1] * ratio * nz, major[0] * ratio * nz];
      const start = num(first(41), 0);
      let sweep = num(first(42), TAU) - start;
      while (sweep <= 1e-12) sweep += TAU;
      const full = sweep >= TAU - 1e-9;
      if (full) sweep = TAU;
      return { kind: 'entity', entity: { type, layer, points: ellipsePoints(center, major, minor, start, sweep, full), closed: full } };
    }
    case 'SPLINE': {
      const flags = Math.trunc(num(first(70)));
      const degree = Math.trunc(num(first(71), 3));
      const ctrl = pointsOf(body, 10).points;
      const fit = pointsOf(body, 11).points;
      const sampled = sampleBSpline(degree, allOf(body, 40), ctrl, allOf(body, 41));
      const points = sampled ?? (fit.length >= 2 ? fit : ctrl);
      const closed = (flags & 1) === 1;
      if (closed && points.length > 2 && Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) < 1e-9) points.pop();
      return { kind: 'entity', entity: { type, layer, points, closed } };
    }
    case 'TEXT': {
      const halign = Math.trunc(num(first(72)));
      const valign = Math.trunc(num(first(73)));
      const aligned = (halign !== 0 || valign !== 0) && first(11) !== undefined;
      // Aligned and fit texts run between their two points: the middle stands for them.
      const point: Vec2 = !aligned ? at(10) : halign === 3 || halign === 5 ? [(at(10)[0] + at(11)[0]) / 2, (at(10)[1] + at(11)[1]) / 2] : at(11);
      const text = decodeDxfControlCodes(decodeDxfString(first(1) ?? ''));
      return entity({ type, layer, at: point, height: num(first(40)), rotation: num(first(50)), text, halign, valign });
    }
    case 'MTEXT': {
      const raw = [...body.filter((q) => q.code === 3).map((q) => q.value), first(1) ?? ''].join('');
      const direction = first(11) !== undefined ? at(11) : null;
      const rotation = direction && (direction[0] !== 0 || direction[1] !== 0) ? angleDeg(direction) : num(first(50));
      return { kind: 'entity', entity: { type, layer, at: at(10), height: num(first(40)), rotation, text: stripMtext(raw), attach: Math.trunc(num(first(71), 1)) || 1 } };
    }
    case 'INSERT':
      return { kind: 'insert', layer, block: decodeDxfString((first(2) ?? '').trim()), at: at(10), sx: num(first(41), 1), sy: num(first(42), 1), rotation: num(first(50)), mirror: ocsMirror };
    default:
      return { kind: 'skip', type };
  }
}

/** An entity moved by an affine transform: arcs stay arcs under a similarity, become points otherwise. */
function transformEntity(e: DxfEntity, m: Affine): DxfEntity {
  const flip = det(m) < 0;
  const similar = isSimilarity(m);
  const s = Math.sqrt(Math.abs(det(m)));
  switch (e.type) {
    case 'LINE':
      return { ...e, a: apply(m, e.a), b: apply(m, e.b) };
    case 'LWPOLYLINE':
    case 'POLYLINE':
      if (similar || e.bulges.every((b) => Math.abs(b) < 1e-12)) return { ...e, points: e.points.map((p) => apply(m, p)), bulges: e.bulges.map((b) => (flip ? -b : b)) };
      {
        const points = flattenBulges(e.points, e.bulges, e.closed).map((p) => apply(m, p));
        return { ...e, points, bulges: points.map(() => 0) };
      }
    case 'ARC': {
      if (similar) {
        const start = angleDeg(linear(m, [Math.cos(e.start * DEG), Math.sin(e.start * DEG)]));
        const end = angleDeg(linear(m, [Math.cos(e.end * DEG), Math.sin(e.end * DEG)]));
        return { ...e, center: apply(m, e.center), radius: e.radius * s, start: flip ? end : start, end: flip ? start : end };
      }
      let sweep = e.end - e.start;
      while (sweep <= 0) sweep += 360;
      const points = ellipsePoints(e.center, [e.radius, 0], [0, e.radius], e.start * DEG, sweep * DEG, false).map((p) => apply(m, p));
      return { type: 'POLYLINE', layer: e.layer, points, bulges: points.map(() => 0), closed: false };
    }
    case 'CIRCLE': {
      if (similar) return { ...e, center: apply(m, e.center), radius: e.radius * s };
      const points = ellipsePoints(e.center, [e.radius, 0], [0, e.radius], 0, TAU, true).map((p) => apply(m, p));
      return { type: 'POLYLINE', layer: e.layer, points, bulges: points.map(() => 0), closed: true };
    }
    case 'ELLIPSE':
    case 'SPLINE':
      return { ...e, points: e.points.map((p) => apply(m, p)) };
    case 'TEXT':
    case 'MTEXT': {
      const rotation = angleDeg(linear(m, [Math.cos(e.rotation * DEG), Math.sin(e.rotation * DEG)]));
      return { ...e, at: apply(m, e.at), height: e.height * s, rotation };
    }
  }
}

/** The transform of a block reference: the block's base point to the origin, scaled, rotated, moved to the insertion point. */
function insertTransform(ins: Extract<Raw, { kind: 'insert' }>, base: Vec2): Affine {
  const cos = Math.cos(ins.rotation * DEG);
  const sin = Math.sin(ins.rotation * DEG);
  const toOrigin: Affine = [1, 0, 0, 1, -base[0], -base[1]];
  const scaleRotate: Affine = [cos * ins.sx, sin * ins.sx, -sin * ins.sy, cos * ins.sy, ins.at[0], ins.at[1]];
  const m = compose(scaleRotate, toOrigin);
  return ins.mirror ? compose(MIRROR_X, m) : m;
}

const count = (skipped: Record<string, number>, type: string) => {
  skipped[type] = (skipped[type] ?? 0) + 1;
};

/** Reads a whole DXF file: header, layer table, blocks and the model-space entities with block references expanded. */
export function readDxf(text: string): DxfFile {
  const recs = records(dxfPairs(text));
  const file: DxfFile = { insUnits: null, extents: null, layers: [], blocks: [], entities: [], skipped: {}, paperSpace: 0 };
  const blocks = new Map<string, { base: Vec2; raws: Raw[] }>();
  const top: DxfRecord[] = [];
  let section = '';
  let block: { name: string; base: Vec2; recs: DxfRecord[] } | null = null;
  for (const rec of recs) {
    if (rec.type === 'SECTION') {
      section = (rec.body.find((q) => q.code === 2)?.value ?? '').trim().toUpperCase();
      if (section === 'HEADER') readHeader(rec.body, file);
      continue;
    }
    if (rec.type === 'ENDSEC') {
      section = '';
      continue;
    }
    if (rec.type === 'EOF') break;
    if (section === 'TABLES' && rec.type === 'LAYER') {
      const first = firstOf(rec.body);
      const name = first(2);
      if (name === undefined) continue;
      const color = Math.trunc(num(first(62), 7));
      file.layers.push({ name: decodeDxfString(name.trim()), color: Math.abs(color), off: color < 0, frozen: (Math.trunc(num(first(70))) & 1) === 1 });
    } else if (section === 'BLOCKS') {
      if (rec.type === 'BLOCK') {
        const first = firstOf(rec.body);
        block = { name: decodeDxfString((first(2) ?? '').trim()), base: [num(first(10)), num(first(20))], recs: [] };
      } else if (rec.type === 'ENDBLK') {
        if (block && !/^\*paper_space/i.test(block.name)) {
          const raws = readStream(block.recs, null);
          blocks.set(block.name.toUpperCase(), { base: block.base, raws });
          file.blocks.push({ name: block.name, base: block.base, entities: raws.length });
        }
        block = null;
      } else block?.recs.push(rec);
    } else if (section === 'ENTITIES') top.push(rec);
  }

  const paper = { count: 0 };
  const expand = (raws: readonly Raw[], m: Affine, layerOf0: string | null, depth: number): void => {
    for (const raw of raws) {
      if (raw.kind === 'skip') {
        count(file.skipped, raw.type);
        continue;
      }
      if (raw.kind === 'entity') {
        const e = m === IDENTITY ? raw.entity : transformEntity(raw.entity, m);
        file.entities.push(layerOf0 !== null && e.layer === '0' ? { ...e, layer: layerOf0 } : e);
        continue;
      }
      if (depth >= 2) {
        count(file.skipped, 'INSERT (nested)');
        continue;
      }
      const def = blocks.get(raw.block.toUpperCase());
      if (!def) {
        count(file.skipped, 'INSERT (no block)');
        continue;
      }
      const layer = layerOf0 !== null && raw.layer === '0' ? layerOf0 : raw.layer;
      expand(def.raws, compose(m, insertTransform(raw, def.base)), layer, depth + 1);
    }
  };
  expand(readStream(top, paper), IDENTITY, null, 0);
  file.paperSpace = paper.count;
  return file;
}

function readHeader(body: readonly DxfPair[], file: DxfFile): void {
  let name = '';
  const ext: Record<string, [number, number]> = {};
  for (const p of body) {
    if (p.code === 9) {
      name = p.value.trim().toUpperCase();
      continue;
    }
    if (name === '$INSUNITS' && p.code === 70) file.insUnits = Math.trunc(num(p.value));
    if ((name === '$EXTMIN' || name === '$EXTMAX') && (p.code === 10 || p.code === 20)) {
      ext[name] ??= [Number.NaN, Number.NaN];
      ext[name][p.code === 10 ? 0 : 1] = num(p.value, Number.NaN);
    }
  }
  const min = ext['$EXTMIN'];
  const max = ext['$EXTMAX'];
  const valid = (v: [number, number] | undefined): v is [number, number] => !!v && v.every((x) => Number.isFinite(x) && Math.abs(x) < 1e19);
  if (valid(min) && valid(max) && max[0] >= min[0] && max[1] >= min[1]) file.extents = { min, max };
}

/** Step 1's reader: the units, the layer names, the model-space entities and what was skipped. */
export function readDxfEntities(text: string): DxfEntities {
  const file = readDxf(text);
  return { insUnits: file.insUnits, layers: file.layers.map((l) => l.name), entities: file.entities, skipped: file.skipped };
}
