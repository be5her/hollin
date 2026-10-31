import { Component, input, signal } from '@angular/core';
import { Button, type DialogComponent } from '@studio/ui';
import alegreyaSans from '../../../../src/renderer/src/fonts/OFL-AlegreyaSans.txt';
import fraunces from '../../../../src/renderer/src/fonts/OFL-Fraunces.txt';
import plexMono from '../../../../src/renderer/src/fonts/OFL-IBMPlexMono.txt';

/** The bundled fonts' licences, as shipped beside the font files, and the icons' licence. */
const LICENCES = [
  { id: 'alegreya-sans', name: 'Alegreya Sans', licence: 'SIL Open Font License 1.1', text: alegreyaSans },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', licence: 'SIL Open Font License 1.1', text: plexMono },
  { id: 'fraunces', name: 'Fraunces', licence: 'SIL Open Font License 1.1', text: fraunces },
] as const;

/** About's Licences…: one font at a time, its full licence text, and a line for the icons. */
@Component({
  selector: 'x-licences-dialog',
  imports: [Button],
  template: `
    <h2 class="heading-dialog text-fg">Licences</h2>
    <p class="text-[13px] text-muted mt-1 mb-3">The fonts are bundled under their licences. The icons are Lucide (ISC; some derived from Feather, MIT).</p>
    <div class="flex gap-1 mb-2" role="tablist" aria-label="Font">
      @for (l of licences; track l.id) {
        <button
          type="button"
          role="tab"
          class="h-6 px-2 rounded border text-[11px] transition-colors"
          [class]="l.id === shown().id ? 'border-accent bg-accent/10 text-fg' : 'border-edge text-muted hover:text-fg hover:bg-elevated'"
          [attr.aria-selected]="l.id === shown().id"
          (click)="shown.set(l)"
          [attr.data-licence]="l.id"
          data-testid="licence-tab"
        >
          {{ l.name }}
        </button>
      }
    </div>
    <p class="text-xs text-muted mb-1.5">{{ shown().name }} · {{ shown().licence }}</p>
    <pre class="max-h-[50vh] overflow-auto text-[11px] leading-4 font-mono bg-surface border border-edge rounded-md px-2.5 py-2 whitespace-pre-wrap" data-testid="licence-text">{{ shown().text }}</pre>
    <div class="flex justify-end mt-4">
      <button xButton variant="primary" (click)="close()(null)" data-testid="licences-close">Close</button>
    </div>
  `,
})
export class LicencesDialog implements DialogComponent<null, null> {
  readonly data = input<null>(null);
  readonly close = input.required<(value: null) => void>();

  protected readonly licences = LICENCES;
  protected readonly shown = signal<(typeof LICENCES)[number]>(LICENCES[0]);
}
