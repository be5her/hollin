import type { RuleLimits } from '../config';
import { deriveLevels, entitiesOnLevel, type DerivedLevel } from '../doc/derive';
import type { Connector, Entity, EntityOf, ProjectDoc } from '../doc/schema';
import { connectorCutLevels, connectorRole, deriveConnector, type ConnectorGeometry, type ConnectorRole, type RuleBreak } from '../geometry/connectors';
import { deriveLevelGeometry } from '../geometry/level-geometry';
import { openingFrame } from '../geometry/openings';
import { pathLength, pointAt } from '../geometry/path';
import { polygonContains } from '../geometry/polygon';
import type { RoomGeometry } from '../geometry/rooms';
import { add, normalize, perp, scale, sub, type Vec2 } from '../geometry/vec';
import { wallOffsets } from '../geometry/walls';
import { footprintArea, itemFootprint, itemModel, itemSize } from '../decor/items';

/*
 * The design as an agent reads it: rooms with their areas, which rooms share a wall or a door, and
 * which rooms each stair, ramp or elevator connects on each level. Everything here is derived from the
 * document the moment it is asked for; nothing is stored.
 */

export type OpeningKind = EntityOf<'opening'>['kind'];

export interface RoomOpeningDescription {
  id: string;
  kind: OpeningKind;
  width: number;
  wallId: string;
  /** The room on the other side, or `outside` when no room lies there. */
  to: string | 'outside';
}

export interface RoomDescription {
  id: string;
  name: string;
  number: string | null;
  /** Net floor area in mm² (0 for a room that is not enclosed or shares its space). */
  area: number;
  perimeter: number;
  enclosed: boolean;
  /** The room that claimed the same space first, when two rooms share one. */
  shared: string | null;
  openings: RoomOpeningDescription[];
  /** Rooms this one touches, and how: a shared wall, a door, a window or a plain opening between them. */
  adjacent: { roomId: string; via: ('wall' | OpeningKind)[] }[];
  /** The stairs, ramps, elevators and other connectors that start, end or stop in this room. */
  connectors: { id: string; kind: Connector['kind']; role: ConnectorRole }[];
  /** The furniture standing in the room (by the centre of each item). */
  furniture: FurnitureDescription[];
  /** The lights in the room. */
  lights: LightDescription[];
  /** Its finishes: the floor's and ceiling's material, and the walls' (the faces that look into it): one material, `mixed`, or null for none. */
  finish: { floor: string | null; walls: string | null; ceiling: string | null };
}

export interface FurnitureDescription {
  id: string;
  /** The item's own name, else its model's. */
  name: string;
  /** The model: `builtin:<id>` or `asset:<file>`. */
  ref: string;
  /** Where its bottom centre stands, and how high above the floor, mm. */
  at: [number, number, number];
  /** Degrees counter-clockwise on the plan; 0 faces south (−y). */
  rotation: number;
  /** Width, depth and height as placed, mm. */
  size: [number, number, number];
  /** The area it covers on the plan, mm². */
  footprint: number;
}

export interface LightDescription {
  id: string;
  kind: EntityOf<'light'>['kind'];
  at: [number, number, number];
  lumens: number;
  color: string;
}

export interface LevelOpeningDescription {
  id: string;
  kind: OpeningKind;
  width: number;
  wallId: string;
  /** The rooms on its two sides (null: no room there, i.e. outside). */
  between: [string | null, string | null];
}

export interface LevelDescription {
  id: string;
  name: string;
  elevation: number;
  height: number;
  isGround: boolean;
  isBasement: boolean;
  /** Entities on the level by type (spanning columns, shafts and voids from other levels included). */
  counts: Partial<Record<Entity['type'], number>>;
  rooms: RoomDescription[];
  /** Enclosed spaces no room claims yet, by area. */
  unnamedSpaces: { area: number; at: Vec2 }[];
  openings: LevelOpeningDescription[];
  /** Every connector reaching the level, with how it shows there and the room it lands in (null: no room, or it only passes through). */
  connectors: { id: string; kind: Connector['kind']; name: string | null; role: ConnectorRole; roomId: string | null }[];
  /** Furniture and lights in no room (outside, or in a space no room names). */
  outside: { furniture: FurnitureDescription[]; lights: LightDescription[] };
}

export interface CirculationStop {
  levelId: string;
  /** The room it opens into on that level, or null. */
  roomId: string | null;
  door?: 'front' | 'back' | 'left' | 'right';
}

export interface CirculationDescription {
  id: string;
  kind: Connector['kind'];
  name: string | null;
  /** Bottom to top: where it starts and ends, or every stop of an elevator. */
  stops: CirculationStop[];
  /** The levels whose slab it cuts (stairwell, shaft). */
  cuts: string[];
  derived: ReturnType<typeof connectorNumbers>;
}

export interface DesignDescription {
  /** Every length is in millimetres, every area in mm². */
  units: 'mm';
  levels: LevelDescription[];
  circulation: CirculationDescription[];
  summary: { levels: number; rooms: number; floorArea: number; connectors: number };
}

/** A connector's derived numbers, rounded for reading: what it climbs, how, which slabs it cuts and the limits it breaks. */
export function connectorNumbers(connector: Connector, levels: readonly DerivedLevel[], limits: RuleLimits, geometry: ConnectorGeometry = deriveConnector(connector, levels, limits)) {
  const g = geometry;
  const r = (v: number) => Math.round(v * 10) / 10;
  const base: { bottom: number; top: number; rise: number; cuts: string[]; broken: RuleBreak[] } = { bottom: g.bottom, top: g.top, rise: g.rise, cuts: connectorCutLevels(connector, levels), broken: g.broken };
  switch (g.kind) {
    case 'stair':
      return { ...base, risers: g.risers, riserHeight: r(g.riserHeight), treadDepth: r(g.treadDepth), walkLength: r(g.walkLength), flights: g.flights.map((f) => ({ risers: f.risers, tread: r(f.tread) })), landings: g.landings.length };
    case 'ramp':
      return { ...base, slope: r(g.slope * 10) / 10, maxSlope: g.maxSlope, run: r(g.run), landings: g.landings.length };
    case 'ladder':
      return { ...base, run: r(g.run) };
    case 'escalator':
      return { ...base, run: r(g.run) };
    case 'elevator':
      return { ...base, stops: g.stops.map((s) => ({ levelId: s.levelId, elevation: s.elevation, door: s.side })) };
  }
}

/** How far from a wall face or a connector's edge a probe point is pushed into the space beside it. */
const PROBE = 60;
/** Walls are probed on both sides at about this spacing, so a long wall shared with several rooms finds them all. */
const WALL_PROBE_SPACING = 600;

/** The room whose space contains `p`: the smallest one wins (a closet before the room around it); shared rooms do not count. */
export function roomAt(rooms: Iterable<RoomGeometry>, p: Vec2): RoomGeometry | null {
  let best: RoomGeometry | null = null;
  for (const r of rooms) {
    if (!r.polygon || r.shared) continue;
    if (!polygonContains(r.polygon, p) || r.holes.some((h) => polygonContains(h, p))) continue;
    if (!best || r.area < best.area) best = r;
  }
  return best;
}

/** Where a connector lands on a level: just before its first riser, just past its last, or in front of an elevator door. */
function landingPoint(connector: Connector, geometry: ConnectorGeometry, levelId: string, role: ConnectorRole): Vec2 | null {
  if (geometry.kind === 'elevator' && connector.kind === 'elevator') {
    const stop = geometry.stops.find((s) => s.levelId === levelId);
    if (!stop) return null;
    const mid: Vec2 = [(stop.door[0][0] + stop.door[1][0]) / 2, (stop.door[0][1] + stop.door[1][1]) / 2];
    // The door mark lies on the shaft's side: the room is just outside it.
    return add(mid, scale(normalize(sub(mid, connector.at)), PROBE));
  }
  if (geometry.kind === 'elevator') return null;
  if (role === 'crosses') return null;
  if (geometry.kind === 'ladder' || geometry.kind === 'escalator') {
    if (role === 'bottom') return geometry.foot;
    const away = normalize(sub(geometry.head, geometry.foot));
    return add(geometry.head, scale(away, PROBE));
  }
  const segs = geometry.axis;
  if (!segs.length) return null;
  if (role === 'bottom') {
    const first = segs[0];
    const dir = normalize(sub(first.b, first.a));
    return add(first.a, scale(dir, -PROBE));
  }
  const last = segs[segs.length - 1];
  const dir = normalize(sub(last.b, last.a));
  return add(last.b, scale(dir, PROBE));
}

/**
 * Describes the whole design: every level with its rooms (areas, the openings of each and which room
 * they lead to, which rooms share a wall), the enclosed spaces no room names yet, and the vertical
 * circulation with the room each stair, ramp, ladder, escalator or elevator opens into on each level.
 */
export function describeDesign(doc: ProjectDoc, limits: RuleLimits): DesignDescription {
  const levels = deriveLevels(doc);
  const connectors = Object.values(doc.connectors);
  const geometries = new Map(connectors.map((c) => [c.id, deriveConnector(c, levels, limits)]));
  const roomOf = new Map<string, Map<string, string | null>>(); // connector id -> level id -> room id

  const levelDescriptions = levels.map((level): LevelDescription => {
    const entities = entitiesOnLevel(doc, level.id);
    const record = Object.fromEntries(entities.map((e) => [e.id, e]));
    const counts: Partial<Record<Entity['type'], number>> = {};
    for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const geometry = deriveLevelGeometry(record);
    const rooms = [...geometry.rooms.values()];
    const at = (p: Vec2) => roomAt(rooms, p)?.id ?? null;

    const adjacency = new Map<string, Map<string, Set<'wall' | OpeningKind>>>();
    const touch = (a: string | null, b: string | null, via: 'wall' | OpeningKind) => {
      if (!a || !b || a === b) return;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        let m = adjacency.get(x);
        if (!m) adjacency.set(x, (m = new Map()));
        let s = m.get(y);
        if (!s) m.set(y, (s = new Set()));
        s.add(via);
      }
    };

    // Rooms on both sides of every wall, probed along it; and the wall faces that look into each room, with their finish.
    const faces = new Map<string, Map<string, string | null>>();
    const face = (roomId: string | null, wall: EntityOf<'wall'>, side: 'left' | 'right') => {
      if (!roomId) return;
      let m = faces.get(roomId);
      if (!m) faces.set(roomId, (m = new Map()));
      m.set(`${wall.id}|${side}`, wall.materials?.[side] ?? null);
    };
    for (const e of entities) {
      if (e.type !== 'wall') continue;
      const offsets = wallOffsets(e);
      const length = pathLength(e.path);
      const steps = Math.max(1, Math.round(length / WALL_PROBE_SPACING));
      for (let i = 0; i < steps; i++) {
        const { point, tangent } = pointAt(e.path, ((i + 0.5) / steps) * length);
        const n = perp(tangent);
        const left = at(add(point, scale(n, offsets.left + PROBE)));
        const right = at(add(point, scale(n, offsets.right - PROBE)));
        touch(left, right, 'wall');
        face(left, e, 'left');
        face(right, e, 'right');
      }
    }
    const wallsFinish = (roomId: string): string | null => {
      const set = new Set(faces.get(roomId)?.values() ?? []);
      if (!set.size || (set.size === 1 && set.has(null))) return null;
      return set.size === 1 ? [...set][0] : 'mixed';
    };

    // Openings: the room on each side.
    const openings: LevelOpeningDescription[] = [];
    const byRoom = new Map<string, RoomOpeningDescription[]>();
    for (const e of entities) {
      if (e.type !== 'opening') continue;
      const wall = record[e.wallId];
      if (!wall || wall.type !== 'wall') continue;
      const frame = openingFrame(wall, e);
      const left = at(add(frame.center, scale(frame.normal, frame.across.left + PROBE)));
      const right = at(add(frame.center, scale(frame.normal, frame.across.right - PROBE)));
      openings.push({ id: e.id, kind: e.kind, width: e.width, wallId: e.wallId, between: [left, right] });
      touch(left, right, e.kind);
      for (const [side, other] of [[left, right], [right, left]] as const) {
        if (!side) continue;
        let list = byRoom.get(side);
        if (!list) byRoom.set(side, (list = []));
        list.push({ id: e.id, kind: e.kind, width: e.width, wallId: e.wallId, to: other ?? 'outside' });
      }
    }

    // Connectors reaching this level and the room each opens into.
    const onLevel: LevelDescription['connectors'] = [];
    const connectorsByRoom = new Map<string, RoomDescription['connectors']>();
    for (const c of connectors) {
      const role = connectorRole(c, level, levels);
      if (!role) continue;
      const g = geometries.get(c.id)!;
      const p = landingPoint(c, g, level.id, role);
      const roomId = p ? at(p) : null;
      onLevel.push({ id: c.id, kind: c.kind, name: c.name ?? null, role, roomId });
      let perLevel = roomOf.get(c.id);
      if (!perLevel) roomOf.set(c.id, (perLevel = new Map()));
      perLevel.set(level.id, roomId);
      if (roomId) {
        let list = connectorsByRoom.get(roomId);
        if (!list) connectorsByRoom.set(roomId, (list = []));
        list.push({ id: c.id, kind: c.kind, role });
      }
    }

    // Furniture and lights, by the room their centre stands in.
    const furnitureBy = new Map<string | null, FurnitureDescription[]>();
    const lightsBy = new Map<string | null, LightDescription[]>();
    const r1 = (v: number) => Math.round(v * 10) / 10;
    for (const e of entities) {
      if (e.type === 'item') {
        const model = itemModel(e.asset, doc.assets);
        const size = itemSize(e, model);
        const room = at([e.at[0], e.at[1]]);
        const list = furnitureBy.get(room) ?? [];
        list.push({ id: e.id, name: e.name ?? model.name, ref: e.asset, at: [r1(e.at[0]), r1(e.at[1]), r1(e.at[2])], rotation: e.rotation[2], size: [r1(size[0]), r1(size[1]), r1(size[2])], footprint: Math.round(footprintArea(itemFootprint(e, model))) });
        furnitureBy.set(room, list);
      } else if (e.type === 'light') {
        const room = at([e.at[0], e.at[1]]);
        const list = lightsBy.get(room) ?? [];
        list.push({ id: e.id, kind: e.kind, at: [r1(e.at[0]), r1(e.at[1]), r1(e.at[2])], lumens: e.intensity, color: e.color });
        lightsBy.set(room, list);
      }
    }

    const roomDescriptions = rooms.map((g): RoomDescription => {
      const room = record[g.id] as EntityOf<'room'>;
      return {
        id: g.id,
        name: room.name,
        number: room.number ?? null,
        area: Math.round(g.area),
        perimeter: Math.round(g.perimeter),
        enclosed: g.enclosed,
        shared: g.shared ?? null,
        openings: byRoom.get(g.id) ?? [],
        adjacent: [...(adjacency.get(g.id) ?? new Map<string, Set<'wall' | OpeningKind>>())].map(([roomId, via]) => ({ roomId, via: [...via] })),
        connectors: connectorsByRoom.get(g.id) ?? [],
        furniture: furnitureBy.get(g.id) ?? [],
        lights: lightsBy.get(g.id) ?? [],
        finish: { floor: room.finish?.floor ?? null, walls: wallsFinish(g.id), ceiling: room.finish?.ceiling ?? null },
      };
    });
    const claimed = new Set(rooms.map((r) => r.polygon).filter(Boolean));
    const unnamedSpaces = geometry.cavities
      .filter((c) => !claimed.has(c.polygon) && c.area >= 500_000 && !entities.some((e) => (e.type === 'shaft' || e.type === 'void') && polygonContains(c.polygon, e.region.outer.v[0].p)))
      .map((c) => ({ area: Math.round(c.area), at: c.polygon[0] }));

    return { id: level.id, name: level.name, elevation: level.elevation, height: level.height, isGround: level.isGround, isBasement: level.isBasement, counts, rooms: roomDescriptions, unnamedSpaces, openings, connectors: onLevel, outside: { furniture: furnitureBy.get(null) ?? [], lights: lightsBy.get(null) ?? [] } };
  });

  const circulation = connectors.map((c): CirculationDescription => {
    const g = geometries.get(c.id)!;
    const rooms = roomOf.get(c.id) ?? new Map<string, string | null>();
    const stops: CirculationStop[] =
      c.kind === 'elevator'
        ? (g as Extract<ConnectorGeometry, { kind: 'elevator' }>).stops.map((s) => ({ levelId: s.levelId, roomId: rooms.get(s.levelId) ?? null, door: s.side }))
        : [
            { levelId: c.bottom.levelId, roomId: rooms.get(c.bottom.levelId) ?? null },
            { levelId: c.top.levelId, roomId: rooms.get(c.top.levelId) ?? null },
          ];
    return { id: c.id, kind: c.kind, name: c.name ?? null, stops, cuts: connectorCutLevels(c, levels), derived: connectorNumbers(c, levels, limits, g) };
  });

  const roomCount = levelDescriptions.reduce((n, l) => n + l.rooms.length, 0);
  const floorArea = levelDescriptions.reduce((n, l) => n + l.rooms.reduce((m, r) => m + r.area, 0), 0);
  return { units: 'mm', levels: levelDescriptions, circulation, summary: { levels: levels.length, rooms: roomCount, floorArea, connectors: connectors.length } };
}
