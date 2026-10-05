import { DOCUMENT, DestroyRef, Service, inject, untracked } from '@angular/core';
import type { ThemePreference } from '@studio/core';
import { HostBridge } from '../host/host-bridge';
import { AppState } from '../state/app-state';

/**
 * Light or dark mode: the `dark` class on the document, which switches the semantic colour
 * variables in styles.css. The native window buttons are recoloured to match the title bar.
 */
@Service()
export class Theme {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView!.matchMedia('(prefers-color-scheme: dark)');

  resolve(preference: ThemePreference): 'light' | 'dark' {
    if (preference === 'system') return this.media.matches ? 'dark' : 'light';
    return preference;
  }

  apply(preference: ThemePreference): void {
    const resolved = this.resolve(preference);
    const root = this.document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    this.app.resolvedTheme.set(resolved);
    const style = getComputedStyle(root);
    const color = style.getPropertyValue('--titlebar').trim();
    const symbolColor = style.getPropertyValue('--titlebar-fg').trim();
    if (/^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(symbolColor)) {
      this.host.invoke('window.titleBarColors', { color, symbolColor }, null).catch(() => {});
    }
  }

  /** Keep the mode in step with the OS while the preference is "system", until `destroyRef` is destroyed. */
  followSystem(destroyRef: DestroyRef): void {
    const listener = () => {
      if ((untracked(this.app.config)?.appearance.theme ?? 'system') === 'system') this.apply('system');
    };
    this.media.addEventListener('change', listener);
    destroyRef.onDestroy(() => this.media.removeEventListener('change', listener));
  }
}
