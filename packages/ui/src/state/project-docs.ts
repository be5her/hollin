import { Service, computed, inject, signal, untracked, type Signal } from '@angular/core';
import { applyPatch, toErrorPayload, type DocPatch, type HistoryState, type ProjectDoc } from '@studio/core';
import { HostBridge } from '../host/host-bridge';

export interface DocState {
  doc: ProjectDoc;
  seq: number;
  epoch: number;
  history: HistoryState;
}

type Patch = DocPatch & { projectId: string };

/**
 * The renderer's mirror of each open project's document. Main holds the real one; every change
 * arrives as a `doc.patched` event and is applied here with the same code. A gap in the change
 * numbers or a new epoch (a snapshot restore) makes it fetch the whole document again.
 */
@Service()
export class ProjectDocs {
  private readonly host = inject(HostBridge);
  private readonly states = signal<Record<string, DocState>>({});
  private readonly loading = new Map<string, Patch[]>();
  readonly errors = signal<Record<string, string>>({});

  constructor() {
    this.host.on('doc.patched', (patch) => this.patched(patch));
    this.host.on('project.changed', (event) => {
      if (event.kind === 'closed') this.forget(event.projectId);
    });
  }

  /** Reads (reactively) a project's document state, loading it on first use. Use inside `computed`. */
  read(projectId: string | null | undefined): DocState | undefined {
    if (!projectId) return undefined;
    const state = this.states()[projectId];
    if (!state && !this.loading.has(projectId)) void this.load(projectId);
    return state;
  }

  /** The state of a project's document, loading it on first use. */
  state(projectId: string): Signal<DocState | undefined> {
    if (!untracked(this.states)[projectId] && !this.loading.has(projectId)) void this.load(projectId);
    return computed(() => this.states()[projectId]);
  }

  doc(projectId: string): Signal<ProjectDoc | undefined> {
    const state = this.state(projectId);
    return computed(() => state()?.doc);
  }

  async load(projectId: string): Promise<void> {
    if (this.loading.has(projectId)) return;
    this.loading.set(projectId, []);
    try {
      const loaded = await this.host.invoke<DocState & { projectId: string }>('doc.get', {}, projectId);
      // Changes announced while the document was on its way: keep those it does not include yet.
      let state: DocState = { doc: loaded.doc, seq: loaded.seq, epoch: loaded.epoch, history: loaded.history };
      for (const patch of this.loading.get(projectId) ?? []) {
        if (patch.epoch !== state.epoch || patch.seq <= state.seq) continue;
        state = { doc: applyPatch(state.doc, patch.ops), seq: patch.seq, epoch: patch.epoch, history: patch.history };
      }
      this.states.update((all) => ({ ...all, [projectId]: state }));
      this.errors.update(({ [projectId]: _gone, ...rest }) => rest);
    } catch (err) {
      this.errors.update((all) => ({ ...all, [projectId]: toErrorPayload(err).message }));
    } finally {
      this.loading.delete(projectId);
    }
  }

  private patched(patch: Patch): void {
    const buffered = this.loading.get(patch.projectId);
    if (buffered) {
      buffered.push(patch);
      return;
    }
    const current = untracked(this.states)[patch.projectId];
    if (!current) return;
    if (patch.epoch !== current.epoch || patch.seq !== current.seq + 1) {
      void this.load(patch.projectId);
      return;
    }
    const next: DocState = { doc: applyPatch(current.doc, patch.ops), seq: patch.seq, epoch: patch.epoch, history: patch.history };
    this.states.update((all) => ({ ...all, [patch.projectId]: next }));
  }

  private forget(projectId: string): void {
    this.states.update(({ [projectId]: _gone, ...rest }) => rest);
  }
}
