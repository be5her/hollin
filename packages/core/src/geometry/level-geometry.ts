import type { Entity, EntityOf } from '../doc/schema';
import { differencePolygons } from './clip';
import { openingFrame } from './openings';
import type { Polygon } from './polygon';
import { joinWalls, junctionNodes, junctionPatches, wallBody, wallEnds, type WallBody, type WallEnd } from './walls';

export type Wall = EntityOf<'wall'>;
export type Opening = EntityOf<'opening'>;

/** What a level's walls derive to. */
export interface LevelWalls {
  bodies: Map<string, WallBody>;
  nodes: WallEnd[][];
  patches: Polygon[];
  /** The joined bodies without openings (what encloses rooms): outlines counter-clockwise, holes clockwise. */
  joined: Polygon[];
  /** The joined bodies with the openings cut out: what is drawn. */
  cut: Polygon[];
}

export interface LevelGeometry {
  walls: LevelWalls;
}

export interface DeriveOptions {
  /** Walls left out (hidden layers, a drag preview's walls); their openings go with them. */
  exclude?: ReadonlySet<string>;
  /** The level's openings, cut out of the drawn walls. */
  openings?: readonly Opening[];
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
  const cuts: Polygon[] = [];
  for (const o of options.openings ?? []) {
    const wall = byId.get(o.wallId);
    if (wall) cuts.push(openingFrame(wall, o).cut);
  }
  const cut = cuts.length ? differencePolygons(joined, cuts) : joined;
  return { bodies, nodes, patches, joined, cut };
}

/**
 * Everything derived from a level's entities, uncached: the caller decides what to memoise (the
 * renderer keys a cache on object identity; main derives afresh because a transaction mutates a
 * level's record in place while a batch runs).
 */
export function deriveLevelGeometry(entities: Record<string, Entity>, options: DeriveOptions = {}): LevelGeometry {
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  for (const id in entities) {
    const e = entities[id];
    if (e.type === 'wall') walls.push(e);
    else if (e.type === 'opening') openings.push(e);
  }
  return { walls: deriveWalls(walls, { openings, ...options }) };
}
