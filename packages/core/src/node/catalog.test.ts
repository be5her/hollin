import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meshToGlb, readGlbChunks, writeGlb } from '../decor/glb';
import { newProjectDoc } from '../doc/defaults';
import { MeshBuilder } from '../solids/mesh';
import { Library } from './library';
import { libraryUrlFile } from './library-urls';

let root: string;
let library: Library;
const changes: string[] = [];

const cube = (size: number) =>
  writeGlb([
    meshToGlb(
      new MeshBuilder()
        .prism(
          [
            [
              [-size / 2, -size / 2],
              [size / 2, -size / 2],
              [size / 2, size / 2],
              [-size / 2, size / 2],
            ],
          ],
          0,
          size,
        )
        .build(),
      [0.8, 0.2, 0.2, 1],
    ),
  ]);

async function file(name: string, data: Uint8Array | string): Promise<string> {
  const target = path.join(root, 'in', name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return target;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-cat-'));
  changes.length = 0;
  library = new Library(path.join(root, 'Library'), { onCatalogChange: (reason) => changes.push(reason) });
  await library.open();
});
afterEach(async () => {
  await library.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('Catalog', () => {
  it('imports a GLB under its hash with its size, once', async () => {
    const bytes = cube(600);
    const { model, added } = await library.catalog.importModel(await file('Modern_side-table.glb', bytes));
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(added).toBe(true);
    expect(model).toMatchObject({ ref: `asset:${sha}.glb`, file: `${sha}.glb`, name: 'Modern side table', category: 'imported', size: [600, 600, 600], min: [-300, -300, 0], triangles: 12 });
    expect(model.tags).toEqual(['modern', 'side', 'table']);
    expect(await fs.readFile(path.join(library.catalogDir, 'furniture', model.file))).toEqual(Buffer.from(bytes));
    const index = JSON.parse(await fs.readFile(path.join(library.catalogDir, 'furniture', 'index.json'), 'utf8'));
    expect(index.models.map((m: { file: string }) => m.file)).toEqual([model.file]);
    const again = await library.catalog.importModel(await file('copy.glb', bytes));
    expect(again.added).toBe(false);
    expect(library.catalog.models()).toHaveLength(1);
    expect(changes).toEqual(['imported']);
  });

  it('stores a self-contained .gltf as a GLB', async () => {
    const { json, bin } = readGlbChunks(cube(1000));
    let text = '';
    for (const b of bin!) text += String.fromCharCode(b);
    const gltf = { ...json, buffers: [{ byteLength: bin!.length, uri: `data:application/octet-stream;base64,${btoa(text)}` }] };
    const { model } = await library.catalog.importModel(await file('crate.gltf', JSON.stringify(gltf)));
    expect(model.file).toMatch(/^[0-9a-f]{64}\.glb$/);
    expect(model.size).toEqual([1000, 1000, 1000]);
    const stored = await fs.readFile(path.join(library.catalogDir, 'furniture', model.file));
    expect(stored.subarray(0, 4).toString()).toBe('glTF');
  });

  it('refuses what it cannot use, and keeps nothing of it', async () => {
    await expect(library.catalog.importModel(await file('chair.obj', 'v 0 0 0'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(library.catalog.importModel(await file('broken.glb', cube(500).subarray(0, 100)))).rejects.toThrow(/truncated/);
    await expect(library.catalog.importModel(await file('bad.gltf', '{nope'))).rejects.toThrow(/not valid JSON/);
    await expect(library.catalog.importModel(path.join(root, 'missing.glb'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const big = path.join(root, 'in', 'huge.glb');
    await fs.writeFile(big, '');
    await fs.truncate(big, 51 * 1024 * 1024);
    await expect(library.catalog.importModel(big)).rejects.toThrow(/larger than 50 MB/);
    expect((await fs.readdir(path.join(library.catalogDir, 'furniture'))).filter((f) => f.endsWith('.glb'))).toEqual([]);
  });

  it('rebuilds a missing or broken index from the files, and drops what is gone', async () => {
    const a = (await library.catalog.importModel(await file('a.glb', cube(500)))).model;
    const b = (await library.catalog.importModel(await file('b.glb', cube(700)))).model;
    await library.close();
    await fs.writeFile(path.join(library.catalogDir, 'furniture', 'index.json'), 'garbage');
    await fs.rm(path.join(library.catalogDir, 'furniture', b.file));
    library = new Library(library.root);
    await library.open();
    expect(library.catalog.models().map((m) => [m.file, m.size[0]])).toEqual([[a.file, 500]]);
    expect((await library.catalog.reindex()).models).toBe(1);
  });

  it('removes a model with its thumbnail, stores thumbnails, and copies models into projects', async () => {
    const { model } = await library.catalog.importModel(await file('lamp.glb', cube(300)));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    await expect(library.catalog.setThumbnail(model.file, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow(/PNG/);
    expect((await library.catalog.setThumbnail(model.file, png)).thumbnail).toMatch(/^[0-9a-f]{10}$/);
    const project = await library.create(newProjectDoc({ name: 'Flat' }));
    const dir = library.projectDir(project.id);
    await library.catalog.copyToProject(model.file, dir);
    await library.catalog.copyToProject(model.file, dir);
    expect(createHash('sha256').update(await fs.readFile(path.join(dir, 'assets', model.file))).digest('hex')).toBe(model.file.slice(0, 64));
    await library.catalog.removeModel(model.file);
    expect(library.catalog.models()).toEqual([]);
    expect(await fs.readdir(path.join(library.catalogDir, 'furniture'))).toEqual(['index.json']);
    // The project keeps its copy.
    expect((await fs.stat(path.join(dir, 'assets', model.file))).isFile()).toBe(true);
    await expect(library.catalog.removeModel(model.file)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('library:// URLs', () => {
  it('serve project thumbnails and assets and catalog models, and nothing else', async () => {
    const project = await library.create(newProjectDoc({ name: 'Flat' }));
    const sha = 'a'.repeat(64);
    const at = (url: string) => libraryUrlFile(library, url);
    expect(at(`library://project/${project.id}/assets/${sha}.glb`)).toEqual({ file: path.join(library.projectDir(project.id), 'assets', `${sha}.glb`), type: 'model/gltf-binary' });
    expect(at(`library://project/${project.id}/assets/${sha}.png?v=3`)?.type).toBe('image/png');
    expect(at(`library://catalog/furniture/${sha}.glb`)).toEqual({ file: path.join(library.catalogDir, 'furniture', `${sha}.glb`), type: 'model/gltf-binary' });
    expect(at(`library://catalog/furniture/${sha}.png`)?.type).toBe('image/png');
    for (const url of [
      `library://project/${project.id}/assets/../project.json`,
      `library://project/${project.id}/assets/%2e%2e%2fproject.json`,
      `library://project/${project.id}/assets/model.glb`,
      `library://project/${project.id}/assets/${sha}`,
      `library://project/${project.id}/project.json`,
      `library://project/${project.id}/levels/x.json`,
      `library://project/prj_0000000000000000/assets/${sha}.glb`,
      `library://project/../config.json`,
      `library://catalog/furniture/index.json`,
      `library://catalog/furniture/${sha}.gltf`,
      `library://catalog/materials/${sha}.png`,
      `library://elsewhere/${sha}.glb`,
      'not a url',
    ]) {
      expect(at(url), url).toBeNull();
    }
    // No thumbnail stored yet.
    expect(at(`library://project/${project.id}/thumbnail.png`)).toBeNull();
  });
});
