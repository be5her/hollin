import { columnPolygon, distance, flatten, openingFrame, polygonContains, polygonEdgeDistance, regionContains, wallBody, type Box, type Entity, type EntityType, type Layer, type LevelWalls, type Polygon, type Region, type Vec2 } from '@studio/core';
import { searchScene, type LevelScene, type SceneItem } from './scene';

export interface Hit {
  id: string;
  type: EntityType;
  /** 0 inside the entity, else the distance to its outline (mm). */
  distance: number;
}

export interface HitOptions {
  /** How far from an outline still counts, in mm (a few pixels at the current zoom). */
  tolerance: number;
  layers: Record<string, Layer>;
  /** The derived walls, so wall bodies need not be recomputed. */
  walls: LevelWalls | null;
}

/** Smaller things first, then what they sit on; rooms and slabs last, so a click inside a room picks a wall or a door before the room. */
const PRIORITY: Record<EntityType, number> = { opening: 0, dimension: 1, label: 1, column: 2, fixture: 2, point: 2, item: 2, light: 2, wall: 3, void: 5, shaft: 5, room: 6, slab: 7 };

const GLYPH = 100;

const segmentDistance = (a: Vec2, b: Vec2, p: Vec2): number => polygonEdgeDistance([a, b], p);

function regionDistance(region: Region, p: Vec2, tolerance: number): number | null {
  if (regionContains(region, p)) return 0;
  const d = Math.min(polygonEdgeDistance(flatten(region.outer, 1), p), ...region.holes.map((h) => polygonEdgeDistance(flatten(h, 1), p)));
  return d <= tolerance ? d : null;
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
      const d = distance(e.boundary.seed, p);
      return d <= tol * 2 ? d : null;
    }
    case 'fixture':
    case 'point':
    case 'item':
    case 'light': {
      const d = distance([e.at[0], e.at[1]], p);
      return d <= Math.max(tol, GLYPH) ? d : null;
    }
    case 'dimension': {
      const dx = e.to[0] - e.from[0];
      const dy = e.to[1] - e.from[1];
      const len = Math.hypot(dx, dy) || 1;
      const n: Vec2 = [(-dy / len) * e.offset, (dx / len) * e.offset];
      const a: Vec2 = [e.from[0] + n[0], e.from[1] + n[1]];
      const b: Vec2 = [e.to[0] + n[0], e.to[1] + n[1]];
      const d = Math.min(segmentDistance(a, b, p), segmentDistance(e.from, a, p), segmentDistance(e.to, b, p));
      return d <= tol ? d : null;
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
  return ids;
}

export const isEntityOnLevel = (entities: Record<string, Entity>, id: string): boolean => id in entities;
