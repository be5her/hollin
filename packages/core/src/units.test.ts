import { describe, expect, it } from 'vitest';
import { defaultConfig, type UnitSettings } from './config';
import { formatAngle, formatLength, parseAngle, parseLength } from './units';

const metric = (patch: Partial<UnitSettings> = {}): UnitSettings => ({ ...defaultConfig().units, ...patch });
const imperial = (patch: Partial<UnitSettings> = {}): UnitSettings => ({ ...defaultConfig().units, system: 'imperial', ...patch });

describe('formatLength', () => {
  it('shows metric lengths in the chosen unit and precision', () => {
    expect(formatLength(3200, metric())).toBe('3200 mm');
    expect(formatLength(3200, metric({ metricUnit: 'm', precision: 2 }))).toBe('3.2 m');
    expect(formatLength(3215.4, metric({ metricUnit: 'cm', precision: 1 }))).toBe('321.5 cm');
    expect(formatLength(-0.2, metric())).toBe('0 mm');
  });

  it('shows feet and inches rounded to the chosen fraction', () => {
    expect(formatLength(3200.4, imperial())).toBe(`10' 6"`);
    expect(formatLength(3213.1, imperial())).toBe(`10' 6 1/2"`);
    expect(formatLength(12.7, imperial())).toBe(`1/2"`);
    expect(formatLength(304.8, imperial())).toBe(`1' 0"`);
    expect(formatLength(-152.4, imperial())).toBe(`-6"`);
    expect(formatLength(3213.1, imperial({ imperialStyle: 'in' }))).toBe(`126 1/2"`);
    expect(formatLength(3, imperial({ fraction: 1 }))).toBe(`0"`);
  });
});

describe('parseLength', () => {
  it('reads metric lengths with or without a unit', () => {
    expect(parseLength('3200', metric())).toBe(3200);
    expect(parseLength('3200mm', metric())).toBe(3200);
    expect(parseLength('320 cm', metric())).toBe(3200);
    expect(parseLength('3.2m', metric())).toBe(3200);
    expect(parseLength('3.2', metric({ metricUnit: 'm' }))).toBe(3200);
    expect(parseLength('-150', metric())).toBe(-150);
    expect(parseLength('.5 m', metric())).toBe(500);
  });

  it('reads feet and inches in the usual spellings', () => {
    expect(parseLength(`10'`, imperial())).toBeCloseTo(3048);
    expect(parseLength(`10' 6"`, imperial())).toBeCloseTo(3200.4);
    expect(parseLength(`10'6"`, imperial())).toBeCloseTo(3200.4);
    expect(parseLength(`10'-6 1/2"`, imperial())).toBeCloseTo(3213.1);
    expect(parseLength(`10 ft 6 in`, imperial())).toBeCloseTo(3200.4);
    expect(parseLength(`126in`, metric())).toBeCloseTo(3200.4);
    expect(parseLength(`6 1/2"`, metric())).toBeCloseTo(165.1);
    expect(parseLength(`1/2"`, metric())).toBeCloseTo(12.7);
    expect(parseLength(`10’ 6”`, imperial())).toBeCloseTo(3200.4);
  });

  it('reads a bare number as inches in imperial', () => {
    expect(parseLength('12', imperial())).toBeCloseTo(304.8);
    expect(parseLength('6-1/2', imperial())).toBeCloseTo(165.1);
  });

  it('round-trips what it formats', () => {
    // Formatting rounds to the display precision: 1/16" in imperial, 0.1 mm here in metric.
    for (const mm of [0, 12.7, 1000, 3213.1, 4572]) {
      expect(Math.abs(parseLength(formatLength(mm, imperial()), imperial())! - mm)).toBeLessThanOrEqual(25.4 / 32 + 1e-9);
      expect(Math.abs(parseLength(formatLength(mm, metric({ precision: 1 })), metric())! - mm)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('rejects text that is not a length', () => {
    for (const text of ['', 'abc', '3 m m', "1'2'", '--3', '3x']) expect(parseLength(text, metric())).toBeNull();
  });
});

describe('angles', () => {
  it('formats and parses degrees and radians', () => {
    expect(formatAngle(45, { precision: 0 })).toBe('45°');
    expect(formatAngle(22.5, { precision: 0 })).toBe('22.5°');
    expect(parseAngle('45')).toBe(45);
    expect(parseAngle('45°')).toBe(45);
    expect(parseAngle('-30 deg')).toBe(-30);
    expect(parseAngle(`${Math.PI / 2} rad`)).toBeCloseTo(90);
    expect(parseAngle('north')).toBeNull();
  });
});
