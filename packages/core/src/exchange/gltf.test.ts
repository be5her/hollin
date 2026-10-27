import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { inspectGlb, meshToGlb, packGlb, readGlbChunks, readGlbTriangles, writeGlb } from '../decor/glb';
import { recipeMeshes } from '../decor/recipes';
import { builtinRecipe } from '../decor/builtin';
import type { ProjectDoc } from '../doc/schema';
import { deriveBuildingSolids } from '../solids/building';
import { MeshBuilder, meshVolume } from '../solids/mesh';
import { buildingToGlb, srgbToLinear } from './gltf';
import { drawingHouse } from './house.fixture';

const TABLE_FILE = `${'a'.repeat(64)}.glb`;
const TABLE_REF = `asset:${TABLE_FILE}`;
const PAINT = 'paint:#aabbcc';

/** An imported model: a 1200 × 600 × 750 mm table, a top on a block. */
function tableGlb(): Uint8Array {
  const rect = (w: number, d: number) => [
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as [number, number][],
  ];
  const top = new MeshBuilder().prism(rect(1200, 600), 700, 750).build();
  const base = new MeshBuilder().prism(rect(800, 400), 0, 700).build();
  return writeGlb([meshToGlb(top, [0.55, 0.35, 0.2, 1], 'top'), meshToGlb(base, [0.2, 0.2, 0.22, 1], 'base')]);
}

/** The exchange house with its outer ground-floor wall painted on one face and an imported table upstairs. */
function house() {
  const base = drawingHouse();
  const doc = structuredClone(base.doc) as unknown as { levelData: Record<string, { entities: Record<string, unknown> }> } & Omit<ProjectDoc, 'levelData'>;
  const outer = doc.levelData[base.ground].entities[(base.ids as Record<string, string>).outer] as { materials?: unknown };
  outer.materials = { left: PAINT, right: PAINT };
  doc.assets[TABLE_FILE] = { id: TABLE_FILE, kind: 'model', name: 'Imported table', category: 'imported', size: [1200, 600, 750], min: [-600, -300, 0], slots: ['top', 'base'] };
  const layerId = (Object.values(doc.levelData[base.ground].entities)[0] as { layerId: string }).layerId;
  doc.levelData[base.upper].entities['itm_imported00000'] = { id: 'itm_imported00000', type: 'item', layerId, asset: TABLE_REF, at: [6000, 3000, 0], rotation: [0, 0, 90], scale: [1, 1, 1], materials: {} };
  return { ...base, doc: doc as unknown as ProjectDoc };
}

const nodeNames = (glb: Uint8Array) => (readGlbChunks(glb).json.nodes ?? []).map((n) => (n as { name?: string }).name);
const triangleCount = (positions: Float32Array) => positions.length / 9;

describe('buildingToGlb', () => {
  const { doc, ground, upper } = house();
  const bytes = tableGlb();
  const assetBytes = (ref: string) => (ref === TABLE_REF ? bytes : undefined);
  const result = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS, assetBytes });
  const solids = deriveBuildingSolids(doc, { limits: DEFAULT_RULE_LIMITS });

  it('writes a GLB its own reader accepts, its nodes named after the project, the levels, the connectors and the furniture', () => {
    const info = inspectGlb(result.glb);
    expect(info.triangles).toBe(result.triangles);
    const names = nodeNames(result.glb);
    expect(names[0]).toBe('House');
    for (const name of ['Ground floor', 'Upper', 'Walls', 'Slabs', 'Glass', 'Finishes', 'Stair', 'Elevator', 'Coffee table', 'Imported table']) expect(names).toContain(name);
    expect(result.nodes).toBe(names.length);
    expect(result.skipped).toEqual([]);
    const json = readGlbChunks(result.glb).json;
    const root = json.nodes![json.scenes![0].nodes![0]];
    expect(root.children!.map((c) => (json.nodes![c] as { name?: string }).name)).toEqual(['Ground floor', 'Upper']);
  });

  it('counts every triangle of the solids and the furniture', () => {
    let expected = 0;
    for (const l of solids.levels) for (const p of l.parts) expected += triangleCount(p.mesh.positions);
    for (const c of solids.connectors) for (const p of c.parts) expected += triangleCount(p.mesh.positions);
    for (const { mesh } of recipeMeshes(builtinRecipe('coffee-table')!)) expected += triangleCount(mesh.positions);
    for (const t of readGlbTriangles(bytes)) expected += triangleCount(t.positions);
    expect(result.triangles).toBe(expected);
  });

  it('writes a painted face in its colour and glass see-through', () => {
    const tris = readGlbTriangles(result.glb);
    const painted = tris.find((t) => t.material === PAINT);
    expect(painted).toBeDefined();
    const [r, g, b] = srgbToLinear('#aabbcc');
    expect(painted!.color[0]).toBeCloseTo(r, 5);
    expect(painted!.color[1]).toBeCloseTo(g, 5);
    expect(painted!.color[2]).toBeCloseTo(b, 5);
    const glass = (readGlbChunks(result.glb).json.materials as { name?: string; alphaMode?: string; doubleSided?: boolean; pbrMetallicRoughness: { baseColorFactor: number[] } }[]).find((m) => m.name === 'glass');
    expect(glass?.alphaMode).toBe('BLEND');
    expect(glass?.doubleSided).toBe(true);
    expect(glass?.pbrMetallicRoughness.baseColorFactor[3]).toBeLessThan(1);
  });

  it('keeps the walls in metres, y up: their volume read back matches the solids within 1 %', () => {
    const one = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS, levelIds: [ground], includeItems: false });
    const walls = readGlbTriangles(one.glb).filter((t) => t.material === 'wall');
    const positions = new Float32Array(walls.reduce((n, t) => n + t.positions.length, 0));
    let at = 0;
    for (const t of walls) {
      positions.set(t.positions, at);
      at += t.positions.length;
    }
    const expected = meshVolume(solids.levels.find((l) => l.levelId === ground)!.parts.find((p) => p.kind === 'wall')!.mesh);
    expect(expected).toBeGreaterThan(0);
    expect(Math.abs(meshVolume({ positions }) - expected) / expected).toBeLessThan(0.01);
    expect(nodeNames(one.glb)).not.toContain('Upper');
  });

  it('places furniture with its 4 × 4 placement', () => {
    const tris = readGlbTriangles(result.glb).filter((t) => t.material === 'top');
    expect(tris).toHaveLength(1);
    const p = tris[0].positions;
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < p.length; i += 3) {
      xs.push(p[i]);
      ys.push(p[i + 1]);
      zs.push(p[i + 2]);
    }
    const upperElevation = solids.levels.find((l) => l.levelId === upper)!.elevation;
    // Turned 90°: 600 wide along x, 1200 along y, around (6000, 3000).
    expect(Math.min(...xs)).toBeCloseTo(5700, 1);
    expect(Math.max(...xs)).toBeCloseTo(6300, 1);
    expect(Math.min(...ys)).toBeCloseTo(2400, 1);
    expect(Math.max(...ys)).toBeCloseTo(3600, 1);
    expect(Math.max(...zs)).toBeCloseTo(upperElevation + 750, 1);
  });

  it('leaves the furniture out when asked, and the finishes', () => {
    const bare = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS, includeItems: false, includeFinishes: false, assetBytes });
    const names = nodeNames(bare.glb);
    expect(names).not.toContain('Coffee table');
    expect(names).not.toContain('Imported table');
    expect(names).not.toContain('Finishes');
    expect(readGlbTriangles(bare.glb).some((t) => t.material === PAINT)).toBe(false);
    expect(bare.triangles).toBeLessThan(result.triangles);
  });

  it('lists an imported model whose file is missing as skipped', () => {
    const missing = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS });
    expect(missing.skipped).toHaveLength(1);
    expect(missing.skipped[0]).toContain('Imported table');
    expect(nodeNames(missing.glb)).not.toContain('Imported table');
    expect(nodeNames(missing.glb)).toContain('Coffee table');
  });

  it('keeps an imported model’s alpha, alpha mode and sides', () => {
    const { json, bin } = readGlbChunks(bytes);
    Object.assign(json.materials![0], { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.6, 0.7, 0.5] }, alphaMode: 'BLEND', doubleSided: true });
    Object.assign(json.materials![1], { alphaMode: 'MASK', alphaCutoff: 0.25 });
    const clear = packGlb(json, bin);
    const out = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS, assetBytes: (ref) => (ref === TABLE_REF ? clear : undefined) });
    const materials = readGlbChunks(out.glb).json.materials as { name?: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean; pbrMetallicRoughness: { baseColorFactor: number[] } }[];
    const top = materials.find((m) => m.name === 'top');
    expect(top?.alphaMode).toBe('BLEND');
    expect(top?.doubleSided).toBe(true);
    expect(top?.pbrMetallicRoughness.baseColorFactor[3]).toBeCloseTo(0.5, 5);
    expect(materials.find((m) => m.name === 'base')).toMatchObject({ alphaMode: 'MASK', alphaCutoff: 0.25 });
  });

  it('lists an imported model without triangles as skipped', () => {
    const { json, bin } = readGlbChunks(bytes);
    // Its primitives as points: nothing to write.
    for (const m of json.meshes!) for (const p of m.primitives) p.mode = 0;
    const points = packGlb(json, bin);
    const out = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS, assetBytes: (ref) => (ref === TABLE_REF ? points : undefined) });
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatch(/Imported table .*no triangles/);
    expect(nodeNames(out.glb)).not.toContain('Imported table');
  });
});
