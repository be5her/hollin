import { Component, Service, computed, inject, signal, untracked } from '@angular/core';
import { FormField, disabled, form } from '@angular/forms/signals';
import type { AssistantStatus, OpenProject } from '@studio/core';
import { AssistantDrafts, Button, HostBridge, OttoMark, ProjectView, Spinner, TabsState, TextArea, Toasts, invokeResource } from '@studio/ui';
import { Settings2 } from 'lucide';
import { ProjectsSync } from './projects-sync';

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
 * The chat Home's composer started, while it runs: the card is rebuilt each time Home is shown, so the
 * state lives here. It ends when that chat is idle again after it ran (or its project closes): the
 * panel's first look at the new project's chat can announce it idle before the run has started.
 */
@Service()
export class OttoDraftRun {
  readonly current = signal<{ projectId: string; text: string } | null>(null);
  private started = false;

  constructor() {
    const host = inject(HostBridge);
    host.on('assistant.event', ({ projectId, event }) => {
      if (event.type !== 'changed' || untracked(this.current)?.projectId !== projectId) return;
      if (event.state.status !== 'idle') this.started = true;
      else if (this.started && !event.state.stopping) this.current.set(null);
    });
    host.on('project.changed', (event) => {
      if (event.kind === 'closed' && untracked(this.current)?.projectId === event.projectId) this.current.set(null);
    });
  }

  /** The composer's chat for `projectId` is about to start. */
  begin(projectId: string, text: string): void {
    this.started = false;
    this.current.set({ projectId, text });
  }
}

/**
 * Home's first card, "Start with Otto" (`03-otto.md` §f): a sentence describing the place and the one
 * mulberry button. "Draft it" creates a project named from the sentence (with the sentence as its
 * description), opens it with the Otto tab showing, and sends the sentence to Otto (`assistant.send`),
 * who drafts the ground floor. While that chat runs the card shows the sentence, "Otto is drafting…"
 * and Open; when it ends the card is empty again, and the project's card carries Otto's mark once the
 * save lands. If the send is refused (a run already going there), the sentence waits in the panel's
 * message field instead. Without a ready provider the field is disabled and the card offers "Set up
 * Otto" (Settings > Assistant) instead of the button.
 */
@Component({
  selector: 'x-otto-composer',
  imports: [Button, FormField, OttoMark, Spinner, TextArea],
  template: `
    <div class="flex items-center gap-2.5">
      <x-otto-mark size="24" label="Otto" />
      <span class="text-[17px] leading-[22px] font-medium tracking-[-0.005em] text-fg">Start with Otto</span>
    </div>
    <p class="text-[13px] leading-[18px] text-fg/70">Describe the place and Otto drafts the ground floor: rooms, walls and doors, in millimetres you can change.</p>
    @if (drafting(); as d) {
      <p class="flex-1 min-h-16 text-[13px] leading-[18px] italic text-fg line-clamp-3" data-testid="otto-composer-sentence">{{ d.text }}</p>
      <div class="flex items-center justify-between gap-2" aria-live="polite">
        <span class="inline-flex items-center gap-2 text-[12px] italic text-fg/70" data-testid="otto-composer-drafting"><svg xSpinner class="size-4 text-ai"></svg>Otto is drafting…</span>
        <button xButton size="sm" variant="ghost" class="shrink-0" (click)="openDraft()" data-testid="otto-composer-open">Open</button>
      </div>
    } @else {
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
    }
  `,
  host: {
    class: 'flex flex-col gap-2.5 rounded-lg border border-l-[3px] border-l-ai bg-ai-tint p-[18px] text-left',
    style: 'border-color: color-mix(in srgb, var(--ai) 35%, var(--edge)); border-left-color: var(--ai)',
    'data-testid': 'otto-composer',
    '[attr.data-state]': "drafting() ? 'drafting' : status.value() ? (ready() ? 'idle' : 'setup') : 'loading'",
    '[attr.data-project]': 'drafting()?.projectId ?? null',
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
  /** The project Otto is drafting from the card's sentence, while that chat runs (kept while Home is not showing). */
  private readonly run = inject(OttoDraftRun);
  protected readonly drafting = this.run.current;
  private readonly sync = inject(ProjectsSync);
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
      this.model.set({ sentence: '' });
      try {
        this.run.begin(created.id, text);
        await this.host.invoke('assistant.send', { text }, created.id);
      } catch {
        // Otto could not start here: the sentence waits in the panel's field for the user to send.
        this.run.current.set(null);
        this.drafts.offer(created.id, text);
      }
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  /** The project Otto is drafting, in its tab. */
  protected openDraft(): void {
    const d = untracked(this.drafting);
    if (d) void this.sync.openProject(d.projectId);
  }

  protected setUp(): void {
    this.tabs.open({ type: 'settings.main', title: 'Settings', data: { key: 'settings', section: 'ai' } }, { singletonKey: 'settings.main:settings' });
  }
}
