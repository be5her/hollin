import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addConnectorOps, addEntityOps, addLevelOps, type NewEntity } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { deriveLevels } from '../doc/derive';
import { Transaction, type Op } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { rectPath, type Path } from '../geometry/path';
import { deriveBuildingSolids } from './building';
import { WALKER_RADIUS, blocked, floorAt, levelAt, rideElevator, walkRelative, walkWorld, type WalkWorld, type Walker } from './walk';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}
const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });

/**
 * Two storeys of a 6 × 6 m room (walls 200 thick centred on the square, inner faces at 100 and
 * 5900) with slabs, a straight stair up the west side from y = 300 to 3700, a door in the south
 * wall at x = 3000, a window in the east wall at y = 2000, and an elevator in the north-east corner.
 */
function house(): { world: WalkWorld; ground: string; upper: string } {
  let doc = newProjectDoc({ name: 'Walk' });
  const ground = doc.building.groundLevelId;
  const upperOps = addLevelOps(doc, { name: 'Level 1' });
  doc = commit(doc, upperOps.ops);
  const upper = upperOps.levelId;
  const add = (levelId: string, entity: NewEntity) => {
    const { ops, id } = addEntityOps(doc, { levelId, entity });
    doc = commit(doc, ops);
    return id;
  };
  for (const levelId of [ground, upper]) {
    const wall = add(levelId, { type: 'wall', path: rectPath(0, 0, 6000, 6000), thickness: 200 });
    add(levelId, { type: 'slab', source: { k: 'auto' } });
    if (levelId === ground) {
      add(levelId, { type: 'opening', kind: 'door', wallId: wall, along: 3000, width: 900, height: 2100 });
      add(levelId, { type: 'opening', kind: 'window', wallId: wall, along: 8000, width: 1200, height: 1200, sill: 900 });
    }
  }
  doc = commit(doc, addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, axis: line([1000, 300], [1000, 3700]), width: 1000 }).ops);
  doc = commit(doc, addConnectorOps({ kind: 'elevator', at: [4500, 4500], shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: ground }, { levelId: upper }] }).ops);
  const levels = deriveLevels(doc);
  return { world: walkWorld(deriveBuildingSolids(doc, { limits: DEFAULT_RULE_LIMITS, levels }), levels), ground, upper };
}

/** Walks forward in steps of `step` mm, `count` times. */
function forward(world: WalkWorld, walker: Walker, count: number, step = 100): Walker {
  let w = walker;
  for (let i = 0; i < count; i++) w = walkRelative(world, w, step, 0);
  return w;
}

describe('walking', () => {
  it('stands on the floor, on the stair\'s treads and on the ground outside', () => {
    const { world } = house();
    expect(floorAt(world, [3000, 2000], 0)).toBe(0);
    // The first tread (187.5 high) is within a step; the fourth is not, from the floor.
    expect(floorAt(world, [1000, 400], 0)).toBe(187.5);
    expect(floorAt(world, [1000, 1100], 0)).toBe(0);
    expect(floorAt(world, [3000, -2000], 0)).toBe(0);
    // Upstairs, the upper floor; over the stairwell, the stair below.
    expect(floorAt(world, [3000, 5000], 3000)).toBe(3000);
    expect(floorAt(world, [1000, 2000], 3000)!).toBeLessThan(3000);
  });

  it('climbs the stair to the upper floor and stops at the wall beyond', () => {
    const { world, upper } = house();
    const start: Walker = { at: [1000, 400, 0], yaw: 90 };
    const up = forward(world, start, 70);
    expect(up.at[2]).toBe(3000);
    expect(levelAt(world, up.at[2])?.id).toBe(upper);
    // The north wall's inner face is at 5900: the walker's centre stops a radius short of it.
    expect(up.at[1]).toBeGreaterThan(5900 - WALKER_RADIUS - 100);
    expect(up.at[1]).toBeLessThanOrEqual(5900 - WALKER_RADIUS);
  });

  it('goes out through the door but not through the wall or the window', () => {
    const { world } = house();
    // South through the door at x = 3000: out on the ground.
    const out = forward(world, { at: [3000, 1500, 0], yaw: 270 }, 40);
    expect(out.at[1]).toBeLessThan(-1000);
    expect(out.at[2]).toBe(0);
    // South at x = 2000: the wall stops it.
    const wall = forward(world, { at: [2000, 1500, 0], yaw: 270 }, 40);
    expect(wall.at[1]).toBeGreaterThanOrEqual(100 + WALKER_RADIUS);
    expect(wall.at[1]).toBeLessThan(100 + WALKER_RADIUS + 100);
    // East at y = 2000, the window's middle: its sill stops it at the knee.
    const window = forward(world, { at: [5000, 2000, 0], yaw: 0 }, 40);
    expect(window.at[0]).toBeLessThanOrEqual(5900 - WALKER_RADIUS);
    expect(blocked(world, [5800, 2000], 0)).toBe(true);
    expect(blocked(world, [3000, 0], 0)).toBe(false);
  });

  it('slides along a wall met at an angle', () => {
    const { world } = house();
    const slid = forward(world, { at: [2000, 1000, 0], yaw: 225 }, 30);
    // Stopped by the south wall, it keeps going west along it.
    expect(slid.at[1]).toBeGreaterThanOrEqual(100 + WALKER_RADIUS);
    expect(slid.at[0]).toBeLessThan(1000);
  });

  it('rides the elevator from stop to stop', () => {
    const { world } = house();
    const inCar: Walker = { at: [4500, 4500, 0], yaw: 0 };
    const up = rideElevator(world, inCar, 1)!;
    expect(up.at[2]).toBe(3000);
    expect(rideElevator(world, up, 1)).toBeNull();
    expect(rideElevator(world, up, -1)!.at[2]).toBe(0);
    expect(rideElevator(world, { at: [3000, 2000, 0], yaw: 0 }, 1)).toBeNull();
  });
});
