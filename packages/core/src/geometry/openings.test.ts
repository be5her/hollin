import { describe, expect, it } from 'vitest';
import { fitOpening, openingFrame, openingMisfits } from './openings';
import type { Path } from './path';

const straight: Path = { closed: false, v: [{ p: [0, 0] }, { p: [5000, 0] }] };
const wall = { path: straight, thickness: 200, alignment: 'center' as const };

describe('openings', () => {
  it('frames an opening across the wall body', () => {
    const f = openingFrame(wall, { along: 1000, width: 900 });
    expect(f.center).toEqual([1000, 0]);
    expect(f.jambs[0]).toEqual([550, 0]);
    expect(f.jambs[1]).toEqual([1450, 0]);
    expect(f.cut.map((p) => p[1]).sort((a, b) => a - b)).toEqual([-100.5, -100.5, 100.5, 100.5]);
    const left = openingFrame({ ...wall, alignment: 'left' }, { along: 1000, width: 900 });
    expect(Math.min(...left.cut.map((p) => p[1]))).toBeCloseTo(-0.5, 9);
    expect(Math.max(...left.cut.map((p) => p[1]))).toBeCloseTo(200.5, 9);
  });

  it('fits within the wall and clear of other openings, and clamps to the nearest gap', () => {
    expect(fitOpening(wall, [], 2500, 900)).toMatchObject({ fits: true, along: 2500, gaps: [[450, 4550]] });
    expect(fitOpening(wall, [], 100, 900)).toMatchObject({ fits: false, along: 450 });
    expect(fitOpening(wall, [], 4900, 900)).toMatchObject({ fits: false, along: 4550 });
    const others = [{ along: 2500, width: 1000 }];
    const fit = fitOpening(wall, others, 2600, 900);
    expect(fit.fits).toBe(false);
    expect(fit.gaps).toEqual([
      [450, 1550],
      [3450, 4550],
    ]);
    expect(fit.along).toBe(3450);
    expect(fitOpening(wall, others, 1000, 900).fits).toBe(true);
    // Nothing fits: a wall full of openings.
    expect(fitOpening(wall, [{ along: 2500, width: 4800 }], 2500, 900)).toMatchObject({ fits: false, gaps: [] });
    expect(Number.isNaN(fitOpening(wall, [{ along: 2500, width: 4800 }], 2500, 900).along)).toBe(true);
  });

  it('tells a misfit from the other openings on the wall, ignoring itself', () => {
    const door = { id: 'a', along: 1000, width: 900 };
    const window = { id: 'b', along: 1600, width: 1200 };
    expect(openingMisfits(wall, door, [door])).toBe(false);
    expect(openingMisfits(wall, door, [door, window])).toBe(true);
    expect(openingMisfits(wall, { id: 'c', along: 4800, width: 900 }, [])).toBe(true);
  });
});
