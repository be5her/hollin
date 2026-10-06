import { Component, computed, inject, linkedSignal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { Autofocus } from '../controls/autofocus';
import { Button } from '../controls/button';
import { Input, Label, Select, TextArea } from '../controls/native-controls';
import { Dialogs, type PendingDialog } from './dialogs';

/** Renders the pending prompt or confirm dialog. Mount once in the shell. */
@Component({
  selector: 'x-dialog-host',
  imports: [Autofocus, Button, FormField, Input, Label, Select, TextArea],
  templateUrl: './dialog-host.html',
  host: { class: 'contents' },
})
export class DialogHost {
  private readonly dialogs = inject(Dialogs);

  protected readonly pending = this.dialogs.pending;
  /** The open dialog as a one-item list, so each new dialog gets fresh fields (and focus). */
  protected readonly open = computed(() => {
    const pending = this.pending();
    return pending ? [pending] : [];
  });
  /** What the prompt's fields edit, reset for every prompt. */
  protected readonly answer = linkedSignal(() => {
    const pending = this.pending();
    return pending?.kind === 'prompt' ? { text: pending.options.defaultValue ?? '', choice: pending.options.choice?.defaultValue ?? '' } : { text: '', choice: '' };
  });
  protected readonly answerForm = form(this.answer);
  /** The form dialog's texts, one per field, reset for every dialog. */
  protected readonly values = linkedSignal(() => {
    const pending = this.pending();
    return pending?.kind === 'form' ? pending.options.fields.map((f) => f.value) : [];
  });
  protected readonly valuesForm = form(this.values);
  protected readonly errors = computed(() => {
    const pending = this.pending();
    if (pending?.kind !== 'form') return [];
    const values = this.values();
    return pending.options.fields.map((f, i) => f.validate?.(values[i] ?? '') ?? null);
  });
  protected readonly hint = computed(() => {
    const pending = this.pending();
    if (pending?.kind !== 'prompt' || !pending.options.choice?.hint) return null;
    const { text, choice } = this.answer();
    return pending.options.choice.hint(text, choice);
  });

  protected readonly invalid = computed(() => this.errors().some((e) => e));

  protected cancel(pending: PendingDialog): void {
    if (pending.kind === 'confirm') pending.resolve(false);
    else pending.resolve(null);
  }

  protected submitForm(event: Event, pending: PendingDialog): void {
    event.preventDefault();
    if (pending.kind !== 'form' || this.errors().some((e) => e)) return;
    const values = this.values();
    pending.resolve(Object.fromEntries(pending.options.fields.map((f, i) => [f.key, values[i] ?? ''])));
  }

  protected submitPrompt(event: Event, pending: PendingDialog): void {
    event.preventDefault();
    if (pending.kind !== 'prompt') return;
    const { text, choice } = this.answer();
    pending.resolve(text, pending.options.choice ? choice : undefined);
  }

  protected promptKeys(event: KeyboardEvent, pending: PendingDialog): void {
    if (event.key === 'Escape') this.cancel(pending);
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) this.submitPrompt(event, pending);
  }

  protected selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }
}
