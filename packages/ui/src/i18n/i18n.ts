import { DOCUMENT, Service, computed, inject, signal } from '@angular/core';
import {
  catalogName,
  modelName,
  errorLine,
  categoryName,
  commandTitle,
  intlLocale,
  isMessageKey,
  languageDirection,
  phraseText,
  setLanguage,
  translate,
  type Language,
  type MessageKey,
  type MessageParams,
  type Phrase,
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

  /** A catalog entry's name as people read it: a built-in's in the current language, anything else (an imported model) as it is. */
  readonly catalogName = (ref: string, name: string): string => catalogName(ref, name, this.language());

  /** An item's model by its name in the current language (a built-in's translated, the missing stand-in's too). */
  readonly modelName = (ref: string, model: { name: string; missing?: true }): string => modelName(ref, model, this.language());

  /** A catalog category by its id, in the current language. */
  readonly categoryName = (category: string): string => categoryName(category, this.language());

  /** A phrase (a rule warning, a broken limit) in the current language, its lengths in `length`'s units. */
  readonly phrase = (phrase: Phrase, length: (mm: number) => string): string => phraseText(phrase, { translate: this.t, length, command: this.commandTitle });

  /** An error as one line in the current language: its translation, or its code's lead before the English message (`errorLine`). */
  readonly error = (err: unknown): string => errorLine(err, this.language());

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
