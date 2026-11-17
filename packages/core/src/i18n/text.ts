/**
 * Text helpers the app needs once it speaks a right-to-left language: which way a piece of text
 * reads, digits typed on an Arabic keyboard, and a folded form for searching.
 */

/** Hebrew, Arabic, Syriac, Thaana, N'Ko and the Arabic presentation forms: any character of the right-to-left blocks. */
const RTL_SCRIPT = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
/**
 * A strong right-to-left letter: the right-to-left blocks without the Arabic-Indic and Persian digits and the Arabic
 * percent sign and separators (U+0660–U+066C, U+06F0–U+06F9), which are numbers, neutral as Western digits are.
 */
const RTL_LETTER = /[֐-ٟ٭-ۯۺ-ࣿיִ-﷿ﹰ-ﻼ]/;
/**
 * A strong left-to-right letter (Latin, Greek, Cyrillic and the rest of the letters outside the right-to-left blocks),
 * without × and ÷ (U+00D7, U+00F7), which sit among the Latin letters but are signs.
 */
const LTR_LETTER = /[A-Za-zÀ-ÖØ-öø-ʯͰ-֏ऀ-῿Ⰰ-퟿]/;

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
  return RTL_SCRIPT.test(text);
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
 * A number typed into a text field (a field of `type="text"`, since a `type="number"` field drops
 * Arabic-Indic digits before the page sees them): its digits through `toLatinDigits`, spaces around
 * it ignored. NaN for an empty field or anything else that is not a number.
 */
export function parseNumber(text: string): number {
  const latin = toLatinDigits(String(text)).trim();
  return latin === '' ? NaN : Number(latin);
}

/**
 * A text folded for matching: lower case, Latin digits, and for Arabic no diacritics or tatweel and
 * one form for the letters people type interchangeably (أ إ آ ٱ as ا, ى as ي, ة as ه, ؤ as و, ئ as ي),
 * so "غرفه" finds "غُرفة"; Latin accents and the invisible direction marks and isolates go too
 * ("cafe" finds "Café"). Compare folded text with folded text only.
 */
export function foldForSearch(text: string): string {
  return toLatinDigits(text)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[A-Za-z\u00c0-\u024f]+/g, (word) => word.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** The longest project name `nameFromSentence` makes, in code points. */
export const SENTENCE_NAME_MAX = 48;

/** Direction marks and isolates, which a pasted sentence may carry and a name must not. */
const BIDI_CONTROLS = /[\u200e\u200f‪-‮\u2066-\u2069]/g;
/** Where a sentence's first clause ends: a comma, a full stop (not one between digits, as in 3.5), a colon, a question or an exclamation, in Latin or Arabic punctuation, or a line break. */
const CLAUSE_END = /[,;:!?\n،؛؟۔]|\.(?!\d)|(?<!\d)\./u;

/**
 * A project name from the first words of a sentence (Home's "Start with Otto", first launch's Otto
 * line): up to the first comma or full stop in any script, at most `SENTENCE_NAME_MAX` code points,
 * cut at a word boundary when the first clause is longer (unless that leaves 20 or fewer), never inside
 * a letter's diacritics, with its first letter capitalised where the script has capitals. `fallback`
 * (the untitled name) when nothing is left.
 */
export function nameFromSentence(sentence: string, fallback: string): string {
  const head = (sentence.replace(BIDI_CONTROLS, '').trim().split(CLAUSE_END)[0] ?? '').trim().replace(/\s+/gu, ' ');
  let chars = [...head];
  if (chars.length > SENTENCE_NAME_MAX) {
    // The last space at or before the limit (a space right after it ends a whole word too).
    let space = -1;
    for (let i = Math.min(SENTENCE_NAME_MAX, chars.length - 1); i >= 0; i--) {
      if (chars[i] === ' ') {
        space = i;
        break;
      }
    }
    if (space > 20) chars = chars.slice(0, space);
    else {
      // A hard cut: drop the letter whose diacritics would be cut off from it.
      let end = SENTENCE_NAME_MAX;
      while (end > 0 && /\p{M}/u.test(chars[end] ?? '')) end--;
      chars = chars.slice(0, end);
    }
  }
  const name = chars.join('').trim();
  if (!name) return fallback;
  const [first, ...rest] = [...name];
  return first.toUpperCase() + rest.join('');
}

/** A piece of a chat line: plain text, or a left-to-right island (a measurement, a range, a size). */
export interface TextPart {
  text: string;
  ltr: boolean;
}

/** One line of a chat message as the panel shows it: its own direction (`dir="auto"`) and its islands, or a blank line. */
export interface ChatBlock {
  text: string;
  /** The line in pieces: `ltr` ones are shown as left-to-right islands. Joined, they are `text`. */
  parts: TextPart[];
  /** A blank line (empty or only spaces): shown as an empty line of one line's height, and copied as one. */
  blank: boolean;
}

/** A digit, Western or Arabic-Indic. */
const D = '[0-9\u0660-\u0669\u06f0-\u06f9]';
/** A number: digits with decimal and thousands separators, thousands also grouped by a space matching `sep`. */
const grouped = (sep: string) => `${D}(?:[.,\u066b\u066c]?${D})*(?:${sep}${D}{3}(?!${D}))*`;
/** A number whose groups are joined only by a no-break or thin space: `101 102 103` with plain spaces is three numbers. */
const NUMBER = grouped('[\u00a0\u202f]');
/** A number whose groups may be joined by a plain space too (`3 000`): one number only when a unit follows the whole run. */
const SPACED_NUMBER = grouped('[ \u00a0\u202f]');
/** A unit symbol after a number, not the start of a longer word. */
const UNIT = '(?:mm|cm|km|m²|m³|m2|m|ft|in|lm|°|%|″|′|"|\')(?![\\p{L}\\p{N}])';
/**
 * A measurement, a size or a range written in a sentence: `3600 mm`, `3 000 mm`, `4 × 5 m`, `600–650 mm`,
 * `12.5 m²`, `45°`. Inside Arabic text the bidi algorithm reads digits after an Arabic letter as Arabic
 * numbers, which puts a Latin unit before them (`mm 3600`) and turns a range around (`650–600`). Digit
 * groups with plain spaces between them are one number only before a unit (`3 000 mm`); otherwise
 * (`101 102 103`, a phone number) they stay separate numbers.
 */
const run = (n: string) => `${n}(?:[ \u00a0\u202f]?[×x–-][ \u00a0\u202f]?${n})*`;
const MEASURE = new RegExp(`${run(SPACED_NUMBER)}[ \u00a0\u202f]?${UNIT}|${run(NUMBER)}(?:[ \u00a0\u202f]?${UNIT})?`, 'gu');

/**
 * A line split around its measurements, sizes and ranges, which are left-to-right islands (the
 * `bidi-ltr` class), so `3600 mm` and `600–650 mm` read the same in an Arabic sentence as in an English
 * one. A bare number needs none and stays plain text.
 */
export function ltrIslands(line: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of line.matchAll(MEASURE)) {
    const found = match[0];
    // A number alone (digits and its own separators) reads right in either direction.
    if (new RegExp(`^${NUMBER}$`, 'u').test(found) && !/[ \u00a0\u202f]/.test(found)) continue;
    if (match.index > at) parts.push({ text: line.slice(at, match.index), ltr: false });
    parts.push({ text: found, ltr: true });
    at = match.index + found.length;
  }
  if (at < line.length) parts.push({ text: line.slice(at), ltr: false });
  return parts;
}

/**
 * A text with its measurements, sizes and ranges (`ltrIslands`) put between U+2066 and U+2069, for a place
 * that has no element to make them islands: canvas text, which a right-to-left `ctx.direction` would
 * otherwise draw as `mm 3600`. A text with no measurement comes back as it is.
 */
export function isolateMeasurements(text: string): string {
  const parts = ltrIslands(text);
  return parts.some((p) => p.ltr) ? parts.map((p) => (p.ltr ? `\u2066${p.text}\u2069` : p.text)).join('') : text;
}

/**
 * A chat message split into its lines, so each takes its direction from its own first strong letter: a
 * reply with an Arabic paragraph, an English one and a list reads right line by line, where one element
 * would give the whole text the direction of its first letter. Each line's measurements are islands
 * (`ltrIslands`). A blank line is a block of its own (`blank`), so the text looks and copies as written,
 * as one `pre-wrap` element showed it; blank lines at the end (a reply still streaming, a trailing
 * newline) are dropped, so the last block always has text. A message without text has no blocks.
 */
export function chatBlocks(text: string): ChatBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((line) => (line.trim() ? { text: line, parts: ltrIslands(line), blank: false } : { text: '', parts: [], blank: true }));
}
