import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { BRANDING, MAX_CHAT_IMAGES, type AssistantEvent, type AssistantStatus, type ChatImageInput, type ChatSnapshot, type ToolItem } from '@studio/core';
import { AppState, AssistantDrafts, Button, HostBridge, Icon, Kbd, OTTO_RULE, OttoMark, Spinner, TabsState, Toasts, injectHostEvent, invokeResource, ottoModelLabel } from '@studio/ui';
import { ArrowDown, Camera, Check, CircleAlert, Eraser, ImageOff, KeyRound, Plug, RefreshCw, Send, Settings2, ShieldAlert, Square, X } from 'lucide';
import { imageFiles, prepareImage, type PreparedImage } from './pasted-images';

/** Why the chat cannot run yet, as the setup state the panel shows instead. */
type EmptyReason = 'key' | 'not-found' | 'not-logged-in';

/** The list follows new content only while it is this close to the bottom (px). */
const FOLLOW_PX = 80;
/** A summary longer than this is clipped to three lines with More. */
const LONG_TEXT = 180;

/** The two example sentences of the empty conversation; a click puts one into the message field. */
const EXAMPLES = ['add a 4 by 5 m bedroom next to the living room', 'how big is the kitchen, and does the stair meet my rules?'];

/**
 * Otto's chat for one project (`design/identity/03-otto.md` §b): the header with the mark, the model and
 * the rule; the transcript (your messages on paper, Otto's as margin notes, every tool call a card with
 * its state, a destructive call as a card waiting for Allow or Keep it, snapshots inline); the composer
 * with Send, or Stop while Otto works. Everything comes from main through `assistant.state` and
 * `assistant.event`; snapshot images through `assistant.image`.
 */
@Component({
  selector: 'x-assistant-panel',
  imports: [Button, Icon, Kbd, NgTemplateOutlet, OttoMark, Spinner],
  templateUrl: './assistant-panel.html',
  styles: `
    .otto-caret { display: inline-block; width: 2px; height: 14px; margin-left: 2px; vertical-align: -2px; background: var(--ai); animation: otto-blink 1s steps(1) infinite; }
    @keyframes otto-blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .otto-caret { animation: none; } }
  `,
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'assistant-panel', '(keydown.escape)': 'onEscape()' },
})
export class AssistantPanel {
  private readonly host = inject(HostBridge);
  private readonly app = inject(AppState);
  private readonly tabs = inject(TabsState);
  private readonly toasts = inject(Toasts);
  private readonly drafts = inject(AssistantDrafts);

  readonly projectId = input.required<string>();

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  private readonly confirmCard = viewChild<ElementRef<HTMLElement>>('confirmCard');

  protected readonly icons = { ArrowDown, Camera, Check, CircleAlert, Eraser, ImageOff, KeyRound, Plug, RefreshCw, Send, Settings2, ShieldAlert, Square, X };
  protected readonly maxImages = MAX_CHAT_IMAGES;
  protected readonly examples = EXAMPLES;
  protected readonly rule = OTTO_RULE;
  protected readonly productName = BRANDING.productName;
  protected readonly status = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: () => null, refreshOnEvents: ['secrets.changed', 'config.changed', 'mcp.status'] });
  protected readonly chat = signal<ChatSnapshot | null>(null);
  protected readonly draft = signal('');
  /** Images pasted or dropped into the composer, ready to go with the next message. */
  protected readonly attachments = signal<readonly PreparedImage[]>([]);
  /** How many pasted images are still being read or shrunk. */
  protected readonly preparing = signal(0);
  protected readonly preparingSlots = computed(() => Array.from({ length: this.preparing() }, (_, i) => i));
  /** A file is dragged over the composer. */
  protected readonly dropping = signal(false);
  protected readonly sending = signal(false);
  protected readonly checking = signal(false);
  protected readonly enabling = signal(false);
  /** Cards whose long text is shown in full. */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** Snapshot images by tool item id, and the images of your messages by their image id, as data URLs. */
  protected readonly images = signal<Record<string, string>>({});
  /** The list is scrolled up while new content arrived: the "New from Otto" pill shows. */
  protected readonly unseen = signal(false);
  private atBottom = true;
  private readonly loadingImages = new Set<string>();
  /** Images main no longer keeps (the chat was restored from the view state, which never stores their data). */
  protected readonly missingImages = signal<ReadonlySet<string>>(new Set());

  protected readonly running = computed(() => this.chat() !== null && this.chat()?.status !== 'idle');
  protected readonly stopping = computed(() => this.chat()?.stopping === true);
  /** No key, Claude Code missing, or Claude Code logged out: the panel shows a setup state instead of the chat. */
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
  protected readonly modelLabel = computed(() => ottoModelLabel(this.status.value(), this.app.config()?.ai, { model: this.status.value()?.provider === 'api' ? (this.chat()?.model ?? undefined) : undefined, detail: true }));
  protected readonly headerLabel = computed(() => {
    const reason = this.emptyReason();
    return reason ? `Otto, ${this.setupLine()}` : `Otto, ${this.modelLabel()}, ${OTTO_RULE}`;
  });
  /** The header's second line in a setup state. */
  protected readonly setupLine = computed(() => {
    switch (this.emptyReason()) {
      case 'key':
        return 'needs a key, or your Claude Code';
      case 'not-found':
        return 'Claude Code not found';
      case 'not-logged-in':
        return 'Claude Code not logged in';
      default:
        return '';
    }
  });
  protected readonly notFoundHint = computed(() => this.status.value()?.claudeCode?.error ?? 'No `claude` on PATH. Install Claude Code, or set its path in Settings.');
  /** True while Otto works and no reply text has started yet, so the panel shows it is busy. */
  protected readonly busy = computed(() => {
    const chat = this.chat();
    if (!chat || chat.status !== 'running') return false;
    const last = chat.items[chat.items.length - 1];
    return !last || (last.kind !== 'assistant' && !(last.kind === 'tool' && last.status === 'running'));
  });
  /** The reply being streamed: its item carries the caret. */
  protected readonly streamingId = computed(() => {
    const chat = this.chat();
    if (!chat || chat.status !== 'running') return null;
    const last = chat.items[chat.items.length - 1];
    return last?.kind === 'assistant' ? last.id : null;
  });
  /** The tool card a pending confirmation belongs to: it is drawn as the waiting card. */
  protected readonly waitingItemId = computed(() => {
    const chat = this.chat();
    const confirm = chat?.confirm;
    if (!chat || !confirm) return null;
    for (let i = chat.items.length - 1; i >= 0; i--) {
      const item = chat.items[i];
      if (item.kind === 'tool' && item.status === 'running' && item.command === confirm.command.id) return item.id;
    }
    return null;
  });
  protected readonly placeholder = computed(() => (this.chat()?.status === 'waiting' ? 'Otto is waiting for your answer above' : this.stopping() ? 'Stopping the last run…' : 'Ask Otto…'));
  protected readonly canSend = computed(() => (this.draft().trim().length > 0 || this.attachments().length > 0) && this.preparing() === 0 && !this.running() && !this.stopping() && !this.sending());
  protected readonly canClear = computed(() => !this.running() && !this.stopping() && Boolean(this.chat()?.items?.length || this.chat()?.sessionId));
  /** The last error was a refused key: Settings is the fix, not sending again. */
  protected readonly keyRefused = computed(() => /refused the key/.test(this.chat()?.error ?? ''));
  private readonly lastUser = computed(() => {
    const items = this.chat()?.items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === 'user') return item;
    }
    return null;
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      untracked(() => void this.load(id));
    });
    // A sentence handed over from Home's composer or the empty project's Otto line lands in the message field, unsent.
    effect(() => {
      const offer = this.drafts.pending();
      const id = this.projectId();
      if (offer?.projectId !== id) return;
      const text = untracked(() => this.drafts.take(id));
      if (text !== null) this.draft.set(text);
    });
    injectHostEvent('assistant.event', ({ projectId, event }) => {
      if (projectId !== untracked(this.projectId)) return;
      this.apply(event);
    });
    // Snapshot images and the images of your messages are fetched once each; one main no longer keeps (a reopened chat) shows as gone.
    effect(() => {
      const items = this.chat()?.items ?? [];
      const have = untracked(this.images);
      const ids = items.flatMap((item) => (item.kind === 'tool' && item.image ? [item.id] : item.kind === 'user' ? (item.images ?? []).map((image) => image.id) : []));
      for (const id of ids) {
        if (have[id] || this.loadingImages.has(id) || untracked(this.missingImages).has(id)) continue;
        this.loadingImages.add(id);
        void this.host
          .invoke<{ mimeType: string; data: string }>('assistant.image', { id }, untracked(this.projectId))
          .then((image) => this.images.update((all) => ({ ...all, [id]: `data:${image.mimeType};base64,${image.data}` })))
          .catch(() => this.missingImages.update((set) => new Set(set).add(id)))
          .finally(() => this.loadingImages.delete(id));
      }
    });
    // Follow new content while the list is near the bottom; otherwise offer the pill.
    afterRenderEffect(() => {
      this.chat();
      this.images();
      const el = this.log()?.nativeElement;
      if (!el) return;
      if (this.atBottom) el.scrollTop = el.scrollHeight;
      else if (el.scrollHeight - el.scrollTop - el.clientHeight > FOLLOW_PX) this.unseen.set(true);
    });
    // A new confirmation takes focus itself (not Allow: Enter can never allow a delete by accident).
    let focused: string | null = null;
    afterRenderEffect(() => {
      const id = this.chat()?.confirm?.id ?? null;
      const card = this.confirmCard()?.nativeElement;
      if (id && card && focused !== id) {
        focused = id;
        card.focus();
      }
      if (!id) focused = null;
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

  protected onScroll(): void {
    const el = this.log()?.nativeElement;
    if (!el) return;
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_PX;
    if (this.atBottom) this.unseen.set(false);
  }

  protected toBottom(): void {
    const el = this.log()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
    this.atBottom = true;
    this.unseen.set(false);
  }

  protected onEscape(): void {
    if (untracked(this.running) && !untracked(this.stopping)) void this.stop();
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

  /** The user's own click: the same config.update Settings runs. Otto never starts the server by itself. */
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

  protected useExample(text: string): void {
    this.draft.set(text);
    const el = this.composer()?.nativeElement;
    if (el) {
      el.value = text;
      el.focus();
    }
  }

  protected async send(text = this.draft().trim(), images: readonly ChatImageInput[] = this.attachments()): Promise<void> {
    if ((!text && !images.length) || this.preparing() > 0 || this.running() || this.stopping() || this.sending()) return;
    this.sending.set(true);
    try {
      await this.host.invoke('assistant.send', { text, ...(images.length ? { images: images.map(({ mimeType, data }) => ({ mimeType, data })) } : {}) }, this.projectId());
      this.draft.set('');
      this.attachments.set([]);
      this.toBottom();
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

  /** Sends the last message again after a failed run (the API history was trimmed back, so the resend is clean), with the images it carried that are still kept. */
  protected sendAgain(): void {
    const last = this.lastUser();
    if (!last) return;
    const shown = this.images();
    const images = (last.images ?? []).flatMap((image) => {
      const url = shown[image.id];
      return url ? [{ mimeType: image.mimeType as ChatImageInput['mimeType'], data: url.slice(url.indexOf(',') + 1) }] : [];
    });
    if (last.text || images.length) void this.send(last.text, images);
  }

  /** A paste with images in it attaches them; its text, if it has any, still lands in the field. */
  protected onPaste(event: ClipboardEvent): void {
    const files = imageFiles(event.clipboardData);
    if (!files.length) return;
    if (!event.clipboardData?.types.includes('text/plain')) event.preventDefault();
    void this.attach(files);
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dropping.set(true);
  }

  protected onDrop(event: DragEvent): void {
    this.dropping.set(false);
    const files = imageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    void this.attach(files);
  }

  /** Reads and shrinks the images, up to the limit per message; the rest are refused with a toast. */
  private async attach(files: File[]): Promise<void> {
    if (this.running() || this.stopping()) return;
    const room = MAX_CHAT_IMAGES - this.attachments().length - this.preparing();
    if (files.length > room) this.toasts.notify(`Otto takes up to ${MAX_CHAT_IMAGES} images per message.`, 'error');
    const taken = files.slice(0, Math.max(0, room));
    this.preparing.update((n) => n + taken.length);
    await Promise.all(
      taken.map(async (file) => {
        try {
          const image = await prepareImage(file);
          this.attachments.update((list) => [...list, image]);
        } catch (err) {
          this.toasts.error(err);
        } finally {
          this.preparing.update((n) => n - 1);
        }
      }),
    );
    this.composer()?.nativeElement.focus();
  }

  protected removeAttachment(id: string): void {
    this.attachments.update((list) => list.filter((image) => image.id !== id));
    this.composer()?.nativeElement.focus();
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
      this.images.set({});
      this.missingImages.set(new Set());
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async answer(allow: boolean): Promise<void> {
    const id = this.chat()?.confirm?.id;
    if (!id) return;
    try {
      await this.host.invoke('assistant.confirm.reply', { id, allow }, this.projectId());
      this.composer()?.nativeElement.focus();
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected toggle(id: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected isLong(text: string): boolean {
    return text.length > LONG_TEXT || text.split('\n').length > 3;
  }

  protected inputPreview(input: unknown): string {
    const text = JSON.stringify(input, null, 1) ?? '';
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  }

  /** The card's title: a batch's label, else the command's title. */
  protected titleOf(item: ToolItem): string {
    const label = (item.input as { label?: unknown } | null)?.label;
    return item.command === 'plan.apply' && typeof label === 'string' && label.trim() ? label.trim() : item.title;
  }

  /** The card's second line: level · layer (or the batch's count) · what kind of call, as far as the call carried them. */
  protected metaOf(item: ToolItem): string {
    const parts: string[] = [];
    if (item.level) parts.push(item.level);
    if (item.command === 'view.snapshot') {
      parts.push(item.view ?? 'plan');
    } else if (item.readOnly) {
      parts.push('read only');
    } else if (item.ops !== undefined) {
      parts.push(`${item.ops} ${item.ops === 1 ? 'edit' : 'edits'}`);
      if (item.undoable) parts.push('one undo step, by Otto');
    } else {
      if (item.layer) parts.push(item.layer);
      if (item.undoable) parts.push('undoable, by Otto');
    }
    return parts.join(' · ');
  }

  /** The third line: the error, a decline or a stop, or a summary that says more than the title. */
  protected summaryOf(item: ToolItem): string {
    if (item.status === 'declined') return 'Kept. Otto was told no.';
    if (item.status === 'stopped') return 'Stopped.';
    if (item.status === 'error') return item.summary;
    return item.summary && item.summary !== this.titleOf(item) ? item.summary : '';
  }

  /** What the waiting card says it would touch: the ids in the call's input, when it names any. */
  protected targetsOf(input: unknown): string {
    const i = (input ?? {}) as { id?: unknown; ids?: unknown; entityIds?: unknown };
    const ids = [i.id, ...(Array.isArray(i.ids) ? i.ids : []), ...(Array.isArray(i.entityIds) ? i.entityIds : [])].filter((x): x is string => typeof x === 'string');
    return ids.slice(0, 4).join(', ') + (ids.length > 4 ? ` and ${ids.length - 4} more` : '');
  }

  protected confirmLabel(title: string, input: unknown): string {
    const targets = this.targetsOf(input);
    return `Otto wants to run ${title}${targets ? `, ${targets}` : ''}. Allow, or keep it.`;
  }

  protected imageAlt(item: ToolItem): string {
    return item.view && item.view !== 'plan' ? `Otto's snapshot: the building in ${item.view}` : `Otto's snapshot: ${(item.level ?? 'the plan').toLowerCase()}, plan`;
  }
}
