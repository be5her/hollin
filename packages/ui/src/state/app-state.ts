import { Service, computed, inject, signal } from '@angular/core';
import type { CommandMeta, GlobalConfig, McpStatus } from '@studio/core';
import { TabsState } from './tabs-state';

/**
 * What Otto is doing in the project on screen, for the status bar and History: published by the assistant
 * module's UI from `assistant.event`, `assistant.status` and `assistant.probe` (the shell knows no module).
 */
export interface AssistantPresence {
  projectId: string;
  /** `ready`, `thinking`, `reading`, `looking`, `editing`, `writing`, `waiting`, `stopping`, `stopped`, `failed`, `needs-key`, `not-found`, `not-logged-in`, `mcp-off` or `checking`. */
  state: string;
  /** The words shown, such as "Otto · ready" or "Otto · Add a 3 m wall…". */
  text: string;
  /** The dot: mulberry while Otto is present, muted when it cannot work or stopped, danger after a failed run. */
  tone: 'ai' | 'muted' | 'danger';
  /** The dot pulses while Otto works. */
  pulse: boolean;
  /** Where a click goes: the project's Otto tab, or Settings > Assistant for the setup states. */
  opens: 'panel' | 'settings';
  /** The destructive call waiting for the user's yes, if any: History shows it greyed at the top, the plan outlines `ids` (what its input names; empty when it names none). */
  pending: { title: string; command: string; ids: string[] } | null;
}

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
  /** Otto's state in the project on screen; null while no project is (or the assistant module is absent). */
  readonly assistant = signal<AssistantPresence | null>(null);

  /** The project on screen: the active tab's. Project-scope commands run against it by default. */
  readonly activeProjectId = computed(() => this.tabs.activeTab()?.projectId ?? null);
  readonly hasProject = computed(() => this.activeProjectId() !== null);
  readonly units = computed(() => this.config()?.units);
}
