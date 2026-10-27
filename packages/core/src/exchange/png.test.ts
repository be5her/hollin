import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PNG_SIGNATURE, pngTopLeftPixel, readPngHeader } from './png';

/** One PNG chunk (the CRC is left zero: the readers do not check it). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/** A width × height PNG whose rows are given as raw scanlines (filter byte first), its IDAT split in two. */
function png(width: number, height: number, colorType: number, rows: number[][]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, colorType, 0, 0, 0], 8);
  const z = deflateSync(Uint8Array.from(rows.flat()));
  const half = Math.floor(z.length / 2);
  const parts = [Uint8Array.from(PNG_SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, half)), chunk('IDAT', z.subarray(half)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('PNG header and first pixel', () => {
  it('reads the size and colour type from the IHDR chunk, and refuses what is no PNG', () => {
    const bytes = png(1600, 1200, 6, [[0, 1, 2, 3, 4]]);
    expect(readPngHeader(bytes)).toEqual({ width: 1600, height: 1200, bitDepth: 8, colorType: 6, interlace: 0 });
    expect(readPngHeader(new TextEncoder().encode('%PDF-1.4 not a png at all, really not'))).toBeNull();
    expect(readPngHeader(bytes.subarray(0, 20))).toBeNull();
  });

  it('gives the top-left pixel whatever the first row is filtered with, across split IDAT chunks', () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const bytes = png(2, 2, 6, [
        [filter, 10, 20, 30, 0, 9, 9, 9, 9],
        [0, 1, 1, 1, 1, 2, 2, 2, 2],
      ]);
      expect(pngTopLeftPixel(bytes, (d) => inflateSync(d))).toEqual([10, 20, 30, 0]);
    }
  });

  it('gives no pixel for a PNG that is not 8-bit RGBA', () => {
    expect(pngTopLeftPixel(png(1, 1, 2, [[0, 1, 2, 3]]), (d) => inflateSync(d))).toBeNull();
  });
});
