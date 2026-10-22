import { roomAt } from '../describe/describe';
import type { Entity, EntityOf } from '../doc/schema';
import { differencePolygons, inflateLines, inflatePolygons, intersectPolygons } from '../geometry/clip';
import { extendPathEnd, offsetPath } from '../geometry/offset';
import { flatten, nearestPoint, pathLength, pointAt } from '../geometry/path';
import { polygonArea, type Polygon } from '../geometry/polygon';
import type { RoomGeometry } from '../geometry/rooms';
import { add, cross, perp, scale, sub, type Vec2 } from '../geometry/vec';
import { wallOffsets } from '../geometry/walls';
import { MeshBuilder } from './mesh';

type Wall = EntityOf<'wall'>;

/** How thick a finish is drawn: a skin this far out of a wall face, or over a floor. */
export const SKIN = 2;
/** A skin is kept only this close to the walls of its band, so it ends where the wall does. */
const REACH = 3;

export type WallSide = 'left' | 'right';

/** A finish's triangles by material, and what it finishes. */
export interface FinishMeshes {
  material: string;
  builder: MeshBuilder;
  ids: string[];
}

/** Collects finish triangles by material; a wall face's skin band by band, built whole at the end. */
export class FinishSet {
  private readonly byMaterial = new Map<string, FinishMeshes>();
  private readonly skins = new Map<string, { material: string; wallId: string; bands: { z0: number; z1: number; strip: Polygon[] }[] }>();

  into(material: string, id: string): MeshBuilder {
    let entry = this.byMaterial.get(material);
    if (!entry) this.byMaterial.set(material, (entry = { material, builder: new MeshBuilder(), ids: [] }));
    if (!entry.ids.includes(id)) entry.ids.push(id);
    return entry.builder;
  }

  /** One band of a wall face's skin. */
  skin(wallId: string, side: WallSide, material: string, z0: number, z1: number, strip: Polygon[]): void {
    const key = `${wallId}|${side}`;
    let entry = this.skins.get(key);
    if (!entry) this.skins.set(key, (entry = { material, wallId, bands: [] }));
    entry.bands.push({ z0, z1, strip });
  }

  /**
   * Every finish's triangles. A skin is built like the walls: the sides of each band, and caps only
   * where it changes from one band to the next (so a face shows no seam where a door's head splits
   * the bands).
   */
  get all(): FinishMeshes[] {
    for (const { material, wallId, bands } of this.skins.values()) {
      const b = this.into(material, wallId);
      const sorted = [...bands].sort((p, q) => p.z0 - q.z0);
      sorted.forEach((band, i) => {
        const above = sorted[i + 1] && Math.abs(sorted[i + 1].z0 - band.z1) < 1e-6 ? sorted[i + 1].strip : [];
        const below = sorted[i - 1] && Math.abs(sorted[i - 1].z1 - band.z0) < 1e-6 ? sorted[i - 1].strip : [];
        b.sides(band.strip, band.z0, band.z1)
          .cap(above.length ? differencePolygons(band.strip, above) : band.strip, band.z1, true)
          .cap(below.length ? differencePolygons(band.strip, below) : band.strip, band.z0, false);
      });
    }
    this.skins.clear();
    return [...this.byMaterial.values()].filter((f) => !f.builder.empty);
  }
}

/** Where a wall face lies: its offset from the wall's reference line (left positive). */
export const faceOffset = (wall: Pick<Wall, 'thickness' | 'alignment'>, side: WallSide) => wallOffsets(wall)[side];

/**
 * The strip of a painted wall face in one band: a line `SKIN` wide just outside the face, carried on
 * past the wall's open ends (so an outer corner is covered), then cut by the walls of the band (so it
 * stops where another wall abuts the face) and kept within `REACH` of them (so it stops at the wall's
 * ends and across its openings).
 */
export function faceStrip(wall: Wall, side: WallSide, footprint: readonly Polygon[], reach: Polygon[], extend: number): Polygon[] {
  let path = wall.path;
  if (!path.closed && extend > 0) path = extendPathEnd(extendPathEnd(path, 'start', extend), 'end', extend);
  const out = side === 'left' ? 1 : -1;
  const centre = offsetPath(path, faceOffset(wall, side) + (out * SKIN) / 2);
  if (!centre) return [];
  let strip: Polygon[];
  if (centre.closed) {
    // A closed wall: a ring, the band between the line grown and shrunk.
    const ring = flatten(centre, 1);
    const ccw = polygonArea(ring) < 0 ? [...ring].reverse() : ring;
    strip = differencePolygons(inflatePolygons([ccw], SKIN / 2), inflatePolygons([ccw], -SKIN / 2));
  } else strip = inflateLines([flatten(centre, 1)], SKIN / 2, 'butt');
  const clear = differencePolygons(strip, [...footprint]);
  return intersectPolygons(clear, reach);
}

/** The walls' painted faces in one band of heights: their skins, per material. */
export function addWallSkins(set: FinishSet, walls: readonly Wall[], footprint: readonly Polygon[], z0: number, z1: number): void {
  const painted = walls.filter((w) => w.materials?.left || w.materials?.right);
  if (!painted.length || !footprint.length || z1 <= z0) return;
  const reach = inflatePolygons([...footprint], REACH);
  const extend = 2 * Math.max(...walls.map((w) => w.thickness));
  for (const wall of painted) {
    for (const side of ['left', 'right'] as const) {
      const material = wall.materials?.[side];
      if (!material) continue;
      const strip = faceStrip(wall, side, footprint, reach, extend);
      if (strip.length) set.skin(wall.id, side, material, z0, z1, strip);
    }
  }
}

/** A room's floor and ceiling finishes: covers `SKIN` thick over its net area, on the floor and under the ceiling. */
export function addRoomCovers(set: FinishSet, room: EntityOf<'room'>, geometry: RoomGeometry | undefined, floor: number, ceiling: number | null): void {
  if (!geometry?.polygon || !geometry.enclosed || geometry.shared) return;
  const polys = [geometry.polygon, ...geometry.holes];
  if (room.finish?.floor) set.into(room.finish.floor, room.id).prism(polys, floor, floor + SKIN);
  if (room.finish?.ceiling && ceiling !== null) set.into(room.finish.ceiling, room.id).prism(polys, ceiling - SKIN, ceiling);
}

/** How far into a room the walls are probed, and how often along them. */
const PROBE = 60;
const SPACING = 600;

/**
 * The wall faces that look into a room: both sides of every wall are probed along it, and a side
 * faces the room when a probe just off it lies in the room's space.
 */
export function wallSidesFacing(entities: Record<string, Entity>, rooms: Iterable<RoomGeometry>, roomId: string): { wallId: string; side: WallSide }[] {
  const list = [...rooms];
  const out: { wallId: string; side: WallSide }[] = [];
  for (const e of Object.values(entities)) {
    if (e.type !== 'wall') continue;
    const offsets = wallOffsets(e);
    const length = pathLength(e.path);
    const steps = Math.max(2, Math.round(length / SPACING));
    for (const side of ['left', 'right'] as const) {
      const d = side === 'left' ? offsets.left + PROBE : offsets.right - PROBE;
      for (let i = 0; i < steps; i++) {
        const { point, tangent } = pointAt(e.path, ((i + 0.5) / steps) * length);
        if (roomAt(list, add(point, scale(perp(tangent), d)))?.id === roomId) {
          out.push({ wallId: e.id, side });
          break;
        }
      }
    }
  }
  return out;
}

/** A surface of the design a finish can be given. */
export type FinishTarget = { wallId: string; side: WallSide } | { roomId: string; surface: 'floor' | 'ceiling' };

/**
 * The surface at a point of a level hit in 3D (mm, z from the level's floor) with the face's normal:
 * a wall face (the wall whose face the point lies on, the side the normal points to), or a room's
 * floor or ceiling (a face turned up or down, in the room's space); null for anything else.
 */
export function surfaceAt(entities: Record<string, Entity>, rooms: Iterable<RoomGeometry>, point: readonly [number, number, number], normal: readonly [number, number, number]): FinishTarget | null {
  const p: Vec2 = [point[0], point[1]];
  if (Math.abs(normal[2]) > 0.7) {
    const room = roomAt(rooms, p);
    return room ? { roomId: room.id, surface: normal[2] > 0 ? 'floor' : 'ceiling' } : null;
  }
  let best: { wallId: string; side: WallSide; miss: number } | null = null;
  for (const e of Object.values(entities)) {
    if (e.type !== 'wall') continue;
    const near = nearestPoint(e.path, p);
    const { tangent } = pointAt(e.path, near.along);
    const across = cross(tangent, sub(p, near.point));
    const side: WallSide = across >= 0 ? 'left' : 'right';
    // The normal must point away from the wall on that side.
    const n = perp(tangent);
    if ((normal[0] * n[0] + normal[1] * n[1]) * (side === 'left' ? 1 : -1) < 0.5) continue;
    const miss = Math.abs(across - faceOffset(e, side));
    if (miss <= SKIN + 10 && (!best || miss < best.miss)) best = { wallId: e.id, side, miss };
  }
  return best ? { wallId: best.wallId, side: best.side } : null;
}

/** Which side of a wall a point on the plan is on. */
export function sideOfWall(wall: Pick<Wall, 'path'>, p: Vec2): WallSide {
  const near = nearestPoint(wall.path, p);
  const { tangent } = pointAt(wall.path, near.along);
  return cross(tangent, sub(p, near.point)) >= 0 ? 'left' : 'right';
}
