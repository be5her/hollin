import { Component, inject } from '@angular/core';
import { Button, OttoMark, RoomSketch, Wordmark } from '@studio/ui';
import { Plus, Upload } from 'lucide';
import { LibraryActions } from './library-actions';

/**
 * Home on an empty library: the wordmark, the sketch of one room, "Start with a room you know.", New project
 * and Import…, Otto's line and the promise that projects stay on this computer.
 */
@Component({
  selector: 'x-first-launch',
  imports: [Button, OttoMark, RoomSketch, Wordmark],
  template: `
    <x-wordmark size="56" />
    <x-room-sketch class="w-[260px] h-[170px] mt-6 mb-4" />
    <h2 class="heading-page !text-[30px] text-fg mb-2.5">Start with a room you know.</h2>
    <p class="text-[15px] leading-[22px] text-muted max-w-[50ch]">Draw the walls of the room you are sitting in, with the numbers off a tape measure. Everything else grows from there.</p>
    <div class="flex justify-center gap-2.5 mt-5">
      <button xButton variant="primary" [icon]="icons.Plus" (click)="actions.create()" data-testid="first-launch-new">New project</button>
      <button xButton [icon]="icons.Upload" (click)="actions.importProject()" data-testid="first-launch-import">Import…</button>
    </div>
    <div class="inline-flex items-center gap-2.5 mt-5 rounded-md bg-ai-tint pl-2.5 pr-3.5 py-2 text-[14px] text-fg" data-testid="first-launch-otto">
      <x-otto-mark size="20" />
      <span>Or start with Otto: <span class="text-fg/70">describe the place and it drafts the ground floor, in millimetres you can change.</span></span>
    </div>
    <p class="mt-4 text-[13px] text-muted">Your projects live in a folder on this computer. Nothing leaves it unless you export.</p>
  `,
  host: { class: 'flex flex-col items-center text-center self-center w-full max-w-[640px] mt-16', 'data-testid': 'library-first-launch' },
})
export class FirstLaunch {
  protected readonly actions = inject(LibraryActions);
  protected readonly icons = { Plus, Upload };
}
