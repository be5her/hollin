import type { Entity, EntityOf } from '../doc/schema';
import { differencePolygons, regionPolygons } from './clip';
import { openingFrame } from './openings';
import type { Polygon } from './polygon';
import { autoSlab, cavitiesOf, detectRooms, roomSolids, type Cavity, type RoomGeometry } from './rooms';
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

/** Everything a level's entities derive to. */
export interface LevelGeometry {
  walls: LevelWalls;
  /** The enclosed spaces (every hole in the solids, at every depth). */
  cavities: Cavity[];
  rooms: Map<string, RoomGeometry>;
  /** The automatic slab: outlines of the walls that enclose something, holes filled, with the connector openings cut out. */
  slab: Polygon[];
  /** Each drawn slab (a region) with the connector openings cut out. */
  slabRegions: Map<string, Polygon[]>;
  /** The connector openings cut out of this level's slabs (see `connectorCuts`). */
  cuts: Polygon[];
  /** The slab entities that follow the walls (they have no outline of their own), with their layers. */
  autoSlabs: { id: string; layerId: string }[];
}

export interface DeriveOptions {
  /** Walls left out (hidden layers, a drag preview's walls); their openings go with them. */
  exclude?: ReadonlySet<string>;
  /** The level's openings, cut out of the drawn walls. */
  openings?: readonly Opening[];
  /** A memoised body per wall, supplied by a cache; otherwise bodies are computed afresh. */
  bodyOf?: (wall: Wall) => WallBody;
  /** Openings cut out of the level's slabs: the stairwells and shafts of the connectors passing through its floor (`connectorCuts`). */
  cuts?: readonly Polygon[];
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

/** Rooms, cavities and the slabs from a level's entities and its derived walls, with cuts taken out of the slabs. */
export function deriveRooms(entities: Record<string, Entity>, walls: LevelWalls, cuts: readonly Polygon[] = []): Pick<LevelGeometry, 'cavities' | 'rooms' | 'slab' | 'slabRegions' | 'cuts' | 'autoSlabs'> {
  const rooms: EntityOf<'room'>[] = [];
  const columns: EntityOf<'column'>[] = [];
  const separators: EntityOf<'separator'>[] = [];
  const autoSlabs: { id: string; layerId: string }[] = [];
  const slabRegions = new Map<string, Polygon[]>();
  for (const id in entities) {
    const e = entities[id];
    if (e.type === 'room') rooms.push(e);
    else if (e.type === 'column') columns.push(e);
    else if (e.type === 'separator') separators.push(e);
    else if (e.type === 'slab') {
      if (e.source.k === 'auto') autoSlabs.push({ id: e.id, layerId: e.layerId });
      else slabRegions.set(e.id, regionPolygons(e.source.region));
    }
  }
  const cavities = cavitiesOf(roomSolids(walls, columns, separators));
  return cutSlabs({ cavities, rooms: detectRooms(rooms, cavities), slab: autoSlabs.length ? autoSlab(walls) : [], slabRegions, cuts: [], autoSlabs }, cuts);
}

/** The same slabs with cuts (connector openings) taken out; everything else is shared. */
export function cutSlabs<T extends Pick<LevelGeometry, 'slab' | 'slabRegions' | 'cuts'>>(geometry: T, cuts: readonly Polygon[]): T {
  if (!cuts.length) return geometry.cuts.length ? { ...geometry, cuts: [] } : geometry;
  const cut = (polys: Polygon[]) => (polys.length ? differencePolygons(polys, [...cuts]) : polys);
  return { ...geometry, slab: cut(geometry.slab), slabRegions: new Map([...geometry.slabRegions].map(([id, polys]) => [id, cut(polys)])), cuts: [...cuts] };
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
  const derivedWalls = deriveWalls(walls, { openings, ...options });
  return { walls: derivedWalls, ...deriveRooms(entities, derivedWalls, options.cuts) };
}
