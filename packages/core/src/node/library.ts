import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ProjectDoc } from '../doc/schema';
import type { ListQuery, ProjectSummary, SnapshotInfo } from '../projects';
import { StudioError } from '../errors';
import { isId, newId } from '../ids';
import { WriteQueue, readJsonFile, renameWithRetry, writeFileAtomic, writeJsonAtomic } from './atomic-write';
import { exportPackage, importPackage, type PackageLimits } from './package';
import { PROJECT_FILE, readProjectDir, writeProjectDir } from './project-store';

export const LIBRARY_FORMAT = 1;
const INDEX_VERSION = 1;
/** Automatic snapshots kept per project; named ones are kept until deleted. */
export const AUTO_SNAPSHOTS_KEPT = 10;
const LOCK_FRESH_MS = 90_000;
const HEARTBEAT_MS = 30_000;

const SnapshotMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['named', 'auto']),
  createdAt: z.string(),
  createdBy: z.string(),
  levelCount: z.number(),
});

const SummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  openedAt: z.string().nullable(),
  levelCount: z.number(),
  thumbnail: z.string().nullable(),
  trashedAt: z.string().nullable(),
});
const IndexSchema = z.object({ version: z.literal(INDEX_VERSION), projects: z.array(SummarySchema) });

export interface LockHolder {
  host: string;
  pid: number;
  heartbeatAt: string;
}

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The project library: one folder the app owns.
 *
 *   library.json                    format marker
 *   index.json                      fast listing (rebuilt from disk when missing or stale)
 *   library.lock                    which machine and process uses the library
 *   projects/<id>/                  project.json, levels/, assets/, thumbnail.png, snapshots/, .local/
 *   trash/<id>/                     trashed projects, with trashed.json
 *   catalog/                        furniture, materials and symbols shared by every project
 *   .staging/                       imports and copies in progress
 */
export class Library {
  private readonly index = new Map<string, ProjectSummary>();
  private readonly queue = new WriteQueue();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Another live process that holds the library, found when it was opened. */
  lockedBy: LockHolder | null = null;

  constructor(
    readonly root: string,
    private readonly opts: { onChange?(reason: string, projectId?: string): void; appVersion?: string } = {},
  ) {}

  get projectsDir(): string {
    return path.join(this.root, 'projects');
  }
  get trashDir(): string {
    return path.join(this.root, 'trash');
  }
  get stagingDir(): string {
    return path.join(this.root, '.staging');
  }
  get catalogDir(): string {
    return path.join(this.root, 'catalog');
  }

  projectDir(id: string): string {
    if (!isId(id)) throw new StudioError('INVALID_INPUT', `Not a project id: ${id}`);
    return path.join(this.projectsDir, id);
  }

  private trashedDir(id: string): string {
    return path.join(this.trashDir, id);
  }

  async open(): Promise<void> {
    for (const dir of [this.projectsDir, this.trashDir, this.stagingDir, ...['furniture', 'materials', 'symbols'].map((d) => path.join(this.catalogDir, d))]) {
      await fs.mkdir(dir, { recursive: true });
    }
    const marker = await readJsonFile<{ formatVersion?: number }>(path.join(this.root, 'library.json')).catch(() => undefined);
    if (marker?.formatVersion && marker.formatVersion > LIBRARY_FORMAT) {
      throw new StudioError('UNSUPPORTED_VERSION', 'This library was created by a newer version of the app. Update the app to use it.');
    }
    if (!marker) await writeJsonAtomic(path.join(this.root, 'library.json'), { formatVersion: LIBRARY_FORMAT, createdWith: this.opts.appVersion ?? null });
    await fs.rm(this.stagingDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(this.stagingDir, { recursive: true });
    await this.acquireLock();
    await this.loadIndex();
    await this.reconcile();
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await this.queue.idle();
    const lockFile = path.join(this.root, 'library.lock');
    const lock = await readJsonFile<{ pid?: number; host?: string }>(lockFile).catch(() => undefined);
    if (lock?.pid === process.pid && lock.host === os.hostname()) await fs.rm(lockFile, { force: true }).catch(() => {});
  }

  // ---------- lock ----------

  private async acquireLock(): Promise<void> {
    const file = path.join(this.root, 'library.lock');
    const existing = await readJsonFile<LockHolder>(file).catch(() => undefined);
    this.lockedBy = null;
    if (existing && Date.now() - Date.parse(existing.heartbeatAt) < LOCK_FRESH_MS) {
      const sameProcess = existing.host === os.hostname() && existing.pid === process.pid;
      const alive = existing.host !== os.hostname() || isAlive(existing.pid);
      if (!sameProcess && alive) this.lockedBy = existing;
    }
    const beat = () => writeJsonAtomic(file, { host: os.hostname(), pid: process.pid, heartbeatAt: new Date().toISOString(), appVersion: this.opts.appVersion ?? null }, { fsync: false }).catch(() => {});
    await beat();
    this.heartbeat = setInterval(() => void beat(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  // ---------- index ----------

  private async loadIndex(): Promise<void> {
    this.index.clear();
    const stored = await readJsonFile(path.join(this.root, 'index.json')).catch(() => undefined);
    const parsed = IndexSchema.safeParse(stored);
    if (parsed.success) for (const p of parsed.data.projects) this.index.set(p.id, p);
  }

  private saveIndex(): Promise<void> {
    const projects = [...this.index.values()];
    return this.queue.run('index', () => writeJsonAtomic(path.join(this.root, 'index.json'), { version: INDEX_VERSION, projects }, { fsync: false }));
  }

  private changed(reason: string, projectId?: string): Promise<void> {
    const saving = this.saveIndex();
    this.opts.onChange?.(reason, projectId);
    return saving;
  }

  /**
   * Brings the index in line with the folders on disk: adds projects it does not know, drops those
   * that are gone, and refreshes entries whose project.json changed behind its back.
   */
  async reconcile(): Promise<{ added: number; removed: number; updated: number }> {
    let added = 0;
    let removed = 0;
    let updated = 0;
    const found = new Set<string>();
    for (const [base, trashed] of [
      [this.projectsDir, false],
      [this.trashDir, true],
    ] as const) {
      for (const name of await fs.readdir(base).catch(() => [] as string[])) {
        if (!isId(name)) continue;
        const dir = path.join(base, name);
        const stat = await fs.stat(path.join(dir, PROJECT_FILE)).catch(() => null);
        if (!stat) continue;
        found.add(name);
        const known = this.index.get(name);
        const stale = !known || Boolean(known.trashedAt) !== trashed || Date.parse(known.updatedAt) + 2000 < stat.mtimeMs;
        if (!stale) continue;
        const summary = await this.summarize(dir, trashed, known).catch((err: Error) => {
          console.warn(`[library] skipped ${dir}: ${err.message}`);
          return null;
        });
        if (!summary) continue;
        this.index.set(name, summary);
        if (known) updated++;
        else added++;
      }
    }
    for (const id of [...this.index.keys()]) {
      if (!found.has(id)) {
        this.index.delete(id);
        removed++;
      }
    }
    if (added || removed || updated) await this.changed('reindexed');
    else await this.saveIndex();
    return { added, removed, updated };
  }

  /** Rebuilds the index from scratch, from the folders on disk. */
  async reindex(): Promise<{ projects: number }> {
    this.index.clear();
    await this.reconcile();
    return { projects: this.index.size };
  }

  private async summarize(dir: string, trashed: boolean, known?: ProjectSummary): Promise<ProjectSummary> {
    const raw = await readJsonFile<{ meta?: Partial<ProjectDoc['meta']>; levels?: Record<string, unknown> }>(path.join(dir, PROJECT_FILE));
    const meta = raw?.meta;
    if (!meta?.id || !meta.name) throw new Error('project.json has no meta');
    const thumb = await fs.stat(path.join(dir, 'thumbnail.png')).catch(() => null);
    const trashInfo = trashed ? await readJsonFile<{ trashedAt?: string }>(path.join(dir, 'trashed.json')).catch(() => undefined) : undefined;
    return {
      id: path.basename(dir),
      name: String(meta.name),
      description: String(meta.description ?? ''),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      createdAt: String(meta.createdAt ?? new Date(0).toISOString()),
      updatedAt: String(meta.updatedAt ?? new Date(0).toISOString()),
      openedAt: known?.openedAt ?? null,
      levelCount: Object.keys(raw?.levels ?? {}).length,
      thumbnail: thumb ? String(Math.round(thumb.mtimeMs)) : null,
      trashedAt: trashed ? (trashInfo?.trashedAt ?? known?.trashedAt ?? new Date().toISOString()) : null,
    };
  }

  // ---------- listing ----------

  get(id: string): ProjectSummary | undefined {
    return this.index.get(id);
  }

  require(id: string, options: { trashed?: boolean } = {}): ProjectSummary {
    const summary = this.index.get(id);
    if (!summary) throw new StudioError('NOT_FOUND', `No project with id ${id}`);
    if (options.trashed !== undefined && Boolean(summary.trashedAt) !== options.trashed) {
      throw new StudioError('CONFLICT', options.trashed ? `"${summary.name}" is not in the trash` : `"${summary.name}" is in the trash; restore it first`);
    }
    return summary;
  }

  list(query: ListQuery = {}): ProjectSummary[] {
    const needle = fold(query.query?.trim() ?? '');
    const tags = (query.tags ?? []).map(fold);
    const matches = [...this.index.values()].filter((p) => {
      if (Boolean(p.trashedAt) !== Boolean(query.trashed)) return false;
      const own = p.tags.map(fold);
      if (tags.some((t) => !own.includes(t))) return false;
      return !needle || fold(`${p.name} ${p.description} ${p.tags.join(' ')}`).includes(needle);
    });
    const by = query.sort ?? 'recent';
    const time = (s: string | null) => (s ? Date.parse(s) : 0);
    matches.sort((a, b) => {
      if (by === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      if (by === 'created') return time(b.createdAt) - time(a.createdAt);
      if (by === 'opened') return time(b.openedAt) - time(a.openedAt) || time(b.updatedAt) - time(a.updatedAt);
      if (query.trashed) return time(b.trashedAt) - time(a.trashedAt);
      return time(b.updatedAt) - time(a.updatedAt);
    });
    return matches;
  }

  /** Every tag in use, with how many live projects carry it. */
  tags(): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const p of this.index.values()) if (!p.trashedAt) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // ---------- create, update, duplicate ----------

  /** Writes a new project folder (staged, then moved into place) and lists it. */
  async create(doc: ProjectDoc): Promise<ProjectSummary> {
    if (this.index.has(doc.meta.id)) throw new StudioError('CONFLICT', `A project with id ${doc.meta.id} already exists`);
    const staging = path.join(this.stagingDir, `new-${randomBytes(6).toString('hex')}`);
    await writeProjectDir(staging, doc);
    await renameWithRetry(staging, this.projectDir(doc.meta.id));
    const summary = this.summaryOf(doc, null);
    this.index.set(summary.id, summary);
    await this.changed('created', summary.id);
    return summary;
  }

  /** Updates the listing after a project was saved. */
  async noteSaved(doc: ProjectDoc): Promise<void> {
    const known = this.index.get(doc.meta.id);
    if (!known) return;
    this.index.set(doc.meta.id, this.summaryOf(doc, known));
    await this.changed('updated', doc.meta.id);
  }

  async noteOpened(id: string): Promise<void> {
    const known = this.index.get(id);
    if (!known) return;
    this.index.set(id, { ...known, openedAt: new Date().toISOString() });
    await this.changed('updated', id);
  }

  private summaryOf(doc: ProjectDoc, known: ProjectSummary | null | undefined): ProjectSummary {
    return {
      id: doc.meta.id,
      name: doc.meta.name,
      description: doc.meta.description,
      tags: doc.meta.tags,
      createdAt: doc.meta.createdAt,
      updatedAt: doc.meta.updatedAt,
      openedAt: known?.openedAt ?? null,
      levelCount: Object.keys(doc.levels).length,
      thumbnail: known?.thumbnail ?? null,
      trashedAt: known?.trashedAt ?? null,
    };
  }

  /** Reads a closed project from disk. */
  async read(id: string): Promise<ReturnType<typeof readProjectDir>> {
    this.require(id, { trashed: false });
    return readProjectDir(this.projectDir(id));
  }

  /** Changes the name, description or tags of a closed project. Open projects change through their session. */
  async updateMeta(id: string, patch: Partial<Pick<ProjectDoc['meta'], 'name' | 'description' | 'tags'>>): Promise<ProjectSummary> {
    const { doc, saved } = await this.read(id);
    const next: ProjectDoc = { ...doc, meta: { ...doc.meta, ...patch, updatedAt: new Date().toISOString() } };
    await writeProjectDir(this.projectDir(id), next, saved);
    await this.noteSaved(next);
    return this.require(id);
  }

  /** Copies a project (its saved state, assets and thumbnail, not its snapshots) under a new id. */
  async duplicate(id: string, name: string): Promise<ProjectSummary> {
    const source = this.require(id, { trashed: false });
    const { doc } = await readProjectDir(this.projectDir(id));
    const now = new Date().toISOString();
    const copy: ProjectDoc = { ...doc, meta: { ...doc.meta, id: newId('prj'), name, createdAt: now, updatedAt: now } };
    const staging = path.join(this.stagingDir, `copy-${randomBytes(6).toString('hex')}`);
    await writeProjectDir(staging, copy);
    const from = this.projectDir(id);
    await fs.cp(path.join(from, 'assets'), path.join(staging, 'assets'), { recursive: true }).catch(() => {});
    await fs.copyFile(path.join(from, 'thumbnail.png'), path.join(staging, 'thumbnail.png')).catch(() => {});
    await renameWithRetry(staging, this.projectDir(copy.meta.id));
    const summary = { ...this.summaryOf(copy, null), thumbnail: source.thumbnail };
    this.index.set(summary.id, summary);
    await this.changed('created', summary.id);
    return summary;
  }

  // ---------- trash ----------

  async trash(id: string): Promise<ProjectSummary> {
    const summary = this.require(id, { trashed: false });
    const trashedAt = new Date().toISOString();
    await renameWithRetry(this.projectDir(id), this.trashedDir(id));
    await writeJsonAtomic(path.join(this.trashedDir(id), 'trashed.json'), { trashedAt, name: summary.name });
    const next = { ...summary, trashedAt };
    this.index.set(id, next);
    await this.changed('trashed', id);
    return next;
  }

  async restore(id: string): Promise<ProjectSummary> {
    const summary = this.require(id, { trashed: true });
    await renameWithRetry(this.trashedDir(id), this.projectDir(id));
    await fs.rm(path.join(this.projectDir(id), 'trashed.json'), { force: true });
    const next = { ...summary, trashedAt: null };
    this.index.set(id, next);
    await this.changed('restored', id);
    return next;
  }

  /** Deletes a trashed project for good. */
  async deleteForever(id: string): Promise<void> {
    this.require(id, { trashed: true });
    await fs.rm(this.trashedDir(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.index.delete(id);
    await this.changed('deleted', id);
  }

  async emptyTrash(): Promise<{ deleted: number }> {
    const trashed = this.list({ trashed: true });
    for (const p of trashed) {
      await fs.rm(this.trashedDir(p.id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      this.index.delete(p.id);
    }
    if (trashed.length) await this.changed('deleted');
    return { deleted: trashed.length };
  }

  // ---------- snapshots ----------

  private snapshotsDir(id: string): string {
    return path.join(this.projectDir(id), 'snapshots');
  }

  async listSnapshots(id: string): Promise<SnapshotInfo[]> {
    this.require(id, { trashed: false });
    const dir = this.snapshotsDir(id);
    const out: SnapshotInfo[] = [];
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!isId(name)) continue;
      const meta = SnapshotMetaSchema.safeParse(await readJsonFile(path.join(dir, name, 'meta.json')).catch(() => undefined));
      if (meta.success) out.push(meta.data);
    }
    return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  /** Saves a copy of the document as a snapshot (assets are content-addressed, so they are shared, not copied). */
  async createSnapshot(id: string, doc: ProjectDoc, options: { name: string; kind: 'named' | 'auto'; createdBy: string }): Promise<SnapshotInfo> {
    this.require(id, { trashed: false });
    const info: SnapshotInfo = {
      id: newId('snp'),
      name: options.name,
      kind: options.kind,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy,
      levelCount: Object.keys(doc.levels).length,
    };
    const dir = this.snapshotsDir(id);
    const staging = path.join(dir, `.tmp-${info.id}`);
    await writeProjectDir(staging, doc);
    await writeJsonAtomic(path.join(staging, 'meta.json'), info);
    await renameWithRetry(staging, path.join(dir, info.id));
    if (options.kind === 'auto') {
      const autos = (await this.listSnapshots(id)).filter((s) => s.kind === 'auto');
      for (const old of autos.slice(AUTO_SNAPSHOTS_KEPT)) await fs.rm(path.join(dir, old.id), { recursive: true, force: true }).catch(() => {});
    }
    this.opts.onChange?.('snapshots', id);
    return info;
  }

  async readSnapshot(id: string, snapshotId: string): Promise<ProjectDoc> {
    this.require(id, { trashed: false });
    if (!isId(snapshotId)) throw new StudioError('INVALID_INPUT', `Not a snapshot id: ${snapshotId}`);
    const dir = path.join(this.snapshotsDir(id), snapshotId);
    if (!(await fs.stat(dir).catch(() => null))) throw new StudioError('NOT_FOUND', `No snapshot ${snapshotId}`);
    return (await readProjectDir(dir)).doc;
  }

  async deleteSnapshot(id: string, snapshotId: string): Promise<void> {
    this.require(id, { trashed: false });
    if (!isId(snapshotId)) throw new StudioError('INVALID_INPUT', `Not a snapshot id: ${snapshotId}`);
    const dir = path.join(this.snapshotsDir(id), snapshotId);
    if (!(await fs.stat(dir).catch(() => null))) throw new StudioError('NOT_FOUND', `No snapshot ${snapshotId}`);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.opts.onChange?.('snapshots', id);
  }

  // ---------- thumbnails ----------

  thumbnailFile(id: string): string | null {
    const summary = this.index.get(id);
    if (!summary?.thumbnail) return null;
    return path.join(summary.trashedAt ? this.trashedDir(id) : this.projectDir(id), 'thumbnail.png');
  }

  async setThumbnail(id: string, png: Uint8Array): Promise<ProjectSummary> {
    const summary = this.require(id, { trashed: false });
    if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) throw new StudioError('INVALID_INPUT', 'The thumbnail must be a PNG image');
    await writeFileAtomic(path.join(this.projectDir(id), 'thumbnail.png'), png);
    const next = { ...summary, thumbnail: createHash('sha1').update(png).digest('hex').slice(0, 10) };
    this.index.set(id, next);
    await this.changed('thumbnail', id);
    return next;
  }

  // ---------- packages ----------

  async exportProject(id: string, target: string, options: { appVersion: string; includeSnapshots: boolean }) {
    this.require(id, { trashed: false });
    return exportPackage(this.projectDir(id), target, options);
  }

  /**
   * Imports a package as a new project. It keeps its id unless that id is already in the library,
   * and gets " (imported)" added to its name when the name is taken.
   */
  async importProject(source: string, limits?: PackageLimits): Promise<ProjectSummary> {
    const { dir } = await importPackage(source, this.stagingDir, limits);
    try {
      const { doc, saved } = await readProjectDir(dir);
      const id = this.index.has(doc.meta.id) ? newId('prj') : doc.meta.id;
      const taken = new Set([...this.index.values()].filter((p) => !p.trashedAt).map((p) => fold(p.name)));
      const name = taken.has(fold(doc.meta.name)) ? `${doc.meta.name} (imported)` : doc.meta.name;
      const next: ProjectDoc = { ...doc, meta: { ...doc.meta, id, name } };
      if (next.meta.id !== doc.meta.id || next.meta.name !== doc.meta.name) await writeProjectDir(dir, next, saved);
      await renameWithRetry(dir, this.projectDir(id));
      const thumb = await fs.stat(path.join(this.projectDir(id), 'thumbnail.png')).catch(() => null);
      const summary = { ...this.summaryOf(next, null), thumbnail: thumb ? String(Math.round(thumb.mtimeMs)) : null };
      this.index.set(id, summary);
      await this.changed('imported', id);
      return summary;
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True when a folder is (or is inside) a cloud-synced location, where a library is at risk of conflicts. */
export function syncedFolderWarning(folder: string): string | null {
  const lower = path.resolve(folder).toLowerCase();
  const synced = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean).map((p) => path.resolve(p!).toLowerCase());
  if (synced.some((p) => lower === p || lower.startsWith(`${p}${path.sep}`)) || /[\\/](onedrive|dropbox|google drive|icloud ?drive|mobile documents)([\\/ -]|$)/i.test(lower)) {
    return 'This folder is synced to the cloud. Sync services can hold files while the app writes them and can create conflicting copies when two computers use the library at once. Use the library from one computer at a time.';
  }
  return null;
}
