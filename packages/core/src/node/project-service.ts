import { promises as fs } from 'node:fs';
import path from 'node:path';
import { newProjectDoc } from '../doc/defaults';
import { DocumentEngine, type Author, type EditContext } from '../doc/engine';
import type { CatalogApi } from '../decor/catalog';
import type { ProjectDoc } from '../doc/schema';
import { StudioError } from '../errors';
import type { LibraryInfo, ListQuery, OpenProject, ProjectSummary, SaveStatus, SnapshotInfo } from '../projects';
import type { EditResult, HostApi, ProjectApi, ProjectsApi } from '../types';
import { WriteQueue, readJsonFile, renameWithRetry, writeJsonAtomic } from './atomic-write';
import { Library, syncedFolderWarning } from './library';
import { ProjectSession, type SessionOptions } from './project-session';
import { readProjectDir, writeProjectDir } from './project-store';

export interface ProjectServiceOptions {
  /** The library folder in use. */
  libraryRoot: string;
  /** Where the library lives when the user has not moved it. */
  defaultLibraryRoot: string;
  appVersion: string;
  emit: HostApi['emit'];
  /** Persists which projects are open, so they reopen on the next start. */
  rememberSession(session: { openProjects: string[]; activeProjectId: string | null }): Promise<void>;
  /** Persists a moved library's location. */
  rememberLibrary(root: string): Promise<void>;
  session?: SessionOptions;
  /** Module hooks. */
  onProjectOpen?(project: ProjectApi): Promise<void> | void;
  onProjectClose?(project: ProjectApi): Promise<void> | void;
}

/**
 * The library plus the open projects. Every project write goes through here: an open project's
 * document lives in its session and is saved by it; closed projects are changed on disk.
 */
export class ProjectService implements ProjectsApi {
  library: Library;
  private readonly sessions = new Map<string, ProjectSession>();
  private readonly engines = new Map<string, DocumentEngine>();
  /** Edits run one at a time per project, so a batch is never interleaved with another caller's edit. */
  private readonly edits = new WriteQueue();
  /** Projects that already got their "before editing" snapshot in this session. */
  private readonly snapshotted = new Set<string>();
  private order: string[] = [];
  private activeId: string | null = null;
  private readonly lastSave = new Map<string, SaveStatus['state']>();

  constructor(private readonly opts: ProjectServiceOptions) {
    this.library = this.makeLibrary(opts.libraryRoot);
  }

  private makeLibrary(root: string): Library {
    return new Library(root, {
      appVersion: this.opts.appVersion,
      onChange: (reason, projectId) => {
        if (reason === 'snapshots' && projectId) this.opts.emit('project.changed', { projectId, kind: 'snapshots' });
        else this.opts.emit('library.changed', projectId ? { reason, projectId } : { reason });
      },
      onCatalogChange: (reason, file) => this.opts.emit('catalog.changed', file ? { reason, file } : { reason }),
    });
  }

  /** The library's catalog of furniture models; it follows the library when that moves. */
  get catalog(): CatalogApi {
    const catalog = () => this.library.catalog;
    return {
      models: () => catalog().models(),
      model: (file) => catalog().model(file),
      importModel: (source) => catalog().importModel(source),
      removeModel: (file) => catalog().removeModel(file),
      setThumbnail: (file, png) => catalog().setThumbnail(file, png),
      copyToProject: async (file, projectId) => {
        this.library.require(projectId, { trashed: false });
        await catalog().copyToProject(file, this.library.projectDir(projectId));
      },
      reindex: () => catalog().reindex(),
    };
  }

  /** Opens the library and reopens the projects that were open last time. */
  async start(session: { openProjects: string[]; activeProjectId: string | null }): Promise<void> {
    await this.library.open();
    for (const id of session.openProjects) {
      try {
        await this.open(id, { focus: false, remember: false });
      } catch (err) {
        console.warn(`[projects] could not reopen ${id}: ${(err as Error).message}`);
      }
    }
    this.activeId = session.activeProjectId && this.sessions.has(session.activeProjectId) ? session.activeProjectId : (this.order[0] ?? null);
    await this.remember();
  }

  /** Saves and closes every project (they reopen next time) and releases the library. */
  async stop(): Promise<void> {
    for (const id of [...this.order]) {
      const session = this.sessions.get(id)!;
      await session.close().catch((err: Error) => console.error(`[projects] could not save ${id} on exit: ${err.message}`));
    }
    await this.library.close();
  }

  private remember(): Promise<void> {
    return this.opts.rememberSession({ openProjects: [...this.order], activeProjectId: this.activeId });
  }

  // ---------- queries ----------

  info(): LibraryInfo {
    const all = this.library.list({});
    return {
      path: this.library.root,
      isDefault: path.resolve(this.library.root) === path.resolve(this.opts.defaultLibraryRoot),
      projects: all.length,
      trashed: this.library.list({ trashed: true }).length,
      lockedBy: this.library.lockedBy,
      warning: syncedFolderWarning(this.library.root),
    };
  }

  list(query: ListQuery = {}): ProjectSummary[] {
    return this.library.list(query);
  }

  tags(): { tag: string; count: number }[] {
    return this.library.tags();
  }

  get(id: string): ProjectSummary | undefined {
    return this.library.get(id);
  }

  openProjects(): OpenProject[] {
    return this.order.map((id) => this.openProject(id));
  }

  current(): OpenProject | null {
    return this.activeId && this.sessions.has(this.activeId) ? this.openProject(this.activeId) : null;
  }

  private openProject(id: string): OpenProject {
    const session = this.sessions.get(id)!;
    const summary = this.library.get(id) ?? this.summaryOfDoc(session.doc);
    return { ...summary, name: session.doc.meta.name, description: session.doc.meta.description, tags: session.doc.meta.tags, save: session.saveState };
  }

  private summaryOfDoc(doc: ProjectDoc): ProjectSummary {
    return { id: doc.meta.id, name: doc.meta.name, description: doc.meta.description, tags: doc.meta.tags, createdAt: doc.meta.createdAt, updatedAt: doc.meta.updatedAt, openedAt: null, levelCount: Object.keys(doc.levels).length, thumbnail: null, trashedAt: null };
  }

  session(id: string): ProjectSession | undefined {
    return this.sessions.get(id);
  }

  // ---------- lifecycle ----------

  async create(input: { name: string; description?: string; tags?: string[] }): Promise<ProjectSummary> {
    const doc = newProjectDoc({ ...input, createdWith: this.opts.appVersion });
    return this.library.create(doc);
  }

  async open(id: string, options: { focus?: boolean; remember?: boolean } = {}): Promise<OpenProject & { warnings: string[] }> {
    const focus = options.focus ?? true;
    if (this.sessions.has(id)) {
      if (focus) await this.focus(id);
      this.opts.emit('project.changed', { projectId: id, kind: 'opened', focus });
      return { ...this.openProject(id), warnings: [] };
    }
    this.library.require(id, { trashed: false });
    const dir = this.library.projectDir(id);
    const read = await readProjectDir(dir);
    let { doc, saved } = read;
    if (doc.meta.id !== id) doc = { ...doc, meta: { ...doc.meta, id } };
    if (read.migratedFrom !== undefined) {
      // Keep the project as it was before upgrading it.
      await this.library.createSnapshot(id, doc, { name: `Before upgrading from format ${read.migratedFrom}`, kind: 'auto', createdBy: 'App' });
      saved = await writeProjectDir(dir, doc, saved);
    }
    const session = new ProjectSession(dir, doc, saved, {
      ...this.opts.session,
      onSaveState: (state) => this.saveStateChanged(id, state),
    });
    const engine = new DocumentEngine(doc, {
      onChange: (next, patch) => {
        session.setDoc(next);
        this.opts.emit('doc.patched', { projectId: id, ...patch });
      },
    });
    this.sessions.set(id, session);
    this.engines.set(id, engine);
    this.order.push(id);
    if (focus || !this.activeId) this.activeId = id;
    await this.library.noteOpened(id);
    if (options.remember !== false) await this.remember();
    await this.opts.onProjectOpen?.(this.api(session));
    this.opts.emit('project.changed', { projectId: id, kind: 'opened', focus });
    return { ...this.openProject(id), warnings: read.warnings };
  }

  private saveStateChanged(id: string, state: SaveStatus): void {
    if (this.lastSave.get(id) === state.state && state.state !== 'saved') return;
    this.lastSave.set(id, state.state);
    this.opts.emit('project.changed', { projectId: id, kind: 'save', save: state });
    const session = this.sessions.get(id);
    if (state.state === 'saved' && session) void this.library.noteSaved(session.doc).catch(() => {});
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await this.edits.idle(id);
    await session.close();
    this.sessions.delete(id);
    this.engines.delete(id);
    this.snapshotted.delete(id);
    this.lastSave.delete(id);
    this.order = this.order.filter((o) => o !== id);
    if (this.activeId === id) this.activeId = this.order[this.order.length - 1] ?? null;
    await this.remember();
    await this.opts.onProjectClose?.(this.api(session));
    this.opts.emit('project.changed', { projectId: id, kind: 'closed' });
  }

  async focus(id: string | null): Promise<void> {
    if (id !== null && !this.sessions.has(id)) throw new StudioError('NOT_FOUND', `Project ${id} is not open`);
    if (this.activeId === id) return;
    this.activeId = id;
    await this.remember();
  }

  async update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<ProjectSummary> {
    const clean = {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.tags !== undefined ? { tags: [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))] } : {}),
    };
    if (clean.name === '') throw new StudioError('INVALID_INPUT', 'name: A project needs a name');
    const session = this.sessions.get(id);
    if (!session) return this.library.updateMeta(id, clean);
    // Project details belong to the library, not the design: no undo step.
    this.engines.get(id)!.setMeta(clean);
    await session.flush();
    await this.library.noteSaved(session.doc);
    this.opts.emit('project.changed', { projectId: id, kind: 'updated' });
    return this.library.require(id);
  }

  async duplicate(id: string, name?: string): Promise<ProjectSummary> {
    const source = this.library.require(id, { trashed: false });
    await this.sessions.get(id)?.flush();
    return this.library.duplicate(id, name?.trim() || `${source.name} copy`);
  }

  async trash(id: string): Promise<ProjectSummary> {
    this.library.require(id, { trashed: false });
    await this.close(id);
    return this.library.trash(id);
  }

  restore(id: string): Promise<ProjectSummary> {
    return this.library.restore(id);
  }

  deleteForever(id: string): Promise<void> {
    return this.library.deleteForever(id);
  }

  emptyTrash(): Promise<{ deleted: number }> {
    return this.library.emptyTrash();
  }

  async save(id: string): Promise<SaveStatus> {
    const session = this.requireOpen(id);
    await session.flush();
    return session.saveState;
  }

  private requireOpen(id: string): ProjectSession {
    const session = this.sessions.get(id);
    if (!session) throw new StudioError('NOT_FOUND', `Project ${id} is not open`);
    return session;
  }

  /** The current document of a project, saved first when it is open. */
  private async currentDoc(id: string): Promise<ProjectDoc> {
    const session = this.sessions.get(id);
    if (session) {
      await session.flush();
      return session.doc;
    }
    return (await this.library.read(id)).doc;
  }

  // ---------- snapshots ----------

  snapshots(id: string): Promise<SnapshotInfo[]> {
    return this.library.listSnapshots(id);
  }

  async createSnapshot(id: string, name: string, createdBy: string, kind: 'named' | 'auto' = 'named'): Promise<SnapshotInfo> {
    return this.library.createSnapshot(id, await this.currentDoc(id), { name: name.trim() || 'Snapshot', kind, createdBy });
  }

  /**
   * Brings back the design of a snapshot. The project keeps its id, name, description and tags, and
   * what it looked like just before is kept as an automatic snapshot, so a restore can be undone.
   */
  async restoreSnapshot(id: string, snapshotId: string, by: string): Promise<{ restored: SnapshotInfo; backup: SnapshotInfo }> {
    const restored = (await this.library.listSnapshots(id)).find((s) => s.id === snapshotId);
    if (!restored) throw new StudioError('NOT_FOUND', `No snapshot ${snapshotId}`);
    const snapshot = await this.library.readSnapshot(id, snapshotId);
    const current = await this.currentDoc(id);
    const backup = await this.library.createSnapshot(id, current, { name: `Before restoring "${restored.name}"`, kind: 'auto', createdBy: by });
    const next: ProjectDoc = { ...snapshot, meta: { ...current.meta } };
    const session = this.sessions.get(id);
    if (session) {
      await this.edits.run(id, async () => this.engines.get(id)!.replace(next, `Restored "${restored.name}"`, { kind: 'user', name: by }));
      await session.flush();
      this.opts.emit('project.changed', { projectId: id, kind: 'replaced' });
    } else {
      const { saved } = await this.library.read(id);
      await writeProjectDir(this.library.projectDir(id), next, saved);
      await this.library.noteSaved(next);
    }
    return { restored, backup };
  }

  deleteSnapshot(id: string, snapshotId: string): Promise<void> {
    return this.library.deleteSnapshot(id, snapshotId);
  }

  // ---------- packages and thumbnails ----------

  async exportProject(id: string, target: string, options: { includeSnapshots?: boolean } = {}): Promise<{ path: string; bytes: number; files: number }> {
    await this.sessions.get(id)?.flush();
    const result = await this.library.exportProject(id, target, { appVersion: this.opts.appVersion, includeSnapshots: options.includeSnapshots ?? false });
    return { path: target, bytes: result.bytes, files: result.files };
  }

  importProject(source: string): Promise<ProjectSummary> {
    return this.library.importProject(source);
  }

  setThumbnail(id: string, png: Uint8Array): Promise<ProjectSummary> {
    return this.library.setThumbnail(id, png);
  }

  // ---------- the library itself ----------

  reindex(): Promise<{ projects: number }> {
    return this.library.reindex();
  }

  /**
   * Moves the library to another folder, or (`adopt`) switches to a library that is already there.
   * Open projects are saved and closed first and reopened afterwards. A move copies into a staging
   * folder, checks the copy lists the same projects, puts it in place, then removes the old folder.
   */
  async moveLibrary(target: string, mode: 'move' | 'adopt'): Promise<LibraryInfo> {
    const from = path.resolve(this.library.root);
    const to = path.resolve(target);
    if (to === from) throw new StudioError('CONFLICT', 'The library is already in that folder.');
    if (to.startsWith(`${from}${path.sep}`)) throw new StudioError('INVALID_INPUT', 'The new folder cannot be inside the current library.');
    const hasLibrary = Boolean(await readJsonFile(path.join(to, 'library.json')).catch(() => undefined));
    if (mode === 'adopt' && !hasLibrary) throw new StudioError('NOT_FOUND', `There is no library in ${to}.`);
    if (mode === 'move') {
      const entries = await fs.readdir(to).catch(() => null);
      if (entries && entries.length > 0) {
        throw new StudioError('CONFLICT', hasLibrary ? 'That folder already holds a library. Use it instead of moving this one.' : 'Choose an empty folder for the library.');
      }
    }

    const reopen = [...this.order];
    const active = this.activeId;
    for (const id of reopen) await this.close(id);
    const before = this.library.list({}).length + this.library.list({ trashed: true }).length;
    await this.library.close();

    if (mode === 'move') {
      const staging = `${to}.moving-${Date.now()}`;
      try {
        await fs.cp(from, staging, { recursive: true, filter: (src) => !/[\\/](library\.lock|\.staging)$/.test(src) });
        const check = this.makeLibrary(staging);
        await check.open();
        const after = check.list({}).length + check.list({ trashed: true }).length;
        await check.close();
        if (after !== before) throw new StudioError('INTERNAL', `The copy lists ${after} projects instead of ${before}; the library was not moved.`);
        await fs.rm(to, { recursive: true, force: true });
        await renameWithRetry(staging, to);
      } catch (err) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        this.library = this.makeLibrary(from);
        await this.library.open();
        for (const id of reopen) await this.open(id, { focus: id === active }).catch(() => {});
        throw err;
      }
    }

    this.library = this.makeLibrary(to);
    await this.library.open();
    await this.opts.rememberLibrary(to);
    if (mode === 'move') await fs.rm(from, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((err: Error) => console.warn(`[projects] old library left at ${from}: ${err.message}`));
    for (const id of reopen) {
      if (this.library.get(id) && !this.library.get(id)?.trashedAt) await this.open(id, { focus: id === active }).catch(() => {});
    }
    this.opts.emit('library.changed', { reason: 'moved' });
    return this.info();
  }

  // ---------- editing ----------

  /** The document, its change number and history, as the renderer's mirror loads it. */
  docState(id: string) {
    const engine = this.engines.get(id);
    if (!engine) throw new StudioError('NOT_FOUND', `Project ${id} is not open`);
    return { projectId: id, doc: engine.doc, seq: engine.seq, epoch: engine.epoch, history: engine.history() };
  }

  /**
   * One transaction on an open project. The first real edit of each session first keeps the project
   * as it was in an automatic snapshot, because undo does not survive a restart.
   */
  async edit<T>(id: string, author: Author, label: string, fn: (tx: EditContext) => T | Promise<T>, options: { coalesce?: string; dryRun?: boolean } = {}): Promise<EditResult<T>> {
    const engine = this.engines.get(id);
    if (!engine) throw new StudioError('NOT_FOUND', `Project ${id} is not open`);
    return this.edits.run(id, async () => {
      if (!options.dryRun && !this.snapshotted.has(id)) {
        this.snapshotted.add(id);
        const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
        await this.library.createSnapshot(id, engine.doc, { name: `Before editing (${when})`, kind: 'auto', createdBy: 'App' }).catch((err: Error) => console.warn(`[projects] could not take the session snapshot of ${id}: ${err.message}`));
      }
      return engine.transact(label, author, fn, options);
    });
  }

  /** Keeps the project as it is in an automatic snapshot, e.g. before a large batch by an agent. */
  async autoSnapshot(id: string, name: string, createdBy: string): Promise<void> {
    const engine = this.engines.get(id);
    if (engine) await this.library.createSnapshot(id, engine.doc, { name, kind: 'auto', createdBy });
  }

  // ---------- commands ----------

  api(session: ProjectSession): ProjectApi {
    const id = session.id;
    const engine = () => {
      const e = this.engines.get(id);
      if (!e) throw new StudioError('NOT_FOUND', `Project ${id} is not open`);
      return e;
    };
    return {
      id,
      get name() {
        return session.doc.meta.name;
      },
      get doc() {
        return engine().doc;
      },
      edit: (author, label, fn, options) => this.edit(id, author, label, fn, options),
      undo: (ifTop) => this.edits.run(id, async () => engine().undo(ifTop)),
      redo: () => this.edits.run(id, async () => engine().redo()),
      history: () => ({ ...engine().entries(), seq: engine().seq, epoch: engine().epoch }),
      lastTouched: (entityId) => engine().lastTouched(entityId),
    };
  }

  // ---------- view state ----------

  private uiFile(id: string): string {
    return path.join(this.library.projectDir(id), '.local', 'ui.json');
  }

  async uiState(id: string): Promise<Record<string, unknown>> {
    this.library.require(id, { trashed: false });
    return (await readJsonFile<Record<string, unknown>>(this.uiFile(id)).catch(() => undefined)) ?? {};
  }

  /** Merges `state` over the stored record key by key (`null` removes a key): the renderer owns the view keys, main the assistant's session. */
  async setUiState(id: string, state: Record<string, unknown>): Promise<void> {
    this.library.require(id, { trashed: false });
    await this.edits.run(`ui:${id}`, async () => {
      const stored = (await readJsonFile<Record<string, unknown>>(this.uiFile(id)).catch(() => undefined)) ?? {};
      const merged: Record<string, unknown> = { ...stored };
      for (const [key, value] of Object.entries(state)) {
        if (value === null || value === undefined) delete merged[key];
        else merged[key] = value;
      }
      await writeJsonAtomic(this.uiFile(id), merged, { fsync: false });
    });
  }

  async resolve(hint: string | null): Promise<ProjectApi | undefined> {
    if (hint) {
      const open = this.sessions.get(hint);
      if (open) return this.api(open);
      const summary = this.library.get(hint);
      if (!summary || summary.trashedAt) throw new StudioError('NOT_FOUND', summary ? `Project "${summary.name}" is in the trash` : `No project with id ${hint}`);
      await this.open(hint, { focus: false });
      return this.api(this.sessions.get(hint)!);
    }
    const active = this.activeId ? this.sessions.get(this.activeId) : undefined;
    return active ? this.api(active) : undefined;
  }
}
