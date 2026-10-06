import { inflateLines, intersectPolygons, polygonOf, unionPolygons } from './clip';
import { extendPathEnd, offsetPath } from './offset';
import { flatten, pathBox, reversePath, type Path } from './path';
import { orient, polygonArea, polygonBox, type Polygon } from './polygon';
import { distance, type Box, type Vec2 } from './vec';

export interface WallLike {
  path: Path;
  thickness: number;
  alignment: 'center' | 'left' | 'right';
}

/** The signed distances of a wall's two faces from its reference line (positive = left, looking along the path). */
export function wallOffsets(wall: Pick<WallLike, 'thickness' | 'alignment'>): { left: number; right: number } {
  const t = wall.thickness;
  if (wall.alignment === 'left') return { left: t, right: 0 };
  if (wall.alignment === 'right') return { left: 0, right: -t };
  return { left: t / 2, right: -t / 2 };
}

/** A wall's body on the plan. */
export interface WallBody {
  /** The body as polygons for booleans and filling: one for an open wall, outline plus hole for a closed one. Outlines counter-clockwise, holes clockwise. */
  polygons: Polygon[];
  /** The exact faces (lines and arcs) when the offset could be computed exactly, for snapping and anchors. */
  faces: { left: Path | null; right: Path | null };
  /** False when the body came from a flattened offset (curved Bézier walls, or an offset that vanished). */
  exact: boolean;
  box: Box;
}

const TOLERANCE = 0.25;

/** The body of a wall: the area between its two faces. */
export function wallBody(wall: WallLike): WallBody {
  const { left, right } = wallOffsets(wall);
  const leftFace = offsetPath(wall.path, left);
  const rightFace = offsetPath(wall.path, right);
  if (leftFace && rightFace) {
    let polygons: Polygon[];
    if (wall.path.closed) {
      const a = flatten(leftFace, TOLERANCE);
      const b = flatten(rightFace, TOLERANCE);
      const [outer, inner] = Math.abs(polygonArea(a)) >= Math.abs(polygonArea(b)) ? [a, b] : [b, a];
      polygons = [orient(outer, true), orient(inner, false)];
    } else {
      polygons = [orient([...flatten(leftFace, TOLERANCE), ...flatten(reversePath(rightFace), TOLERANCE)], true)];
    }
    return { polygons, faces: { left: leftFace, right: rightFace }, exact: true, box: polygonBox(polygons[0]) };
  }
  // Fallback: a flattened offset of the reference line, shifted to the body's middle when the wall is not centred.
  const middle = (left + right) / 2;
  const centre = middle === 0 ? wall.path : (offsetPath(wall.path, middle) ?? wall.path);
  const line = flatten(centre, TOLERANCE);
  const polygons = wall.path.closed ? unionPolygons(inflateLines([[...line, line[0]]], wall.thickness / 2, 'butt')) : inflateLines([line], wall.thickness / 2, 'butt');
  const box = polygons.length ? polygonBox(polygons[0]) : pathBox(wall.path);
  return { polygons, faces: { left: leftFace, right: rightFace }, exact: false, box };
}

/** One end of an open wall. */
export interface WallEnd {
  id: string;
  end: 'start' | 'end';
  point: Vec2;
  thickness: number;
}

export function wallEnds(walls: readonly (WallLike & { id: string })[]): WallEnd[] {
  const ends: WallEnd[] = [];
  for (const w of walls) {
    if (w.path.closed || w.path.v.length < 2) continue;
    ends.push({ id: w.id, end: 'start', point: w.path.v[0].p, thickness: w.thickness }, { id: w.id, end: 'end', point: w.path.v[w.path.v.length - 1].p, thickness: w.thickness });
  }
  return ends;
}

/** Wall ends that meet (within `tolerance` mm), grouped: the junctions where separate walls join. */
export function junctionNodes(ends: readonly WallEnd[], tolerance = 1): WallEnd[][] {
  const cell = Math.max(tolerance * 4, 1);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  ends.forEach((e, i) => {
    const k = key(e.point[0], e.point[1]);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });
  const seen = new Array<boolean>(ends.length).fill(false);
  const nodes: WallEnd[][] = [];
  for (let i = 0; i < ends.length; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    const node = [ends[i]];
    const cx = Math.floor(ends[i].point[0] / cell);
    const cy = Math.floor(ends[i].point[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (seen[j] || distance(ends[i].point, ends[j].point) > tolerance) continue;
          seen[j] = true;
          node.push(ends[j]);
        }
      }
    }
    if (node.length > 1) nodes.push(node);
  }
  return nodes;
}

/**
 * The corner fills at junctions: for every pair of wall ends that meet, the overlap of the two
 * walls carried on past the node (by twice the thickest wall there). For straight walls that is
 * exactly the quadrilateral bounded by the four face lines, so an L corner is filled to its miter
 * at any angle and thickness mix; very sharp angles bevel, and arc ends carry on tangentially.
 */
export function junctionPatches(nodes: readonly WallEnd[][], walls: ReadonlyMap<string, WallLike>, skip?: ReadonlySet<string>): Polygon[] {
  const patches: Polygon[] = [];
  for (const node of nodes) {
    const by = 2 * Math.max(...node.map((e) => e.thickness));
    const extended = node.map((e) => {
      const wall = walls.get(e.id);
      return wall ? wallBody({ ...wall, path: extendPathEnd(wall.path, e.end, by) }).polygons : [];
    });
    for (let i = 0; i < node.length; i++) {
      for (let j = i + 1; j < node.length; j++) {
        if (skip && (skip.has(node[i].id) || skip.has(node[j].id))) continue;
        for (const p of intersectPolygons(extended[i], extended[j])) if (Math.abs(polygonArea(p)) > 1) patches.push(p);
      }
    }
  }
  return patches;
}

/** The joined bodies of a level's walls: the union of the bodies and the junction patches. */
export function joinWalls(bodies: readonly Polygon[][], patches: readonly Polygon[]): Polygon[] {
  const all = [...bodies.flat(), ...patches];
  return all.length ? unionPolygons(all) : [];
}

export { polygonOf };
