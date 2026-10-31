import { Component, input } from '@angular/core';

/** A centred title (Fraunces, the panel heading) and hint for a view with nothing to show. Projected content is the call to action. */
@Component({
  selector: 'x-empty-state',
  template: `<p class="heading-panel text-fg" data-testid="empty-state-title">{{ title() }}</p>@if (hint()) {<p class="text-[13px] text-muted max-w-xs">{{ hint() }}</p>}<div class="mt-2 empty:hidden"><ng-content /></div>`,
  host: { class: 'flex flex-col items-center justify-center gap-2 p-8 text-center h-full' },
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly hint = input<string | null>();
}
