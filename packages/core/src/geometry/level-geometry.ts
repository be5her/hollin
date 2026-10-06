import type { Entity, EntityOf } from '../doc/schema';
import type { Polygon } from './polygon';
import { joinWalls, junctionNodes, junctionPatches, wallBody, wallEnds, type WallBody, type WallEnd } from './walls';

export type Wall = EntityOf<'wall'>;

/** What a level's walls derive to. */
export interface LevelWalls {
  bodies: Map<string, WallBody>;
  nodes: WallEnd[][];
  patches: Polygon[];
  /** The joined bodies: outlines counter-clockwise, holes clockwise. */
  joined: Polygon[];
}

export interface LevelGeometry {
  walls: LevelWalls;
}

export interface DeriveOptions {
  /** Walls left out of the joined drawing (hidden layers, a drag preview's walls); they still take part in nothing here. */
  exclude?: ReadonlySet<string>;
  /** A memoised body per wall, supplied by a cache; otherwise bodies are computed afresh. */
  bodyOf?: (wall: Wall) => WallBody;
}

/** Derives the joined walls of a set of walls. */
export function deriveWalls(walls: readonly Wall[], options: DeriveOptions = {}): LevelWalls {
  const included = options.exclude ? walls.filter((w) => !options.exclude!.has(w.id)) : [...walls];
  const bodyOf = options.bodyOf ?? wallBody;
  const bodies = new Map<string, WallBody>();
  const byId = new Map<string, Wall>();
  for (const w of included) {
    bodies.set(w.id, bodyOf(w));
    byId.set(w.id, w);
  }
  const nodes = junctionNodes(wallEnds(included));
  const patches = junctionPatches(nodes, byId);
  const joined = joinWalls(
    [...bodies.values()].map((b) => b.polygons),
    patches,
  );
  return { bodies, nodes, patches, joined };
}

/**
 * Everything derived from a level's entities, uncached: the caller decides what to memoise (the
 * renderer keys a cache on object identity; main derives afresh because a transaction mutates a
 * level's record in place while a batch runs).
 */
export function deriveLevelGeometry(entities: Record<string, Entity>, options: DeriveOptions = {}): LevelGeometry {
  const walls: Wall[] = [];
  for (const id in entities) {
    const e = entities[id];
    if (e.type === 'wall') walls.push(e);
  }
  return { walls: deriveWalls(walls, options) };
}
