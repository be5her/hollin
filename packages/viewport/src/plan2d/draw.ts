import { arcGeometry, resolvePath, type Path, type Region, type Seg } from '@studio/core';

/**
 * Traces resolved segments onto a canvas path (a `Path2D` or a context) in world coordinates. The
 * canvas is drawn through a y-flipping transform, so "increasing angle" in canvas terms is
 * counter-clockwise in the world: a positive sweep (bulge > 0) is drawn with `anticlockwise = false`.
 */
export function traceSegments(target: CanvasPath, segs: readonly Seg[], closed: boolean): void {
  if (!segs.length) return;
  target.moveTo(segs[0].a[0], segs[0].a[1]);
  for (const s of segs) {
    if (s.k === 'line') target.lineTo(s.b[0], s.b[1]);
    else if (s.k === 'arc') {
      const { center, radius, start, sweep } = arcGeometry(s.a, s.b, s.bulge);
      target.arc(center[0], center[1], radius, start, start + sweep, sweep < 0);
    } else target.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.b[0], s.b[1]);
  }
  if (closed) target.closePath();
}

export function tracePath(target: CanvasPath, path: Path): void {
  traceSegments(target, resolvePath(path).segs, path.closed);
}

/** The outer outline and the holes, so a nonzero or even-odd fill leaves the holes empty. */
export function traceRegion(target: CanvasPath, region: Region): void {
  tracePath(target, region.outer);
  for (const hole of region.holes) tracePath(target, hole);
}

/** A closed polygon from flattened points. */
export function tracePolygon(target: CanvasPath, points: readonly (readonly [number, number])[]): void {
  if (!points.length) return;
  target.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) target.lineTo(points[i][0], points[i][1]);
  target.closePath();
}

/** A `Path2D` factory: the real one in the browser, something recording in tests. */
export type PathFactory = () => Path2D;

export const canCreatePath2D = (): boolean => typeof Path2D !== 'undefined';
