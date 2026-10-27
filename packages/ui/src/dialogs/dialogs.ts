import { Service, signal, type InputSignal, type Type } from '@angular/core';

export interface PromptOptions {
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Multi-line text area instead of a single input. */
  multiline?: boolean;
  /** A select shown under the text, whose value comes back with it (see `promptWithChoice`). */
  choice?: PromptChoice;
}

export interface PromptChoice {
  label: string;
  options: { value: string; label: string }[];
  defaultValue: string;
  /** A line shown next to the select, recomputed as the text and the choice change. */
  hint?(text: string, choice: string): string | null;
}

export interface PromptResult {
  value: string;
  choice: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Lines listed under the message (what a removal takes with it, for instance). */
  details?: string[];
  confirmLabel?: string;
  danger?: boolean;
}

export interface FormDialogField {
  key: string;
  label: string;
  value: string;
  /** A select instead of a text input. */
  options?: { value: string; label: string }[];
  /** Monospaced input, for lengths. */
  mono?: boolean;
  /** An error for this text (shown under the field, and the dialog cannot be confirmed), or null. */
  validate?(text: string): string | null;
}

export interface FormDialogOptions {
  title: string;
  message?: string;
  fields: FormDialogField[];
  confirmLabel?: string;
}

/**
 * A dialog of its own (`Dialogs.open`): a component drawn in the dialog frame with two inputs, `data`
 * (what the caller passed) and `close` (call it with the answer, or null to cancel). Escape and a click
 * outside cancel it. Focus moves to its first field on open, Tab stays inside, its first heading labels
 * it, and focus returns to the opener on close (`DialogFocus`).
 */
export interface DialogComponent<D, T> {
  readonly data: InputSignal<D>;
  readonly close: InputSignal<(value: T | null) => void>;
}

export type PendingDialog =
  | { kind: 'prompt'; options: PromptOptions; resolve(value: string | null, choice?: string): void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve(value: boolean): void }
  | { kind: 'form'; options: FormDialogOptions; resolve(value: Record<string, string> | null): void }
  | { kind: 'component'; component: Type<unknown>; data: unknown; resolve(value: unknown): void };

/**
 * Prompt, confirm, form and component dialogs as promises. The shell's dialog host draws the pending
 * one; every kind keeps focus inside while open and gives it back to the opener on close (`DialogFocus`).
 */
@Service()
export class Dialogs {
  private readonly current = signal<PendingDialog | null>(null);

  readonly pending = this.current.asReadonly();

  prompt(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      this.current.set({
        kind: 'prompt',
        options,
        resolve: (value) => {
          this.current.set(null);
          resolve(value);
        },
      });
    });
  }

  /** A prompt with a select next to the text; resolves with both, or null when cancelled. */
  promptWithChoice(options: PromptOptions & { choice: PromptChoice }): Promise<PromptResult | null> {
    return new Promise((resolve) => {
      this.current.set({
        kind: 'prompt',
        options,
        resolve: (value, choice) => {
          this.current.set(null);
          resolve(value === null ? null : { value, choice: choice ?? options.choice.defaultValue });
        },
      });
    });
  }

  /** A dialog with several fields; resolves with the texts by key, or null when cancelled. */
  form(options: FormDialogOptions): Promise<Record<string, string> | null> {
    return new Promise((resolve) => {
      this.current.set({
        kind: 'form',
        options,
        resolve: (value) => {
          this.current.set(null);
          resolve(value);
        },
      });
    });
  }

  /** A dialog component of a module's own (see `DialogComponent`); resolves with what it closes with, or null when cancelled. */
  open<D, T>(component: Type<DialogComponent<D, T>>, data: D): Promise<T | null> {
    return new Promise((resolve) => {
      this.current.set({
        kind: 'component',
        component,
        data,
        resolve: (value) => {
          this.current.set(null);
          resolve((value ?? null) as T | null);
        },
      });
    });
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.current.set({
        kind: 'confirm',
        options,
        resolve: (value) => {
          this.current.set(null);
          resolve(value);
        },
      });
    });
  }
}
