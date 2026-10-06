import { Directive, ElementRef, inject, input, output, signal } from '@angular/core';
import { Units } from '../state/units';

/**
 * A text input holding a length in the user's units: `<input xInput xLength [formField]="f.thickness" (commit)="…" />`.
 * While typing, text that is not a length marks the field invalid (`aria-invalid`, a red border;
 * read `#t.invalid()` with `#t="xLength"` to show a message). On blur or Enter a valid value is
 * emitted in millimetres, once, when it differs from what the field held when it got focus; an
 * invalid one is put back. With `allowEmpty`, an empty field emits null.
 */
@Directive({
  selector: 'input[xLength]',
  exportAs: 'xLength',
  host: {
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[class.!border-danger]': 'invalid()',
    '[class.!ring-danger/30]': 'invalid()',
    '[attr.title]': 'invalid() ? "Not a length (try 3200, 3.2m or 10\' 6\\")" : null',
    '(focus)': 'focused()',
    '(input)': 'typed()',
    '(blur)': 'left()',
    '(keydown.enter)': 'enter($event)',
  },
})
export class LengthInput {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly units = inject(Units);

  /** An empty field is allowed and means "none" (null). */
  readonly allowEmpty = input(false);
  /** The value in millimetres (null for an allowed empty field), on blur or Enter, when it changed. */
  readonly commit = output<number | null>();

  readonly invalid = signal(false);
  private original = '';

  protected parse(text: string): number | null | undefined {
    if (text.trim() === '') return this.allowEmpty() ? null : undefined;
    const mm = this.units.parseLength(text);
    return mm === null ? undefined : mm;
  }

  protected focused(): void {
    this.original = this.el.nativeElement.value;
  }

  protected typed(): void {
    this.invalid.set(this.parse(this.el.nativeElement.value) === undefined);
  }

  protected enter(event: Event): void {
    event.preventDefault();
    this.el.nativeElement.blur();
  }

  protected left(): void {
    const el = this.el.nativeElement;
    const parsed = this.parse(el.value);
    if (parsed === undefined) {
      // Put back what was there, the way typing would, so a bound form sees it.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, this.original);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      this.invalid.set(false);
      return;
    }
    this.invalid.set(false);
    if (el.value.trim() !== this.original.trim()) this.commit.emit(parsed);
  }
}

/** The same for an angle in degrees: `<input xInput xAngle (commit)="…" />`. */
@Directive({
  selector: 'input[xAngle]',
  exportAs: 'xAngle',
  host: {
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[class.!border-danger]': 'invalid()',
    '[attr.title]': 'invalid() ? "Not an angle (try 45 or 30°)" : null',
    '(focus)': 'focused()',
    '(input)': 'typed()',
    '(blur)': 'left()',
    '(keydown.enter)': 'enter($event)',
  },
})
export class AngleInput {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly units = inject(Units);

  readonly commit = output<number>();
  readonly invalid = signal(false);
  private original = '';

  protected focused(): void {
    this.original = this.el.nativeElement.value;
  }

  protected typed(): void {
    this.invalid.set(this.units.parseAngle(this.el.nativeElement.value) === null);
  }

  protected enter(event: Event): void {
    event.preventDefault();
    this.el.nativeElement.blur();
  }

  protected left(): void {
    const el = this.el.nativeElement;
    const degrees = this.units.parseAngle(el.value);
    if (degrees === null) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, this.original);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      this.invalid.set(false);
      return;
    }
    this.invalid.set(false);
    if (el.value.trim() !== this.original.trim()) this.commit.emit(degrees);
  }
}
