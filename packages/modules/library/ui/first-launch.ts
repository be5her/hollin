import { Component, computed, inject, signal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { AssistantStatus } from '@studio/core';
import { Button, OttoMark, RoomSketch, TabsState, Toasts, Wordmark, invokeResource } from '@studio/ui';
import { Plus, Upload } from 'lucide';
import { LibraryActions } from './library-actions';
import { OttoDraftRun, ottoCanWork } from './otto-composer';

/**
 * Home on an empty library: the wordmark, the sketch of one room, "Start with a room you know.", New project
 * and Import…, Otto's line and the promise that projects stay on this computer. Otto's line is the empty
 * project's (`03-otto.md` §g): an editable sentence that Enter sends like Draft it (a project named from it,
 * opened with the Otto tab showing, the sentence its first message); when Otto cannot work yet, the line
 * says so and Enter opens Settings > Assistant.
 */
@Component({
  selector: 'x-first-launch',
  imports: [Button, FormField, OttoMark, RoomSketch, Wordmark],
  template: `
    <x-wordmark size="56" />
    <x-room-sketch class="w-[260px] h-[170px] mt-6 mb-4" />
    <h2 class="heading-page !text-[30px] text-fg mb-2.5">Start with a room you know.</h2>
    <p class="text-[15px] leading-[22px] text-muted max-w-[50ch]">Draw the walls of the room you are sitting in, with the numbers off a tape measure. Everything else grows from there.</p>
    <div class="flex justify-center gap-2.5 mt-5">
      <button xButton variant="primary" [icon]="icons.Plus" (click)="actions.create()" data-testid="first-launch-new">New project</button>
      <button xButton [icon]="icons.Upload" (click)="actions.importProject()" data-testid="first-launch-import">Import…</button>
    </div>
    <label
      class="flex items-center gap-2.5 mt-5 rounded-md bg-ai-tint pl-2.5 pr-3.5 py-2 text-[13px] text-fg text-left w-[min(460px,100%)]"
      data-testid="first-launch-otto"
      [attr.data-ready]="ready()"
    >
      <x-otto-mark size="20" />
      <span class="shrink-0">{{ ready() ? 'Or tell Otto:' : 'Or tell Otto, once it has a key:' }}</span>
      <input
        type="text"
        class="min-w-0 flex-1 bg-transparent border-0 p-0 italic text-[13px] text-fg underline decoration-dotted decoration-muted underline-offset-4 rounded-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-60"
        [formField]="ottoForm.sentence"
        aria-label="A sentence for Otto: Enter starts a project with it"
        [title]="ready() ? 'Enter creates a project and sends this to Otto, who drafts its ground floor' : 'Enter opens Settings, where Otto gets its key'"
        (keydown.enter)="tellOtto(); $event.preventDefault()"
        data-testid="first-launch-otto-input"
      />
    </label>
    <p class="mt-4 text-[13px] text-muted">Your projects live in a folder on this computer. Nothing leaves it unless you export.</p>
  `,
  host: { class: 'flex flex-col items-center text-center self-center w-full max-w-[640px] mt-16', 'data-testid': 'library-first-launch' },
})
export class FirstLaunch {
  protected readonly actions = inject(LibraryActions);
  private readonly run = inject(OttoDraftRun);
  private readonly tabs = inject(TabsState);
  private readonly toasts = inject(Toasts);
  protected readonly icons = { Plus, Upload };

  private readonly status = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: null, refreshOnEvents: ['secrets.changed', 'config.changed', 'mcp.status'] });
  protected readonly ready = computed(() => ottoCanWork(this.status.value()));
  /** The sentence the line offers, the empty project's own, which the user can change before Enter sends it. */
  private readonly ottoDraft = signal({ sentence: 'a 5 by 7 m studio with a bathroom in the corner' });
  protected readonly ottoForm = form(this.ottoDraft);
  private busy = false;

  protected async tellOtto(): Promise<void> {
    const text = untracked(this.ottoDraft).sentence.trim();
    if (!text || this.busy) return;
    if (!untracked(this.ready)) {
      this.tabs.open({ type: 'settings.main', title: 'Settings', data: { key: 'settings', section: 'ai' } }, { singletonKey: 'settings.main:settings' });
      return;
    }
    this.busy = true;
    try {
      await this.run.start(text);
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.busy = false;
    }
  }
}
