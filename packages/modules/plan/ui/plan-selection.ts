import { Service, computed, signal, type Signal } from '@angular/core';
import type { VertexRef } from '@studio/viewport';

interface Selection {
  ids: string[];
  vertex: VertexRef | null;
}

const EMPTY: Selection = { ids: [], vertex: null };

export interface SelectionRequest {
  levelId: string;
  ids: string[];
  n: number;
}

/** What is selected on each project's plan, shared by the plan view (which sets it) and the Properties panel (which edits it). */
@Service()
export class PlanSelection {
  private readonly state = signal<Record<string, Selection>>({});
  /** What another panel asked the plan to select (a warning clicked): applied by the plan view once its level matches. */
  private readonly requests = signal<Record<string, SelectionRequest | undefined>>({});
  private requested_n = 0;

  of(projectId: string): Signal<Selection> {
    return computed(() => this.state()[projectId] ?? EMPTY);
  }

  setIds(projectId: string, ids: string[]): void {
    this.state.update((all) => ({ ...all, [projectId]: { ...(all[projectId] ?? EMPTY), ids } }));
  }

  setVertex(projectId: string, vertex: VertexRef | null): void {
    this.state.update((all) => ({ ...all, [projectId]: { ...(all[projectId] ?? EMPTY), vertex } }));
  }

  /** Asks the plan to show a level and select ids there. */
  request(projectId: string, what: { levelId: string; ids: string[] }): void {
    this.requests.update((all) => ({ ...all, [projectId]: { ...what, n: ++this.requested_n } }));
  }

  requested(projectId: string): Signal<SelectionRequest | undefined> {
    return computed(() => this.requests()[projectId]);
  }

  /** Done with a request (by its number, so a newer one is kept). */
  clearRequest(projectId: string, n: number): void {
    this.requests.update((all) => (all[projectId]?.n === n ? { ...all, [projectId]: undefined } : all));
  }
}
