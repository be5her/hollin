import { describe, expect, it } from 'vitest';
import { fileSafe, levelPaths } from './main';

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
