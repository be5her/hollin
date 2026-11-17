/*
 * A small TrueType reader for the PDF writer: enough of an sfnt to map code points to glyphs (`cmap`
 * formats 4 and 12), measure them (`hmtx`, `head`'s units per em), describe the face (`OS/2` or
 * `hhea` ascent and descent, the cap height, the bounding box, the PostScript name) and write a subset
 * that keeps the glyph ids (unused glyphs emptied in `glyf`, the layout tables dropped). Pure: bytes
 * in, numbers and bytes out. CFF-flavoured OpenType (`OTTO`) is refused: a CIDFontType2 needs `glyf`.
 */

export interface TrueTypeFont {
  readonly bytes: Uint8Array;
  readonly postScriptName: string;
  readonly unitsPerEm: number;
  /** Above the baseline, font units (positive). */
  readonly ascent: number;
  /** Below the baseline, font units (negative). */
  readonly descent: number;
  readonly capHeight: number;
  /** xMin, yMin, xMax, yMax in font units. */
  readonly bbox: readonly [number, number, number, number];
  readonly italicAngle: number;
  readonly numGlyphs: number;
  /** Every code point the `cmap` maps, with its glyph. */
  readonly cmap: ReadonlyMap<number, number>;
  /** The glyph of a code point, 0 (`.notdef`) when the face has none. */
  glyph(codePoint: number): number;
  /** A glyph's advance width in font units. */
  advance(glyph: number): number;
  /** A glyph's outline box (xMin, yMin, xMax, yMax) in font units, null for an empty glyph. */
  glyphBounds(glyph: number): [number, number, number, number] | null;
  /** A table's bytes by its tag (`'glyf'`, `'OS/2'` ...). */
  table(tag: string): Uint8Array | undefined;
}

class Reader {
  readonly view: DataView;
  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8 = (at: number) => this.view.getUint8(at);
  u16 = (at: number) => this.view.getUint16(at);
  i16 = (at: number) => this.view.getInt16(at);
  u32 = (at: number) => this.view.getUint32(at);
  i32 = (at: number) => this.view.getInt32(at);
  tag = (at: number) => String.fromCharCode(this.u8(at), this.u8(at + 1), this.u8(at + 2), this.u8(at + 3));
}

/** Reads a TrueType (`glyf`-outline) font file; throws on anything else. */
export function readTrueType(bytes: Uint8Array): TrueTypeFont {
  const r = new Reader(bytes);
  if (bytes.length < 12) throw new Error('Not a TrueType font: too short.');
  const version = r.u32(0);
  if (version === 0x4f54544f) throw new Error('A CFF-flavoured OpenType font (OTTO) cannot be embedded as TrueType.');
  if (version !== 0x00010000 && version !== 0x74727565) throw new Error('Not a TrueType font.');
  const count = r.u16(4);
  if (12 + count * 16 > bytes.length) throw new Error('The font\'s table directory runs past the end of the file.');
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = r.u32(at + 8);
    const length = r.u32(at + 12);
    if (offset + length > bytes.length) throw new Error(`The font's ${r.tag(at)} table runs past the end of the file.`);
    tables.set(r.tag(at), { offset, length });
  }
  const need = (tag: string) => {
    const t = tables.get(tag);
    if (!t) throw new Error(`The font has no ${tag} table.`);
    return t.offset;
  };
  for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) need(tag);
  // The fixed parts read below must be inside their tables.
  for (const [tag, min] of [['head', 54], ['hhea', 36], ['maxp', 6], ['cmap', 4]] as const) {
    if (tables.get(tag)!.length < min) throw new Error(`The font's ${tag} table is too short.`);
  }

  const head = need('head');
  const unitsPerEm = r.u16(head + 18);
  const bbox: [number, number, number, number] = [r.i16(head + 36), r.i16(head + 38), r.i16(head + 40), r.i16(head + 42)];
  const indexToLocFormat = r.i16(head + 50);
  const numGlyphs = r.u16(need('maxp') + 4);
  const hhea = need('hhea');
  const numberOfHMetrics = r.u16(hhea + 34);
  let ascent = r.i16(hhea + 4);
  let descent = r.i16(hhea + 6);
  let capHeight = 0;
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 78) {
    // The typographic ascender and descender, as PDF readers expect them.
    ascent = r.i16(os2.offset + 68);
    descent = r.i16(os2.offset + 70);
    if (r.u16(os2.offset) >= 2 && os2.length >= 90) capHeight = r.i16(os2.offset + 88);
  }
  if (!capHeight) capHeight = Math.round(ascent * 0.7);
  const post = tables.get('post');
  const italicAngle = post ? r.i32(post.offset + 4) / 65536 : 0;

  const hmtx = need('hmtx');
  const advance = (glyph: number) => {
    if (glyph < 0 || glyph >= numGlyphs) return 0;
    return r.u16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1));
  };

  const loca = need('loca');
  const glyf = need('glyf');
  const glyphRange = (glyph: number): [number, number] => {
    if (glyph < 0 || glyph >= numGlyphs) return [0, 0];
    return indexToLocFormat === 0 ? [r.u16(loca + 2 * glyph) * 2, r.u16(loca + 2 * glyph + 2) * 2] : [r.u32(loca + 4 * glyph), r.u32(loca + 4 * glyph + 4)];
  };

  const cmap = readCmap(r, tables.get('cmap')!);

  return {
    bytes,
    postScriptName: readPostScriptName(r, tables.get('name')) ?? 'Embedded',
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    bbox,
    italicAngle,
    numGlyphs,
    cmap,
    glyph: (codePoint) => cmap.get(codePoint) ?? 0,
    advance,
    glyphBounds: (glyph) => {
      const [start, end] = glyphRange(glyph);
      if (end - start < 10) return null;
      const at = glyf + start;
      return [r.i16(at + 2), r.i16(at + 4), r.i16(at + 6), r.i16(at + 8)];
    },
    table: (tag) => {
      const t = tables.get(tag);
      return t ? bytes.subarray(t.offset, t.offset + t.length) : undefined;
    },
  };
}

/**
 * The best Unicode subtable: format 12 (full repertoire) before format 4 (the basic plane), Windows before Unicode platform.
 * Everything read is bounded by the table's length, and the groups and segments must ascend without overlapping (as the
 * format requires), so a damaged or hostile table fails at once instead of mapping millions of code points.
 */
function readCmap(r: Reader, table: { offset: number; length: number }): Map<number, number> {
  const cmap = table.offset;
  const tableEnd = cmap + table.length;
  const inside = (at: number, size: number) => {
    if (at < cmap || at + size > tableEnd) throw new Error('The font\'s cmap table runs past its end.');
  };
  const count = r.u16(cmap + 2);
  inside(cmap + 4, count * 8);
  const candidates: { rank: number; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = cmap + 4 + i * 8;
    const platform = r.u16(at);
    const encoding = r.u16(at + 2);
    const offset = cmap + r.u32(at + 4);
    if (offset + 2 > tableEnd) continue;
    const format = r.u16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    candidates.push({ rank: (format === 12 ? 0 : 2) + (platform === 3 ? 0 : 1), offset });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const best = candidates[0];
  if (!best) throw new Error('The font has no Unicode cmap (format 4 or 12).');
  const map = new Map<number, number>();
  const at = best.offset;
  if (r.u16(at) === 12) {
    inside(at, 16);
    const groups = r.u32(at + 12);
    inside(at + 16, groups * 12);
    let next = 0;
    for (let g = 0; g < groups; g++) {
      const p = at + 16 + g * 12;
      const start = r.u32(p);
      const end = r.u32(p + 4);
      const glyph = r.u32(p + 8);
      if (start < next || end < start || end > 0x10ffff) throw new Error('The font\'s cmap groups overlap or are out of order.');
      next = end + 1;
      for (let c = start; c <= end; c++) if (glyph + (c - start)) map.set(c, glyph + (c - start));
    }
    return map;
  }
  inside(at, 14);
  const segX2 = r.u16(at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  inside(ends, segX2 * 4 + 2);
  let next = 0;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = r.u16(ends + 2 * s);
    const start = r.u16(starts + 2 * s);
    const delta = r.i16(deltas + 2 * s);
    const rangeOffset = r.u16(ranges + 2 * s);
    if (start < next || end < start) throw new Error('The font\'s cmap segments overlap or are out of order.');
    next = end + 1;
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        const p = ranges + 2 * s + rangeOffset + 2 * (c - start);
        inside(p, 2);
        glyph = r.u16(p);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) map.set(c, glyph);
    }
  }
  return map;
}

/** Name id 6, from the Windows (UTF-16BE) or the Macintosh (Roman) records. */
function readPostScriptName(r: Reader, name: { offset: number; length: number } | undefined): string | null {
  if (!name) return null;
  const count = r.u16(name.offset + 2);
  const strings = name.offset + r.u16(name.offset + 4);
  for (let i = 0; i < count; i++) {
    const at = name.offset + 6 + i * 12;
    if (r.u16(at + 6) !== 6) continue;
    const platform = r.u16(at);
    const length = r.u16(at + 8);
    const offset = strings + r.u16(at + 10);
    let s = '';
    if (platform === 3 || platform === 0) for (let j = 0; j + 1 < length; j += 2) s += String.fromCharCode(r.u16(offset + j));
    else for (let j = 0; j < length; j++) s += String.fromCharCode(r.u8(offset + j));
    // A PDF name: no spaces or delimiters.
    s = s.replace(/[^\x21-\x7e]|[()<>[\]{}/%#]/g, '');
    if (s) return s;
  }
  return null;
}

/** The tables a subset keeps: what a PDF's CIDFontType2 needs (head, hhea, loca, maxp, cvt, prep, glyf, hmtx, fpgm) and a few readers like to find. */
const SUBSET_TABLES = ['OS/2', 'cmap', 'cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep'];

/** The glyphs a composite glyph is made of. */
function components(font: TrueTypeFont, glyph: number, glyf: Uint8Array, start: number, end: number): number[] {
  const r = new Reader(glyf);
  if (end - start < 10 || r.i16(start) >= 0) return [];
  const out: number[] = [];
  let at = start + 10;
  for (;;) {
    const flags = r.u16(at);
    out.push(r.u16(at + 2));
    at += 4 + (flags & 0x0001 ? 4 : 2);
    if (flags & 0x0008) at += 2;
    else if (flags & 0x0040) at += 4;
    else if (flags & 0x0080) at += 8;
    if (!(flags & 0x0020) || at >= end) break;
  }
  return out.filter((g) => g < font.numGlyphs && g !== glyph);
}

/**
 * A copy of the font that draws only `glyphs` (and `.notdef`, and the parts of composite glyphs): the
 * other glyphs are emptied, so glyph ids, the `cmap` and the metrics stay as they were, and the layout
 * tables (GSUB, GPOS ...) are left out. `head`'s checksum adjustment is written afresh.
 */
export function subsetTrueType(font: TrueTypeFont, glyphs: Iterable<number>): Uint8Array {
  const head = font.table('head')!;
  const glyf = font.table('glyf')!;
  const loca = font.table('loca')!;
  const long = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50) !== 0;
  const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const range = (g: number): [number, number] => (long ? [lv.getUint32(4 * g), lv.getUint32(4 * g + 4)] : [lv.getUint16(2 * g) * 2, lv.getUint16(2 * g + 2) * 2]);

  const keep = new Set<number>([0]);
  const queue = [...glyphs].filter((g) => g >= 0 && g < font.numGlyphs);
  while (queue.length) {
    const g = queue.pop()!;
    if (keep.has(g)) continue;
    keep.add(g);
    const [start, end] = range(g);
    queue.push(...components(font, g, glyf, start, end));
  }
  for (const g of [...keep]) {
    const [start, end] = range(g);
    for (const c of components(font, g, glyf, start, end)) keep.add(c);
  }

  // glyf and loca: kept glyphs copied, each padded to 4 bytes (even, as the short loca needs); the rest empty.
  let size = 0;
  for (const g of keep) {
    const [start, end] = range(g);
    size += (end - start + 3) & ~3;
  }
  const newGlyf = new Uint8Array(size);
  const newLoca = new Uint8Array((font.numGlyphs + 1) * (long ? 4 : 2));
  const nl = new DataView(newLoca.buffer);
  let at = 0;
  for (let g = 0; g <= font.numGlyphs; g++) {
    if (long) nl.setUint32(4 * g, at);
    else nl.setUint16(2 * g, at / 2);
    if (g === font.numGlyphs || !keep.has(g)) continue;
    const [start, end] = range(g);
    newGlyf.set(glyf.subarray(start, end), at);
    at += (end - start + 3) & ~3;
  }

  // `post` without its glyph names (version 3): a PDF reader needs none.
  const post = font.table('post');
  const shortPost = post && post.length >= 32 ? post.slice(0, 32) : undefined;
  if (shortPost) new DataView(shortPost.buffer).setUint32(0, 0x00030000);
  const replaced: Record<string, Uint8Array | undefined> = { glyf: newGlyf, loca: newLoca, head: head.slice(), post: shortPost };
  const tables = SUBSET_TABLES.map((tag) => ({ tag, data: tag in replaced ? replaced[tag] : font.table(tag) })).filter((t): t is { tag: string; data: Uint8Array } => Boolean(t.data));
  return writeSfnt(tables);
}

const checksum = (data: Uint8Array): number => {
  let sum = 0;
  const padded = data.length % 4 ? new Uint8Array((data.length + 3) & ~3) : data;
  if (padded !== data) padded.set(data);
  const v = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
};

/** An sfnt from its tables (sorted by tag), each 4-byte aligned, with `head`'s checksum adjustment set. */
function writeSfnt(tables: { tag: string; data: Uint8Array }[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  const headerSize = 12 + 16 * n;
  let size = headerSize;
  for (const t of sorted) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, n);
  v.setUint16(6, (1 << es) * 16);
  v.setUint16(8, es);
  v.setUint16(10, n * 16 - (1 << es) * 16);
  let at = headerSize;
  let headAt = -1;
  sorted.forEach((t, i) => {
    const rec = 12 + i * 16;
    if (t.tag === 'head') {
      // The adjustment counts as zero in the table's own checksum.
      new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength).setUint32(8, 0);
      headAt = at;
    }
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    v.setUint32(rec + 4, checksum(t.data));
    v.setUint32(rec + 8, at);
    v.setUint32(rec + 12, t.data.length);
    out.set(t.data, at);
    at += (t.data.length + 3) & ~3;
  });
  if (headAt >= 0) v.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
