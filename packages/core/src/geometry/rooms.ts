import type { Entity, EntityOf } from '../doc/schema';
import { closePolygons, flattenNodes, inflateLines, polygonOf, regionPolygons, unionTree, type ClipNode } from './clip';
import type { LevelWalls } from './level-geometry';
import { columnPolygon } from './openings';
import { flatten, pathLength, regionArea, type Region } from './path';
import { polygonArea, polygonBox, polygonCentroid, polygonContains, polygonPerimeter, type Polygon } from './polygon';
import type { Vec2 } from './vec';

export type Room = EntityOf<'room'>;
export type Separator = EntityOf<'separator'>;
export type Column = EntityOf<'column'>;

/** An enclosed space: a hole in the solids, with the solids standing inside it. */
export interface Cavity {
  /** Counter-clockwise. */
  polygon: Polygon;
  /** Clockwise. */
  islands: Polygon[];
  area: number;
  perimeter: number;
}

/** What a room resolves to on the plan. */
export interface RoomGeometry {
  id: string;
  /** False for a detected room whose seed is not inside any enclosed space. */
  enclosed: boolean;
  /** Counter-clockwise outline, when enclosed or drawn. */
  polygon: Polygon | null;
  /** Clockwise holes (islands inside the space). */
  holes: Polygon[];
  /** Net floor area in mm² (0 when not enclosed). */
  area: number;
  perimeter: number;
  /** Where the name and area are written. */
  labelAt: Vec2;
  /** The id of the room that claimed the same space first, when two seeds share one. */
  shared?: string;
}

/** Room dividers are a hair wide so they split the space without changing its area to speak of. */
const SEPARATOR_HALF_WIDTH = 0.5;
/** Gaps narrower than twice this close: a wall snapped to another wall's face still encloses. */
const CLOSING = 1;

/** The solids rooms are enclosed by: the joined walls, columns and room dividers. */
export function roomSolids(walls: LevelWalls, columns: readonly Column[], separators: readonly Separator[]): Polygon[] {
  const solids: Polygon[] = [...walls.joined];
  for (const c of columns) solids.push(columnPolygon(c));
  const lines = separators.map((s) => flatten(s.path, 0.5)).filter((l) => l.length >= 2);
  if (lines.length) solids.push(...inflateLines(lines, SEPARATOR_HALF_WIDTH, 'square'));
  return solids;
}

/** Every enclosed space in the solids, at every depth (a closet inside a room is one too). */
export function cavitiesOf(solids: readonly Polygon[]): Cavity[] {
  if (!solids.length) return [];
  const closed = closePolygons([...solids], CLOSING);
  const tree = unionTree(closed);
  const out: Cavity[] = [];
  const walk = (nodes: ClipNode[]) => {
    for (const outer of nodes) {
      for (const hole of outer.children) {
        if (!hole.hole) continue;
        const islands = hole.children.map((n) => n.polygon);
        out.push({ polygon: hole.polygon, islands, area: Math.abs(polygonArea(hole.polygon)) - islands.reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0), perimeter: polygonPerimeter(hole.polygon) });
        walk(hole.children);
      }
    }
  };
  walk(tree);
  return out;
}

const inCavity = (c: Cavity, p: Vec2): boolean => polygonContains(c.polygon, p) && !c.islands.some((i) => polygonContains(i, p));

/** The cavity a point lies in, or null. */
export function cavityAt(cavities: readonly Cavity[], p: Vec2): Cavity | null {
  // The smallest containing cavity wins (a closet before the room around it).
  let best: Cavity | null = null;
  for (const c of cavities) if (inCavity(c, p) && (!best || c.area < best.area)) best = c;
  return best;
}

/**
 * A point to write a label at: the centroid when it lies inside, else the box centre, else the middle
 * of the widest stretch of the inside along a few horizontal lines (a ring corridor's centroid and box
 * centre both fall in the island it runs round).
 */
export function labelPoint(polygon: Polygon, holes: readonly Polygon[]): Vec2 {
  const inside = (p: Vec2) => polygonContains(polygon, p) && !holes.some((h) => polygonContains(h, p));
  const centroid = polygonCentroid(polygon);
  if (inside(centroid)) return centroid;
  const box = polygonBox(polygon);
  const centre: Vec2 = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  if (inside(centre)) return centre;
  let best: Vec2 | null = null;
  let widest = 0;
  // Lines a little off the round fractions, so they rarely pass through a vertex.
  for (const t of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
    const y = box.minY + (box.maxY - box.minY) * (t + 1e-4);
    const xs: number[] = [];
    for (const ring of [polygon, ...holes]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j];
        const [x1, y1] = ring[i];
        if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    // Between every other pair of crossings the line is inside.
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const p: Vec2 = [(xs[i] + xs[i + 1]) / 2, y];
      if (xs[i + 1] - xs[i] > widest && inside(p)) {
        widest = xs[i + 1] - xs[i];
        best = p;
      }
    }
  }
  return best ?? polygon[0] ?? centroid;
}

/** Resolves every room of a level: detected rooms from the cavity their seed lies in, drawn rooms from their region. */
export function detectRooms(rooms: readonly Room[], cavities: readonly Cavity[]): Map<string, RoomGeometry> {
  const out = new Map<string, RoomGeometry>();
  const claimed = new Map<Cavity, string>();
  for (const room of rooms) {
    if (room.boundary.k === 'region') {
      const region = room.boundary.region;
      const [outer, ...holes] = regionPolygons(region);
      out.set(room.id, { id: room.id, enclosed: true, polygon: outer, holes, area: regionArea(region), perimeter: pathLength(region.outer), labelAt: labelPoint(outer, holes) });
      continue;
    }
    const seed = room.boundary.seed;
    const cavity = cavityAt(cavities, seed);
    if (!cavity) {
      out.set(room.id, { id: room.id, enclosed: false, polygon: null, holes: [], area: 0, perimeter: 0, labelAt: seed });
      continue;
    }
    const first = claimed.get(cavity);
    if (!first) claimed.set(cavity, room.id);
    out.set(room.id, { id: room.id, enclosed: true, polygon: cavity.polygon, holes: cavity.islands, area: first ? 0 : cavity.area, perimeter: cavity.perimeter, labelAt: seed, ...(first ? { shared: first } : {}) });
  }
  return out;
}

/** Cavities no room claims yet, big enough to be rooms and not shafts or voids. */
export function unclaimedCavities(cavities: readonly Cavity[], rooms: ReadonlyMap<string, RoomGeometry>, entities: Record<string, Entity>, minArea = 500_000): Cavity[] {
  const claimed = new Set<Polygon>();
  for (const r of rooms.values()) if (r.polygon) claimed.add(r.polygon);
  const voids: Region[] = [];
  for (const id in entities) {
    const e = entities[id];
    if (e.type === 'shaft' || e.type === 'void') voids.push(e.region);
  }
  return cavities.filter((c) => {
    if (claimed.has(c.polygon) || c.area < minArea) return false;
    const at = labelPoint(c.polygon, c.islands);
    return !voids.some((v) => polygonContains(polygonOf(v.outer), at));
  });
}

/** The automatic slab: the outlines of the walls' union that enclose something, holes filled. */
export function autoSlab(walls: LevelWalls): Polygon[] {
  return unionTree([...walls.joined])
    .filter((outer) => outer.children.some((c) => c.hole))
    .map((outer) => outer.polygon);
}

export { flattenNodes };
