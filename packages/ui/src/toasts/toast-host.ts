import { Component, inject } from '@angular/core';
import { CircleAlert, CircleCheck, Info, X } from 'lucide';
import { I18n } from '../i18n/i18n';
import { Icon } from '../icon/icon';
import { Toasts } from './toasts';

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert };

/** Renders the toasts. Mount once in the shell. */
@Component({
  selector: 'x-toast-host',
  imports: [Icon],
  templateUrl: './toast-host.html',
  host: { class: 'contents' },
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
  protected readonly t = inject(I18n).t;
  protected readonly icons = ICONS;
  protected readonly closeIcon = X;
}
