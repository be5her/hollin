import { Directive } from '@angular/core';

/** The themed text input. Works with `[formField]` like any native input. */
@Directive({
  selector: 'input[xInput]',
  host: {
    class:
      'h-8 w-full rounded-md border border-edge bg-surface px-2.5 text-sm text-fg placeholder:text-muted/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50',
    spellcheck: 'false',
    autocomplete: 'off',
  },
})
export class Input {}

@Directive({
  selector: 'textarea[xTextarea]',
  host: {
    class:
      'w-full rounded-md border border-edge bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-muted/70 font-mono focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50',
    spellcheck: 'false',
  },
})
export class TextArea {}

@Directive({
  selector: 'select[xSelect]',
  host: {
    class: 'h-8 rounded-md border border-edge bg-surface px-2 text-sm text-fg focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50',
  },
})
export class Select {}

@Directive({
  selector: 'input[xCheckbox]',
  host: { type: 'checkbox', class: 'size-3.5 accent-accent cursor-pointer' },
})
export class Checkbox {}

@Directive({
  selector: 'label[xLabel]',
  host: { class: 'block text-xs font-medium text-muted mb-1' },
})
export class Label {}
