import { Component, computed, inject, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { AssistantStatus } from '@studio/core';
import { Button, I18n, OttoMark, RoomSketch, TabsState, Toasts, Wordmark, invokeResource } from '@studio/ui';
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
    <h2 class="heading-page !text-[30px] text-fg mb-2.5">{{ t('library.first.title') }}</h2>
    <p class="text-[15px] leading-[22px] text-muted max-w-[50ch]">{{ t('library.first.lead') }}</p>
    <div class="flex justify-center gap-2.5 mt-5">
      <button xButton variant="primary" [icon]="icons.Plus" (click)="actions.create()" data-testid="first-launch-new">{{ t('library.action.new') }}</button>
      <button xButton [icon]="icons.Upload" (click)="actions.importProject()" data-testid="first-launch-import">{{ t('library.home.import') }}</button>
    </div>
    <label
      class="flex items-center gap-2.5 mt-5 rounded-md bg-ai-tint ps-2.5 pe-3.5 py-2 text-[13px] text-fg text-start w-[min(460px,100%)]"
      data-testid="first-launch-otto"
      [attr.data-ready]="ready()"
    >
      <x-otto-mark size="20" />
      <span class="shrink-0">{{ ready() ? t('library.first.otto') : t('library.first.ottoNoKey') }}</span>
      <input
        type="text"
        dir="auto"
        class="min-w-0 flex-1 bg-transparent border-0 p-0 italic text-[13px] text-fg underline decoration-dotted decoration-muted underline-offset-4 rounded-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-60"
        [formField]="ottoForm.sentence"
        [attr.aria-label]="t('library.first.ottoInput')"
        [title]="ready() ? t('library.first.ottoReady') : t('library.first.ottoSetup')"
        (keydown.enter)="tellOtto(); $event.preventDefault()"
        data-testid="first-launch-otto-input"
      />
    </label>
    <p class="mt-4 text-[13px] text-muted">{{ t('library.first.privacy') }}</p>
  `,
  host: { class: 'flex flex-col items-center text-center self-center w-full max-w-[640px] mt-16', 'data-testid': 'library-first-launch' },
})
export class FirstLaunch {
  protected readonly actions = inject(LibraryActions);
  private readonly run = inject(OttoDraftRun);
  private readonly tabs = inject(TabsState);
  private readonly toasts = inject(Toasts);
  protected readonly icons = { Plus, Upload };
  protected readonly t = inject(I18n).t;

  private readonly status = invokeResource<AssistantStatus>('assistant.status', () => ({}), { projectId: null, refreshOnEvents: ['secrets.changed', 'config.changed', 'mcp.status'] });
  protected readonly ready = computed(() => ottoCanWork(this.status.value()));
  /** The sentence the line offers, the empty project's own, which the user can change before Enter sends it (offered again in the new language after a switch). */
  private readonly ottoDraft = linkedSignal(() => ({ sentence: this.t('library.first.sentence') }));
  protected readonly ottoForm = form(this.ottoDraft);
  private busy = false;

  protected async tellOtto(): Promise<void> {
    const text = untracked(this.ottoDraft).sentence.trim();
    if (!text || this.busy) return;
    if (!untracked(this.ready)) {
      const settings = this.tabs.open({ type: 'settings.main', title: 'Settings', titleKey: 'shell.tab.settings', data: { key: 'settings', section: 'ai' } }, { singletonKey: 'settings.main:settings' });
      this.tabs.update(settings.id, { data: { key: 'settings', section: 'ai' } });
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
