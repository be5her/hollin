import { DOCUMENT, Service, computed, inject, signal } from '@angular/core';
import {
  commandTitle,
  intlLocale,
  isMessageKey,
  languageDirection,
  setLanguage,
  translate,
  type Language,
  type MessageKey,
  type MessageParams,
  type TextDirection,
} from '@studio/core';
import { HostBridge } from '../host/host-bridge';

/** `I18n.t`: a message in the language of the moment. */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * The renderer's language. Main resolves it (`app.language`, then `language.changed`) and this keeps
 * it in a signal, so `t` in a template or a `computed` follows a switch at once. It also keeps core's
 * process language in step (for code without a reactive context) and sets `lang` and `dir` on `<html>`.
 * In a component: `protected readonly t = inject(I18n).t;` then `{{ t('area.key') }}`. See `docs/i18n.md`.
 */
@Service()
export class I18n {
  private readonly host = inject(HostBridge);
  private readonly document = inject(DOCUMENT);

  readonly language = signal<Language>('en');
  readonly direction = computed<TextDirection>(() => languageDirection(this.language()));
  /** The locale for `Intl` and every `toLocale*String`: Arabic keeps Western digits. */
  readonly locale = computed(() => intlLocale(this.language()));

  /** A message in the current language; reads the language signal. */
  readonly t: Translate = (key, params) => translate(this.language(), key, params);

  /**
   * A title a module registered (a palette action, a Settings section, a panel): a message key, which
   * is translated, or plain text, shown as it is.
   */
  readonly label = (text: string, params?: MessageParams): string => (isMessageKey(text) ? this.t(text, params) : text);

  /** A command's title as the palette shows it: Arabic by command id, English from its definition. */
  readonly commandTitle = (command: { id: string; title: string }): string => commandTitle(command, this.language());

  /** Load the language main resolved; the shell calls it before the first render. */
  async load(): Promise<void> {
    const state = await this.host.invoke<{ language: Language }>('app.language', {}, null);
    this.apply(state.language);
  }

  /** Follow `language.changed`; returns the function that stops. */
  follow(): () => void {
    return this.host.on('language.changed', ({ language }) => this.apply(language));
  }

  apply(language: Language): void {
    setLanguage(language);
    this.language.set(language);
    const root = this.document.documentElement;
    root.lang = language;
    root.dir = languageDirection(language);
  }
}
