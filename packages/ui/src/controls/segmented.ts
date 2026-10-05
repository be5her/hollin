import { Component, Directive, computed, inject, input, model } from '@angular/core';
import { cn } from '../class-names';

/**
 * A row of tabs that picks one value: `<x-segmented [(value)]="view"><button xSegment="body">Body</button>…</x-segmented>`.
 * The parent renders the matching content.
 */
@Component({
  selector: 'x-segmented',
  template: '<ng-content />',
  host: { role: 'tablist', class: 'flex items-center gap-0.5 border-b border-edge' },
})
export class Segmented<T extends string = string> {
  readonly value = model.required<T>();
}

@Directive({
  selector: 'button[xSegment]',
  host: {
    type: 'button',
    role: 'tab',
    '[attr.aria-selected]': 'selected()',
    '[class]': 'classes()',
    '(click)': 'choose()',
  },
})
export class Segment {
  private readonly group = inject(Segmented);

  readonly xSegment = input.required<string>();

  protected readonly selected = computed(() => this.group.value() === this.xSegment());
  protected readonly classes = computed(() =>
    cn('px-3 h-8 text-xs font-medium border-b-2 -mb-px transition-colors', this.selected() ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'),
  );

  protected choose(): void {
    this.group.value.set(this.xSegment());
  }
}
