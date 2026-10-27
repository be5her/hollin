import { Service, signal } from '@angular/core';
import { toErrorPayload } from '@studio/core';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
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
  notify(message: string, kind: Toast['kind'] = 'info', action?: ToastAction): void {
    const id = ++this.seq;
    this.list.update((toasts) => [...toasts, { id, kind, message, ...(action ? { action } : {}) }]);
    setTimeout(() => this.dismiss(id), kind === 'error' || action ? 6000 : 3000);
  }

  /** Runs a toast's action and dismisses the toast. */
  act(toast: Toast): void {
    this.dismiss(toast.id);
    toast.action?.run();
  }

  /** Show what went wrong, whatever was thrown. */
  error(err: unknown): void {
    this.notify(toErrorPayload(err).message, 'error');
  }

  dismiss(id: number): void {
    this.list.update((toasts) => toasts.filter((t) => t.id !== id));
  }

  /** Copy text to the clipboard and say so. */
  copy(text: string, what = 'Copied'): void {
    void navigator.clipboard.writeText(text).then(
      () => this.notify(what, 'success'),
      () => this.notify('Could not copy to the clipboard', 'error'),
    );
  }
}
