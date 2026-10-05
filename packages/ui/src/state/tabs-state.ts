import { Service, computed, signal, untracked } from '@angular/core';
import { moveItem, newId } from '@studio/core';

export interface Tab {
  id: string;
  /** `shell.home`, `shell.settings`, or registered by a module as `<module>.<kind>`, e.g. `project.editor`. */
  type: string;
  title: string;
  /** Free-form payload the tab component reads. */
  data?: Record<string, unknown>;
  /** The project the tab shows; the project on screen is the active tab's. */
  projectId?: string;
  dirty?: boolean;
  /** Pinned tabs stay at the front and cannot be closed (Home). */
  pinned?: boolean;
}

/** Stable identity for "one tab per item" behaviour. */
export function singletonKey(tab: Pick<Tab, 'type' | 'data' | 'projectId'>): string {
  const key = tab.projectId ?? tab.data?.['key'] ?? tab.data?.['id'] ?? '';
  return `${tab.type}:${String(key)}`;
}

/** The open tabs: Home, Settings and every open project. */
@Service()
export class TabsState {
  private readonly list = signal<Tab[]>([]);
  private readonly activeId = signal<string | null>(null);

  readonly tabs = this.list.asReadonly();
  readonly activeTabId = this.activeId.asReadonly();
  readonly activeTab = computed(() => this.list().find((t) => t.id === this.activeId()) ?? null);

  find(key: string): Tab | undefined {
    return untracked(this.list).find((t) => singletonKey(t) === key);
  }

  /** Open (or, with a singleton key that is already open, focus) a tab and make it active. */
  open(tab: Omit<Tab, 'id'> & { id?: string }, options: { singletonKey?: string; activate?: boolean } = {}): Tab {
    const existing = options.singletonKey ? this.find(options.singletonKey) : undefined;
    const target = existing ?? { ...tab, id: tab.id ?? newId('tab') };
    if (!existing) {
      this.list.update((tabs) => (target.pinned ? [...tabs.filter((t) => t.pinned), target, ...tabs.filter((t) => !t.pinned)] : [...tabs, target]));
    }
    if (options.activate !== false) this.activeId.set(target.id);
    return target;
  }

  close(id: string): void {
    const tabs = untracked(this.list);
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0 || tabs[index].pinned) return;
    const rest = tabs.filter((t) => t.id !== id);
    this.list.set(rest);
    if (untracked(this.activeId) === id) this.activeId.set(rest[Math.min(index, rest.length - 1)]?.id ?? null);
  }

  /** Close every unpinned tab the predicate matches. */
  closeWhere(predicate: (tab: Tab) => boolean): void {
    const rest = untracked(this.list).filter((t) => t.pinned || !predicate(t));
    this.list.set(rest);
    if (!rest.some((t) => t.id === untracked(this.activeId))) this.activeId.set(rest[rest.length - 1]?.id ?? null);
  }

  activate(id: string | null): void {
    this.activeId.set(id);
  }

  /** Reorder: the tab ends up at index `to` among the unpinned tabs. Pinned tabs keep their places at the front. */
  move(id: string, to: number): void {
    const tabs = untracked(this.list);
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0 || tabs[from].pinned) return;
    const pinned = tabs.filter((t) => t.pinned).length;
    this.list.set(moveItem(tabs, from, pinned + Math.max(0, to)));
  }

  update(id: string, patch: Partial<Omit<Tab, 'id'>>): void {
    this.list.update((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  private readonly closeHandlers = new Map<string, (tab: Tab) => Promise<void>>();

  /** Runs before a tab of this type is closed by the user, e.g. to close its project in the host. */
  onClose(type: string, handler: (tab: Tab) => Promise<void>): void {
    this.closeHandlers.set(type, handler);
  }

  async beforeClose(tab: Tab): Promise<void> {
    await this.closeHandlers.get(tab.type)?.(tab);
  }
}
