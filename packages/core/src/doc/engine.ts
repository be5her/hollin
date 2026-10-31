import { StudioError } from '../errors';
import { newId } from '../ids';
import { followTiesOps } from './builders';
import { Transaction, patchOps, type Op, type RecordMap } from './ops';
import type { ProjectDoc } from './schema';

/** Who made a change: the user, the in-app assistant, or an MCP agent (by the name it reports). */
export interface Author {
  kind: 'user' | 'assistant' | 'mcp';
  name: string;
}

/** When a record last changed, and who changed it. */
export interface LastTouched {
  seq: number;
  author: Author;
}

export interface HistoryInfo {
  id: string;
  label: string;
  author: Author;
  at: string;
  /** The command that made the change (`plan.apply` for a batch), when it ran through the registry. */
  command?: string;
  /** The one level whose entities the change touched, and its name; absent when it touched none or several. */
  levelId?: string;
  level?: string;
  /** The name of the one layer the touched entities sit on; absent when none or several. */
  layer?: string;
}

export interface HistoryState {
  undo: HistoryInfo | null;
  redo: HistoryInfo | null;
}

/** What the renderer's mirror receives after every change. A new `epoch` (restore, reload) means: fetch the whole document. */
export interface DocPatch {
  epoch: number;
  seq: number;
  tx: { id: string; label: string; author: Author; kind: 'do' | 'undo' | 'redo' | 'meta' | 'replace' };
  ops: Op[];
  history: HistoryState;
}

interface Entry extends HistoryInfo {
  before: RecordMap;
  after: RecordMap;
  coalesce?: string;
  bytes: number;
  atMs: number;
}

export interface EngineOptions {
  /** Called after every change with the new document. */
  onChange(doc: ProjectDoc, patch: DocPatch): void;
  maxEntries?: number;
  maxBytes?: number;
  /** How long rapid edits with the same coalesce key keep merging into one undo step. */
  coalesceMs?: number;
  now?: () => number;
}

/** What a command's edit function gets: the document as changed so far, and a way to change it. */
export interface EditContext {
  readonly doc: ProjectDoc;
  apply(ops: readonly Op[]): void;
}

/** Where a change happened, for History's signature line: the one level and layer its entities share, if they share one. */
function whereOf(doc: ProjectDoc, before: RecordMap, after: RecordMap): Pick<HistoryInfo, 'levelId' | 'level' | 'layer'> {
  const levels = new Set<string>();
  const layers = new Set<string>();
  for (const map of [before, after]) {
    for (const r of map.values()) {
      if (r.c !== 'entity') continue;
      if (r.lv) levels.add(r.lv);
      const layerId = (r.value as { layerId?: unknown } | undefined)?.layerId;
      if (typeof layerId === 'string') layers.add(layerId);
    }
  }
  const out: Pick<HistoryInfo, 'levelId' | 'level' | 'layer'> = {};
  if (levels.size === 1) {
    const [levelId] = levels;
    out.levelId = levelId;
    const name = doc.levels[levelId]?.name;
    if (name) out.level = name;
  }
  if (layers.size === 1) {
    const name = doc.layers[[...layers][0]]?.name;
    if (name) out.layer = name;
  }
  return out;
}

const infoOf = (e: Entry): HistoryInfo => ({ id: e.id, label: e.label, author: e.author, at: e.at, ...(e.command ? { command: e.command } : {}), ...(e.levelId ? { levelId: e.levelId } : {}), ...(e.level ? { level: e.level } : {}), ...(e.layer ? { layer: e.layer } : {}) });

const sizeOf = (map: RecordMap) => [...map.values()].reduce((sum, r) => sum + (r.value === undefined ? 8 : JSON.stringify(r.value).length), 0);

/**
 * An open project's document with its history. Every change is a transaction with a label and an
 * author; undo and redo follow one linear stack shared by everyone (so every inverse stays valid).
 */
export class DocumentEngine {
  private current: ProjectDoc;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private seqValue = 0;
  private epochValue = 1;
  private readonly touchedAt = new Map<string, LastTouched>();
  private readonly opts: Required<Omit<EngineOptions, 'onChange'>> & Pick<EngineOptions, 'onChange'>;

  constructor(doc: ProjectDoc, options: EngineOptions) {
    this.current = doc;
    this.opts = { maxEntries: 500, maxBytes: 64 * 1024 * 1024, coalesceMs: 1000, now: () => Date.now(), ...options };
  }

  get doc(): ProjectDoc {
    return this.current;
  }

  get seq(): number {
    return this.seqValue;
  }

  get epoch(): number {
    return this.epochValue;
  }

  /** The change number at which a record last changed, and by whom; null if not since opening (or since a reload). */
  lastTouched(id: string): LastTouched | null {
    return this.touchedAt.get(id) ?? null;
  }

  history(): HistoryState {
    const info = (e: Entry | undefined): HistoryInfo | null => (e ? infoOf(e) : null);
    return { undo: info(this.undoStack[this.undoStack.length - 1]), redo: info(this.redoStack[this.redoStack.length - 1]) };
  }

  /** Newest first. */
  entries(): { undo: HistoryInfo[]; redo: HistoryInfo[] } {
    return { undo: [...this.undoStack].reverse().map(infoOf), redo: [...this.redoStack].reverse().map(infoOf) };
  }

  /**
   * Runs `fn` against a draft and commits what it changed as one transaction (one undo step). If `fn`
   * throws, or validation fails, nothing changes. Callers serialize transactions per project.
   */
  async transact<T>(label: string, author: Author, fn: (ctx: EditContext) => T | Promise<T>, options: { coalesce?: string; dryRun?: boolean; command?: string } = {}): Promise<{ result: T; changed: boolean; txId: string | null }> {
    const tx = new Transaction(this.current);
    const result = await fn({
      get doc() {
        return tx.doc;
      },
      apply: (ops) => tx.apply(ops),
    });
    // Dimensions tied to a changed wall or shape store the points they show now, so they stay put if a tie stops resolving.
    tx.apply(followTiesOps(tx.doc, tx.touchedEntities()));
    const committed = tx.commit();
    // A dry run stops here: the change was built and checked, and is dropped.
    if (!committed || options.dryRun) return { result, changed: Boolean(committed), txId: null };
    const now = this.opts.now();
    const top = this.undoStack[this.undoStack.length - 1];
    let entry: Entry;
    // Null when the change merged into the step before it and the two cancelled out: no step is left to name.
    let txId: string | null;
    if (options.coalesce && top && top.coalesce === options.coalesce && top.author.kind === author.kind && top.author.name === author.name && now - top.atMs < this.opts.coalesceMs && this.redoStack.length === 0) {
      // Merge into the previous step: keep its "before", take the new "after".
      const before: RecordMap = new Map(top.before);
      for (const [k, v] of committed.before) if (!before.has(k)) before.set(k, v);
      const after: RecordMap = new Map(top.after);
      for (const [k, v] of committed.after) after.set(k, v);
      for (const [k, a] of after) if (JSON.stringify(a.value) === JSON.stringify(before.get(k)?.value)) after.delete(k);
      for (const k of [...before.keys()]) if (!after.has(k)) before.delete(k);
      this.undoStack.pop();
      // Where the merged step lies is worked out afresh: the earlier step's level and layer may no longer be the only ones.
      const { levelId: _levelId, level: _level, layer: _layer, ...rest } = top;
      entry = { ...rest, before, after, atMs: now, at: new Date(now).toISOString(), bytes: sizeOf(before) + sizeOf(after), ...whereOf(committed.doc, before, after) };
      if (after.size) this.undoStack.push(entry);
      txId = after.size ? entry.id : null;
    } else {
      entry = {
        id: newId('tx'),
        label,
        author,
        at: new Date(now).toISOString(),
        atMs: now,
        before: committed.before,
        after: committed.after,
        coalesce: options.coalesce,
        bytes: sizeOf(committed.before) + sizeOf(committed.after),
        ...(options.command ? { command: options.command } : {}),
        ...whereOf(committed.doc, committed.before, committed.after),
      };
      this.undoStack.push(entry);
      txId = entry.id;
    }
    this.redoStack = [];
    this.trim();
    this.current = committed.doc;
    this.seqValue++;
    for (const r of committed.after.values()) this.touchedAt.set(r.id, { seq: this.seqValue, author });
    this.emit({ id: entry.id, label, author, kind: 'do' }, patchOps(committed.before, committed.after));
    return { result, changed: true, txId };
  }

  /**
   * What an undo or redo entry added or changed (its entity and connector ids, the removed ones left out) and the level
   * to show them on: the entry's one level, else the level of the first entity it changed, null for connectors alone.
   * For selecting a History row's change on the plan; null when no entry has that id.
   */
  changed(txId: string): { levelId: string | null; ids: string[] } | null {
    const entry = this.undoStack.find((e) => e.id === txId) ?? this.redoStack.find((e) => e.id === txId);
    if (!entry) return null;
    const ids: string[] = [];
    let levelId: string | null = entry.levelId ?? null;
    for (const r of entry.after.values()) {
      if ((r.c !== 'entity' && r.c !== 'connector') || r.value === undefined) continue;
      ids.push(r.id);
      if (!levelId && r.c === 'entity' && r.lv) levelId = r.lv;
    }
    return { levelId, ids };
  }

  /** Undoes the newest change. With `ifTop`, only when that is the newest change (so an agent never undoes someone else's work). */
  undo(ifTop?: string): HistoryState {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) throw new StudioError('CONFLICT', 'There is nothing to undo.');
    if (ifTop && entry.id !== ifTop) throw new StudioError('CONFLICT', `The newest change is "${entry.label}" by ${entry.author.name}, not the one you meant; nothing was undone.`);
    this.move(entry, entry.after, entry.before, 'undo');
    this.undoStack.pop();
    this.redoStack.push(entry);
    return this.history();
  }

  redo(): HistoryState {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) throw new StudioError('CONFLICT', 'There is nothing to redo.');
    this.move(entry, entry.before, entry.after, 'redo');
    this.redoStack.pop();
    this.undoStack.push(entry);
    return this.history();
  }

  private move(entry: Entry, from: RecordMap, to: RecordMap, kind: 'undo' | 'redo'): void {
    const ops = patchOps(from, to);
    const tx = new Transaction(this.current);
    tx.apply(ops);
    const committed = tx.commit();
    if (committed) this.current = committed.doc;
    this.seqValue++;
    for (const r of to.values()) this.touchedAt.set(r.id, { seq: this.seqValue, author: entry.author });
    this.emit({ id: entry.id, label: entry.label, author: entry.author, kind }, ops);
  }

  /** Changes project details (name, description, tags) without an undo step: they belong to the library, not the design. */
  setMeta(patch: Partial<ProjectDoc['meta']>): void {
    const meta = { ...this.current.meta, ...patch };
    this.current = { ...this.current, meta };
    this.seqValue++;
    this.emit({ id: newId('tx'), label: 'Project details', author: { kind: 'user', name: 'You' }, kind: 'meta' }, [{ t: 'upd', c: 'meta', id: 'meta', set: patch as Record<string, unknown> }]);
  }

  /** Replaces the whole document (snapshot restore, reload): history is cleared and the mirror refetches. */
  replace(doc: ProjectDoc, label: string, author: Author): void {
    this.current = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.touchedAt.clear();
    this.epochValue++;
    this.seqValue++;
    this.emit({ id: newId('tx'), label, author, kind: 'replace' }, []);
  }

  private trim(): void {
    let bytes = this.undoStack.reduce((sum, e) => sum + e.bytes, 0);
    while (this.undoStack.length > this.opts.maxEntries || (bytes > this.opts.maxBytes && this.undoStack.length > 1)) {
      bytes -= this.undoStack.shift()!.bytes;
    }
  }

  private emit(tx: DocPatch['tx'], ops: Op[]): void {
    this.opts.onChange(this.current, { epoch: this.epochValue, seq: this.seqValue, tx, ops, history: this.history() });
  }
}
