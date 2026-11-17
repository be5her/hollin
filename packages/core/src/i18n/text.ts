/**
 * Text helpers the app needs once it speaks a right-to-left language: which way a piece of text
 * reads, digits typed on an Arabic keyboard, and a folded form for searching.
 */

/** Hebrew, Arabic, Syriac, Thaana, N'Ko and the Arabic presentation forms: the strong right-to-left letters. */
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
/** A strong left-to-right letter (Latin, Greek, Cyrillic and the rest of the letters outside the right-to-left blocks). */
const LTR_LETTER = /[A-Za-zÀ-ʯͰ-֏ऀ-῿Ⰰ-퟿]/;

/**
 * The direction a text reads in, by its first strong letter, like `dir="auto"` in HTML: for canvas
 * text and exports, which have no `dir`. Digits and punctuation are neutral, so `3600 mm` and
 * `12.5 m²` read left to right, and a text with no letters takes `fallback`.
 */
export function textDirection(text: string, fallback: 'ltr' | 'rtl' = 'ltr'): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RTL_LETTER.test(ch)) return 'rtl';
    if (LTR_LETTER.test(ch)) return 'ltr';
  }
  return fallback;
}

/** True when the text holds any right-to-left letter: it then needs shaping and reordering wherever the platform does not do them (the PDF writer). */
export function hasRtl(text: string): boolean {
  return RTL_LETTER.test(text);
}

/**
 * Digits and separators as the parsers expect them: Arabic-Indic (٠ to ٩) and Persian (۰ to ۹)
 * digits become 0 to 9, the Arabic decimal separator (٫) a dot, the Arabic thousands separator (٬)
 * disappears and the Arabic comma (،) becomes a comma. An Arabic keyboard layout types these, so
 * every field that takes a number passes its text through here first.
 */
export function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹٫٬،]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code === 0x066b) return '.';
    if (code === 0x066c) return '';
    return ',';
  });
}

/**
 * A text folded for matching: lower case, Latin digits, and for Arabic no diacritics or tatweel and
 * one form for the letters people type interchangeably (أ إ آ ٱ as ا, ى as ي, ة as ه, ؤ as و, ئ as ي),
 * so "غرفه" finds "غُرفة". Compare folded text with folded text only.
 */
export function foldForSearch(text: string): string {
  return toLatinDigits(text)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}
