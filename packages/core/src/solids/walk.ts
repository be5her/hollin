import type { DerivedLevel } from '../doc/derive';
import { polygonContains, type Polygon } from '../geometry/polygon';
import { add, scale, type Vec2 } from '../geometry/vec';
import type { BuildingSolids, WallBand } from './building';
import type { Vec3 } from './mesh';

/** How high the eye is above the feet, mm. */
export const EYE_HEIGHT = 1600;
/** The highest step taken without climbing: a stair's riser is lower, a desk is not. */
export const STEP_UP = 450;
/** How close to a wall the walker's centre may come, mm. */
export const WALKER_RADIUS = 250;
/** Where walls are probed above the feet: at the knee (a window's sill stops you) and at the head (a door's head lets you through, a low lintel would not). */
const PROBES = [400, 1500];
/** The longest move tested at once, so a fast frame cannot pass through a wall, mm. */
const SUBSTEP = 100;

/** A surface you can stand on: polygons (even–odd, so holes are left out) and the plane its height follows. */
interface Surface {
  polygons: Polygon[];
  plane: readonly [number, number, number];
}

/** What walking needs from the solids: what to stand on, what blocks, the elevator cars, the ground outside. */
export interface WalkWorld {
  surfaces: Surface[];
  walls: WallBand[];
  /** Furniture: it stops the walker at the knee, never at the head (a table is walked round, not under). */
  obstacles: WallBand[];
  cars: { id: string; polygon: Polygon; stops: { levelId: string; elevation: number }[] }[];
  /** The ground outside the building: the ground level's elevation. */
  ground: number;
  levels: readonly DerivedLevel[];
}

/** The walker: where its feet are (mm) and which way it faces (degrees counter-clockwise from +x). */
export interface Walker {
  at: Vec3;
  yaw: number;
}

/** The walking world of a building: every floor's slab tops, the connectors' treads, landings and slopes, the elevator cars, and the walls band by band. */
export function walkWorld(solids: BuildingSolids, levels: readonly DerivedLevel[]): WalkWorld {
  const surfaces: Surface[] = [];
  const walls: WallBand[] = [];
  const obstacles: WallBand[] = [];
  for (const level of solids.levels) {
    if (level.floor.length) surfaces.push({ polygons: level.floor, plane: [level.elevation, 0, 0] });
    walls.push(...level.bands.filter((b) => b.footprint.length));
    obstacles.push(...level.obstacles);
  }
  const cars: WalkWorld['cars'] = [];
  for (const c of solids.connectors) {
    for (const s of c.surfaces) surfaces.push({ polygons: [s.polygon], plane: s.plane });
    if (c.car) cars.push({ id: c.id, polygon: c.car.polygon, stops: c.car.stops });
  }
  const ground = levels.find((l) => l.isGround)?.elevation ?? 0;
  return { surfaces, walls, obstacles, cars, ground, levels };
}

const inside = (polygons: readonly Polygon[], p: Vec2) => polygons.reduce((n, poly) => (polygonContains(poly, p) ? n + 1 : n), 0) % 2 === 1;
const heightOf = (s: Surface, p: Vec2) => s.plane[0] + s.plane[1] * p[0] + s.plane[2] * p[1];

/**
 * The floor under a point for feet at `z`: the highest surface there no more than a step above the
 * feet (so a stair is climbed and a hole dropped into), else the ground outside when that is in
 * reach; null when there is nothing to stand on.
 */
export function floorAt(world: WalkWorld, p: Vec2, z: number): number | null {
  let best: number | null = null;
  for (const s of world.surfaces) {
    if (!inside(s.polygons, p)) continue;
    const h = heightOf(s, p);
    if (h <= z + STEP_UP + 1e-6 && (best === null || h > best)) best = h;
  }
  if (best === null && world.ground <= z + STEP_UP + 1e-6) best = world.ground;
  return best;
}

/** The distance from a point to a polygon's edges. */
function edgeDistance(poly: Polygon, p: Vec2): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

/** True when a wall stands within the walker's radius of a point at knee or head height above feet at `z`, or furniture at the knee. */
export function blocked(world: WalkWorld, p: Vec2, z: number): boolean {
  const near = (band: WallBand) => inside(band.footprint, p) || band.footprint.some((poly) => edgeDistance(poly, p) < WALKER_RADIUS);
  for (const probe of PROBES) {
    const h = z + probe;
    for (const band of world.walls) if (h >= band.z0 && h < band.z1 && near(band)) return true;
  }
  const knee = z + PROBES[0];
  for (const item of world.obstacles) if (knee >= item.z0 && knee < item.z1 && near(item)) return true;
  return false;
}

/**
 * The walker moved by a step on the plan (mm): in short substeps, each tried whole, then along x
 * alone, then along y alone, so it slides along a wall it meets at an angle; after each, its feet
 * settle on the floor under them (climbing a step, dropping into a stairwell). A step with nothing to
 * stand on is not taken.
 */
export function walkBy(world: WalkWorld, walker: Walker, move: Vec2): Walker {
  const n = Math.max(1, Math.ceil(Math.hypot(move[0], move[1]) / SUBSTEP));
  const d = scale(move, 1 / n);
  let p: Vec2 = [walker.at[0], walker.at[1]];
  let z = walker.at[2];
  for (let i = 0; i < n; i++) {
    let moved = false;
    for (const tryMove of [d, [d[0], 0] as Vec2, [0, d[1]] as Vec2]) {
      if (tryMove[0] === 0 && tryMove[1] === 0) continue;
      const q = add(p, tryMove);
      const floor = floorAt(world, q, z);
      if (floor === null || blocked(world, q, floor)) continue;
      p = q;
      z = floor;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return { ...walker, at: [p[0], p[1], z] };
}

/** The walker turned to face `yaw` and moved `forward` and `right` mm relative to it. */
export function walkRelative(world: WalkWorld, walker: Walker, forward: number, right: number): Walker {
  const a = (walker.yaw * Math.PI) / 180;
  const ahead: Vec2 = [Math.cos(a), Math.sin(a)];
  const side: Vec2 = [Math.sin(a), -Math.cos(a)];
  return walkBy(world, walker, add(scale(ahead, forward), scale(side, right)));
}

/** The elevator car the walker stands in at one of its stops, and which stop, or null. */
export function carAt(world: WalkWorld, walker: Walker): { car: WalkWorld['cars'][number]; stop: number } | null {
  const p: Vec2 = [walker.at[0], walker.at[1]];
  for (const car of world.cars) {
    if (!polygonContains(car.polygon, p)) continue;
    const stop = car.stops.findIndex((s) => Math.abs(s.elevation - walker.at[2]) < 1);
    if (stop >= 0) return { car, stop };
  }
  return null;
}

/** The walker carried by the elevator it stands in to the next stop up (1) or down (-1); null when there is none that way. */
export function rideElevator(world: WalkWorld, walker: Walker, direction: 1 | -1): Walker | null {
  const found = carAt(world, walker);
  if (!found) return null;
  const next = found.car.stops[found.stop + direction];
  return next ? { ...walker, at: [walker.at[0], walker.at[1], next.elevation] } : null;
}

/** The level whose floor the feet are on or above (the highest such), for showing where the walker is. */
export function levelAt(world: WalkWorld, z: number): DerivedLevel | null {
  let best: DerivedLevel | null = null;
  for (const l of world.levels) if (l.elevation <= z + 1 && (!best || l.elevation > best.elevation)) best = l;
  return best;
}
