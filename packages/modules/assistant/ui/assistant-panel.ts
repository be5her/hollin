import { Component, ElementRef, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { AI_MODELS, type AssistantEvent, type AssistantStatus, type ChatSnapshot, type TranscriptItem } from '@studio/core';
import { AppState, Button, EmptyState, HostBridge, Icon, Spinner, TabsState, Toasts, injectHostEvent, invokeResource } from '@studio/ui';
import { Check, CircleAlert, Eraser, KeyRound, Plug, RefreshCw, Send, ShieldAlert, Sparkles, Square, Wrench, X } from 'lucide';

/** Why the chat cannot run yet, as the empty state the panel shows instead. */
type EmptyReason = 'key' | 'not-found' | 'not-logged-in';

/**
 * The chat with the assistant for one project: the transcript (replies streamed, tool calls as
 * cards, a confirmation card when a destructive command waits for the user), the error of the last
 * run, and the composer. Everything comes from main through `assistant.state` and `assistant.event`.
 */
@Component({
  selector: 'x-assistant-panel',
  imports: [Button, EmptyState, Icon, Spinner],
  templateUrl: './assistant-panel.html',
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'assistant-panel' },
})
export class AssistantPanel {
  private readonly host = inject(HostBridge);
  private readonly app = inject(AppState);
  private readonly tabs = inject(TabsState);
  private readonly toasts = inject(Toasts);

  readonly projectId = input.required<string>();

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  protected readonly icons = { Check, CircleAlert, Eraser, KeyRound, Plug, RefreshCw, Send, ShieldAlert, Sparkles, Square, Wrench, X };
  protected readonly status = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: () => null, refreshOnEvents: ['secrets.changed', 'config.changed', 'mcp.status'] });
  protected readonly chat = signal<ChatSnapshot | null>(null);
  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly checking = signal(false);
  protected readonly enabling = signal(false);
  protected readonly running = computed(() => this.chat()?.status !== 'idle' && this.chat() !== null);
  /** No key, Claude Code missing, or Claude Code logged out: the panel shows an empty state instead of the chat. */
  protected readonly emptyReason = computed<EmptyReason | null>(() => {
    const s = this.status.value();
    if (!s) return null;
    if (s.provider === 'api') return s.keySet ? null : 'key';
    if (!s.claudeCode?.found) return 'not-found';
    return s.claudeCode.loggedIn === false ? 'not-logged-in' : null;
  });
  /** With Claude Code, the chat needs the MCP server, which only the user turns on. */
  protected readonly mcpOff = computed(() => {
    const s = this.status.value();
    return s?.provider === 'claude-code' && !s.mcp.running;
  });
  protected readonly modelLabel = computed(() => {
    const s = this.status.value();
    if (s?.provider === 'claude-code') {
      const ai = this.app.config()?.ai;
      return [`Claude Code${s.claudeCode?.version ? ` ${s.claudeCode.version}` : ''}`, ai?.claudeCodeModel, ai?.claudeCodeEffort && `${ai.claudeCodeEffort} effort`].filter(Boolean).join(' · ');
    }
    const id = this.chat()?.model ?? s?.model;
    return AI_MODELS.find((m) => m.id === id)?.label ?? id ?? '';
  });
  protected readonly notFoundHint = computed(() => this.status.value()?.claudeCode?.error ?? 'Install Claude Code, or set its path in Settings.');
  /** True while the model is working and no reply text has started yet, so the panel shows it is busy. */
  protected readonly busy = computed(() => {
    const chat = this.chat();
    if (!chat || chat.status !== 'running') return false;
    const last = chat.items[chat.items.length - 1];
    return !last || last.kind !== 'assistant';
  });
  protected readonly canSend = computed(() => this.draft().trim().length > 0 && !this.running() && !this.sending());

  constructor() {
    effect(() => {
      const id = this.projectId();
      untracked(() => void this.load(id));
    });
    injectHostEvent('assistant.event', ({ projectId, event }) => {
      if (projectId !== untracked(this.projectId)) return;
      this.apply(event);
    });
    afterRenderEffect(() => {
      this.chat();
      const el = this.log()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private async load(projectId: string): Promise<void> {
    try {
      this.chat.set(await this.host.invoke<ChatSnapshot>('assistant.state', {}, projectId));
    } catch (err) {
      this.toasts.error(err);
    }
  }

  private apply(event: AssistantEvent): void {
    if (event.type === 'changed') {
      this.chat.set(event.state);
      return;
    }
    this.chat.update((chat) => (chat ? { ...chat, items: chat.items.map((item) => (item.kind === 'assistant' && item.id === event.id ? { ...item, text: item.text + event.delta } : item)) } : chat));
  }

  protected openSettings(): void {
    this.tabs.open({ type: 'settings.main', title: 'Settings', data: { key: 'settings', section: 'ai' } }, { singletonKey: 'settings.main:settings' });
  }

  /** Probes Claude Code again (after installing it or logging in). */
  protected async checkAgain(): Promise<void> {
    this.checking.set(true);
    try {
      await this.host.invoke('assistant.status', { refresh: true }, null);
      this.status.reload();
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.checking.set(false);
    }
  }

  /** The user's own click: the same config.update Settings runs. The assistant never starts the server by itself. */
  protected async enableMcp(): Promise<void> {
    this.enabling.set(true);
    try {
      await this.host.invoke('config.update', { patch: { mcp: { enabled: true } } }, null);
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.enabling.set(false);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  protected async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || !this.canSend()) return;
    this.sending.set(true);
    try {
      await this.host.invoke('assistant.send', { text }, this.projectId());
      this.draft.set('');
      const el = this.composer()?.nativeElement;
      if (el) {
        el.value = '';
        el.focus();
      }
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.sending.set(false);
    }
  }

  protected async stop(): Promise<void> {
    try {
      await this.host.invoke('assistant.cancel', {}, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async clear(): Promise<void> {
    try {
      await this.host.invoke('assistant.clear', {}, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async answer(allow: boolean): Promise<void> {
    const id = this.chat()?.confirm?.id;
    if (!id) return;
    try {
      await this.host.invoke('assistant.confirm.reply', { id, allow }, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected inputPreview(input: unknown): string {
    const text = JSON.stringify(input, null, 1) ?? '';
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  }

  protected toolIcon(item: Extract<TranscriptItem, { kind: 'tool' }>) {
    return item.status === 'ok' ? Check : item.status === 'running' ? Wrench : item.status === 'declined' ? ShieldAlert : CircleAlert;
  }
}
