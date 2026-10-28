import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, afterRenderEffect, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { FormField, form, max, min, required } from '@angular/forms/signals';
import { AI_MODELS, AI_PROVIDERS, BRANDING, CLAUDE_CODE_EFFORTS, CLAUDE_CODE_MODEL_ALIASES, clientSnippets, defaultConfig, type AiProvider, type AssistantStatus, type ClaudeCodeEffort, type ConfigPatch, type GlobalConfig, type McpCallEntry, type ThemePreference, type UnitSettings } from '@studio/core';
import { AppState, Badge, Button, Checkbox, HostBridge, Icon, Input, Label, SETTINGS_LATE, Select, SettingsSections, Theme, Toasts, invokeResource, type Tab, type TabComponent } from '@studio/ui';
import { Copy, KeyRound, RefreshCw, Trash2 } from 'lucide';
import { UnitsEditor } from './units-editor';

interface Draft {
  theme: ThemePreference;
  units: UnitSettings;
  mcpEnabled: boolean;
  port: number;
  allowMutations: boolean;
  model: string;
  provider: AiProvider;
  claudeCodePath: string;
  claudeCodeModel: string;
  claudeCodeEffort: ClaudeCodeEffort;
}

function toDraft(config: GlobalConfig): Draft {
  return {
    theme: config.appearance.theme,
    units: config.units,
    mcpEnabled: config.mcp.enabled,
    port: config.mcp.port,
    allowMutations: config.mcp.allowMutations,
    model: config.ai.model,
    provider: config.ai.provider,
    claudeCodePath: config.ai.claudeCodePath,
    claudeCodeModel: config.ai.claudeCodeModel,
    claudeCodeEffort: config.ai.claudeCodeEffort,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface AppInfo {
  productName: string;
  version: string;
  platform: string;
  runtime: Record<string, string>;
  dataDir: string;
  secretsPersistent: boolean;
}

/**
 * Settings: appearance, units, the MCP server, the assistant and About. Choices apply at once; the
 * port applies when the field loses focus. Everything is stored in the global config, except the
 * API key, which goes to the encrypted secret store.
 */
@Component({
  selector: 'x-settings-tab',
  imports: [Badge, Button, Checkbox, FormField, Icon, Input, Label, NgComponentOutlet, NgTemplateOutlet, Select, UnitsEditor],
  templateUrl: './settings-tab.html',
  host: { class: 'flex-1 overflow-auto', 'data-testid': 'settings' },
})
export class SettingsTab implements TabComponent {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly theme = inject(Theme);
  private readonly toasts = inject(Toasts);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tab = input.required<Tab>();

  protected readonly icons = { Copy, KeyRound, RefreshCw, Trash2 };
  protected readonly models = AI_MODELS;
  protected readonly providers = AI_PROVIDERS;
  protected readonly claudeCodeModels = CLAUDE_CODE_MODEL_ALIASES;
  protected readonly claudeCodeEfforts = CLAUDE_CODE_EFFORTS;
  protected readonly productName = BRANDING.productName;
  protected readonly config = this.app.config;
  protected readonly mcp = this.app.mcpStatus;
  /** Sections other modules add, e.g. the library's location (after Units) and Updates (before About). */
  private readonly allSections = inject(SettingsSections).sections;
  protected readonly sections = computed(() => this.allSections().filter((s) => s.order < SETTINGS_LATE));
  protected readonly lateSections = computed(() => this.allSections().filter((s) => s.order >= SETTINGS_LATE));

  /** The editable copy of the config. It follows the stored config, so changes made elsewhere show up here. */
  protected readonly draft = linkedSignal<GlobalConfig | null, Draft>({
    source: this.config,
    computation: (config, previous) => (config ? toDraft(config) : (previous?.value ?? toDraft(defaultConfig()))),
  });
  protected readonly settings = form(this.draft, (p) => {
    required(p.port);
    min(p.port, 1024);
    max(p.port, 65535);
  });

  protected readonly keyDraft = signal({ key: '' });
  protected readonly keyForm = form(this.keyDraft, (p) => {
    required(p.key);
  });
  protected readonly keyStatus = invokeResource<{ set: boolean; persistent: boolean }>('ai.key.status', () => ({}), { projectId: null, refreshOnEvents: ['secrets.changed'] });
  /** For the Claude Code provider: found, which version, logged in. */
  protected readonly assistant = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: null, refreshOnEvents: ['config.changed', 'mcp.status'] });
  protected readonly checking = signal(false);
  protected readonly claudeCodeState = computed(() => {
    const cc = this.assistant.value()?.claudeCode;
    if (!cc) return '';
    if (!cc.found) return `Not found: ${cc.error ?? cc.path}`;
    const version = cc.version ? `Claude Code ${cc.version}` : 'Claude Code';
    return cc.loggedIn === false ? `${version}, not logged in: run \`claude\` in a terminal and log in` : cc.loggedIn ? `${version}, logged in` : `${version}${cc.error ? `: ${cc.error}` : ''}`;
  });
  protected readonly calls = invokeResource<McpCallEntry[]>('mcp.calls', () => ({}), { projectId: null, refreshOnEvents: ['mcp.call'] });
  protected readonly recentCalls = computed(() => [...(this.calls.value() ?? [])].reverse().slice(0, 8));
  protected readonly info = invokeResource<AppInfo>('app.info', () => ({}), { projectId: null });
  protected readonly snippets = computed(() => clientSnippets(BRANDING.mcpServerName, this.mcp()?.url ?? `http://127.0.0.1:${this.draft().port}/mcp`));
  protected readonly savingKey = signal(false);

  constructor() {
    // Apply choices as they are made. The port waits for blur, so half-typed numbers never restart the server.
    effect(() => {
      const draft = this.draft();
      const config = untracked(this.config);
      if (!config) return;
      const patch: ConfigPatch = {};
      if (draft.theme !== config.appearance.theme) patch.appearance = { theme: draft.theme };
      if (!same(draft.units, config.units)) patch.units = draft.units;
      if (draft.mcpEnabled !== config.mcp.enabled || draft.allowMutations !== config.mcp.allowMutations) {
        patch.mcp = { enabled: draft.mcpEnabled, allowMutations: draft.allowMutations };
      }
      if (draft.model !== config.ai.model || draft.provider !== config.ai.provider || draft.claudeCodeEffort !== config.ai.claudeCodeEffort) {
        patch.ai = { model: draft.model, provider: draft.provider, claudeCodeEffort: draft.claudeCodeEffort };
      }
      if (Object.keys(patch).length) untracked(() => this.save(patch));
    });

    // Opening Settings at a section (from the status bar) scrolls to it.
    afterRenderEffect({
      write: () => {
        const section = this.tab().data?.['section'];
        if (typeof section === 'string') this.element.nativeElement.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: 'start' });
      },
    });
  }

  private async save(patch: ConfigPatch): Promise<void> {
    if (patch.appearance?.theme) this.theme.apply(patch.appearance.theme);
    try {
      await this.host.invoke('config.update', { patch }, null);
    } catch (err) {
      this.toasts.error(err);
      // Fall back to what is stored.
      const config = untracked(this.config);
      if (config) this.draft.set(toDraft(config));
    }
  }

  protected savePort(): void {
    const config = untracked(this.config);
    const port = untracked(this.draft).port;
    if (!config || port === config.mcp.port) return;
    if (this.settings.port().invalid()) {
      this.toasts.notify('The port must be a number from 1024 to 65535.', 'error');
      return;
    }
    void this.save({ mcp: { port } });
  }

  /** The Claude Code path applies when the field loses focus, like the port, so a half-typed path is never probed. */
  protected saveClaudeCodePath(): void {
    const config = untracked(this.config);
    const claudeCodePath = untracked(this.draft).claudeCodePath.trim();
    if (!config || claudeCodePath === config.ai.claudeCodePath) return;
    void this.save({ ai: { claudeCodePath } });
  }

  /** The Claude Code model applies when the field loses focus, so a half-typed name is never passed to Claude Code. */
  protected saveClaudeCodeModel(): void {
    const config = untracked(this.config);
    const claudeCodeModel = untracked(this.draft).claudeCodeModel.trim();
    if (!config || claudeCodeModel === config.ai.claudeCodeModel) return;
    void this.save({ ai: { claudeCodeModel } });
  }

  protected async checkClaudeCode(): Promise<void> {
    this.checking.set(true);
    try {
      await this.host.invoke('assistant.status', { refresh: true }, null);
      this.assistant.reload();
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.checking.set(false);
    }
  }

  protected async restartMcp(): Promise<void> {
    try {
      await this.host.invoke('mcp.restart', {}, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async saveKey(event: Event): Promise<void> {
    event.preventDefault();
    const key = untracked(this.keyDraft).key.trim();
    if (!key) return;
    this.savingKey.set(true);
    try {
      const status = await this.host.invoke<{ persistent: boolean }>('ai.key.set', { key }, null);
      this.keyDraft.set({ key: '' });
      this.toasts.notify(status.persistent ? 'API key saved, encrypted' : 'API key kept for this session only: this system has no secure storage', 'success');
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.savingKey.set(false);
    }
  }

  protected async clearKey(): Promise<void> {
    try {
      await this.host.invoke('ai.key.clear', {}, null);
      this.toasts.notify('API key removed', 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected copy(text: string): void {
    this.toasts.copy(text);
  }

  protected time(at: string): string {
    return new Date(at).toLocaleTimeString();
  }
}
