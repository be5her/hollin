import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { UpdateState } from '@studio/core';
import { AppState, Button, Checkbox, HostBridge, Toasts, invokeResource } from '@studio/ui';
import { Download, RefreshCw, RotateCw } from 'lucide';
import { UpdateNotices } from './update-notices';

/** The line under Updates for each state. */
export function updateLine(s: UpdateState | undefined, at: (iso: string) => string): string {
  if (!s) return '';
  switch (s.state) {
    case 'idle':
      return s.checkedAt ? `Last checked ${at(s.checkedAt)}` : 'Not checked yet';
    case 'checking':
      return 'Checking…';
    case 'available':
      return `Version ${s.version} is available`;
    case 'up-to-date':
      return `You have the latest version (checked ${at(s.checkedAt ?? new Date().toISOString())})`;
    case 'downloading':
      return `Downloading ${s.progress ?? 0} %`;
    case 'ready':
      return `Ready to install version ${s.version}. It also installs when you quit.`;
    case 'error':
      return s.message ?? 'Something went wrong.';
    case 'unsupported':
      return `Updates are not available in this build: ${s.message ?? 'no update feed'}`;
  }
}

/**
 * Settings > Updates: where the update stands, Check / Download / Restart and install (each enabled
 * only when it can act), the release notes as plain text, and whether to check when the app starts.
 */
@Component({
  selector: 'x-updates-settings',
  imports: [Button, Checkbox, FormField],
  template: `
    <p class="text-xs text-muted mb-3">New versions come from the app's releases. Nothing is downloaded or installed until you ask.</p>
    <p class="text-sm mb-3" [class]="tone()" data-testid="updates-status" [attr.data-state]="state()?.state">{{ line() }}</p>
    <div class="flex items-center gap-2 flex-wrap">
      <button xButton size="sm" [icon]="icons.RefreshCw" [loading]="state()?.state === 'checking'" [disabled]="!canCheck()" (click)="check()" data-testid="updates-check">Check for updates</button>
      <button xButton size="sm" [icon]="icons.Download" [loading]="state()?.state === 'downloading'" [disabled]="state()?.state !== 'available'" (click)="download()" data-testid="updates-download">Download</button>
      <button xButton size="sm" variant="primary" [icon]="icons.RotateCw" [disabled]="state()?.state !== 'ready' || installing()" (click)="install()" data-testid="updates-install">Restart and install</button>
    </div>
    @if (notes(); as text) {
      <h3 class="text-xs font-semibold text-muted mt-4 mb-1.5">What's new in {{ state()?.version }}</h3>
      <div class="text-xs whitespace-pre-line bg-surface border border-edge rounded-md px-2.5 py-2 max-h-48 overflow-auto" data-testid="updates-notes">{{ text }}</div>
    }
    <label class="flex items-center gap-2 text-sm mt-4"><input xCheckbox type="checkbox" [formField]="auto.check" data-testid="updates-auto" />Check for updates when the app starts</label>
  `,
})
export class UpdatesSettings {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly notices = inject(UpdateNotices);

  protected readonly icons = { Download, RefreshCw, RotateCw };
  private readonly status = invokeResource<UpdateState>('app.update.status', () => ({}), { projectId: null, refreshOnEvents: ['update.changed'] });
  protected readonly state = this.status.value;
  protected readonly installing = signal(false);
  protected readonly line = computed(() => updateLine(this.state(), (iso) => new Date(iso).toLocaleString()));
  protected readonly tone = computed(() => {
    const s = this.state()?.state;
    return s === 'error' ? 'text-danger' : s === 'available' || s === 'ready' ? 'text-success' : s === 'unsupported' ? 'text-muted' : '';
  });
  protected readonly canCheck = computed(() => ['idle', 'available', 'up-to-date', 'error'].includes(this.state()?.state ?? ''));
  protected readonly notes = computed(() => {
    const s = this.state();
    return s && (s.state === 'available' || s.state === 'downloading' || s.state === 'ready') ? (s.notes ?? '') : '';
  });

  /** The startup check switch, following the stored config. */
  private readonly draft = linkedSignal(() => ({ check: this.app.config()?.updates.check ?? true }));
  protected readonly auto = form(this.draft);

  constructor() {
    effect(() => {
      const check = this.draft().check;
      const config = untracked(this.app.config);
      if (!config || check === config.updates.check) return;
      untracked(() => void this.save(check));
    });
  }

  private async save(check: boolean): Promise<void> {
    try {
      await this.host.invoke('config.update', { patch: { updates: { check } } }, null);
    } catch (err) {
      this.toasts.error(err);
      this.draft.set({ check: untracked(this.app.config)?.updates.check ?? true });
    }
  }

  protected async check(): Promise<void> {
    try {
      await this.host.invoke('app.update.check', {}, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async download(): Promise<void> {
    try {
      await this.host.invoke('app.update.download', {}, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async install(): Promise<void> {
    this.installing.set(true);
    try {
      await this.notices.install();
    } finally {
      this.installing.set(false);
    }
  }
}
