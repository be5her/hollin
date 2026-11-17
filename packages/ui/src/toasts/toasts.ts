import { Service, signal } from '@angular/core';
import { errorText, t } from '@studio/core';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  /** An untranslated error's English message, under its translated lead (`message`), shown left to right. */
  detail?: string;
  /** A button on the toast (Show, for an exported file), which also dismisses it. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run(): void;
}

/** Short notices in the corner. Errors stay a little longer. */
@Service()
export class Toasts {
  private readonly list = signal<Toast[]>([]);
  private seq = 0;

  readonly toasts = this.list.asReadonly();

  /** Show a notice; one with an action stays as long as an error, so there is time to use it. */
  notify(message: string, kind: Toast['kind'] = 'info', action?: ToastAction, detail?: string): void {
    const id = ++this.seq;
    this.list.update((toasts) => [...toasts, { id, kind, message, ...(detail ? { detail } : {}), ...(action ? { action } : {}) }]);
    setTimeout(() => this.dismiss(id), kind === 'error' || action ? 6000 : 3000);
  }

  /** Runs a toast's action and dismisses the toast. */
  act(toast: Toast): void {
    this.dismiss(toast.id);
    toast.action?.run();
  }

  /**
   * Show what went wrong, whatever was thrown, in the language of the moment: the error's own text when
   * it carries a translation (or the interface is English), else the translated lead for its code with
   * the English message under it (`errorText`).
   */
  error(err: unknown): void {
    const { text, detail } = errorText(err);
    this.notify(text, 'error', undefined, detail);
  }

  dismiss(id: number): void {
    this.list.update((toasts) => toasts.filter((t) => t.id !== id));
  }

  /** Copy text to the clipboard and say so (`what`, or "Copied" in the app's language). */
  copy(text: string, what?: string): void {
    void navigator.clipboard.writeText(text).then(
      () => this.notify(what ?? t('common.copied'), 'success'),
      () => this.notify(t('common.copyFailed'), 'error'),
    );
  }
}
