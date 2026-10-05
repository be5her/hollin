import { Directive, ElementRef, afterNextRender, booleanAttribute, inject, input } from '@angular/core';

/** Focuses the element once it is rendered, also when it appears after the page has loaded: `<input xAutofocus>` or `[xAutofocus]="!url"`. */
@Directive({ selector: '[xAutofocus]' })
export class Autofocus {
  readonly xAutofocus = input(true, { transform: booleanAttribute });
  /** Select the text as well, for inputs that are replaced as a whole. */
  readonly autofocusSelect = input(false, { transform: booleanAttribute });

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (!this.xAutofocus()) return;
      element.focus();
      if (this.autofocusSelect() && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.select();
    });
  }
}
