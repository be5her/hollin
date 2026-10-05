import type { UnitSettings } from './config';

/** Lengths are stored in millimetres everywhere; these helpers only translate for display and typing. */
export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

const METRIC_FACTOR = { mm: 1, cm: 10, m: 1000 } as const;

function trimNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** `6`, `6 1/2`, `1/2` or `0` for a non-negative inch value already rounded to 1/denominator. */
function inchesText(inches: number, denominator: number): string {
  const whole = Math.floor(inches + 1e-9);
  const numerator = Math.round((inches - whole) * denominator);
  if (numerator === 0) return String(whole);
  const g = gcd(numerator, denominator);
  const frac = `${numerator / g}/${denominator / g}`;
  return whole === 0 ? frac : `${whole} ${frac}`;
}

/** A length in the user's units, e.g. `3200 mm`, `3.2 m`, `10' 6 1/2"`, `126"`. */
export function formatLength(mm: number, units: UnitSettings): string {
  if (!Number.isFinite(mm)) return '—';
  if (units.system === 'metric') {
    const value = mm / METRIC_FACTOR[units.metricUnit];
    const text = trimNumber(value, units.precision);
    return `${text === '-0' ? '0' : text} ${units.metricUnit}`;
  }
  const denominator = units.fraction;
  const rounded = Math.round((Math.abs(mm) / MM_PER_INCH) * denominator) / denominator;
  const sign = mm < 0 && rounded > 0 ? '-' : '';
  if (units.imperialStyle === 'in') return `${sign}${inchesText(rounded, denominator)}"`;
  const feet = Math.floor(rounded / 12 + 1e-9);
  const inches = rounded - feet * 12;
  if (feet === 0) return `${sign}${inchesText(inches, denominator)}"`;
  return `${sign}${feet}' ${inchesText(inches, denominator)}"`;
}

const NUMBER = String.raw`\d+(?:\.\d+)?|\.\d+`;
/** `6`, `6.5`, `6 1/2`, `6-1/2`, `1/2`. */
const MIXED = String.raw`(?:(${NUMBER})(?:[\s-]+(\d+)\/(\d+))?|(\d+)\/(\d+))`;

function mixedValue(m: RegExpMatchArray, offset: number): number {
  const [whole, num, den, onlyNum, onlyDen] = m.slice(offset, offset + 5);
  if (onlyNum !== undefined) return Number(onlyNum) / Number(onlyDen);
  const base = Number(whole);
  return num !== undefined ? base + Number(num) / Number(den) : base;
}

const FEET_INCHES = new RegExp(String.raw`^${MIXED}\s*(?:'|ft|feet|foot)\s*-?\s*(?:${MIXED}\s*(?:"|in|inch|inches)?)?$`, 'i');
const INCHES = new RegExp(String.raw`^${MIXED}\s*(?:"|in|inch|inches)$`, 'i');
const METRIC = new RegExp(String.raw`^(${NUMBER})\s*(mm|cm|m)$`, 'i');
const PLAIN = new RegExp(String.raw`^${MIXED}$`);

/**
 * Reads a typed length into millimetres, or null when it is not one. Accepts `3200`, `3200mm`,
 * `320 cm`, `3.2m`, `10'`, `10' 6"`, `10'-6 1/2"`, `10 ft 6 in`, `126in`, `6 1/2"`. A bare number
 * is in the display unit: the chosen metric unit, or inches in imperial.
 */
export function parseLength(text: string, units: UnitSettings): number | null {
  let input = text.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!input) return null;
  let sign = 1;
  if (input.startsWith('-')) {
    sign = -1;
    input = input.slice(1).trim();
  } else if (input.startsWith('+')) {
    input = input.slice(1).trim();
  }

  let mm: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = input.match(METRIC))) {
    mm = Number(m[1]) * METRIC_FACTOR[m[2].toLowerCase() as keyof typeof METRIC_FACTOR];
  } else if ((m = input.match(FEET_INCHES))) {
    const feet = mixedValue(m, 1);
    const inches = m[6] !== undefined || m[9] !== undefined ? mixedValue(m, 6) : 0;
    mm = feet * MM_PER_FOOT + inches * MM_PER_INCH;
  } else if ((m = input.match(INCHES))) {
    mm = mixedValue(m, 1) * MM_PER_INCH;
  } else if ((m = input.match(PLAIN))) {
    const value = mixedValue(m, 1);
    mm = units.system === 'metric' ? value * METRIC_FACTOR[units.metricUnit] : value * MM_PER_INCH;
  }
  return mm === null || !Number.isFinite(mm) ? null : sign * mm;
}

/** An angle in degrees, e.g. `45°` or `22.5°`. */
export function formatAngle(degrees: number, units: Pick<UnitSettings, 'precision'>): string {
  if (!Number.isFinite(degrees)) return '—';
  const text = trimNumber(degrees, Math.max(units.precision, 1));
  return `${text === '-0' ? '0' : text}°`;
}

const ANGLE = new RegExp(String.raw`^([+-]?(?:${NUMBER}))\s*(°|deg|degrees?|rad|radians?)?$`, 'i');

/** Reads `45`, `45°`, `45 deg` or `0.785 rad` into degrees, or null. */
export function parseAngle(text: string): number | null {
  const m = text.trim().match(ANGLE);
  if (!m) return null;
  const value = Number(m[1]);
  const degrees = m[2] && /^rad/i.test(m[2]) ? (value * 180) / Math.PI : value;
  return Number.isFinite(degrees) ? degrees : null;
}
