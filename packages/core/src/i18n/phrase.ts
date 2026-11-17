import type { MessageKey } from './en';
import type { MessageParams } from './message';

/**
 * A sentence kept as its catalog key and parameters rather than as text, so it can be shown in the
 * language of the moment and with lengths in the user's units: a rule warning, a broken limit. The
 * English text agents read is made from it once (`phraseText` with `ENGLISH_PHRASE`).
 *
 * A parameter is plain text (a name someone wrote, shown as it is), a number, a length in millimetres
 * (`{ mm }`), a range of lengths (`{ mmRange }`), or another phrase, translated in turn.
 */
export interface Phrase {
  key: MessageKey;
  params?: Readonly<Record<string, PhraseParam>>;
}

export type PhraseParam = string | number | { readonly mm: number } | { readonly mmRange: readonly [number, number] } | Phrase;

/** How a phrase becomes text: the translation of a key, and a length (mm) as it is shown. */
export interface PhraseFormat {
  translate: (key: MessageKey, params?: MessageParams) => string;
  length: (mm: number) => string;
}

/** A length as core writes it into English messages for agents: millimetres to a tenth. */
export const mmText = (mm: number): string => `${Math.round(mm * 10) / 10} mm`;

/**
 * Two lengths as a range: `600–650 mm` when both are written in the same unit after a space (or a
 * no-break space, which is kept), else `2' 0"–2' 2"`.
 */
export function rangeText(from: string, to: string): string {
  const a = /^(.*\d)([ \u00a0])(\S+)$/.exec(from);
  const b = /^(.*\d)([ \u00a0])(\S+)$/.exec(to);
  return a && b && a[3] === b[3] ? `${a[1]}–${b[1]}${a[2]}${a[3]}` : `${from}–${to}`;
}

/** The text of a phrase, its parameters formatted and translated with `format`. */
export function phraseText(phrase: Phrase, format: PhraseFormat): string {
  const params: MessageParams = {};
  for (const [name, value] of Object.entries(phrase.params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
    else if ('mm' in value) params[name] = format.length(value.mm);
    else if ('mmRange' in value) params[name] = rangeText(format.length(value.mmRange[0]), format.length(value.mmRange[1]));
    else params[name] = phraseText(value, format);
  }
  return format.translate(phrase.key, params);
}
