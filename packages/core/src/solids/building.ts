import type { RuleLimits } from '../config';
import { deriveLevels, entitiesOnLevel, levelCeiling, type DerivedLevel } from '../doc/derive';
import type { Entity, EntityOf, ProjectDoc } from '../doc/schema';
import { differencePolygons, regionPolygons, unionPolygons } from '../geometry/clip';
import { connectorCuts } from '../geometry/connectors';
import { deriveRooms, deriveWalls, type Wall } from '../geometry/level-geometry';
import { columnPolygon, openingFrame } from '../geometry/openings';
import type { Polygon } from '../geometry/polygon';
import { add, scale } from '../geometry/vec';
import type { WallBody } from '../geometry/walls';
import { deriveConnectorsSolids, type ConnectorSolids } from './connectors';
import { MeshBuilder, type Mesh } from './mesh';

/** What a part of the building is made of: the 3D view gives each its own material. Connectors are stairs, ramps and escalators; rails their handrails and ladders; car an elevator's car. */
export type SolidKind = 'wall' | 'slab' | 'column' | 'glass' | 'connector' | 'rail' | 'car';

/** A mesh of one kind and the entities it was built from (a level's walls are joined into one). */
export interface SolidPart {
  kind: SolidKind;
  mesh: Mesh;
  ids: string[];
}

/** The level's walls over a range of heights where nothing changes: their footprint, openings cut out. */
export interface WallBand {
  z0: number;
  z1: number;
  footprint: Polygon[];
}

/** Everything a level builds in 3D. */
export interface LevelSolids {
  levelId: string;
  /** Its floor, mm. */
  elevation: number;
  /** Where its walls of full height stop: the underside of the floor above (its top when nothing sits on it). */
  ceiling: number;
  parts: SolidPart[];
  /** The walls band by band, bottom to top, for walking and collisions. */
  bands: WallBand[];
  /** The slabs' top faces at the floor's elevation, connector openings, voids and shafts cut out. */
  floor: Polygon[];
}

export interface SolidsOptions {
  limits: RuleLimits;
  /** The levels' elevations, when the caller has them already. */
  levels?: readonly DerivedLevel[];
  /** Cuts the level's walls and columns this far above its floor (the cutaway view). */
  cutHeight?: number;
  /** A memoised body per wall, supplied by a cache; otherwise bodies are computed afresh. */
  bodyOf?: (wall: Wall) => WallBody;
}

/** How thick a window's glass is drawn, mm. */
const GLASS = 12;
const EPS = 1e-6;

const shown = (doc: ProjectDoc, e: Entity) => doc.layers[e.layerId]?.visible !== false;

/**
 * A level in 3D, pure data: its walls extruded band by band (every height where a wall starts or
 * stops or an opening's sill or head lies splits them, each band is the joined walls present over it
 * minus the openings spanning it, and the caps between bands are their differences, so sills,
 * lintels and wall tops are exact), window glass, columns, and its slabs below the floor with the
 * connector openings, voids and shafts cut out. Entities on hidden layers are left out, as on the plan.
 */
export function deriveLevelSolids(doc: ProjectDoc, levelId: string, options: SolidsOptions): LevelSolids {
  const levels = options.levels ?? deriveLevels(doc);
  const level = levels.find((l) => l.id === levelId);
  const entities = doc.levelData[levelId]?.entities ?? {};
  if (!level) return { levelId, elevation: 0, ceiling: 0, parts: [], bands: [], floor: [] };
  const e0 = level.elevation;
  const ceiling = levelCeiling(level, levels);
  const cutAt = options.cutHeight !== undefined ? e0 + options.cutHeight : Infinity;

  const walls: Wall[] = [];
  const openings: EntityOf<'opening'>[] = [];
  const columns: EntityOf<'column'>[] = [];
  for (const id in entities) {
    const e = entities[id];
    if (e.type === 'wall') walls.push(e);
    else if (e.type === 'opening') openings.push(e);
    else if (e.type === 'column' && shown(doc, e)) columns.push(e);
  }
  const visible = walls.filter((w) => shown(doc, w));
  const all = deriveWalls(walls, { bodyOf: options.bodyOf });
  const parts: SolidPart[] = [];

  // ---------- walls, band by band ----------
  const spans = visible
    .map((wall) => {
      const z0 = e0 + wall.baseOffset;
      return { wall, z0, z1: Math.min(wall.height !== null ? z0 + wall.height : ceiling, cutAt) };
    })
    .filter((s) => s.z1 > s.z0 + EPS);
  const byWall = new Map(spans.map((s) => [s.wall.id, s]));
  const holes = openings.flatMap((o) => {
    const span = byWall.get(o.wallId);
    if (!span) return [];
    const z0 = Math.max(span.z0, e0 + o.sill);
    const z1 = Math.min(span.z1, e0 + o.sill + o.height);
    return z1 > z0 + EPS ? [{ opening: o, wall: span.wall, z0, z1, cut: openingFrame(span.wall, o).cut }] : [];
  });
  const breaks = [...new Set([...spans.flatMap((s) => [s.z0, s.z1]), ...holes.flatMap((h) => [h.z0, h.z1])])].sort((a, b) => a - b);
  const joinedBy = new Map<string, Polygon[]>();
  if (visible.length === walls.length) joinedBy.set(walls.map((w) => w.id).sort().join(','), all.joined);
  const bands: WallBand[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const z0 = breaks[i];
    const z1 = breaks[i + 1];
    const present = spans.filter((s) => s.z0 <= z0 + EPS && s.z1 >= z1 - EPS);
    if (!present.length) {
      bands.push({ z0, z1, footprint: [] });
      continue;
    }
    const key = present.map((s) => s.wall.id).sort().join(',');
    let joined = joinedBy.get(key);
    if (!joined) {
      joined = deriveWalls(
        present.map((s) => s.wall),
        { bodyOf: options.bodyOf },
      ).joined;
      joinedBy.set(key, joined);
    }
    const ids = new Set(present.map((s) => s.wall.id));
    const cuts = holes.filter((h) => ids.has(h.wall.id) && h.z0 <= z0 + EPS && h.z1 >= z1 - EPS).map((h) => h.cut);
    bands.push({ z0, z1, footprint: cuts.length ? differencePolygons(joined, cuts) : joined });
  }
  const wallMesh = new MeshBuilder();
  bands.forEach((band, i) => {
    if (!band.footprint.length) return;
    const above = bands[i + 1]?.footprint ?? [];
    const below = bands[i - 1]?.footprint ?? [];
    wallMesh
      .sides(band.footprint, band.z0, band.z1)
      .cap(above.length ? differencePolygons(band.footprint, above) : band.footprint, band.z1, true)
      .cap(below.length ? differencePolygons(band.footprint, below) : band.footprint, band.z0, false);
  });
  if (!wallMesh.empty) parts.push({ kind: 'wall', mesh: wallMesh.build(), ids: spans.map((s) => s.wall.id) });

  // ---------- window glass: a thin pane in the middle of the wall ----------
  const glass = new MeshBuilder();
  const panes: string[] = [];
  for (const h of holes) {
    if (h.opening.kind !== 'window') continue;
    const f = openingFrame(h.wall, h.opening);
    const mid = (f.across.left + f.across.right) / 2;
    const [a, b] = f.jambs;
    const pane: Polygon = [add(a, scale(f.normal, mid - GLASS / 2)), add(b, scale(f.normal, mid - GLASS / 2)), add(b, scale(f.normal, mid + GLASS / 2)), add(a, scale(f.normal, mid + GLASS / 2))];
    glass.prism([pane], h.z0, h.z1);
    panes.push(h.opening.id);
  }
  if (!glass.empty) parts.push({ kind: 'glass', mesh: glass.build(), ids: panes });

  // ---------- columns ----------
  const columnMesh = new MeshBuilder();
  const columnIds: string[] = [];
  for (const c of columns) {
    const z0 = e0 + (c.span?.baseOffset ?? 0);
    const topLevel = c.span ? levels.find((l) => l.id === c.span!.topLevelId) : undefined;
    const z1 = Math.min(topLevel ? topLevel.elevation + c.span!.topOffset : ceiling, cutAt);
    if (z1 <= z0 + EPS) continue;
    columnMesh.prism([columnPolygon(c)], z0, z1);
    columnIds.push(c.id);
  }
  if (!columnMesh.empty) parts.push({ kind: 'column', mesh: columnMesh.build(), ids: columnIds });

  // ---------- slabs, below the floor ----------
  const cuts = [...connectorCuts(doc, levelId, options.limits, [...levels])];
  for (const e of entitiesOnLevel(doc, levelId)) {
    // A void opens the floors it shows on; a shaft every floor above the one it starts from.
    if (e.type === 'void' || (e.type === 'shaft' && e.levelId !== levelId)) cuts.push(...regionPolygons(e.region));
  }
  const slabs = deriveRooms(entities, all, cuts);
  const slabMesh = new MeshBuilder();
  const slabIds: string[] = [];
  const floor: Polygon[] = [];
  const addSlab = (id: string, polys: Polygon[], thickness: number) => {
    if (!polys.length) return;
    if (thickness > 0) slabMesh.prism(polys, e0 - thickness, e0);
    else slabMesh.cap(polys, e0, true);
    floor.push(...polys);
    slabIds.push(id);
  };
  const autos = slabs.autoSlabs.map((s) => entities[s.id]).filter((e): e is EntityOf<'slab'> => e?.type === 'slab' && shown(doc, e));
  if (autos.length) addSlab(autos[0].id, slabs.slab, Math.max(...autos.map((s) => s.thickness ?? level.slabThickness)));
  for (const [id, polys] of slabs.slabRegions) {
    const slab = entities[id];
    if (slab?.type === 'slab' && shown(doc, slab)) addSlab(id, polys, slab.thickness ?? level.slabThickness);
  }
  if (!slabMesh.empty) parts.push({ kind: 'slab', mesh: slabMesh.build(), ids: slabIds });

  return { levelId, elevation: e0, ceiling, parts, bands, floor: floor.length > 1 ? unionPolygons(floor) : floor };
}

export interface BuildingSolids {
  /** Bottom to top. */
  levels: LevelSolids[];
  connectors: ConnectorSolids[];
}

/** Every level in 3D (see `deriveLevelSolids`), bottom to top, and every connector (`deriveConnectorSolids`); `cut` cuts one level's walls (the cutaway view). */
export function deriveBuildingSolids(doc: ProjectDoc, options: Omit<SolidsOptions, 'cutHeight'> & { cut?: { levelId: string; height: number } }): BuildingSolids {
  const levels = options.levels ?? deriveLevels(doc);
  return {
    levels: levels.map((l) => deriveLevelSolids(doc, l.id, { ...options, levels, cutHeight: options.cut?.levelId === l.id ? options.cut.height : undefined })),
    connectors: deriveConnectorsSolids(doc, options.limits, levels),
  };
}
