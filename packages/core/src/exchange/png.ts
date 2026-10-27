/** The eight bytes every PNG file starts with. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** What a PNG's IHDR chunk says: the size in pixels, the bit depth, the colour type (6 is RGBA) and the interlace method. */
export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** The header of a PNG file, read by hand (the signature, then the IHDR chunk, which must come first); null when the bytes are no PNG. */
export function readPngHeader(bytes: Uint8Array): PngHeader | null {
  if (bytes.length < 33 || PNG_SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (u32(bytes, 8) !== 13 || type !== 'IHDR') return null;
  return { width: u32(bytes, 16), height: u32(bytes, 20), bitDepth: bytes[24], colorType: bytes[25], interlace: bytes[28] };
}

/**
 * The top-left pixel of an 8-bit RGBA, non-interlaced PNG as `[r, g, b, a]`: the IDAT chunks are
 * joined and inflated with `inflate` (node's `inflateSync`; core stays free of node), and the first
 * pixel of the first row is stored as is whatever the row's filter (each filter predicts it from
 * zeros). Null for any other kind of PNG.
 */
export function pngTopLeftPixel(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): [number, number, number, number] | null {
  const header = readPngHeader(bytes);
  if (!header || header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) return null;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    joined.set(p, offset);
    offset += p.length;
  }
  const raw = inflate(joined);
  if (raw.length < 5 || raw[0] > 4) return null;
  return [raw[1], raw[2], raw[3], raw[4]];
}
