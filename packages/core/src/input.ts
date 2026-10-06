import type { UnitSettings } from './config';
import { DEG, add, normalize, scale, type Vec2 } from './geometry/vec';
import { parseAngle, parseLength } from './units';

/**
 * A coordinate typed while drawing: a length along the current direction (`3000`, `3.5m`), a polar
 * length and angle (`3000<45`), a relative offset (`@1000,500`, `@2m,-50cm`) or an absolute
 * position (`1000,500`). Lengths take any unit `parseLength` accepts; angles are degrees.
 */
export type Coordinate = { k: 'length'; mm: number } | { k: 'polar'; mm: number; degrees: number } | { k: 'relative'; dx: number; dy: number } | { k: 'absolute'; x: number; y: number };

const splitPair = (text: string): [string, string] | null => {
  const parts = text.split(/[,;]/);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
};

export function parseCoordinate(text: string, units: UnitSettings): Coordinate | null {
  let input = text.trim();
  if (!input) return null;
  const relative = input.startsWith('@');
  if (relative) input = input.slice(1).trim();
  if (input.includes('<')) {
    const [len, ang] = input.split('<');
    const mm = parseLength(len, units);
    const degrees = parseAngle(ang);
    if (mm === null || degrees === null) return null;
    return { k: 'polar', mm, degrees };
  }
  const pair = splitPair(input);
  if (pair) {
    const x = parseLength(pair[0], units);
    const y = parseLength(pair[1], units);
    if (x === null || y === null) return null;
    return relative ? { k: 'relative', dx: x, dy: y } : { k: 'absolute', x, y };
  }
  const mm = parseLength(input, units);
  if (mm === null) return null;
  return relative ? { k: 'polar', mm, degrees: 0 } : { k: 'length', mm };
}

/**
 * The point a typed coordinate means, given the last point and the current direction (unit vector,
 * from the last point to the cursor; `[1, 0]` when there is none). Null when a relative form has no
 * last point to start from.
 */
export function resolveCoordinate(coord: Coordinate, context: { from?: Vec2; direction?: Vec2 }): Vec2 | null {
  if (coord.k === 'absolute') return [coord.x, coord.y];
  const from = context.from;
  if (!from) return null;
  if (coord.k === 'relative') return add(from, [coord.dx, coord.dy]);
  if (coord.k === 'polar') return add(from, scale([Math.cos(coord.degrees * DEG), Math.sin(coord.degrees * DEG)], coord.mm));
  const direction = context.direction && (context.direction[0] !== 0 || context.direction[1] !== 0) ? normalize(context.direction) : ([1, 0] as Vec2);
  return add(from, scale(direction, coord.mm));
}
