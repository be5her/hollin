import type { Corner, Path } from './path';
import { add, cross, distance, dot, normalize, scale, sub, type Vec2 } from './vec';

/**
 * The geometry of a corner between two straight edges, for the corner grip: a fillet's arc or a
 * chamfer's line is drawn across the corner, and its middle lies on the bisector of the vertex.
 * Corners next to arcs or Béziers have no grip (the inspector still edits them).
 */
export interface CornerFrame {
  /** The vertex. */
  vertex: Vec2;
  /** The unit bisector, pointing into the corner (towards the fillet's arc). */
  bisector: Vec2;
  /** Half the angle between the two edges, in radians (0, π/2). */
  halfAngle: number;
  /** The longest tangent distance a corner may take along each edge (half the edge when its other end has a corner too). */
  maxIn: number;
  maxOut: number;
}

/** The frame of the corner at vertex `index`, or null when the vertex is an end, lies between curves or the edges are collinear. */
export function cornerFrame(path: Path, index: number): CornerFrame | null {
  const n = path.v.length;
  if (!path.closed && (index <= 0 || index >= n - 1)) return null;
  const prev = path.v[(index - 1 + n) % n];
  const v = path.v[index];
  const next = path.v[(index + 1) % n];
  if (!prev || !v || !next) return null;
  if (prev.s || v.s) return null;
  const a = sub(prev.p, v.p);
  const b = sub(next.p, v.p);
  const lenIn = distance(prev.p, v.p);
  const lenOut = distance(next.p, v.p);
  if (lenIn < 1e-9 || lenOut < 1e-9) return null;
  const ua = normalize(a);
  const ub = normalize(b);
  if (Math.abs(cross(ua, ub)) < 1e-9) return null;
  const bisector = normalize(add(ua, ub));
  const halfAngle = Math.acos(Math.min(1, Math.max(-1, dot(ua, bisector))));
  const hasCorner = (i: number) => Boolean(path.v[((i % n) + n) % n]?.c) && (path.closed || (i > 0 && i < n - 1));
  return { vertex: v.p, bisector, halfAngle, maxIn: lenIn * (hasCorner(index - 1) ? 0.5 : 1), maxOut: lenOut * (hasCorner(index + 1) ? 0.5 : 1) };
}

/** Where the corner's grip sits: the middle of the fillet arc or of the chamfer line. */
export function cornerGripPoint(frame: CornerFrame, corner: Corner): Vec2 {
  const s = Math.sin(frame.halfAngle);
  const c = Math.cos(frame.halfAngle);
  if (corner.k === 'fillet') {
    // The tangent points sit r / tan(φ) from the vertex; the arc's middle is r / sin(φ) − r along the bisector.
    const r = Math.min(corner.r, filletRadiusMax(frame));
    return add(frame.vertex, scale(frame.bisector, r / s - r));
  }
  const d1 = Math.min(corner.d1, frame.maxIn);
  const d2 = Math.min(corner.d2 ?? corner.d1, frame.maxOut);
  return add(frame.vertex, scale(frame.bisector, ((d1 + d2) / 2) * c));
}

/** The largest fillet radius whose tangent points stay within the edges' budgets. */
export function filletRadiusMax(frame: CornerFrame): number {
  return Math.min(frame.maxIn, frame.maxOut) * Math.tan(frame.halfAngle);
}

/**
 * The corner a grip dragged to `cursor` means: the cursor's distance along the bisector sets the
 * fillet radius, or scales both chamfer distances together. Returns null when the drag would make the
 * corner sharp (the grip was pulled back onto the vertex).
 */
export function cornerFromGrip(frame: CornerFrame, current: Corner, cursor: Vec2): Corner | null {
  const along = dot(sub(cursor, frame.vertex), frame.bisector);
  if (along <= 1e-6) return null;
  const s = Math.sin(frame.halfAngle);
  const c = Math.cos(frame.halfAngle);
  if (current.k === 'fillet') {
    const r = Math.min((along * s) / (1 - s), filletRadiusMax(frame));
    return r >= 1 ? { k: 'fillet', r: round(r) } : null;
  }
  const ratio = (current.d2 ?? current.d1) / current.d1;
  const d1 = Math.min((2 * along) / (c * (1 + ratio)), frame.maxIn, frame.maxOut / ratio);
  if (d1 < 1) return null;
  const d2 = d1 * ratio;
  return Math.abs(d2 - d1) < 1e-6 ? { k: 'chamfer', d1: round(d1) } : { k: 'chamfer', d1: round(d1), d2: round(d2) };
}

const round = (mm: number) => Math.round(mm * 10) / 10;
