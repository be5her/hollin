import { currentLanguage, intlLocale, translate, type Language } from '@studio/core';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const formats = new Map<Language, Intl.RelativeTimeFormat>();

/**
 * "just now", "5 minutes ago", "yesterday", "3 weeks ago", in the app's language (`currentLanguage`;
 * a `computed` that shows it reads `I18n.language` too, so it follows a switch).
 */
export function relativeTime(iso: string | null | undefined, now = Date.now(), language: Language = currentLanguage()): string {
  if (!iso) return '';
  const seconds = (Date.parse(iso) - now) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (Math.abs(seconds) < 45) return translate(language, 'common.justNow');
  let relative = formats.get(language);
  if (!relative) formats.set(language, (relative = new Intl.RelativeTimeFormat(intlLocale(language), { numeric: 'auto' })));
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(Math.round(seconds / 60), 'minute');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Two letters for a placeholder: the initials of the first two words, or the first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/** A stable hue for an id, for placeholder colours. */
export function hueOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * True while an input method composes (Arabic, Japanese, any IME): its Enter confirms the composition and
 * must never send or submit. Chromium sets `isComposing`, and reports key code 229 for keys the IME takes.
 */
export function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
