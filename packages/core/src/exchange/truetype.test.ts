import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shapeArabic } from './arabic-shape';
import { readTrueType, subsetTrueType } from './truetype';

/** The face the PDF embeds for Arabic (the app ships it in resources/fonts). */
const PLEX_ARABIC = new Uint8Array(readFileSync(new URL('../../../../resources/fonts/IBMPlexSansArabic-Regular.ttf', import.meta.url)));

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** The sum of an sfnt's 32-bit words: 0xB1B0AFBA once head's checksum adjustment is right. */
function fileSum(bytes: Uint8Array): number {
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const v = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

/**
 * A minimal TrueType file of three empty glyphs whose cmap is a format 12 table mapping U+1F600 and 'A', or the
 * `groups` given (start, end, glyph), with `claimed` as their count when it lies.
 */
function tinyFont(groups: [number, number, number][] = [[0x41, 0x41, 1], [0x1f600, 0x1f600, 2]], claimed = groups.length): Uint8Array {
  const tables: Record<string, number[]> = {
    head: [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0), ...u16(2048), ...new Array(16).fill(0), ...u16(0), ...u16(0), ...u16(100), ...u16(100), ...u16(0), ...u16(8), ...u16(2), ...u16(1), ...u16(0)],
    hhea: [...u32(0x00010000), ...u16(1600), ...u16(-400 & 0xffff), ...new Array(26).fill(0), ...u16(3)],
    hmtx: [...u16(500), ...u16(0), ...u16(1000), ...u16(0), ...u16(1200), ...u16(0)],
    maxp: [...u32(0x00005000), ...u16(3)],
    loca: [...u32(0), ...u32(0), ...u32(0), ...u32(0)],
    glyf: [],
    cmap: [...u16(0), ...u16(1), ...u16(3), ...u16(10), ...u32(12), ...u16(12), ...u16(0), ...u32(16 + 12 * groups.length), ...u32(0), ...u32(claimed), ...groups.flatMap(([a, b, g]) => [...u32(a), ...u32(b), ...u32(g)])],
  };
  const tags = Object.keys(tables).sort();
  const out: number[] = [...u32(0x00010000), ...u16(tags.length), ...u16(64), ...u16(2), ...u16(tags.length * 16 - 64)];
  let at = 12 + 16 * tags.length;
  const bodies: number[] = [];
  for (const tag of tags) {
    const data = tables[tag];
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(at), ...u32(data.length));
    const padded = [...data, ...new Array((4 - (data.length % 4)) % 4).fill(0)];
    bodies.push(...padded);
    at += padded.length;
  }
  return new Uint8Array([...out, ...bodies]);
}

describe('readTrueType', () => {
  const font = readTrueType(PLEX_ARABIC);

  it('reads the face the PDF embeds: its name, units and metrics', () => {
    expect(font.postScriptName).toBe('IBMPlexSansArabic');
    expect(font.unitsPerEm).toBe(1000);
    expect(font.numGlyphs).toBeGreaterThan(1000);
    expect(font.ascent).toBeGreaterThan(600);
    expect(font.descent).toBeLessThan(0);
    expect(font.capHeight).toBeGreaterThan(500);
    expect(font.bbox[2]).toBeGreaterThan(font.bbox[0]);
  });

  it('has every Arabic presentation form the shaper writes (U+FE70 to U+FEFC)', () => {
    const missing: string[] = [];
    for (let c = 0xfe70; c <= 0xfefc; c++) if (c !== 0xfe75 && !font.glyph(c)) missing.push(c.toString(16));
    expect(missing).toEqual([]);
    // Every form a sample shapes to has its glyph.
    for (const ch of shapeArabic('غرفة المعيشة الأهلي لا مطبخ')) expect(font.glyph(ch.codePointAt(0)!)).toBeGreaterThan(0);
  });

  it('measures glyphs: letters advance, marks do not, unknown code points are .notdef', () => {
    expect(font.advance(font.glyph(0xfefb))).toBeGreaterThan(0);
    expect(font.advance(font.glyph(0x064f))).toBe(0);
    expect(font.glyphBounds(font.glyph(0x064f))).not.toBeNull();
    expect(font.glyph(0x2603)).toBe(0);
    expect(font.glyphBounds(font.glyph(0x20))).toBeNull();
  });

  it('reads a format 12 cmap, beyond the basic plane', () => {
    const tiny = readTrueType(tinyFont());
    expect(tiny.unitsPerEm).toBe(2048);
    expect(tiny.glyph(0x41)).toBe(1);
    expect(tiny.glyph(0x1f600)).toBe(2);
    expect(tiny.glyph(0x42)).toBe(0);
    expect(tiny.advance(2)).toBe(1200);
    // Without OS/2: hhea's ascent and descent.
    expect([tiny.ascent, tiny.descent]).toEqual([1600, -400]);
  });

  it('refuses what is not a TrueType font', () => {
    expect(() => readTrueType(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/CFF/);
    expect(() => readTrueType(new TextEncoder().encode('not a font at all'))).toThrow(/TrueType/);
  });

  it('refuses a truncated file with an error of its own', () => {
    // The directory says 17 tables; 100 bytes hold five.
    expect(() => readTrueType(PLEX_ARABIC.slice(0, 100))).toThrow(/table directory/);
    // The directory is whole; the tables are not.
    expect(() => readTrueType(PLEX_ARABIC.slice(0, 4096))).toThrow(/runs past the end/);
  });

  it('bounds a format 12 cmap by its table', () => {
    // A count that claims more groups than the table holds.
    expect(() => readTrueType(tinyFont([[0x41, 0x41, 1]], 0x10000000))).toThrow(/cmap table runs past its end/);
    // Groups that overlap would map the whole of Unicode again and again.
    const start = performance.now();
    expect(() => readTrueType(tinyFont([[0, 0x10ffff, 1], [0, 0x10ffff, 1], [0, 0x10ffff, 1]]))).toThrow(/overlap or are out of order/);
    expect(() => readTrueType(tinyFont([[0x42, 0x41, 1]]))).toThrow(/overlap or are out of order/);
    expect(() => readTrueType(tinyFont([[0x41, 0x110000, 1]]))).toThrow(/overlap or are out of order/);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('subsetTrueType', () => {
  const font = readTrueType(PLEX_ARABIC);
  const used = [...shapeArabic('غُرفة')].map((c) => font.glyph(c.codePointAt(0)!));

  it('keeps the glyphs used under their ids and empties the rest', () => {
    const bytes = subsetTrueType(font, used);
    expect(bytes.length).toBeLessThan(PLEX_ARABIC.length / 3);
    const sub = readTrueType(bytes);
    expect(sub.numGlyphs).toBe(font.numGlyphs);
    for (const g of used) {
      expect(sub.glyphBounds(g)).toEqual(font.glyphBounds(g));
      expect(sub.advance(g)).toBe(font.advance(g));
    }
    expect(sub.glyphBounds(font.glyph(0x0628))).toBeNull();
    expect(sub.table('GSUB')).toBeUndefined();
    expect(sub.glyph(0xfecf)).toBe(font.glyph(0xfecf));
  });

  it('writes a valid sfnt: aligned tables with their checksums and head adjusted', () => {
    const bytes = subsetTrueType(font, used);
    expect(fileSum(bytes)).toBe(0xb1b0afba);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getUint16(4);
    for (let i = 0; i < count; i++) {
      const offset = v.getUint32(12 + i * 16 + 8);
      expect(offset % 4).toBe(0);
    }
  });
});
