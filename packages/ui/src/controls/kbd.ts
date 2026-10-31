import { Directive } from '@angular/core';

@Directive({
  selector: 'kbd[xKbd]',
  host: { class: 'inline-flex items-center h-[18px] whitespace-nowrap rounded border border-edge bg-elevated px-1.5 text-[11px] font-mono text-muted leading-4' },
})
export class Kbd {}
