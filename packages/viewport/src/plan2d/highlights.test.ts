import { describe, expect, it } from 'vitest';
import { highlightAge, highlightAnimating, highlightOpacity, highlightTag } from './highlights';

describe("Otto's highlights", () => {
  const at = 1_000_000;

  it('hold for 45 s, fade linearly for 15 s and are gone at a minute', () => {
    expect(highlightOpacity({ at }, at)).toBe(1);
    expect(highlightOpacity({ at }, at + 45_000)).toBe(1);
    expect(highlightOpacity({ at }, at + 52_500)).toBeCloseTo(0.5);
    expect(highlightOpacity({ at }, at + 60_000)).toBe(0);
    expect(highlightAnimating({ at }, at + 10_000)).toBe(false);
    expect(highlightAnimating({ at }, at + 50_000)).toBe(true);
  });

  it('leave over 200 ms after your next edit, eased out', () => {
    const h = { at, clearedAt: at + 5000 };
    expect(highlightOpacity(h, at + 5000)).toBe(1);
    const mid = highlightOpacity(h, at + 5100);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    expect(highlightOpacity(h, at + 5200)).toBe(0);
    expect(highlightAnimating(h, at + 5100)).toBe(true);
    expect(highlightAnimating(h, at + 5300)).toBe(false);
  });

  it('cut instead of fading under reduced motion', () => {
    expect(highlightOpacity({ at }, at + 55_000, true)).toBe(1);
    expect(highlightOpacity({ at }, at + 60_000, true)).toBe(0);
    expect(highlightOpacity({ at, clearedAt: at + 1000 }, at + 1000, true)).toBe(0);
    expect(highlightAnimating({ at }, at + 55_000, true)).toBe(false);
  });

  it('say how old they are, and cut a long label', () => {
    expect(highlightAge(3000)).toBe('now');
    expect(highlightAge(24_000)).toBe('20 s ago');
    expect(highlightAge(61_000)).toBe('1 min ago');
    expect(highlightTag('Add a 3 m wall', 0)).toBe('Otto · Add a 3 m wall · now');
    const long = highlightTag('Draft the ground floor of a two-bedroom flat with an open kitchen', 0);
    expect(long).toBe('Otto · Draft the ground floor of a two-bed… · now');
  });
});
