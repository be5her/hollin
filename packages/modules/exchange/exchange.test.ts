import { describe, expect, it } from 'vitest';
import { checkedPng, fileSafe, levelPaths } from './main';

/** The signature and an IHDR chunk saying width × height, RGBA: all `checkedPng` reads. */
function pngHead(width: number, height: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 6;
  return b.toString('base64');
}

describe('export file names', () => {
  it('keeps the path for one level and puts each level name before the extension for several', () => {
    expect(levelPaths('C:/out/Plan.dxf', ['Ground floor'])).toEqual(['C:/out/Plan.dxf']);
    expect(levelPaths('C:/out/Plan.dxf', ['Ground floor', 'Upper'])).toEqual(['C:/out/Plan - Ground floor.dxf', 'C:/out/Plan - Upper.dxf']);
  });

  it('replaces the characters Windows forbids and numbers clashing names', () => {
    expect(fileSafe('A/B: "C"?. ')).toBe('A_B_ _C__');
    expect(fileSafe('...')).toBe('Level');
    expect(levelPaths('/x/p.svg', ['Floor', 'floor', 'Floor'])).toEqual(['/x/p - Floor.svg', '/x/p - floor 2.svg', '/x/p - Floor 3.svg']);
  });
});

describe('export.image: the PNG the window drew', () => {
  it('is taken at the size asked for', () => {
    expect(checkedPng(pngHead(1600, 1200), 1600, 1200).length).toBe(33);
  });

  it('is refused, never written smaller, when the window could not draw that large, or answered no PNG', () => {
    expect(() => checkedPng(pngHead(4096, 2048), 4096, 4096)).toThrow(expect.objectContaining({ code: 'UNAVAILABLE', message: expect.stringContaining('4096 × 2048') }));
    expect(() => checkedPng(Buffer.from('not a png at all, not even close to one').toString('base64'), 64, 64)).toThrow(expect.objectContaining({ code: 'UNAVAILABLE' }));
  });
});
