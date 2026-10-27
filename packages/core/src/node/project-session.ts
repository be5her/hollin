import type { ProjectDoc } from '../doc/schema';
import { WriteQueue } from './atomic-write';
import type { SaveStatus } from '../projects';
import { writeProjectDir, type SavedState } from './project-store';

export type SaveState = SaveStatus;

export interface SessionOptions {
  /** Quiet time after the last change before saving. */
  debounceMs?: number;
  /** Longest a change waits while changes keep coming, e.g. from an agent. */
  maxWaitMs?: number;
  /** Delay before retrying a failed save. */
  retryMs?: number;
  onSaveState?(state: SaveState): void;
  /** Injected for tests. */
  write?: typeof writeProjectDir;
  now?: () => string;
}

/**
 * One open project: its document (the single source of truth while open) and its autosave.
 * A change is saved 750 ms after the last edit, or within 5 s while edits keep arriving. The project
 * counts as saved only once a write has succeeded; a failed save is retried and reported.
 */
export class ProjectSession {
  private current: ProjectDoc;
  private saved: SavedState;
  private dirty = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private maxWait: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly queue = new WriteQueue();
  private closed = false;
  private state: SaveState;
  private readonly opts: Required<Omit<SessionOptions, 'onSaveState'>> & Pick<SessionOptions, 'onSaveState'>;

  constructor(
    readonly dir: string,
    doc: ProjectDoc,
    saved: SavedState,
    options: SessionOptions = {},
  ) {
    this.current = doc;
    this.saved = saved;
    this.opts = {
      debounceMs: options.debounceMs ?? 750,
      maxWaitMs: options.maxWaitMs ?? 5000,
      retryMs: options.retryMs ?? 5000,
      write: options.write ?? writeProjectDir,
      now: options.now ?? (() => new Date().toISOString()),
      onSaveState: options.onSaveState,
    };
    this.state = { state: 'saved', savedAt: doc.meta.updatedAt };
  }

  get id(): string {
    return this.current.meta.id;
  }

  get doc(): ProjectDoc {
    return this.current;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get saveState(): SaveState {
    return this.state;
  }

  /** Replace the document (after an edit) and schedule a save. */
  setDoc(next: ProjectDoc): void {
    if (this.closed) throw new Error(`Project ${this.id} is closed`);
    if (next === this.current) return;
    this.current = next;
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    this.setState({ state: 'dirty' });
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush().catch(() => {}), this.opts.debounceMs);
    this.maxWait ??= setTimeout(() => void this.flush().catch(() => {}), this.opts.maxWaitMs);
  }

  private clearTimers(): void {
    for (const timer of [this.debounce, this.maxWait, this.retry]) if (timer) clearTimeout(timer);
    this.debounce = this.maxWait = this.retry = null;
  }

  /** Writes pending changes now. Rejects when the write fails (the project stays dirty and is retried). */
  flush(): Promise<void> {
    return this.queue.run('save', async () => {
      this.clearTimers();
      if (!this.dirty) return;
      const savedAt = this.opts.now();
      const doc = this.current;
      const toWrite: ProjectDoc = { ...doc, meta: { ...doc.meta, updatedAt: savedAt } };
      this.dirty = false;
      this.setState({ state: 'saving' });
      try {
        this.saved = await this.opts.write(this.dir, toWrite, this.saved);
      } catch (err) {
        this.dirty = true;
        this.setState({ state: 'failed', error: (err as Error).message });
        if (!this.closed) this.retry = setTimeout(() => void this.flush().catch(() => {}), this.opts.retryMs);
        throw err;
      }
      // Keep what was written as the document unless it changed while saving.
      if (this.current === doc) this.current = toWrite;
      else {
        // The levels written are the same objects either way, so only project.json differs.
        this.markDirty();
        return;
      }
      this.setState({ state: 'saved', savedAt });
    });
  }

  /**
   * Saves pending changes, then runs `read` while no save can start, e.g. to copy the project's
   * folder: between the steps of a save the folder holds level files that project.json does not
   * list yet, or no longer lists.
   */
  async whileSaved<T>(read: () => Promise<T>): Promise<T> {
    await this.flush();
    return this.queue.run('save', read);
  }

  /**
   * Saves what is pending (including edits that land during the save) and stops autosaving. When the
   * save fails the session stays open, dirty and retrying, so no edit is lost; the error is thrown.
   */
  async close(): Promise<void> {
    let rounds = 0;
    do await this.flush();
    while (this.dirty && ++rounds < 5);
    this.closed = true;
    this.clearTimers();
  }

  private setState(state: SaveState): void {
    this.state = state;
    this.opts.onSaveState?.(state);
  }
}
