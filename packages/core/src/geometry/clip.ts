import { ClipType, EndType, FillRule, JoinType, PolyTree64, booleanOpWithPolyTree, inflatePaths, type Path64, type Paths64, type PolyPath64 } from 'clipper2-ts';
import { flatten, type Path, type Region } from './path';
import { orient, type Polygon } from './polygon';

/**
 * Polygon booleans and offsets through Clipper2 (clipper2-ts). Clipper works on integers, so
 * millimetres are scaled to micrometres: 1 µm resolution, and 2^53 µm (9 million km) of range.
 */
const SCALE = 1000;

export const toClip = (poly: Polygon): Path64 => poly.map(([x, y]) => ({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) }));
export const fromClip = (path: Path64): Polygon => path.map((p) => [p.x / SCALE, p.y / SCALE]);

/** A closed path flattened to a polygon. */
export function polygonOf(path: Path, tolerance = 0.25): Polygon {
  return flatten(path, tolerance);
}

/** A region as polygons: the outer counter-clockwise, the holes clockwise, so a nonzero fill leaves the holes empty. */
export function regionPolygons(region: Region, tolerance = 0.25): Polygon[] {
  return [orient(polygonOf(region.outer, tolerance), true), ...region.holes.map((h) => orient(polygonOf(h, tolerance), false))];
}

/** A node of a boolean result: an outline (counter-clockwise) or a hole (clockwise), with what lies inside it. */
export interface ClipNode {
  polygon: Polygon;
  hole: boolean;
  children: ClipNode[];
}

function nodesOf(parent: PolyPath64): ClipNode[] {
  const out: ClipNode[] = [];
  for (let i = 0; i < parent.count; i++) {
    const child = parent.child(i);
    const polygon = child.polygon ? fromClip(child.polygon) : [];
    if (polygon.length < 3) continue;
    out.push({ polygon: orient(polygon, !child.isHole), hole: child.isHole, children: nodesOf(child) });
  }
  return out;
}

function run(type: ClipType, subject: Polygon[], clip: Polygon[]): ClipNode[] {
  const tree = new PolyTree64();
  booleanOpWithPolyTree(type, subject.map(toClip), clip.length ? clip.map(toClip) : null, tree, FillRule.NonZero);
  return nodesOf(tree);
}

/** Every polygon of a tree, outlines counter-clockwise and holes clockwise, at every depth. */
export function flattenNodes(nodes: ClipNode[]): Polygon[] {
  const out: Polygon[] = [];
  const walk = (list: ClipNode[]) => {
    for (const n of list) {
      out.push(n.polygon);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** The union of polygons (nonzero: orient outlines counter-clockwise and holes clockwise), as a tree. */
export function unionTree(polys: Polygon[]): ClipNode[] {
  return polys.length ? run(ClipType.Union, polys, []) : [];
}

export function unionPolygons(polys: Polygon[]): Polygon[] {
  return flattenNodes(unionTree(polys));
}

export function differencePolygons(subject: Polygon[], clip: Polygon[]): Polygon[] {
  if (!subject.length) return [];
  if (!clip.length) return unionPolygons(subject);
  return flattenNodes(run(ClipType.Difference, subject, clip));
}

export function intersectPolygons(a: Polygon[], b: Polygon[]): Polygon[] {
  if (!a.length || !b.length) return [];
  return flattenNodes(run(ClipType.Intersection, a, b));
}

const JOINS = { miter: JoinType.Miter, round: JoinType.Round, square: JoinType.Square, bevel: JoinType.Bevel } as const;

/** Closed polygons grown (positive) or shrunk (negative) by `delta` mm. */
export function inflatePolygons(polys: Polygon[], delta: number, join: keyof typeof JOINS = 'miter', miterLimit = 2): Polygon[] {
  if (!polys.length) return [];
  const out: Paths64 = inflatePaths(polys.map(toClip), delta * SCALE, JOINS[join], EndType.Polygon, miterLimit, 0.05 * SCALE);
  return normalise(out);
}

const ENDS = { butt: EndType.Butt, square: EndType.Square, round: EndType.Round } as const;

/** Open polylines turned into bodies `delta` mm wide on each side. */
export function inflateLines(lines: Polygon[], delta: number, end: keyof typeof ENDS = 'butt', join: keyof typeof JOINS = 'miter', miterLimit = 2): Polygon[] {
  if (!lines.length || delta <= 0) return [];
  return normalise(inflatePaths(lines.map(toClip), delta * SCALE, JOINS[join], ENDS[end], miterLimit, 0.05 * SCALE));
}

/** Morphological closing: grow then shrink, so gaps narrower than 2·delta close. */
export function closePolygons(polys: Polygon[], delta: number): Polygon[] {
  if (!polys.length) return [];
  return inflatePolygons(inflatePolygons(polys, delta), -delta);
}

/** Clipper's loose output as a clean, oriented set: unions it once more through a tree. */
function normalise(paths: Paths64): Polygon[] {
  const tree = new PolyTree64();
  booleanOpWithPolyTree(ClipType.Union, paths, null, tree, FillRule.NonZero);
  return flattenNodes(nodesOf(tree));
}
