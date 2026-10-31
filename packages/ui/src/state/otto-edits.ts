import { Service, computed, inject, signal, untracked, type Signal } from '@angular/core';
import type { DocPatch } from '@studio/core';
import { HostBridge } from '../host/host-bridge';

/** One edit by Otto the plan marks for a minute (the shape `PlanHighlight` in `@studio/viewport` takes). */
export interface OttoEdit {
  /** The undo entry it came from. */
  txId: string;
  /** The entities and connectors it added or changed. */
  ids: readonly string[];
  /** The batch's label, or the command's title for a single call. */
  label: string;
  /** When it landed here, in ms since the epoch. */
  at: number;
  /** When your next edit began removing it, if it has. */
  clearedAt?: number;
}

/** How long an edit stays marked, how long your next edit takes to remove the marks (`03-otto.md` §c). */
const LIFE_MS = 60_000;
const CLEAR_MS = 200;

type Patch = DocPatch & { projectId: string };

/**
 * Otto's recent edits per open project, from `doc.patched`: a transaction by the assistant (done or
 * redone) adds its entity and connector ids with the time it landed; undoing it removes them at once,
 * and redoing it brings them back with their first age; your next edit (or an MCP agent's) clears them
 * over 200 ms; each is gone a minute after it landed. The plan view hands them to its editor as
 * highlights. Nothing is stored: a restart forgets them, like the undo stack.
 */
@Service()
export class OttoEdits {
  private readonly host = inject(HostBridge);
  private readonly edits = signal<Record<string, readonly OttoEdit[]>>({});
  /** Undone edits, by transaction id, so a redo restores the original time. */
  private readonly undone = new Map<string, OttoEdit>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.host.on('doc.patched', (patch) => this.patched(patch));
    this.host.on('project.changed', (event) => {
      if (event.kind === 'closed') this.set(event.projectId, []);
    });
  }

  /** A project's recent Otto edits, oldest first. */
  of(projectId: () => string | null | undefined): Signal<readonly OttoEdit[]> {
    return computed(() => this.edits()[projectId() ?? ''] ?? NONE);
  }

  private patched(patch: Patch): void {
    const { projectId, tx } = patch;
    const now = Date.now();
    const list = untracked(this.edits)[projectId] ?? NONE;
    if (tx.kind === 'replace') {
      this.set(projectId, []);
      return;
    }
    if (tx.kind === 'meta') return;
    if (tx.author.kind !== 'assistant') {
      // Your next edit makes the sheet yours again (an undo or redo of your own step counts too).
      if (list.some((e) => e.clearedAt === undefined)) this.set(projectId, list.map((e) => (e.clearedAt === undefined ? { ...e, clearedAt: now } : e)));
      return;
    }
    if (tx.kind === 'undo') {
      const gone = list.find((e) => e.txId === tx.id);
      if (gone) this.undone.set(tx.id, gone);
      this.set(projectId, list.filter((e) => e.txId !== tx.id));
      return;
    }
    const ids = [...new Set(patch.ops.filter((op) => (op.c === 'entity' || op.c === 'connector') && op.t !== 'del').map((op) => op.id))];
    const before = list.find((e) => e.txId === tx.id);
    const restored = tx.kind === 'redo' ? this.undone.get(tx.id) : undefined;
    this.undone.delete(tx.id);
    if (!ids.length && !before) return;
    // A step that merged into the one before it keeps that step's ids too.
    const merged = before ? [...new Set([...before.ids, ...ids])] : ids;
    const edit: OttoEdit = { txId: tx.id, ids: merged, label: tx.label, at: restored?.at ?? now };
    this.set(projectId, [...list.filter((e) => e.txId !== tx.id), edit]);
  }

  private set(projectId: string, list: readonly OttoEdit[]): void {
    this.edits.update((all) => {
      if (!list.length) {
        if (!(projectId in all)) return all;
        const { [projectId]: _gone, ...rest } = all;
        return rest;
      }
      return { ...all, [projectId]: list };
    });
    this.schedule();
  }

  /** Drops edits whose minute is up and those your edit has finished removing, at the next time one is due. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    let due = Infinity;
    for (const list of Object.values(untracked(this.edits))) for (const e of list) due = Math.min(due, e.clearedAt !== undefined ? e.clearedAt + CLEAR_MS : e.at + LIFE_MS);
    for (const [id, e] of this.undone) if (Date.now() - e.at > LIFE_MS) this.undone.delete(id);
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => this.prune(), Math.max(0, due - Date.now()) + 20);
  }

  private prune(): void {
    const now = Date.now();
    const all = untracked(this.edits);
    for (const [projectId, list] of Object.entries(all)) {
      const kept = list.filter((e) => (e.clearedAt !== undefined ? now - e.clearedAt < CLEAR_MS : now - e.at < LIFE_MS));
      if (kept.length !== list.length) {
        this.set(projectId, kept);
        return;
      }
    }
    this.schedule();
  }
}

const NONE: readonly OttoEdit[] = [];
