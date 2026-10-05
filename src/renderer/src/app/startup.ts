import { DestroyRef, Service, inject } from '@angular/core';
import type { GlobalConfig, McpStatus } from '@studio/core';
import { AppState, HostBridge, TabsState, Theme } from '@studio/ui';
import { ShellActions } from './shell-actions';

/**
 * Brings the shell up: loads what the host knows (config, commands, MCP status) before the first
 * render, then follows the host's events.
 */
@Service()
export class ShellStartup {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly theme = inject(Theme);
  private readonly tabs = inject(TabsState);
  private readonly actions = inject(ShellActions);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Home first, so the project tabs restored by the library land after it and can take focus.
    this.tabs.open({ type: 'shell.home', title: 'Home', pinned: true, data: { key: 'home' } }, { singletonKey: 'shell.home:home' });
    const offs = [
      this.host.on('config.changed', ({ config }) => {
        this.app.config.set(config);
        this.theme.apply(config.appearance.theme);
      }),
      this.host.on('mcp.status', (status) => this.app.mcpStatus.set(status)),
      this.actions.register(),
    ];
    this.destroyRef.onDestroy(() => offs.forEach((off) => off()));
    this.theme.followSystem(this.destroyRef);
  }

  /** Load the initial state; the shell renders once this resolves. */
  async load(): Promise<void> {
    const [config, commands, mcp] = await Promise.all([
      this.host.invoke<GlobalConfig>('config.get', {}, null),
      this.host.listCommands(),
      this.host.invoke<McpStatus>('mcp.status', {}, null),
    ]);
    this.app.config.set(config);
    this.theme.apply(config.appearance.theme);
    this.app.commands.set(commands);
    this.app.mcpStatus.set(mcp);
    this.app.ready.set(true);
  }
}
