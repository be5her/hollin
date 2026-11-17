import { DestroyRef, Service, inject } from '@angular/core';
import type { UpdateState } from '@studio/core';
import { HostBridge, I18n, TabsState, Toasts } from '@studio/ui';

/**
 * The update toasts, wherever the user is: a version found by the startup check (with Settings, which
 * opens the Updates section), and a download that is ready (with Restart and install). A check the
 * user started shows its outcome in Settings, where they are, so it gets no toast.
 */
@Service()
export class UpdateNotices {
  private readonly host = inject(HostBridge);
  private readonly tabs = inject(TabsState);
  private readonly toasts = inject(Toasts);
  private readonly t = inject(I18n).t;
  private started = false;
  private last: UpdateState['state'] | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    const off = this.host.on('update.changed', (state) => this.changed(state));
    inject(DestroyRef).onDestroy(off);
  }

  /** Opens Settings at the Updates section. */
  openSettings(): void {
    const data = { key: 'settings', section: 'updates' };
    const tab = this.tabs.open({ type: 'settings.main', title: 'Settings', titleKey: 'shell.tab.settings', data }, { singletonKey: 'settings.main:settings' });
    this.tabs.update(tab.id, { data });
  }

  /** Saves, stops and restarts the app into the downloaded version. */
  async install(): Promise<void> {
    try {
      await this.host.invoke('app.update.install', {}, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  private changed(state: UpdateState): void {
    const previous = this.last;
    this.last = state.state;
    if (state.state === previous) return;
    if (state.state === 'available' && state.scheduled) {
      this.toasts.notify(this.t('updates.state.available', { version: state.version ?? '' }), 'info', { label: this.t('updates.toast.settings'), run: () => this.openSettings() });
    } else if (state.state === 'ready') {
      this.toasts.notify(this.t('updates.toast.ready', { version: state.version ?? '' }), 'success', { label: this.t('updates.install'), run: () => void this.install() });
    }
  }
}
