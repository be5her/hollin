import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_MODEL_BYTES, type CatalogModel } from '../decor/catalog';
import { gltfToGlb, inspectGlb, inspectGltf, readGlbChunks, type GltfJson } from '../decor/glb';
import { ASSET_FILE, assetRef } from '../decor/refs';
import { StudioError } from '../errors';
import { WriteQueue, readJsonFile, writeFileAtomic, writeJsonAtomic } from './atomic-write';

const INDEX_VERSION = 1;
const MODEL_FILE = /^([0-9a-f]{64})\.glb$/;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const ModelSchema = z.object({
  ref: z.string(),
  file: z.string().regex(MODEL_FILE),
  name: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  size: Vec3,
  min: Vec3,
  bytes: z.number(),
  triangles: z.number(),
  slots: z.array(z.string()).default([]),
  importedAt: z.string(),
  thumbnail: z.string().nullable(),
});
const IndexSchema = z.object({ version: z.literal(INDEX_VERSION), models: z.array(ModelSchema) });

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Words from a file name, for a model's name and tags: "modern_sofa-2seat.glb" → "modern sofa 2seat". */
function nameFromFile(source: string): string {
  const base = path.basename(source).replace(/\.(glb|gltf)$/i, '');
  const words = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (words || 'Model').slice(0, 200);
}

/**
 * The library's furniture catalog: models imported from `.glb` (or self-contained `.gltf`) files,
 * stored content-addressed as `catalog/furniture/<sha256>.glb`, with `index.json` beside them (a
 * cache: rebuilt from the files when it is missing, broken or out of step) and `<sha256>.png`
 * thumbnails the window draws. Every write is atomic and queued.
 */
export class Catalog {
  private readonly index = new Map<string, CatalogModel>();
  private readonly queue = new WriteQueue();

  constructor(
    readonly root: string,
    private readonly onChange?: (reason: string, file?: string) => void,
  ) {}

  get furnitureDir(): string {
    return path.join(this.root, 'furniture');
  }

  private get indexFile(): string {
    return path.join(this.furnitureDir, 'index.json');
  }

  modelPath(file: string): string {
    if (!MODEL_FILE.test(file)) throw new StudioError('INVALID_INPUT', `Not a catalog model: ${file}`);
    return path.join(this.furnitureDir, file);
  }

  thumbnailPath(file: string): string {
    return this.modelPath(file).replace(/\.glb$/, '.png');
  }

  async open(): Promise<void> {
    await fs.mkdir(this.furnitureDir, { recursive: true });
    this.index.clear();
    const parsed = IndexSchema.safeParse(await readJsonFile(this.indexFile).catch(() => undefined));
    if (parsed.success) for (const m of parsed.data.models) this.index.set(m.file, m);
    await this.reconcile(!parsed.success);
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** Brings the index in line with the model files: new files are measured and listed, missing ones dropped. */
  private async reconcile(forceWrite: boolean): Promise<number> {
    const files = (await fs.readdir(this.furnitureDir).catch(() => [] as string[])).filter((f) => MODEL_FILE.test(f));
    let changed = forceWrite;
    for (const file of files) {
      if (this.index.has(file)) continue;
      const model = await this.describe(file, undefined).catch((err: Error) => {
        console.warn(`[catalog] skipped ${file}: ${err.message}`);
        return null;
      });
      if (model) {
        this.index.set(file, model);
        changed = true;
      }
    }
    for (const file of [...this.index.keys()]) {
      if (!files.includes(file)) {
        this.index.delete(file);
        changed = true;
      }
    }
    if (changed) await this.saveIndex();
    return this.index.size;
  }

  /**
   * Rebuilds the index from the files, keeping the names and tags it knew. The new index is built
   * aside and swapped in at the end, so lookups meanwhile still find every model; an import or a
   * removal made while it ran is kept.
   */
  async reindex(): Promise<{ models: number }> {
    const known = new Map(this.index);
    const next = new Map<string, CatalogModel>();
    const files = (await fs.readdir(this.furnitureDir).catch(() => [] as string[])).filter((f) => MODEL_FILE.test(f));
    for (const file of files) {
      const model = await this.describe(file, known.get(file)).catch(() => null);
      if (model) next.set(file, model);
    }
    for (const [file, model] of this.index) if (!known.has(file)) next.set(file, model);
    for (const file of known.keys()) if (!this.index.has(file)) next.delete(file);
    this.index.clear();
    for (const [file, model] of next) this.index.set(file, model);
    await this.saveIndex();
    this.onChange?.('reindexed');
    return { models: this.index.size };
  }

  /** Reads and measures a stored model file. */
  private async describe(file: string, known: CatalogModel | undefined): Promise<CatalogModel> {
    const bytes = new Uint8Array(await fs.readFile(this.modelPath(file)));
    if (sha256(bytes) !== MODEL_FILE.exec(file)![1]) throw new StudioError('INVALID_INPUT', `${file} does not match its checksum`);
    const info = inspectGlb(bytes);
    const thumb = await fs.stat(this.thumbnailPath(file)).catch(() => null);
    return {
      ref: assetRef(file),
      file,
      name: known?.name ?? `Model ${file.slice(0, 8)}`,
      category: known?.category ?? 'imported',
      tags: known?.tags ?? [],
      size: info.size,
      min: info.min,
      bytes: bytes.length,
      triangles: info.triangles,
      slots: info.materials,
      importedAt: known?.importedAt ?? new Date().toISOString(),
      thumbnail: thumb ? String(Math.round(thumb.mtimeMs)) : null,
    };
  }

  private saveIndex(): Promise<void> {
    const models = [...this.index.values()].sort((a, b) => a.importedAt.localeCompare(b.importedAt) || a.file.localeCompare(b.file));
    return this.queue.run('index', () => writeJsonAtomic(this.indexFile, { version: INDEX_VERSION, models }, { fsync: false }));
  }

  models(): CatalogModel[] {
    return [...this.index.values()];
  }

  model(file: string): CatalogModel | undefined {
    return this.index.get(file);
  }

  /**
   * Imports a model file: checks its size, structure, accessors and extensions, measures it, and
   * stores it under its content hash. A `.gltf` must carry its buffers as data URIs and is stored as
   * a `.glb`. Importing the same model twice lists it once.
   */
  async importModel(source: string): Promise<{ model: CatalogModel; added: boolean }> {
    const ext = path.extname(source).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') throw new StudioError('INVALID_INPUT', 'Import a .glb file (or a .gltf with its data embedded).');
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile()) throw new StudioError('NOT_FOUND', `No file at ${source}`);
    if (stat.size > MAX_MODEL_BYTES) throw new StudioError('INVALID_INPUT', `The model is larger than ${MAX_MODEL_BYTES / 1024 / 1024} MB.`);
    const raw = new Uint8Array(await fs.readFile(source));
    let glb: Uint8Array;
    if (ext === '.gltf') {
      let json: GltfJson;
      try {
        json = JSON.parse(new TextDecoder().decode(raw)) as GltfJson;
      } catch {
        throw new StudioError('INVALID_INPUT', 'Not a usable glTF model: the file is not valid JSON');
      }
      inspectGltf(json, null);
      glb = gltfToGlb(json);
    } else {
      readGlbChunks(raw);
      glb = raw;
    }
    const info = inspectGlb(glb);
    const file = `${sha256(glb)}.glb`;
    const existing = this.index.get(file);
    if (existing) return { model: existing, added: false };
    const target = this.modelPath(file);
    if (!(await fs.stat(target).catch(() => null))) await writeFileAtomic(target, glb);
    const model: CatalogModel = {
      ref: assetRef(file),
      file,
      name: nameFromFile(source),
      category: 'imported',
      tags: [...new Set(nameFromFile(source).toLowerCase().split(' ').filter((t) => t.length > 1))].slice(0, 10),
      size: info.size,
      min: info.min,
      bytes: glb.length,
      triangles: info.triangles,
      slots: info.materials,
      importedAt: new Date().toISOString(),
      thumbnail: null,
    };
    this.index.set(file, model);
    await this.saveIndex();
    this.onChange?.('imported', file);
    return { model, added: true };
  }

  async removeModel(file: string): Promise<void> {
    if (!this.index.has(file)) throw new StudioError('NOT_FOUND', `The catalog has no model ${file}`);
    await this.queue.run(`model:${file}`, async () => {
      await fs.rm(this.modelPath(file), { force: true });
      await fs.rm(this.thumbnailPath(file), { force: true });
    });
    this.index.delete(file);
    await this.saveIndex();
    this.onChange?.('removed', file);
  }

  async setThumbnail(file: string, png: Uint8Array): Promise<CatalogModel> {
    const model = this.index.get(file);
    if (!model) throw new StudioError('NOT_FOUND', `The catalog has no model ${file}`);
    if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) throw new StudioError('INVALID_INPUT', 'The thumbnail must be a PNG image');
    await this.queue.run(`thumb:${file}`, () => writeFileAtomic(this.thumbnailPath(file), png, { fsync: false }));
    const next = { ...model, thumbnail: createHash('sha1').update(png).digest('hex').slice(0, 10) };
    this.index.set(file, next);
    await this.saveIndex();
    this.onChange?.('thumbnail', file);
    return next;
  }

  /** Copies a model into a project folder's `assets/`, checking its hash; a copy already there is kept. */
  async copyToProject(file: string, projectDir: string): Promise<void> {
    if (!ASSET_FILE.test(file)) throw new StudioError('INVALID_INPUT', `Not an asset file: ${file}`);
    const target = path.join(projectDir, 'assets', file);
    const there = await fs.readFile(target).catch(() => null);
    if (there && sha256(new Uint8Array(there)) === file.slice(0, 64)) return;
    const bytes = await fs.readFile(this.modelPath(file)).catch(() => null);
    if (!bytes) throw new StudioError('NOT_FOUND', `The catalog has no model ${file}`);
    const data = new Uint8Array(bytes);
    if (sha256(data) !== file.slice(0, 64)) throw new StudioError('INVALID_INPUT', `The catalog's copy of ${file} is damaged`);
    await this.queue.run(`asset:${target}`, () => writeFileAtomic(target, data));
  }
}
