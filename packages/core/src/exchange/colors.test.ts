import { describe, expect, it } from 'vitest';
import { PRINT_COLORS } from './colors';
import { DXF_COLORS } from './dxf';

describe('the print palette', () => {
  it("is the identity's light plan palette for a white sheet", () => {
    expect(PRINT_COLORS).toEqual({
      fg: '#231f1c',
      wallLine: '#231f1c',
      wall: '#3b3531',
      muted: '#7b7064',
      slab: '#e9e1d2',
      room: '#8b9a6b',
      dim: '#3f5390',
      connector: '#4b433d',
      decor: '#8c6b4a',
      warning: '#b8841f',
    });
  });

  it('maps to the nearest AutoCAD colour indices', () => {
    expect(DXF_COLORS).toEqual({ fg: 7, wallLine: 7, connector: 7, wall: 8, muted: 8, slab: 9, room: 75, dim: 165, decor: 35, warning: 42 });
  });
});
