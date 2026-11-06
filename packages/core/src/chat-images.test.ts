import { describe, expect, it } from 'vitest';
import { MAX_CHAT_IMAGE_BYTES } from './assistant-types';
import { base64Bytes, checkChatImage, sniffImageType } from './chat-images';

const b64 = (...bytes: number[]) => Buffer.from(bytes).toString('base64');
const png = b64(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const jpeg = b64(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49);
const gif = b64(...Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1'));
const webp = b64(...Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'));

describe('chat images', () => {
  it('tells the image type from the data, whatever the clipboard said', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(gif)).toBe('image/gif');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(b64(...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'latin1')))).toBeNull();
    expect(sniffImageType(b64(...Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1')))).toBeNull();
  });

  it('counts the decoded size without decoding', () => {
    for (const n of [1, 2, 3, 4, 5, 100, 1001]) expect(base64Bytes(Buffer.alloc(n).toString('base64'))).toBe(n);
  });

  it('refuses what is not base64, not an image the model reads, or too large', () => {
    expect(checkChatImage(png)).toEqual({ ok: true, mimeType: 'image/png' });
    expect(checkChatImage('data:image/png;base64,' + png)).toMatchObject({ ok: false, reason: expect.stringContaining('base64') });
    expect(checkChatImage('')).toMatchObject({ ok: false });
    expect(checkChatImage(b64(...Buffer.from('%PDF-1.7 hello', 'latin1')))).toMatchObject({ ok: false, reason: expect.stringContaining('PNG, JPEG, GIF or WebP') });
    const big = Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 3);
    Buffer.from(png, 'base64').copy(big);
    expect(checkChatImage(big.toString('base64'))).toMatchObject({ ok: false, reason: expect.stringContaining('5 MB') });
  });
});
