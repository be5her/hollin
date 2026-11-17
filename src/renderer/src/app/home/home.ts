import { Component, inject, input } from '@angular/core';
import { BRANDING } from '@studio/core';
import { AppState, Button, HostBridge, I18n, type Tab, type TabComponent } from '@studio/ui';
import { Search, Settings } from 'lucide';
import { ShellActions } from '../shell-actions';

/** The Home tab. The project library takes it over once projects exist. */
@Component({
  selector: 'x-home',
  imports: [Button],
  template: `
    <div class="max-w-2xl mx-auto w-full px-8 py-16 flex flex-col gap-6" data-testid="home">
      <div>
        <h1 class="heading-page text-fg" lang="en">{{ productName }}</h1>
        <p class="text-sm text-muted mt-1">{{ t('common.appDescription') }}</p>
      </div>
      <div class="flex gap-2">
        <button xButton variant="primary" [icon]="icons.Search" (click)="openPalette()">{{ t('shell.action.palette') }}</button>
        <button xButton [icon]="icons.Settings" (click)="shell.openSettings()">{{ t('shell.tab.settings') }}</button>
      </div>
      <p class="text-xs text-muted">{{ t('shell.home.empty') }}</p>
    </div>
  `,
  host: { class: 'flex-1 overflow-auto' },
})
export class Home implements TabComponent {
  private readonly app = inject(AppState);
  protected readonly host = inject(HostBridge);
  protected readonly shell = inject(ShellActions);

  readonly tab = input.required<Tab>();

  protected readonly productName = BRANDING.productName;
  protected readonly t = inject(I18n).t;
  protected readonly icons = { Search, Settings };

  protected openPalette(): void {
    this.app.paletteOpen.set(true);
  }
}
