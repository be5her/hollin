import { Injector, Service, inject, runInInjectionContext, untracked } from '@angular/core';
import { AppState, Dialogs, HostBridge, TabsState, Theme, Toasts, UiActions, type Tab, type UIAction } from '@studio/ui';
import { modules } from './modules';

/** What the shell itself can do (tabs, settings, theme), plus the palette and keyboard wiring. */
@Service()
export class ShellActions {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly tabs = inject(TabsState);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly theme = inject(Theme);
  private readonly actions = inject(UiActions);
  private readonly injector = inject(Injector);

  private readonly shellActions: UIAction[] = [
    { id: 'palette.open', title: 'Command palette', group: 'App', shortcut: 'Ctrl+K', run: () => this.app.paletteOpen.set(true) },
    { id: 'home.open', title: 'Go to Home', group: 'App', keywords: ['projects', 'library'], run: () => this.openHome() },
    { id: 'settings.open', title: 'Settings', group: 'App', shortcut: 'Ctrl+,', keywords: ['preferences', 'options'], run: () => this.openSettings() },
    { id: 'theme.toggle', title: 'Toggle light / dark theme', group: 'App', keywords: ['appearance', 'dark mode'], run: () => this.toggleTheme() },
    {
      id: 'tab.close',
      title: 'Close tab',
      group: 'Tabs',
      shortcut: 'Ctrl+W',
      run: () => {
        const tab = untracked(this.tabs.activeTab);
        if (tab) void this.closeTabs([tab.id]);
      },
      when: () => {
        const tab = untracked(this.tabs.activeTab);
        return tab !== null && !tab.pinned;
      },
    },
    { id: 'tab.next', title: 'Next tab', group: 'Tabs', shortcut: 'Ctrl+Tab', run: () => this.cycleTab(1) },
    { id: 'tab.previous', title: 'Previous tab', group: 'Tabs', shortcut: 'Ctrl+Shift+Tab', run: () => this.cycleTab(-1) },
    ...modules
      .filter((m) => m.sidebar)
      .map<UIAction>((m) => ({
        id: `module.show.${m.id}`,
        title: `Show ${m.title}`,
        group: 'Panels',
        run: () => this.app.activeModule.set(m.id),
        when: () => m.availability === 'always' || untracked(this.app.hasProject),
      })),
  ];
  private moduleActions: UIAction[] = [];

  /** Put the shell's and the modules' actions in the palette; returns the function that takes them out. */
  register(): () => void {
    // Module actions are built in an injection context so they can reach their module's services.
    this.moduleActions = runInInjectionContext(this.injector, () => modules.flatMap((m) => m.actions?.() ?? []));
    const offs = [this.actions.register(this.shellActions), this.actions.register(this.moduleActions)];
    return () => offs.forEach((off) => off());
  }

  openHome(): void {
    const home = this.tabs.find('shell.home:home');
    if (home) this.tabs.activate(home.id);
  }

  openSettings(section?: string): void {
    const tab = this.tabs.open({ type: 'settings.main', title: 'Settings', data: { key: 'settings', section } }, { singletonKey: 'settings.main:settings' });
    if (section) this.tabs.update(tab.id, { data: { key: 'settings', section } });
  }

  async toggleTheme(): Promise<void> {
    const next = untracked(this.app.resolvedTheme) === 'dark' ? 'light' : 'dark';
    this.theme.apply(next);
    try {
      await this.host.invoke('config.update', { patch: { appearance: { theme: next } } }, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  /** Close tabs, asking first when any of them has unsaved changes. Pinned tabs stay. */
  async closeTabs(ids: string[]): Promise<void> {
    const closing = untracked(this.tabs.tabs).filter((t) => ids.includes(t.id) && !t.pinned);
    const dirty = closing.filter((t) => t.dirty);
    if (dirty.length) {
      const ok = await this.dialogs.confirm({
        title: dirty.length === 1 ? `Close "${dirty[0].title}" with unsaved changes?` : `Close ${dirty.length} tabs with unsaved changes?`,
        message: 'Unsaved changes in those tabs are lost.',
        danger: true,
        confirmLabel: 'Close',
      });
      if (!ok) return;
    }
    for (const tab of closing) await this.beforeClose(tab);
    this.tabs.closeWhere((t) => closing.some((c) => c.id === t.id));
  }

  /** Hook for tabs that need the host told, e.g. closing a project. */
  private readonly closeHandlers = new Map<string, (tab: Tab) => Promise<void>>();

  onClose(type: string, handler: (tab: Tab) => Promise<void>): void {
    this.closeHandlers.set(type, handler);
  }

  private async beforeClose(tab: Tab): Promise<void> {
    try {
      await this.closeHandlers.get(tab.type)?.(tab);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  private cycleTab(step: 1 | -1): void {
    const tabs = untracked(this.tabs.tabs);
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.id === untracked(this.tabs.activeTabId));
    this.tabs.activate(tabs[(index + step + tabs.length) % tabs.length].id);
  }

  /** Global keyboard shortcuts. Editors handle their own keys first and stop propagation. */
  handleShortcut(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented) return;
    const key = e.key.toLowerCase();
    const run = (id: string) => {
      if (this.actions.run(id)) e.preventDefault();
    };
    if (key === 'k' || (e.shiftKey && key === 'p')) return run('palette.open');
    if (key === ',') return run('settings.open');
    if (key === 'w') return run('tab.close');
    if (key === 'tab') return run(e.shiftKey ? 'tab.previous' : 'tab.next');
    if (key === 'n' && !e.shiftKey) return run('project.new');
  }
}
