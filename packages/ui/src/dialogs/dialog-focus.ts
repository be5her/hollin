import { DOCUMENT, DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

const FOCUSABLE = 'input:not([type=hidden]), select, textarea, button, a[href], [tabindex]';
const FIELD = 'input:not([type=hidden]), select, textarea';
let titles = 0;

/**
 * Keeps keyboard focus in a modal dialog frame: on open it moves to the first field (or the first
 * control) unless something inside already took it, Tab and Shift+Tab cycle inside, the frame is
 * labelled by its first heading (`aria-labelledby`), and on close focus goes back to the element
 * that had it when the dialog opened, when that is still on the page.
 */
@Directive({
  selector: '[xDialogFocus]',
  host: { '(keydown.tab)': 'cycle($event, false)', '(keydown.shift.tab)': 'cycle($event, true)' },
})
export class DialogFocus {
  private readonly frame = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  /** Who had focus when the dialog opened (the button that opened it, usually). */
  private readonly opener = this.document.activeElement as HTMLElement | null;

  constructor() {
    afterNextRender(() => {
      const heading = this.frame.querySelector('h1, h2, h3');
      if (heading) {
        heading.id ||= `x-dialog-title-${++titles}`;
        this.frame.setAttribute('aria-labelledby', heading.id);
      }
      if (this.frame.contains(this.document.activeElement)) return;
      const tabbable = this.tabbable();
      (tabbable.find((el) => el.matches(FIELD)) ?? tabbable[0] ?? this.frame).focus();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.opener?.isConnected && this.opener !== this.document.body) this.opener.focus();
    });
  }

  /** The controls Tab stops at, in order: enabled, shown, and of a group of radios only the checked one (or the first). */
  private tabbable(): HTMLElement[] {
    const all = [...this.frame.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
    const group = (el: HTMLInputElement) => el.name || el.closest('[role=radiogroup]') || el.parentElement;
    return all.filter((el) => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return true;
      const radios = all.filter((r): r is HTMLInputElement => r instanceof HTMLInputElement && r.type === 'radio' && group(r) === group(el));
      return el.checked || (!radios.some((r) => r.checked) && radios[0] === el);
    });
  }

  protected cycle(event: Event, back: boolean): void {
    const tabbable = this.tabbable();
    if (!tabbable.length) return event.preventDefault();
    const at = tabbable.indexOf(this.document.activeElement as HTMLElement);
    if (back ? at > 0 : at !== -1 && at < tabbable.length - 1) return;
    event.preventDefault();
    tabbable[back ? tabbable.length - 1 : 0].focus();
  }
}
