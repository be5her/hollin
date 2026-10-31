import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import type { AssistantStatus, ChatSnapshot, ToolItem } from '@studio/core';
import { AppState, HostBridge, injectHostEvent, invokeResource, type AssistantPresence } from '@studio/ui';

/** How long the status bar keeps "stopped" and "couldn't reach Claude" before it says ready again. */
const STOPPED_MS = 3000;
const FAILED_MS = 6000;

/** What a running call is doing, in the status bar's words. */
function activity(item: ToolItem): { state: string; text: string } {
  if (item.command === 'view.snapshot') return { state: 'looking', text: (item.input as { view?: unknown } | null)?.view === '3d' ? 'looking at the 3D view…' : 'looking at the plan…' };
  if (item.readOnly) return { state: 'reading', text: 'reading the plan…' };
  const label = (item.input as { label?: unknown } | null)?.label;
  return { state: 'editing', text: `${typeof label === 'string' && label.trim() ? label.trim() : item.title}…` };
}

/**
 * Follows every project's chat (`assistant.event`), the provider's state (`assistant.status`) and Claude
 * Code probes (`assistant.probe`), and publishes what Otto is doing in the project on screen as
 * `AppState.assistant`, which the status bar and History read. Started by the module's `setup`.
 */
@Service()
export class OttoPresence {
  private readonly host = inject(HostBridge);
  private readonly app = inject(AppState);

  private readonly chats = signal<Record<string, ChatSnapshot>>({});
  /** Short-lived states after a run: stopped (3 s) or failed (6 s). */
  private readonly flashes = signal<Record<string, 'stopped' | 'failed'>>({});
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly checking = signal(false);
  private readonly status = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: () => null, refreshOnEvents: ['secrets.changed', 'config.changed', 'mcp.status', 'assistant.probe'] });
  private readonly loading = new Set<string>();

  readonly presence = computed<AssistantPresence | null>(() => {
    const projectId = this.app.activeProjectId();
    if (!projectId) return null;
    const chat = this.chats()[projectId];
    const pending = chat?.confirm ? { title: chat.confirm.command.title, command: chat.confirm.command.id } : null;
    const make = (state: string, text: string, tone: AssistantPresence['tone'] = 'ai', pulse = false, opens: AssistantPresence['opens'] = 'panel'): AssistantPresence => ({ projectId, state, text: `Otto · ${text}`, tone, pulse, opens, pending });

    if (chat?.status === 'waiting') return make('waiting', 'waiting for your yes');
    if (chat?.status === 'running') {
      if (chat.stopping) return make('stopping', 'stopping…', 'ai', true);
      const last = chat.items[chat.items.length - 1];
      if (last?.kind === 'tool' && last.status === 'running') {
        const { state, text } = activity(last);
        return make(state, text, 'ai', true);
      }
      if (last?.kind === 'assistant') return make('writing', 'writing…', 'ai', true);
      return make('thinking', 'thinking…', 'ai', true);
    }
    if (chat?.stopping) return make('stopping', 'stopping…', 'ai', true);
    const flash = this.flashes()[projectId];
    if (flash === 'failed') return make('failed', "couldn't reach Claude", 'danger');
    if (flash === 'stopped') return make('stopped', 'stopped', 'muted');

    const s = this.status.value();
    if (s?.provider === 'api' && !s.keySet) return make('needs-key', 'needs a key', 'muted', false, 'settings');
    if (s?.provider === 'claude-code') {
      if (this.checking()) return make('checking', 'checking Claude Code…', 'muted', true, 'settings');
      if (!s.claudeCode?.found) return make('not-found', 'Claude Code not found', 'muted', false, 'settings');
      if (s.claudeCode.loggedIn === false) return make('not-logged-in', 'Claude Code not logged in', 'muted', false, 'settings');
      if (!s.mcp.running) return make('mcp-off', 'needs the MCP server', 'muted', false, 'settings');
    }
    return make('ready', 'ready');
  });

  constructor() {
    injectHostEvent('assistant.event', ({ projectId, event }) => {
      if (event.type !== 'changed') {
        // A text delta: the reply has started, which the snapshot shows once its item exists.
        return;
      }
      const before = untracked(this.chats)[projectId];
      this.note(projectId, before, event.state);
      this.chats.update((all) => ({ ...all, [projectId]: event.state }));
    });
    injectHostEvent('assistant.probe', ({ checking }) => this.checking.set(checking));
    // The chat of a project that was open before this window started (or a reload) is fetched once.
    effect(() => {
      const projectId = this.app.activeProjectId();
      if (!projectId || untracked(this.chats)[projectId] || this.loading.has(projectId)) return;
      this.loading.add(projectId);
      void this.host
        .invoke<ChatSnapshot>('assistant.state', {}, projectId)
        .then((state) => this.chats.update((all) => (all[projectId] ? all : { ...all, [projectId]: state })))
        .catch(() => {})
        .finally(() => this.loading.delete(projectId));
    });
    effect(() => this.app.assistant.set(this.presence()));
  }

  /** A run that ended stopped or with an error shows so on the status bar for a few seconds. */
  private note(projectId: string, before: ChatSnapshot | undefined, after: ChatSnapshot): void {
    if (!before) return;
    if (before.stopping && !after.stopping) this.flash(projectId, 'stopped', STOPPED_MS);
    else if (before.status !== 'idle' && after.status === 'idle' && after.error && !after.stopping) this.flash(projectId, 'failed', FAILED_MS);
  }

  private flash(projectId: string, kind: 'stopped' | 'failed', ms: number): void {
    clearTimeout(this.timers.get(projectId));
    this.flashes.update((all) => ({ ...all, [projectId]: kind }));
    this.timers.set(
      projectId,
      setTimeout(() => {
        this.timers.delete(projectId);
        this.flashes.update(({ [projectId]: _gone, ...rest }) => rest);
      }, ms),
    );
  }
}
