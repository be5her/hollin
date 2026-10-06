import { Service, computed, signal, type Signal } from '@angular/core';
import type { VertexRef } from '@studio/viewport';

interface Selection {
  ids: string[];
  vertex: VertexRef | null;
}

const EMPTY: Selection = { ids: [], vertex: null };

/** What is selected on each project's plan, shared by the plan view (which sets it) and the Properties panel (which edits it). */
@Service()
export class PlanSelection {
  private readonly state = signal<Record<string, Selection>>({});

  of(projectId: string): Signal<Selection> {
    return computed(() => this.state()[projectId] ?? EMPTY);
  }

  setIds(projectId: string, ids: string[]): void {
    this.state.update((all) => ({ ...all, [projectId]: { ...(all[projectId] ?? EMPTY), ids } }));
  }

  setVertex(projectId: string, vertex: VertexRef | null): void {
    this.state.update((all) => ({ ...all, [projectId]: { ...(all[projectId] ?? EMPTY), vertex } }));
  }
}
