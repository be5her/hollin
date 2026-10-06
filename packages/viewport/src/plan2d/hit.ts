import { columnPolygon, dimensionGeometry, dimensionOutline, distance, flatten, openingFrame, polygonContains, polygonEdgeDistance, regionContains, resolveDimension, wallBody, type Box, type Entity, type EntityType, type Layer, type LevelGeometry, type LevelWalls, type Polygon, type Region, type Vec2 } from '@studio/core';
import { connectorDistance, type PlanConnector } from './connectors';
import { searchScene, type LevelScene, type SceneItem } from './scene';

export interface Hit {
  id: string;
  /** The entity's type, or 'connector' for a stair, ramp, ladder, elevator or escalator. */
  type: EntityType | 'connector';
  /** 0 inside the entity, else the distance to its outline (mm). */
  distance: number;
}

export interface HitOptions {
  /** How far from an outline still counts, in mm (a few pixels at the current zoom). */
  tolerance: number;
  layers: Record<string, Layer>;
  /** The derived walls, so wall bodies need not be recomputed. */
  walls: LevelWalls | null;
  /** The level's geometry, so a detected room is hit anywhere in its space. */
  geometry?: LevelGeometry | null;
  /** The connectors the level shows: hit anywhere on their footprint. They are on no layer, so never hidden or locked. */
  connectors?: readonly PlanConnector[];
}

/** Smaller things first, then what they sit on; rooms and slabs last, so a click inside a room picks a wall or a door before the room. */
const PRIORITY: Record<EntityType | 'connector', number> = { opening: 0, dimension: 1, label: 1, column: 2, fixture: 2, point: 2, item: 2, light: 2, connector: 2.5, separator: 3, wall: 3, shape: 4, void: 5, shaft: 5, room: 6, slab: 7 };

const GLYPH = 100;

function regionDistance(region: Region, p: Vec2, tolerance: number): number | null {
  if (regionContains(region, p)) return 0;
  const d = Math.min(polygonEdgeDistance(flatten(region.outer, 1), p), ...region.holes.map((h) => polygonEdgeDistance(flatten(h, 1), p)));
  return d <= tolerance ? d : null;
}

/** The distance to an open polyline (its closing edge does not count). */
function polylineDistance(pts: readonly Vec2[], p: Vec2, tolerance: number): number | null {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, polygonEdgeDistance([pts[i - 1], pts[i]], p));
  return best <= tolerance ? best : null;
}

function polygonsDistance(polys: readonly Polygon[], p: Vec2, tolerance: number): number | null {
  const inside = polys.filter((poly) => polygonContains(poly, p)).length % 2 === 1;
  if (inside) return 0;
  const d = Math.min(...polys.map((poly) => polygonEdgeDistance(poly, p)));
  return d <= tolerance ? d : null;
}

/** How far the point is from the entity, or null when it misses. */
export function entityDistance(item: SceneItem, p: Vec2, scene: LevelScene, options: HitOptions): number | null {
  const e = item.entity;
  const tol = options.tolerance;
  switch (e.type) {
    case 'wall': {
      const body = options.walls?.bodies.get(e.id) ?? wallBody(e);
      return polygonsDistance(body.polygons, p, tol);
    }
    case 'opening': {
      const wall = scene.items.get(e.wallId)?.entity;
      if (!wall || wall.type !== 'wall') return null;
      return polygonsDistance([openingFrame(wall, e).cut], p, tol);
    }
    case 'column':
      return polygonsDistance([columnPolygon(e)], p, tol);
    case 'slab':
      return e.source.k === 'region' ? regionDistance(e.source.region, p, tol) : null;
    case 'void':
    case 'shaft':
      return regionDistance(e.region, p, tol);
    case 'room': {
      if (e.boundary.k === 'region') return regionDistance(e.boundary.region, p, tol);
      const geometry = options.geometry?.rooms.get(e.id);
      if (geometry?.polygon && polygonContains(geometry.polygon, p) && !geometry.holes.some((h) => polygonContains(h, p))) return 0;
      const d = distance(e.boundary.seed, p);
      return d <= tol * 2 ? d : null;
    }
    case 'separator':
      return polylineDistance(flatten(e.path, 1), p, tol);
    case 'shape': {
      const pts = flatten(e.path, 1);
      if (!e.path.closed) return polylineDistance(pts, p, tol);
      if (e.filled && polygonContains(pts, p)) return 0;
      const d = polygonEdgeDistance(pts, p);
      return d <= tol ? d : null;
    }
    case 'fixture':
    case 'point':
    case 'item':
    case 'light': {
      const d = distance([e.at[0], e.at[1]], p);
      return d <= Math.max(tol, GLYPH) ? d : null;
    }
    case 'dimension': {
      const points = resolveDimension(e, (id) => scene.items.get(id)?.entity, (w) => options.walls?.bodies.get(w.id) ?? wallBody(w));
      const g = dimensionGeometry(e, points, null);
      let best = Infinity;
      for (const pts of dimensionOutline(g)) best = Math.min(best, polylineDistance(pts, p, Infinity) ?? Infinity);
      return best <= tol ? best : null;
    }
    case 'label': {
      const halfW = Math.max(e.size, e.text.length * e.size * 0.3);
      const inside = Math.abs(p[0] - e.at[0]) <= halfW + tol && Math.abs(p[1] - e.at[1]) <= e.size / 2 + tol;
      return inside ? 0 : null;
    }
  }
}

function visible(item: SceneItem, options: HitOptions): boolean {
  const layer = options.layers[item.layerId];
  return !layer || (layer.visible && !layer.locked);
}

/** Every entity under the point, nearest and smallest first. Hidden and locked layers are skipped. */
export function hitAll(scene: LevelScene, p: Vec2, options: HitOptions): Hit[] {
  const t = options.tolerance;
  const hits: Hit[] = [];
  for (const item of searchScene(scene, { minX: p[0] - t, minY: p[1] - t, maxX: p[0] + t, maxY: p[1] + t })) {
    if (!visible(item, options)) continue;
    const d = entityDistance(item, p, scene, options);
    if (d !== null) hits.push({ id: item.id, type: item.type, distance: d });
  }
  for (const pc of options.connectors ?? []) {
    if (p[0] < pc.box.minX - t || p[0] > pc.box.maxX + t || p[1] < pc.box.minY - t || p[1] > pc.box.maxY + t) continue;
    const d = connectorDistance(pc, p, t);
    if (d !== null) hits.push({ id: pc.id, type: 'connector', distance: d });
  }
  return hits.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.distance - b.distance);
}

export function hitTest(scene: LevelScene, p: Vec2, options: HitOptions): Hit | null {
  return hitAll(scene, p, options)[0] ?? null;
}

/** A window selection takes what lies fully inside the box; a crossing selection what touches it. Boxes are the entities' extents. */
export function marqueeSelect(scene: LevelScene, box: Box, mode: 'window' | 'crossing', options: HitOptions): string[] {
  const ids: string[] = [];
  for (const item of searchScene(scene, box)) {
    if (!visible(item, options)) continue;
    const inside = item.minX >= box.minX && item.maxX <= box.maxX && item.minY >= box.minY && item.maxY <= box.maxY;
    if (mode === 'window' ? inside : true) ids.push(item.id);
  }
  for (const pc of options.connectors ?? []) {
    const b = pc.box;
    const inside = b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
    const touches = b.maxX >= box.minX && b.minX <= box.maxX && b.maxY >= box.minY && b.minY <= box.maxY;
    if (mode === 'window' ? inside : touches) ids.push(pc.id);
  }
  return ids;
}

export const isEntityOnLevel = (entities: Record<string, Entity>, id: string): boolean => id in entities;
