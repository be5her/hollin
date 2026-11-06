import { MAX_CHAT_IMAGE_BYTES, type ChatImageType } from './assistant-types';

/*
 * Checks on an image pasted into the assistant's chat before it goes to the model: what it really is
 * (from its first bytes, since the API refuses a media type that does not match the data) and how big
 * it is decoded. Pure, so main and the tests share it.
 */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The decoded size of a base64 string, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** The image type the data's signature names, or null when it is none the model reads. */
export function sniffImageType(data: string): ChatImageType | null {
  let head: Uint8Array;
  try {
    const bin = atob(data.slice(0, 24));
    head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** Why an image cannot be sent, or its real type: base64 only, one of the types the model reads, at most `MAX_CHAT_IMAGE_BYTES` decoded. */
export function checkChatImage(data: string): { ok: true; mimeType: ChatImageType } | { ok: false; reason: string } {
  if (!data || data.length % 4 !== 0 || !BASE64.test(data)) return { ok: false, reason: 'is not base64 image data' };
  const mimeType = sniffImageType(data);
  if (!mimeType) return { ok: false, reason: 'is not a PNG, JPEG, GIF or WebP image' };
  const bytes = base64Bytes(data);
  if (bytes > MAX_CHAT_IMAGE_BYTES) return { ok: false, reason: `is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_CHAT_IMAGE_BYTES / 1024 / 1024} MB the model takes` };
  return { ok: true, mimeType };
}
