/** Crockford base32, lowercase: no i, l, o or u, so ids read and type unambiguously. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * A random id: `<prefix>_` plus 16 base32 characters (80 bits). Lowercase because ids become file
 * names, which Windows and macOS compare without case. Works in Node and in the renderer.
 */
export function newId(prefix?: string): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return prefix ? `${prefix}_${out}` : out;
}

const ID_PATTERN = /^(?:[a-z]{1,8}_)?[0-9a-hjkmnp-tv-z]{16}$/;

/** True for strings shaped like `newId()` output. Never parse the prefix for meaning. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function nowIso(): string {
  return new Date().toISOString();
}
