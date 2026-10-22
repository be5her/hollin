import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addConnectorOps, addLevelOps, type NewConnector } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { deriveLevels } from '../doc/derive';
import { Transaction, type Op } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { deriveConnector, type StairGeometry } from '../geometry/connectors';
import type { Path } from '../geometry/path';
import { polygonArea, polygonContains } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec';
import { deriveBuildingSolids } from './building';
import { deriveConnectorSolids, type ConnectorSolids, type WalkSurface } from './connectors';
import { meshBox, meshVolume, type Mesh } from './mesh';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

const polyline = (...points: Vec2[]): Path => ({ closed: false, v: points.map((p) => ({ p })) });
const near = (actual: number, expected: number, tolerance = 1e-5) => Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
const closed = (mesh: Mesh) => near(meshVolume(mesh, [5000, -3000, 7000]), meshVolume(mesh));
const mesh = (s: ConnectorSolids, kind: string) => s.parts.find((p) => p.kind === kind)!.mesh;
/** The highest surface over a point, as walking would find it. */
function heightAt(surfaces: readonly WalkSurface[], p: Vec2): number | null {
  let best: number | null = null;
  for (const s of surfaces) {
    if (!polygonContains(s.polygon, p)) continue;
    const z = s.plane[0] + s.plane[1] * p[0] + s.plane[2] * p[1];
    if (best === null || z > best) best = z;
  }
  return best;
}

/** The ground floor and Level 1, 3000 apart, and one connector between them. */
function withConnector(make: (ground: string, upper: string) => NewConnector) {
  let doc = newProjectDoc({ name: 'Connectors' });
  const ground = doc.building.groundLevelId;
  const upper = addLevelOps(doc, { name: 'Level 1' });
  doc = commit(doc, upper.ops);
  const added = addConnectorOps(make(ground, upper.levelId));
  doc = commit(doc, added.ops);
  const levels = deriveLevels(doc);
  const solids = deriveConnectorSolids(doc.connectors[added.id], levels, DEFAULT_RULE_LIMITS)!;
  return { doc, ground, upper: upper.levelId, id: added.id, levels, solids };
}

describe('connector solids', () => {
  it('builds a straight stair as one step per tread at its riser height, with handrails 900 mm above the nosings', () => {
    const { solids, ground } = withConnector((bottom, top) => ({ kind: 'stair', shape: 'straight', bottom: { levelId: bottom }, top: { levelId: top }, axis: polyline([2000, 1000], [2000, 4750]), width: 1000 }));
    expect(solids.levelId).toBe(ground);
    expect([solids.bottom, solids.top]).toEqual([0, 3000]);
    // 3000 over risers of at most 190 is 16 risers of 187.5; 15 treads of 250 over 3750.
    expect(solids.surfaces.map((s) => s.plane[0])).toEqual(Array.from({ length: 15 }, (_, k) => (k + 1) * 187.5));
    for (const s of solids.surfaces) expect(polygonArea(s.polygon)).toBeCloseTo(250 * 1000, 0);
    const body = mesh(solids, 'connector');
    expect(closed(body)).toBe(true);
    // Each step reaches a riser and 200 mm below its tread, or down to the floor: 187.5, 375, then 387.5.
    expect(near(meshVolume(body), 250 * 1000 * (187.5 + 375 + 13 * 387.5))).toBe(true);
    expect(heightAt(solids.surfaces, [2000, 1100])).toBe(187.5);
    expect(heightAt(solids.surfaces, [2000, 4700])).toBe(2812.5);
    const rails = mesh(solids, 'rail');
    expect(closed(rails)).toBe(true);
    const box = meshBox(rails)!;
    expect(box.max[2]).toBeGreaterThan(3900);
    expect(box.max[2]).toBeLessThan(3930);
    expect(box.min[2]).toBeGreaterThan(187.5 + 900 - 30);
  });

  it('lays an L stair\'s landing at its derived height', () => {
    const { solids, doc, id, levels } = withConnector((bottom, top) => ({ kind: 'stair', shape: 'l', bottom: { levelId: bottom }, top: { levelId: top }, axis: polyline([0, 0], [0, 3000], [3000, 3000]), width: 1000 }));
    const g = deriveConnector(doc.connectors[id], levels, DEFAULT_RULE_LIMITS) as StairGeometry;
    expect(g.landings).toHaveLength(1);
    const height = g.landings[0].height;
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(3000);
    // The landing is the corner square: the walk line's corner at (0, 3000).
    expect(heightAt(solids.surfaces, [0, 3000])).toBe(height);
    expect(closed(mesh(solids, 'connector'))).toBe(true);
    // The first flight climbs to the landing and the second goes on above it.
    expect(heightAt(solids.surfaces, [0, 200])!).toBeLessThan(height);
    expect(heightAt(solids.surfaces, [2800, 3000])!).toBeGreaterThan(height);
  });

  it('slopes a ramp evenly from its bottom to its top', () => {
    const { solids } = withConnector((bottom) => ({ kind: 'ramp', bottom: { levelId: bottom }, top: { levelId: bottom, offset: 600 }, axis: polyline([0, 0], [12000, 0]), width: 1500 }));
    expect(heightAt(solids.surfaces, [3000, 0])).toBeCloseTo(150, 6);
    expect(heightAt(solids.surfaces, [6000, 300])).toBeCloseTo(300, 6);
    expect(heightAt(solids.surfaces, [11990, -700])).toBeCloseTo(599.5, 3);
    const body = mesh(solids, 'connector');
    expect(closed(body)).toBe(true);
    // A sheared slab 200 thick under every point of its 12 m × 1.5 m plan.
    expect(near(meshVolume(body), 12000 * 1500 * 200)).toBe(true);
  });

  it('runs an elevator\'s shaft from its lowest stop to the ceiling of its highest, its car at the bottom', () => {
    const { solids, ground, upper } = withConnector((bottom, top) => ({ kind: 'elevator', at: [7000, 3000], shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 }, stops: [{ levelId: bottom }, { levelId: top }] }));
    expect(solids.levelId).toBe(ground);
    const shaft = mesh(solids, 'glass');
    expect(closed(shaft)).toBe(true);
    expect(near(meshVolume(shaft), 2000 * 2200 * 6000)).toBe(true);
    const car = mesh(solids, 'car');
    expect(near(meshVolume(car), 1100 * 1400 * 2300)).toBe(true);
    expect(solids.car!.stops).toEqual([
      { levelId: ground, elevation: 0 },
      { levelId: upper, elevation: 3000 },
    ]);
    expect(heightAt(solids.surfaces, [7000, 3000])).toBe(3000);
  });

  it('builds a ladder of rails and rungs, and an escalator level at both ends', () => {
    const ladder = withConnector((bottom, top) => ({ kind: 'ladder', bottom: { levelId: bottom }, top: { levelId: top }, at: [0, 0], direction: 90 })).solids;
    const rails = mesh(ladder, 'rail');
    expect(closed(rails)).toBe(true);
    expect(meshVolume(rails)).toBeGreaterThan(0);
    // The rails' section lies flat, so they end exactly at the upper floor.
    expect(meshBox(rails)!.max[2]).toBeCloseTo(3000, 3);
    const escalator = withConnector((bottom, top) => ({ kind: 'escalator', bottom: { levelId: bottom }, top: { levelId: top }, at: [0, 0], direction: 0 })).solids;
    expect(closed(mesh(escalator, 'connector'))).toBe(true);
    expect(heightAt(escalator.surfaces, [600, 0])).toBeCloseTo(0, 6);
    // 3000 at 30°: 5196 mm inclined after the 1200 mm landing.
    expect(heightAt(escalator.surfaces, [1200 + 3000 * Math.sqrt(3) + 600, 0])).toBeCloseTo(3000, 3);
    expect(heightAt(escalator.surfaces, [1200 + (3000 * Math.sqrt(3)) / 2, 0])).toBeCloseTo(1500, 3);
  });

  it('comes with the building, every connector once', () => {
    const { doc } = withConnector((bottom, top) => ({ kind: 'stair', shape: 'straight', bottom: { levelId: bottom }, top: { levelId: top }, axis: polyline([2000, 1000], [2000, 4750]), width: 1000 }));
    const solids = deriveBuildingSolids(doc, { limits: DEFAULT_RULE_LIMITS });
    expect(solids.connectors.map((c) => c.kind)).toEqual(['stair']);
  });
});
