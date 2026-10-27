import { arcGeometry, segmentLength, segmentPoint, segmentTangent, trim, type Seg } from './path';
import { add, normalize, perp, scale, sub, type Vec2 } from './vec';

/*
 * The pure geometry of the plan's symbols, shared by the canvas (sizes in a few pixels' worth of
 * millimetres) and the exports (sizes from the drawing's text height).
 */

/** How far the glyphs of points and lights reach on the plan, mm. */
export const PLAN_GLYPHS = Object.freeze({ point: 100, light: 150 });

/** Points along walk-line segments between two distances, arcs sampled finely enough to look round. */
export function walkPoints(segs: readonly Seg[], from: number, to: number): Vec2[] {
  const out: Vec2[] = [];
  let start = 0;
  for (const s of segs) {
    const len = segmentLength(s);
    const a = Math.max(from, start);
    const b = Math.min(to, start + len);
    if (b > a + 1e-9 && len > 0) {
      const steps = s.k === 'line' ? 1 : Math.max(4, Math.ceil(Math.abs(s.k === 'arc' ? arcGeometry(s.a, s.b, s.bulge).sweep : 1) / 0.15));
      for (let i = out.length ? 1 : 0; i <= steps; i++) out.push(segmentPoint(s, (a - start + ((b - a) * i) / steps) / len));
    }
    start += len;
  }
  return out;
}

/** The walk line's segments between two distances, exact: lines and arcs trimmed (a Bézier by its parameter). */
export function walkSegments(segs: readonly Seg[], from: number, to: number): Seg[] {
  const out: Seg[] = [];
  let start = 0;
  for (const s of segs) {
    const len = segmentLength(s);
    const a = Math.max(from, start);
    const b = Math.min(to, start + len);
    if (b > a + 1e-9 && len > 0) out.push(a - start < 1e-9 && start + len - b < 1e-9 ? s : trim(s, (a - start) / len, (b - start) / len));
    start += len;
  }
  return out;
}

/** The walk line's direction at a distance along it (clamped to its ends). */
export function walkTangent(segs: readonly Seg[], along: number): Vec2 {
  let start = 0;
  for (const s of segs) {
    const len = segmentLength(s);
    if (along <= start + len + 1e-9) return normalize(segmentTangent(s, len > 0 ? Math.min(1, Math.max(0, (along - start) / len)) : 0));
    start += len;
  }
  const last = segs[segs.length - 1];
  return last ? normalize(segmentTangent(last, 1)) : [1, 0];
}

/** An open arrowhead at `tip` pointing along `dir`, `length` long: its two strokes. */
export function arrowHeadLines(tip: Vec2, dir: Vec2, length: number): [Vec2, Vec2][] {
  const back = scale(dir, -length);
  const side = scale(perp(dir), length * 0.45);
  return [
    [tip, add(add(tip, back), side)],
    [tip, add(sub(tip, side), back)],
  ];
}

/** The break line across a stair at a distance along it (where the plan cuts it): slanted across the flight with a zigzag in the middle, as a polyline. */
export function breakLinePoints(segs: readonly Seg[], along: number, width: number, centre: Vec2): Vec2[] {
  const t = walkTangent(segs, along);
  const n = perp(t);
  const skew = width * 0.25;
  const a = add(add(centre, scale(n, width / 2)), scale(t, skew));
  const b = sub(sub(centre, scale(n, width / 2)), scale(t, skew));
  const mid1 = add(centre, add(scale(n, width * 0.08), scale(t, width * 0.12)));
  const mid2 = sub(centre, add(scale(n, width * 0.08), scale(t, width * 0.12)));
  return [a, mid1, mid2, b];
}
