import { Component, computed, inject, signal, untracked } from '@angular/core';
import { FormField, disabled, form } from '@angular/forms/signals';
import type { AssistantStatus, OpenProject } from '@studio/core';
import { AssistantDrafts, Button, HostBridge, OttoMark, ProjectView, TabsState, TextArea, Toasts, invokeResource } from '@studio/ui';
import { Settings2 } from 'lucide';

/** A project name from the first words of the sentence: up to the first comma or full stop, at most 48 characters. */
export function nameFromSentence(sentence: string): string {
  const head = sentence.trim().split(/[,.;:!?\n]/)[0]?.trim() ?? '';
  let name = head;
  if (name.length > 48) {
    const cut = name.slice(0, 48);
    name = cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : 48).trim();
  }
  return name ? name[0].toUpperCase() + name.slice(1) : 'Untitled project';
}

/**
 * Home's first card, "Start with Otto": a sentence describing the place and the one mulberry button.
 * Today "Draft it" creates a project named from the sentence (with the sentence as its description),
 * opens it with the assistant panel showing and the sentence waiting in its message field, unsent; the
 * chat that drafts the ground floor by itself comes in a later step. Without a ready provider the field
 * is disabled and the card offers "Set up Otto" (Settings > Assistant) instead of the button.
 */
@Component({
  selector: 'x-otto-composer',
  imports: [Button, FormField, OttoMark, TextArea],
  template: `
    <div class="flex items-center gap-2.5">
      <x-otto-mark size="24" />
      <span class="text-[17px] leading-[22px] font-medium tracking-[-0.005em] text-fg">Start with Otto</span>
    </div>
    <p class="text-[13px] leading-[18px] text-fg/70">Describe the place and Otto drafts the ground floor: rooms, walls and doors, in millimetres you can change.</p>
    <textarea
      xTextarea
      rows="3"
      class="flex-1 min-h-16 resize-none !bg-canvas !font-sans !text-[13px] leading-[18px] placeholder:italic disabled:!bg-surface"
      placeholder="A two-bedroom flat with an open kitchen, about 65 m², bathroom off the hall"
      aria-label="Describe the place for Otto"
      [formField]="composer.sentence"
      (keydown.control.enter)="draft(); $event.preventDefault()"
      data-testid="otto-composer-input"
    ></textarea>
    @if (ready()) {
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] leading-[14px] text-fg/70">Otto asks before it deletes anything.</span>
        <button
          type="button"
          class="inline-flex items-center justify-center h-8 px-3 rounded-md text-[13px] font-medium bg-ai text-ai-fg hover:bg-ai-hover active:bg-ai-hover transition-colors shrink-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:opacity-50 disabled:pointer-events-none"
          [disabled]="!sentence().trim() || busy()"
          (click)="draft()"
          data-testid="otto-composer-draft"
        >
          Draft it
        </button>
      </div>
    } @else {
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] leading-[14px] text-fg/70" data-testid="otto-composer-reason">{{ reason() }}</span>
        <button xButton size="sm" variant="secondary" class="shrink-0" [icon]="icons.Settings2" (click)="setUp()" data-testid="otto-composer-setup">Set up Otto</button>
      </div>
    }
  `,
  host: {
    class: 'flex flex-col gap-2.5 rounded-lg border border-l-[3px] border-l-ai bg-ai-tint p-[18px] text-left',
    style: 'border-color: color-mix(in srgb, var(--ai) 35%, var(--edge)); border-left-color: var(--ai)',
    'data-testid': 'otto-composer',
    '[attr.data-state]': "status.value() ? (ready() ? 'idle' : 'setup') : 'loading'",
  },
})
export class OttoComposer {
  private readonly host = inject(HostBridge);
  private readonly tabs = inject(TabsState);
  private readonly view = inject(ProjectView);
  private readonly drafts = inject(AssistantDrafts);
  private readonly toasts = inject(Toasts);

  protected readonly icons = { Settings2 };
  protected readonly status = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: null, refreshOnEvents: ['secrets.changed', 'config.changed', 'mcp.status'] });
  /** The provider can work: a key for the API; Claude Code found, logged in, and the MCP server on. */
  protected readonly ready = computed(() => {
    const s = this.status.value();
    if (!s) return true;
    if (s.provider === 'api') return s.keySet;
    return Boolean(s.claudeCode?.found) && s.claudeCode?.loggedIn !== false && s.mcp.running;
  });
  protected readonly reason = computed(() => {
    const s = this.status.value();
    if (!s || s.provider === 'api') return 'Otto needs a Claude API key, or your Claude Code.';
    if (!s.claudeCode?.found) return 'Otto cannot find your Claude Code.';
    if (s.claudeCode.loggedIn === false) return 'Your Claude Code is not logged in.';
    return 'Otto reaches your Claude Code through the MCP server, which is off.';
  });
  protected readonly busy = signal(false);
  private readonly model = signal({ sentence: '' });
  protected readonly sentence = computed(() => this.model().sentence);
  protected readonly composer = form(this.model, (p) => {
    disabled(p.sentence, { when: () => !this.ready() || this.busy() });
  });

  protected async draft(): Promise<void> {
    const text = untracked(this.model).sentence.trim();
    if (!text || untracked(this.busy) || !untracked(this.ready)) return;
    this.busy.set(true);
    try {
      const created = await this.host.invoke<OpenProject>('project.create', { name: nameFromSentence(text), description: text }, null);
      this.view.set(created.id, 'rightPanel', 'assistant');
      this.drafts.offer(created.id, text);
      this.model.set({ sentence: '' });
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected setUp(): void {
    this.tabs.open({ type: 'settings.main', title: 'Settings', data: { key: 'settings', section: 'ai' } }, { singletonKey: 'settings.main:settings' });
  }
}
