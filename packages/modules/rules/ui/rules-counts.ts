import { Service, computed, inject, signal, type Signal } from '@angular/core';
import { HostBridge, injectHostEvent } from '@studio/ui';

/** How many warnings each open project has, for the badge on the Warnings tab: fetched once, then kept current by `rules.changed`. */
@Service()
export class RulesCounts {
  private readonly host = inject(HostBridge);
  private readonly counts = signal<Record<string, number>>({});
  private readonly fetched = new Set<string>();
  private readonly signals = new Map<string, Signal<number>>();

  constructor() {
    injectHostEvent('rules.changed', ({ projectId, count }) => this.counts.update((all) => ({ ...all, [projectId]: count })));
    injectHostEvent('project.changed', ({ projectId, kind }) => {
      if (kind !== 'closed') return;
      this.fetched.delete(projectId);
      this.signals.delete(projectId);
      this.counts.update(({ [projectId]: _gone, ...rest }) => rest);
    });
  }

  count(projectId: string): Signal<number> {
    let s = this.signals.get(projectId);
    if (!s) {
      s = computed(() => this.counts()[projectId] ?? 0);
      this.signals.set(projectId, s);
    }
    if (!this.fetched.has(projectId)) {
      this.fetched.add(projectId);
      queueMicrotask(() => {
        this.host
          .invoke<{ count: number }>('rules.check', {}, projectId)
          .then((r) => this.counts.update((all) => ({ ...all, [projectId]: r.count })))
          .catch(() => undefined);
      });
    }
    return s;
  }
}
