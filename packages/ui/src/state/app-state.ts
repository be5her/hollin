import { Service, computed, inject, signal } from '@angular/core';
import type { CommandMeta, GlobalConfig, McpStatus } from '@studio/core';
import { TabsState } from './tabs-state';

/** What the whole renderer shares: config, the command list, host status and what is on screen. */
@Service()
export class AppState {
  private readonly tabs = inject(TabsState);

  readonly ready = signal(false);
  readonly config = signal<GlobalConfig | null>(null);
  readonly commands = signal<CommandMeta[]>([]);
  readonly paletteOpen = signal(false);
  readonly resolvedTheme = signal<'light' | 'dark'>('light');
  readonly mcpStatus = signal<McpStatus | null>(null);
  /** The module whose panel the sidebar shows, or null to hide the sidebar. */
  readonly activeModule = signal<string | null>(null);

  /** The project on screen: the active tab's. Project-scope commands run against it by default. */
  readonly activeProjectId = computed(() => this.tabs.activeTab()?.projectId ?? null);
  readonly hasProject = computed(() => this.activeProjectId() !== null);
  readonly units = computed(() => this.config()?.units);
}
