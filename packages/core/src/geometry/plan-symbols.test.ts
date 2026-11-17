import { describe, expect, it } from 'vitest';
import { walkLabelPlacement } from './plan-symbols';

describe('walkLabelPlacement', () => {
  // A walk running up the page: its normal points along x, the words sit left and right of the dot.
  const dot: [number, number] = [1000, 2000];
  const normal: [number, number] = [1, 0];

  it('centres a short Latin word 1.27 text heights from the dot, as the plan always has', () => {
    expect(walkLabelPlacement(dot, normal, 1, 'UP', 100)).toEqual({ at: [1127, 2000], align: 'center' });
    expect(walkLabelPlacement(dot, normal, -1, '16 R', 100)).toEqual({ at: [873, 2000], align: 'center' });
  });

  it('starts an Arabic word at a gap beside the dot, reading away from it, so it never runs into the dot', () => {
    expect(walkLabelPlacement(dot, normal, 1, 'صعود', 100)).toEqual({ at: [1060, 2000], align: 'left' });
    expect(walkLabelPlacement(dot, normal, -1, '8 قوائم', 100)).toEqual({ at: [940, 2000], align: 'right' });
  });

  it('keeps words centred above and below the dot of a walk across the page', () => {
    expect(walkLabelPlacement(dot, [0, 1], 1, 'صعود', 100)).toEqual({ at: [1000, 2127], align: 'center' });
  });
});
