import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeshBuilder, gltfMaterialSlots, inspectGlb, meshToGlb, readGlbChunks, writeGlb, type Asset, type Entity, type Layer } from '@studio/core';
import { BoxGeometry, Mesh, MeshStandardMaterial, type Group, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LevelDecor, type DecorContext } from './decor';
import { DecorMaterials } from './materials';
import { MODEL_RETRY_MS, ModelCache, modelFromGltf } from './models';
import { BuildingScene } from './scene';
import { DARK_SCENE_THEME, LIGHT_SCENE_THEME } from './theme';

type Item = Extract<Entity, { type: 'item' }>;

const FILE = `${'a'.repeat(64)}.glb`;
const LONG = `  ${'Walnut veneer, satin lacquered, '.repeat(3)}  `;

/** Three boxes: one in an unnamed material, one in a padded name longer than a slot, one without normals (three shades it flat). */
function modelGlb(): Uint8Array {
  const box = (x: number) => new MeshBuilder().prism([[[x, 0], [x + 400, 0], [x + 400, 400], [x, 400]]], 0, 400).build();
  const plain = meshToGlb(box(0), [0.5, 0.5, 0.5, 1]);
  const long = { ...meshToGlb(box(500), [0.4, 0.3, 0.2, 1]), material: LONG };
  const { normals: _drop, ...bare } = { ...meshToGlb(box(1000), [0.2, 0.2, 0.2, 1]), material: 'Bare' };
  return writeGlb([plain, long, bare]);
}

const parse = (bytes: Uint8Array) => new GLTFLoader().parseAsync(bytes.slice().buffer, '');

const meshes = (o: { traverse: (f: (o: unknown) => void) => void }) => {
  const out: Mesh[] = [];
  o.traverse((m) => {
    if (m instanceof Mesh) out.push(m);
  });
  return out;
};

const asset: Asset = { id: FILE, kind: 'model', name: 'Boxes', category: 'imported', size: [1400, 400, 400], min: [0, -400, 0] };
const layers: Record<string, Layer> = {};
const item = (materials: Record<string, string>): Item => ({ id: 'itm_0000000000000001', type: 'item', levelId: 'lvl_0000000000000001', layerId: 'lay_0000000000000001', asset: `asset:${FILE}`, at: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], materials });

function context(model: Group | null | undefined): DecorContext & { standIn: MeshStandardMaterial } {
  return { materials: new DecorMaterials(), models: { get: () => model } as unknown as ModelCache, modelUrl: (f) => f, standIn: new MeshStandardMaterial() };
}

afterEach(() => vi.unstubAllGlobals());

describe('imported models in 3D', () => {
  it('marks each material with the slot core gives it, so unnamed and long names repaint', async () => {
    const bytes = modelGlb();
    const slots = gltfMaterialSlots(readGlbChunks(bytes).json);
    expect(slots).toEqual(['material-0', LONG.trim().slice(0, 60), 'Bare']);
    expect(inspectGlb(bytes).materials).toEqual(slots);
    const model = modelFromGltf(await parse(bytes));
    expect(meshes(model).map((m) => (m.material as Material).userData['slot'])).toEqual(slots);

    const ctx = context(model);
    const decor = new LevelDecor('lvl_0000000000000001');
    decor.update({ [item({}).id]: item({ 'material-0': 'paint:#ff0000', [slots[1]]: 'builtin:walnut', Bare: 'paint:#00ff00' }) }, { [FILE]: asset }, layers, 0, ctx);
    const drawn = meshes(decor.group).map((m) => m.material as MeshStandardMaterial);
    expect(drawn.map((m) => m.name)).toEqual(['paint:#ff0000', 'builtin:walnut', 'paint:#00ff00']);
    // The primitive without normals keeps its flat shading in its repaint; the others shade smooth.
    expect(drawn.map((m) => m.flatShading)).toEqual([false, false, true]);
    expect(drawn[2]).toBe(ctx.materials.get('paint:#00ff00', undefined, false, true));
    expect(drawn[2]).not.toBe(ctx.materials.get('paint:#00ff00'));
  });

  it('draws a stand-in box in the theme colour and frees its geometry when it goes', () => {
    const ctx = context(undefined);
    const decor = new LevelDecor('lvl_0000000000000001');
    const e = item({});
    decor.update({ [e.id]: e }, { [FILE]: asset }, layers, 0, ctx);
    const [box] = meshes(decor.group);
    expect(box.geometry).toBeInstanceOf(BoxGeometry);
    expect(box.material).toBe(ctx.standIn);
    const freed = vi.fn();
    box.geometry.addEventListener('dispose', freed);
    decor.update({}, { [FILE]: asset }, layers, 0, ctx);
    expect(freed).toHaveBeenCalledOnce();
    expect(meshes(decor.group)).toHaveLength(0);
    // The scene's stand-in material follows the theme.
    const scene = new BuildingScene(LIGHT_SCENE_THEME);
    const standIn = (scene as unknown as { standIn: MeshStandardMaterial }).standIn;
    expect(`#${standIn.color.getHexString()}`).toBe(LIGHT_SCENE_THEME.standIn);
    scene.setTheme(DARK_SCENE_THEME);
    expect(`#${standIn.color.getHexString()}`).toBe(DARK_SCENE_THEME.standIn);
    scene.dispose();
  });

  it('tries a model that failed to load again, after a while or when asked', async () => {
    const bytes = modelGlb();
    let ok = false;
    const fetch = vi.fn(async () => (ok ? new Response(bytes.slice()) : new Response('gone', { status: 404, statusText: 'Not Found' })));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new ModelCache();
    expect(cache.get('m.glb')).toBeUndefined();
    await cache.settled();
    expect(cache.get('m.glb')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    // Within the wait it stays failed; past it, the next build fetches again.
    now += MODEL_RETRY_MS - 1;
    expect(cache.get('m.glb')).toBeNull();
    now += 1;
    expect(cache.get('m.glb')).toBeUndefined();
    await cache.settled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.get('m.glb')).toBeNull();
    // An asset announced again: tried at once, and now it loads.
    ok = true;
    cache.retryFailed();
    expect(cache.get('m.glb')).toBeUndefined();
    await cache.settled();
    expect(cache.get('m.glb')).toBeInstanceOf(Object);
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});
