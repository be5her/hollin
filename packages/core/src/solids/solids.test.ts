import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { addConnectorOps, addEntityOps, addLevelOps, type NewEntity } from '../doc/builders';
import { newProjectDoc } from '../doc/defaults';
import { Transaction, type Op } from '../doc/ops';
import type { ProjectDoc } from '../doc/schema';
import { deriveWalls } from '../geometry/level-geometry';
import { circlePath, rectPath, type Path } from '../geometry/path';
import { polygonArea } from '../geometry/polygon';
import { deriveBuildingSolids, deriveLevelSolids, type LevelSolids, type SolidKind } from './building';
import { meshBox, meshVolume, type Mesh } from './mesh';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

function add(doc: ProjectDoc, levelId: string, entity: NewEntity): { doc: ProjectDoc; id: string } {
  const { ops, id } = addEntityOps(doc, { levelId, entity });
  return { doc: commit(doc, ops), id };
}

const line = (a: [number, number], b: [number, number]): Path => ({ closed: false, v: [{ p: a }, { p: b }] });
const wall = (path: Path, extra: Record<string, unknown> = {}): NewEntity => ({ type: 'wall', path, thickness: 200, ...extra });
const options = { limits: DEFAULT_RULE_LIMITS };

const part = (level: LevelSolids, kind: SolidKind): Mesh | undefined => level.parts.find((p) => p.kind === kind)?.mesh;
/** Relative difference, so float32 positions compare fairly against exact values. */
const near = (actual: number, expected: number, tolerance = 1e-5) => Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
/** A closed solid encloses the same volume about any origin. */
const closed = (mesh: Mesh) => near(meshVolume(mesh, [5000, -3000, 7000]), meshVolume(mesh));

/** The area of the horizontal triangles at z facing up (or down). */
function capArea(mesh: Mesh, z: number, up: boolean): number {
  const p = mesh.positions;
  let total = 0;
  for (let i = 0; i < p.length; i += 9) {
    if (Math.abs(p[i + 2] - z) > 1e-3 || Math.abs(p[i + 5] - z) > 1e-3 || Math.abs(p[i + 8] - z) > 1e-3) continue;
    const a = ((p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 6] - p[i]) * (p[i + 4] - p[i + 1])) / 2;
    if (a > 0 === up) total += Math.abs(a);
  }
  return total;
}

/** A 4 × 3 m room (one closed wall, 200 thick, centred on the rectangle) with a door on the bottom wall, a window on the right wall and an automatic slab. */
function room() {
  let doc = newProjectDoc({ name: 'Room' });
  const ground = doc.building.groundLevelId;
  const w = add(doc, ground, wall(rectPath(0, 0, 4000, 3000)));
  doc = w.doc;
  doc = add(doc, ground, { type: 'opening', kind: 'door', wallId: w.id, along: 1000, width: 900, height: 2100 }).doc;
  doc = add(doc, ground, { type: 'opening', kind: 'window', wallId: w.id, along: 5500, width: 1200, height: 1200, sill: 900 }).doc;
  doc = add(doc, ground, { type: 'slab', source: { k: 'auto' } }).doc;
  return { doc, ground, wallId: w.id };
}

const RING = 4200 * 3200 - 3800 * 2800;
const DOOR = 900 * 200;
const WINDOW = 1200 * 200;

describe('level solids', () => {
  it('extrudes the walls with the openings cut through, as closed solids', () => {
    const { doc, ground } = room();
    const level = deriveLevelSolids(doc, ground, options);
    const walls = part(level, 'wall')!;
    expect(closed(walls)).toBe(true);
    expect(near(meshVolume(walls), RING * 3000 - DOOR * 2100 - WINDOW * 1200)).toBe(true);
    // Nothing above the ground floor: its walls run to its top.
    expect(level.ceiling).toBe(3000);
    expect(meshBox(walls)!.max[2]).toBe(3000);
    expect(level.bands.map((b) => [b.z0, b.z1])).toEqual([
      [0, 900],
      [900, 2100],
      [2100, 3000],
    ]);
  });

  it('caps the window sill, the lintels and the wall tops at their heights', () => {
    const { doc, ground } = room();
    const walls = part(deriveLevelSolids(doc, ground, options), 'wall')!;
    expect(capArea(walls, 900, true)).toBeCloseTo(WINDOW, -1);
    expect(capArea(walls, 2100, false)).toBeCloseTo(DOOR + WINDOW, -1);
    expect(capArea(walls, 3000, true)).toBeCloseTo(RING, -1);
    expect(capArea(walls, 0, false)).toBeCloseTo(RING - DOOR, -1);
  });

  it('puts a pane of glass in a window and none in a door', () => {
    const { doc, ground } = room();
    const level = deriveLevelSolids(doc, ground, options);
    const glass = part(level, 'glass')!;
    expect(closed(glass)).toBe(true);
    expect(near(meshVolume(glass), 1200 * 12 * 1200)).toBe(true);
    expect(level.parts.find((p) => p.kind === 'glass')!.ids).toHaveLength(1);
    const box = meshBox(glass)!;
    expect([box.min[2], box.max[2]]).toEqual([900, 2100]);
    // In the middle of the right wall (x = 4000).
    expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(4000, 3);
  });

  it('lays the slab under the floor, as thick as the level says', () => {
    const { doc, ground } = room();
    const level = deriveLevelSolids(doc, ground, options);
    const slab = part(level, 'slab')!;
    expect(closed(slab)).toBe(true);
    expect(near(meshVolume(slab), 4200 * 3200 * 200)).toBe(true);
    expect(meshBox(slab)!.min[2]).toBe(-200);
    expect(level.floor.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(4200 * 3200, -1);
  });

  it('joins walls at their corners and follows arcs', () => {
    let doc = newProjectDoc({ name: 'Corners' });
    const ground = doc.building.groundLevelId;
    doc = add(doc, ground, wall(line([0, 0], [4000, 0]))).doc;
    doc = add(doc, ground, wall(line([4000, 0], [4000, 3000]))).doc;
    doc = add(doc, ground, wall(circlePath([10000, 0], 2000))).doc;
    const level = deriveLevelSolids(doc, ground, options);
    const walls = part(level, 'wall')!;
    expect(closed(walls)).toBe(true);
    const joined = deriveWalls(Object.values(doc.levelData[ground].entities).filter((e) => e.type === 'wall')).joined;
    expect(near(meshVolume(walls), joined.reduce((s, p) => s + polygonArea(p), 0) * 3000)).toBe(true);
    // The L is filled to its miter: 4 m and 3 m of 200 mm wall, the outer corner square included.
    expect(joined.reduce((s, p) => s + polygonArea(p), 0) - Math.PI * (2100 ** 2 - 1900 ** 2)).toBeCloseTo(1_400_000, -4);
  });

  it('stops a wall of full height under the floor above, and a wall of its own height where it says', () => {
    let doc = newProjectDoc({ name: 'Two floors' });
    const ground = doc.building.groundLevelId;
    const upper = addLevelOps(doc, { name: 'Level 1' });
    doc = commit(doc, upper.ops);
    doc = add(doc, ground, wall(line([0, 0], [4000, 0]))).doc;
    doc = add(doc, ground, wall(line([0, 2000], [4000, 2000]), { height: 1100, baseOffset: 100 })).doc;
    doc = add(doc, upper.levelId, wall(line([0, 0], [4000, 0]))).doc;
    const solids = deriveBuildingSolids(doc, options);
    const [g, u] = solids.levels;
    expect(g.ceiling).toBe(2800);
    expect(meshBox(part(g, 'wall')!)!.max[2]).toBe(2800);
    expect(g.bands.map((b) => [b.z0, b.z1])).toEqual([
      [0, 100],
      [100, 1200],
      [1200, 2800],
    ]);
    expect(near(meshVolume(part(g, 'wall')!), 4000 * 200 * 2800 + 4000 * 200 * 1100)).toBe(true);
    expect(u.elevation).toBe(3000);
    expect(meshBox(part(u, 'wall')!)!.max[2]).toBe(6000);
  });

  it('cuts the stairwell out of the slab the stair arrives at, and a void out of its own floor', () => {
    let doc = newProjectDoc({ name: 'Stairwell' });
    const ground = doc.building.groundLevelId;
    const upper = addLevelOps(doc, { name: 'Level 1' });
    doc = commit(doc, upper.ops);
    for (const lv of [ground, upper.levelId]) {
      doc = add(doc, lv, wall(rectPath(0, 0, 8000, 6000))).doc;
      doc = add(doc, lv, { type: 'slab', source: { k: 'auto' } }).doc;
    }
    doc = commit(doc, addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper.levelId }, axis: line([2000, 1000], [2000, 4750]), width: 1000 }).ops);
    doc = add(doc, ground, { type: 'void', region: { outer: rectPath(5000, 2000, 1000, 1000), holes: [] } }).doc;
    const [g, u] = deriveBuildingSolids(doc, options).levels;
    const full = 8200 * 6200;
    expect(near(meshVolume(part(g, 'slab')!), (full - 1000 * 1000) * 200)).toBe(true);
    expect(near(meshVolume(part(u, 'slab')!), (full - 1000 * 3750) * 200, 1e-4)).toBe(true);
    expect(closed(part(u, 'slab')!)).toBe(true);
    expect(u.floor.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(full - 1000 * 3750, -2);
  });

  it('runs a column to the floor above, or to the top of its span', () => {
    let doc = newProjectDoc({ name: 'Columns' });
    const ground = doc.building.groundLevelId;
    const l1 = addLevelOps(doc, { name: 'Level 1' });
    doc = commit(doc, l1.ops);
    const l2 = addLevelOps(doc, { name: 'Level 2' });
    doc = commit(doc, l2.ops);
    doc = add(doc, ground, { type: 'column', at: [0, 0], shape: { k: 'rect', w: 300, d: 300 } }).doc;
    doc = add(doc, ground, { type: 'column', at: [2000, 0], shape: { k: 'rect', w: 300, d: 300 }, span: { topLevelId: l2.levelId } }).doc;
    const g = deriveBuildingSolids(doc, options).levels[0];
    const columns = part(g, 'column')!;
    expect(closed(columns)).toBe(true);
    expect(near(meshVolume(columns), 300 * 300 * (2800 + 6000))).toBe(true);
  });

  it('leaves out what sits on a hidden layer', () => {
    const { doc, ground } = room();
    const structure = Object.values(doc.layers).find((l) => l.levelId === ground && l.kind === 'structure')!;
    const hidden = commit(doc, [{ t: 'upd', c: 'layer', id: structure.id, set: { visible: false } }]);
    const level = deriveLevelSolids(hidden, ground, options);
    expect(level.parts).toEqual([]);
  });

  it('cuts the walls at a height for the cutaway view', () => {
    const { doc, ground } = room();
    const level = deriveLevelSolids(doc, ground, { ...options, cutHeight: 1200 });
    const walls = part(level, 'wall')!;
    expect(closed(walls)).toBe(true);
    expect(meshBox(walls)!.max[2]).toBe(1200);
    expect(near(meshVolume(walls), RING * 1200 - DOOR * 1200 - WINDOW * 300)).toBe(true);
    expect(meshBox(part(level, 'glass')!)!.max[2]).toBe(1200);
    // Only the cut level is cut.
    expect(meshBox(part(deriveBuildingSolids(doc, { ...options, cut: { levelId: 'lvl_none', height: 1200 } }).levels[0], 'wall')!)!.max[2]).toBe(3000);
  });

  it('builds 5,000 walls within a loose bound', () => {
    let doc = newProjectDoc({ name: 'Grid' });
    const ground = doc.building.groundLevelId;
    const ops: Op[] = [];
    for (let i = 0; i <= 50; i++) {
      for (let j = 0; j < 50; j++) {
        ops.push(...addEntityOps(doc, { levelId: ground, entity: wall(line([j * 3000, i * 3000], [(j + 1) * 3000, i * 3000])) }).ops);
        ops.push(...addEntityOps(doc, { levelId: ground, entity: wall(line([i * 3000, j * 3000], [i * 3000, (j + 1) * 3000])) }).ops);
      }
    }
    doc = commit(doc, ops);
    const started = performance.now();
    const level = deriveLevelSolids(doc, ground, options);
    const ms = performance.now() - started;
    // eslint-disable-next-line no-console
    console.log(`${Object.keys(doc.levelData[ground].entities).length} walls in 3D: ${ms.toFixed(0)} ms`);
    expect(part(level, 'wall')).toBeDefined();
    expect(ms).toBeLessThan(5000);
  });
});
