/** A 2D point or vector in millimetres; y points up. */
export type Vec2 = readonly [number, number];

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
/** The z component of the 3D cross product: positive when b turns left (counter-clockwise) from a. */
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Rotated 90° counter-clockwise: the left normal of a direction. */
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
};
export const rotate = (a: Vec2, radians: number): Vec2 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const angleOf = (a: Vec2): number => Math.atan2(a[1], a[0]);
export const equals = (a: Vec2, b: Vec2, eps = 1e-9): boolean => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

export const DEG = Math.PI / 180;

/** The angle in (-π, π] from direction a to direction b, positive counter-clockwise. */
export function signedAngle(a: Vec2, b: Vec2): number {
  return Math.atan2(cross(a, b), dot(a, b));
}

/** Rounds to 0.001 mm, the precision lengths are stored with. */
export function roundMm(value: number): number {
  const r = Math.round(value * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export function extendBox(box: Box, p: Vec2): Box {
  return { minX: Math.min(box.minX, p[0]), minY: Math.min(box.minY, p[1]), maxX: Math.max(box.maxX, p[0]), maxY: Math.max(box.maxY, p[1]) };
}
