import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { parseCoordinate, resolveCoordinate } from './input';

const metric = defaultConfig().units;
const imperial = { ...metric, system: 'imperial' as const };

describe('typed coordinates', () => {
  it('reads lengths, polar, relative and absolute forms in any unit', () => {
    expect(parseCoordinate('3000', metric)).toEqual({ k: 'length', mm: 3000 });
    expect(parseCoordinate('3.5m', metric)).toEqual({ k: 'length', mm: 3500 });
    expect(parseCoordinate('3000<45', metric)).toEqual({ k: 'polar', mm: 3000, degrees: 45 });
    expect(parseCoordinate('@1000,500', metric)).toEqual({ k: 'relative', dx: 1000, dy: 500 });
    expect(parseCoordinate('@2m, -50cm', metric)).toEqual({ k: 'relative', dx: 2000, dy: -500 });
    expect(parseCoordinate('1000;500', metric)).toEqual({ k: 'absolute', x: 1000, y: 500 });
    expect(parseCoordinate('-500,0', metric)).toEqual({ k: 'absolute', x: -500, y: 0 });
    expect(parseCoordinate(`10'`, imperial)).toEqual({ k: 'length', mm: 3048 });
    expect((parseCoordinate('12', imperial) as { mm: number }).mm).toBeCloseTo(304.8, 9);
    expect(parseCoordinate('@3000', metric)).toEqual({ k: 'polar', mm: 3000, degrees: 0 });
  });

  it('refuses what is not a coordinate', () => {
    expect(parseCoordinate('', metric)).toBeNull();
    expect(parseCoordinate('abc', metric)).toBeNull();
    expect(parseCoordinate('1,2,3', metric)).toBeNull();
    expect(parseCoordinate('3000<', metric)).toBeNull();
    expect(parseCoordinate('@x,1', metric)).toBeNull();
  });

  it('resolves against the last point and the current direction', () => {
    expect(resolveCoordinate({ k: 'absolute', x: 1, y: 2 }, {})).toEqual([1, 2]);
    expect(resolveCoordinate({ k: 'length', mm: 3000 }, { from: [100, 100] })).toEqual([3100, 100]);
    expect(resolveCoordinate({ k: 'length', mm: 1000 }, { from: [0, 0], direction: [0, 5] })).toEqual([0, 1000]);
    expect(resolveCoordinate({ k: 'relative', dx: 10, dy: -20 }, { from: [100, 100] })).toEqual([110, 80]);
    const polar = resolveCoordinate({ k: 'polar', mm: 1000, degrees: 90 }, { from: [0, 0] })!;
    expect(polar[0]).toBeCloseTo(0, 9);
    expect(polar[1]).toBeCloseTo(1000, 9);
    expect(resolveCoordinate({ k: 'length', mm: 3000 }, {})).toBeNull();
  });
});
