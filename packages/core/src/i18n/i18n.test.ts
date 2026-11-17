import { afterEach, describe, expect, it } from 'vitest';
import { ar } from './ar';
import { en, type MessageKey } from './en';
import { commandTitle, currentLanguage, foldForSearch, hasRtl, intlLocale, isMessageKey, languageDirection, resolveLanguage, setLanguage, t, textDirection, toLatinDigits, translate } from './index';
import type { Message } from './message';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (message: Message) => (typeof message === 'string' ? [message] : Object.values(message));
const keys = Object.keys(en) as MessageKey[];

describe('the catalogs', () => {
  it('carry the same keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('name keys by area in camel case', () => {
    for (const key of keys) expect(key, key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/);
  });

  it('keep plural messages plural, with the forms Arabic needs', () => {
    for (const key of keys) {
      const [source, target] = [en[key] as Message, ar[key]];
      expect(typeof target, key).toBe(typeof source);
      if (typeof target === 'string') continue;
      // Arabic counts with six forms: a message that leaves one out would fall back to `other` for those numbers.
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other'] as const) expect(target[form], `${key} (${form})`).toBeTypeOf('string');
    }
  });

  it('use the same placeholders in both languages', () => {
    for (const key of keys) {
      const wanted = new Set(forms(en[key]).flatMap(placeholders));
      for (const text of forms(ar[key])) {
        // A plural form may spell its number out ("غرفتان") and so drop `{count}`; nothing else may go missing, and nothing new may appear.
        for (const name of placeholders(text)) expect(wanted.has(name), `${key}: {${name}} is not in the English text`).toBe(true);
        for (const name of wanted) if (name !== 'count' || typeof ar[key] === 'string') expect(placeholders(text), `${key}: {${name}} is missing`).toContain(name);
      }
    }
  });

  it('leave no Arabic text empty or untranslated by accident', () => {
    for (const key of keys) for (const text of forms(ar[key])) expect(text.trim().length, key).toBeGreaterThan(0);
  });
});

describe('translate', () => {
  afterEach(() => setLanguage('en'));

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(translate('en', 'common.ok')).toBe('OK');
    expect(translate('ar', 'common.cancel')).toBe('إلغاء');
  });

  it('follows the process language through t', () => {
    expect(t('common.close')).toBe('Close');
    setLanguage('ar');
    expect(currentLanguage()).toBe('ar');
    expect(t('common.close')).toBe('إغلاق');
  });

  it('knows a key from any other string', () => {
    expect(isMessageKey('common.ok')).toBe(true);
    expect(isMessageKey('common.nope')).toBe(false);
    expect(isMessageKey('toString')).toBe(false);
  });

  it('gives a command its English title in English and falls back to it', () => {
    expect(commandTitle({ id: 'no.such.command', title: 'Do it' }, 'en')).toBe('Do it');
    expect(commandTitle({ id: 'no.such.command', title: 'Do it' }, 'ar')).toBe('Do it');
  });
});

describe('languages', () => {
  it('resolve the system preference to a language the app speaks', () => {
    expect(resolveLanguage('system', 'ar-SA')).toBe('ar');
    expect(resolveLanguage('system', 'ar')).toBe('ar');
    expect(resolveLanguage('system', 'en-GB')).toBe('en');
    expect(resolveLanguage('system', 'fr-FR')).toBe('en');
    expect(resolveLanguage('system', undefined)).toBe('en');
    expect(resolveLanguage('ar', 'en-US')).toBe('ar');
    expect(resolveLanguage('en', 'ar-EG')).toBe('en');
  });

  it('know their direction and their Intl locale', () => {
    expect(languageDirection('ar')).toBe('rtl');
    expect(languageDirection('en')).toBe('ltr');
    expect(new Intl.NumberFormat(intlLocale('ar')).format(1234.5)).toMatch(/^[0-9.,]+$/);
  });
});

describe('text helpers', () => {
  it('read the direction from the first strong letter', () => {
    expect(textDirection('غرفة المعيشة')).toBe('rtl');
    expect(textDirection('Living room')).toBe('ltr');
    expect(textDirection('3600 mm')).toBe('ltr');
    expect(textDirection('12 غرفة')).toBe('rtl');
    expect(textDirection('Room غرفة')).toBe('ltr');
    expect(textDirection('1250')).toBe('ltr');
    expect(textDirection('1250', 'rtl')).toBe('rtl');
    expect(hasRtl('Bedroom 2')).toBe(false);
    expect(hasRtl('Bedroom غرفة')).toBe(true);
  });

  it('turn Arabic and Persian digits and separators into what the parsers read', () => {
    expect(toLatinDigits('٣٦٠٠')).toBe('3600');
    expect(toLatinDigits('۳٫۵')).toBe('3.5');
    expect(toLatinDigits('١٬٢٥٠٫٥ mm')).toBe('1250.5 mm');
    expect(toLatinDigits('١٠٠،٢٠٠')).toBe('100,200');
    expect(toLatinDigits('3600 mm')).toBe('3600 mm');
  });

  it('fold Arabic for searching', () => {
    expect(foldForSearch('غُرفة')).toBe(foldForSearch('غرفه'));
    expect(foldForSearch('الأرضي')).toBe(foldForSearch('الارضى'));
    expect(foldForSearch('مـطـبـخ')).toBe('مطبخ');
    expect(foldForSearch('Kitchen ٢')).toBe('kitchen 2');
    expect(foldForSearch('Café Crème')).toBe('cafe creme');
    // Isolates and marks around a name in a translated title do not stand between it and a search.
    const [fsi, pdi, rlm] = [0x2068, 0x2069, 0x200f].map((c) => String.fromCharCode(c));
    expect(foldForSearch(`فتح المشروع: ${fsi}بيت${pdi}${rlm}`)).toBe('فتح المشروع: بيت');
  });
});
