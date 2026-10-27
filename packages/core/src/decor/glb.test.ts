import { describe, expect, it } from 'vitest';
import { MeshBuilder, meshVolume } from '../solids/mesh';
import { gltfToGlb, inspectGlb, inspectGltf, meshToGlb, packGlb, readGlbChunks, readGlbTriangles, writeGlb, writeGlbScene, type GltfJson } from './glb';

/** A box in the app's terms: x0..x1, y0..y1, z0..z1 mm. */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  new MeshBuilder()
    .prism(
      [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
      ],
      z0,
      z1,
    )
    .build();

const sofa = () => writeGlb([meshToGlb(box(-1000, -450, 0, 1000, 450, 800), [0.5, 0.5, 0.6, 1], 'body')]);

describe('GLB', () => {
  it('writes a model and reads it back with its extent in mm, z up', () => {
    const bytes = sofa();
    expect(bytes.length % 4).toBe(0);
    const { json, bin } = readGlbChunks(bytes);
    expect(json.asset?.version).toBe('2.0');
    expect(bin?.length).toBeGreaterThan(0);
    const info = inspectGlb(bytes);
    expect(info.min).toEqual([-1000, -450, 0]);
    expect(info.size).toEqual([2000, 900, 800]);
    expect(info.meshes).toBe(1);
    expect(info.triangles).toBe(12);
  });

  it('follows node transforms: a box scaled and moved in glTF metres, y up', () => {
    const { json, bin } = readGlbChunks(writeGlb([meshToGlb(box(0, -1000, 0, 1000, 0, 1000), [1, 1, 1, 1])]));
    // A unit cube (glTF 0..1 on every axis), scaled 2 along glTF x and moved 1 m up.
    json.nodes = [{ children: [1], translation: [0, 1, 0] }, { mesh: 0, scale: [2, 1, 1] }];
    json.scenes = [{ nodes: [0] }];
    const info = inspectGltf(json, bin);
    expect(info.min).toEqual([0, -1000, 1000]);
    expect(info.size).toEqual([2000, 1000, 1000]);
  });

  it('turns a 90° rotation about glTF y into a turn on the plan', () => {
    const { json, bin } = readGlbChunks(writeGlb([meshToGlb(box(0, -500, 0, 2000, 0, 300), [1, 1, 1, 1])]));
    const s = Math.SQRT1_2;
    json.nodes = [{ mesh: 0, rotation: [0, s, 0, s] }];
    const info = inspectGltf(json, bin);
    expect(info.size[0]).toBeCloseTo(500, 3);
    expect(info.size[1]).toBeCloseTo(2000, 3);
    expect(info.size[2]).toBeCloseTo(300, 3);
  });

  it('refuses damaged and hostile files with a reason', () => {
    const good = sofa();
    expect(() => inspectGlb(new Uint8Array(10))).toThrow(/too short/);
    expect(() => inspectGlb(new TextEncoder().encode('{"asset":{"version":"2.0"}} padding'))).toThrow(/not a GLB/);
    expect(() => inspectGlb(good.subarray(0, good.length - 8))).toThrow(/truncated/);
    // An accessor that claims more elements than its buffer view holds.
    const { json, bin } = readGlbChunks(good);
    json.accessors![0].count = 100000;
    expect(() => inspectGlb(packGlb(json, bin))).toThrow(/reads past the end/);
    // A buffer view past its buffer.
    const second = readGlbChunks(good);
    second.json.bufferViews![0].byteLength = 1 << 30;
    expect(() => inspectGlb(packGlb(second.json, second.bin))).toThrow(/runs past the end/);
    // Indices into nothing.
    const third = readGlbChunks(good);
    third.json.nodes![0].mesh = 5;
    expect(() => inspectGlb(packGlb(third.json, third.bin))).toThrow(/mesh that does not exist/);
    // A node that is its own child.
    const fourth = readGlbChunks(good);
    fourth.json.nodes![0].children = [0];
    expect(() => inspectGlb(packGlb(fourth.json, fourth.bin))).toThrow(/cycle/);
  });

  it('refuses compressed meshes and textures it cannot read', () => {
    for (const [ext, why] of [
      ['KHR_draco_mesh_compression', /Draco/],
      ['EXT_meshopt_compression', /meshopt/],
      ['KHR_texture_basisu', /KTX2/],
    ] as const) {
      const { json, bin } = readGlbChunks(sofa());
      json.extensionsUsed = [ext];
      expect(() => inspectGlb(packGlb(json, bin))).toThrow(why);
    }
  });

  it('packs a .gltf with embedded buffers into one GLB', () => {
    const { json, bin } = readGlbChunks(sofa());
    let text = '';
    for (const b of bin!) text += String.fromCharCode(b);
    // Split the buffer in two, as some exporters do.
    const half = json.bufferViews![1].byteOffset!;
    const first = btoa(text.slice(0, half));
    const second = btoa(text.slice(half));
    const gltf: GltfJson = {
      ...json,
      buffers: [
        { byteLength: half, uri: `data:application/octet-stream;base64,${first}` },
        { byteLength: bin!.length - half, uri: `data:application/octet-stream;base64,${second}` },
      ],
      bufferViews: json.bufferViews!.map((v, i) => (i === 0 ? v : { ...v, buffer: 1, byteOffset: v.byteOffset! - half })),
    };
    expect(inspectGltf(gltf, null).size).toEqual([2000, 900, 800]);
    const glb = gltfToGlb(gltf);
    expect(inspectGlb(glb).size).toEqual([2000, 900, 800]);
    expect(readGlbChunks(glb).json.buffers).toHaveLength(1);
    expect(() => inspectGltf({ ...json, buffers: [{ byteLength: 10, uri: 'sofa.bin' }] }, null)).toThrow(/outside file/);
  });

  it('writes a node tree in one aligned buffer, with shared materials and node matrices', () => {
    const a = meshToGlb(box(0, 0, 0, 1000, 1000, 1000), [1, 0, 0, 1]);
    // Indexed: one triangle of its 36 points.
    const indexed = { ...meshToGlb(box(0, 0, 0, 500, 500, 500), [1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
    const clear = { ...meshToGlb(box(0, 0, 0, 100, 100, 100), [0, 0, 1, 0.4]), doubleSided: true, material: 'glass' };
    const glb = writeGlbScene({
      name: 'Root',
      children: [
        { name: 'Level', children: [{ name: 'Walls', meshes: [{ ...a, material: 'wall' }, { ...indexed, material: 'wall' }, clear] }] },
        // Moved 2 m along glTF x.
        { name: 'Item', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1], meshes: [{ ...a, material: 'wall' }] },
      ],
    });
    const { json } = readGlbChunks(glb);
    expect(json.nodes!.map((n) => (n as { name?: string }).name)).toEqual(['Root', 'Level', 'Walls', 'Item']);
    expect(json.scenes![0].nodes).toEqual([0]);
    expect(json.meshes![0].primitives).toHaveLength(3);
    expect(json.meshes![0].name).toBe('Walls');
    // Same values, one material; the clear one blends and shows both sides.
    expect(json.materials).toHaveLength(2);
    expect(json.materials![1]).toMatchObject({ name: 'glass', alphaMode: 'BLEND', doubleSided: true });
    for (const v of json.bufferViews!) expect((v.byteOffset ?? 0) % 4).toBe(0);
    for (const p of json.meshes!.flatMap((m) => m.primitives)) {
      const pos = json.accessors![p.attributes.POSITION];
      expect(pos.min).toHaveLength(3);
      expect(pos.max).toHaveLength(3);
    }
    const info = inspectGlb(glb);
    expect(info.triangles).toBe(12 + 1 + 12 + 12);
    expect(info.max[0]).toBeCloseTo(3000, 3);
    // The writer of plain meshes still writes a root node per mesh.
    const plain = readGlbChunks(writeGlb([{ ...a, name: 'one' }, { ...a, name: 'two' }])).json;
    expect(plain.scenes![0].nodes).toEqual([0, 1]);
    expect(plain.materials!.map((m) => m.name)).toEqual(['one', 'two']);
  });

  it('keeps a mirrored node facing outwards: its triangles are wound back counter-clockwise', () => {
    const { json, bin } = readGlbChunks(writeGlb([meshToGlb(box(0, 0, 0, 1000, 1000, 1000), [1, 1, 1, 1])]));
    const volume = (j: GltfJson) => meshVolume({ positions: readGlbTriangles(packGlb(j, bin)).at(0)!.positions });
    expect(volume(json)).toBeCloseTo(1e9, -3);
    // Mirrored along glTF x by its scale, then by a matrix; mirrored twice is not mirrored.
    expect(volume({ ...json, nodes: [{ mesh: 0, scale: [-1, 1, 1] }] })).toBeCloseTo(1e9, -3);
    expect(volume({ ...json, nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] })).toBeCloseTo(1e9, -3);
    expect(volume({ ...json, nodes: [{ children: [1], scale: [1, 1, -1] }, { mesh: 0, scale: [-1, 1, 1] }], scenes: [{ nodes: [0] }] })).toBeCloseTo(1e9, -3);
  });

  it('reads a material’s alpha, alpha mode and sides with its triangles', () => {
    const clear = { ...meshToGlb(box(0, 0, 0, 100, 100, 100), [0, 0, 1, 0.4]), doubleSided: true, material: 'glass' };
    const leaves = { ...meshToGlb(box(0, 0, 0, 100, 100, 100), [0, 1, 0, 0.8]), alphaMode: 'MASK' as const, alphaCutoff: 0.3, material: 'leaves' };
    const solid = meshToGlb(box(0, 0, 0, 100, 100, 100), [1, 0, 0, 1], 'solid');
    const read = readGlbTriangles(writeGlb([clear, leaves, solid]));
    expect(read.map(({ material, alpha, alphaMode, alphaCutoff, doubleSided }) => ({ material, alpha: Math.round(alpha * 10) / 10, alphaMode, alphaCutoff, doubleSided }))).toEqual([
      { material: 'glass', alpha: 0.4, alphaMode: 'BLEND', alphaCutoff: undefined, doubleSided: true },
      { material: 'leaves', alpha: 0.8, alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: false },
      { material: 'solid', alpha: 1, alphaMode: 'OPAQUE', alphaCutoff: undefined, doubleSided: false },
    ]);
  });
});
