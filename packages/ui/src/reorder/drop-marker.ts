import { Component, computed, input } from '@angular/core';
import type { DragAxis } from './drag-reorder';

/**
 * The accent line showing where a dragged item will land. Its container must be `relative`. `at` is a
 * physical offset from the container's left (or top) edge in its scrolled coordinates, which holds in a
 * right-to-left strip too (`dragReorder` measures it that way), so the line is placed with `left`.
 */
@Component({
  selector: 'x-drop-marker',
  template: '',
  host: {
    '[class]': 'classes()',
    '[style.left.px]': 'axis() === "x" ? at() : null',
    '[style.top.px]': 'axis() === "y" ? at() : null',
    '[attr.data-testid]': 'testId()',
  },
})
export class DropMarker {
  readonly axis = input.required<DragAxis>();
  readonly at = input.required<number>();
  readonly testId = input<string>();

  protected readonly classes = computed(() =>
    this.axis() === 'x'
      ? 'block absolute top-1 bottom-1 w-0.5 -translate-x-px rounded-full bg-accent pointer-events-none z-10'
      : 'block absolute inset-x-1.5 h-0.5 -mt-px rounded-full bg-accent pointer-events-none z-10',
  );
}
