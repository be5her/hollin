import { ar } from './ar';
import { arCommandTitles } from './ar/commands';
import { en, type MessageKey } from './en';
import type { Message, MessageParams } from './message';
import { mmText, type PhraseFormat } from './phrase';

export type { MessageKey } from './en';
export { arCommandTitles } from './ar/commands';
export type { Message, MessageParams, PluralForms } from './message';
export * from './text';
export * from './phrase';

/**
 * The languages the app speaks. English is the source: its catalog (`./en`) defines every key, and
 * every other catalog must carry the same keys (the type of `./ar` and `i18n.test.ts` see to it).
 * `docs/i18n.md` says how to add a string and a language.
 */
export const LANGUAGES = [
  { id: 'en', name: 'English', dir: 'ltr' },
  { id: 'ar', name: 'العربية', dir: 'rtl' },
] as const;

export type Language = (typeof LANGUAGES)[number]['id'];
/** What Settings stores: a language, or the operating system's. */
export type LanguagePreference = Language | 'system';
export type TextDirection = 'ltr' | 'rtl';

const CATALOGS: Record<Language, Record<MessageKey, Message>> = { en, ar };

let current: Language = 'en';

/** The language a preference means on this machine: the OS's when it is one the app speaks, English otherwise. */
export function resolveLanguage(preference: LanguagePreference, systemLocale: string | undefined): Language {
  if (preference !== 'system') return preference;
  const tag = (systemLocale ?? '').toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.some((l) => l.id === tag) ? (tag as Language) : 'en';
}

export function languageDirection(language: Language): TextDirection {
  return LANGUAGES.find((l) => l.id === language)?.dir ?? 'ltr';
}

/**
 * The locale to hand `Intl` for dates and relative times. Arabic keeps Western digits (`nu-latn`), as
 * the lengths, the coordinates and every number typed into the app do.
 */
export function intlLocale(language: Language): string {
  return language === 'ar' ? 'ar-u-nu-latn' : 'en';
}

const pluralRules = new Map<Language, Intl.PluralRules>();

function pluralForm(language: Language, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(language);
  if (!rules) pluralRules.set(language, (rules = new Intl.PluralRules(language)));
  return rules.select(count);
}

function fill(text: string, params: MessageParams | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/**
 * A message in a language: `{name}` placeholders are filled from `params`, and a message with plural
 * forms picks its form by `params.count` (Arabic has six). A key the language lacks falls back to
 * English, so a missing translation is never an empty label.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const message: Message = CATALOGS[language][key] ?? en[key];
  if (typeof message === 'string') return fill(message, params);
  const count = Number(params?.['count'] ?? 0);
  return fill(message[pluralForm(language, count)] ?? message.other, params);
}

/** True when `key` is a message key: for keys built at run time (`plan.tool.${id}`), before they are translated. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/**
 * A command's title as the palette and the assistant's tool cards show it. English is the title the
 * command was defined with; the other languages keep theirs by command id (`./ar/commands.ts`).
 * Agents (MCP) always read the English title and description.
 */
export function commandTitle(command: { id: string; title: string }, language: Language = current): string {
  return language === 'ar' ? (arCommandTitles[command.id] ?? command.title) : command.title;
}

/**
 * The process's language: the main process sets it from the config, the renderer's `I18n` service
 * keeps it in step with its signal. Code without a reactive context (edit labels in main, tool hints
 * and canvas text in the viewport) reads it through `t`.
 */
export function setLanguage(language: Language): void {
  current = language;
}

export function currentLanguage(): Language {
  return current;
}

/** `translate` in the process's language. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}

/** English with lengths in millimetres as core writes them: the text agents read of a `Phrase` (a warning's `message`). */
export const ENGLISH_PHRASE: PhraseFormat = { translate: (key, params) => translate('en', key, params), length: mmText };
