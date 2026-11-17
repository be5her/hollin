import { afterEach, describe, expect, it } from 'vitest';
import { ar } from './ar';
import { en, type MessageKey } from './en';
import { SENTENCE_NAME_MAX, chatBlocks, ltrIslands, commandTitle, currentLanguage, foldForSearch, nameFromSentence, hasRtl, parseNumber, intlLocale, isMessageKey, languageDirection, resolveLanguage, setLanguage, t, textDirection, toLatinDigits, translate } from './index';
import type { Message } from './message';
import { DXF_UNIT_NAMES } from '../exchange/dxf-import';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (message: Message) => (typeof message === 'string' ? [message] : Object.values(message));
const keys = Object.keys(en) as MessageKey[];

describe('the catalogs', () => {
  it('carry the same keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('name keys by area in camel case', () => {
    // An error code keeps its own spelling in its lead's key (`errors.code.NOT_FOUND`).
    for (const key of keys) expect(key, key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$|^errors\.code\.[A-Z_]+$/);
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
    // A placeholder given is filled, in both languages.
    expect(translate('en', 'common.effort', { effort: 'high' })).toBe('high effort');
    expect(translate('ar', 'common.effort', { effort: 'مرتفع' })).toBe('جهد مرتفع');
    // One not given stays as it is written, and a parameter the message does not name changes nothing.
    expect(translate('en', 'common.effort')).toBe('{effort} effort');
    expect(translate('en', 'common.effort', { other: 'x' })).toBe('{effort} effort');
    expect(translate('en', 'common.ok', { effort: 'high' })).toBe('OK');
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

  it('counts the things the interface counts most the way Arabic counts them', () => {
    const counts = [0, 1, 2, 3, 11, 100];
    const say = (key: MessageKey) => counts.map((count) => translate('ar', key, { count }));
    expect(say('plan.count.wall')).toEqual(['0 جدار', 'جدار واحد', 'جداران', '3 جدران', '11 جدارًا', '100 جدار']);
    expect(say('plan.count.room')).toEqual(['0 غرفة', 'غرفة واحدة', 'غرفتان', '3 غرف', '11 غرفة', '100 غرفة']);
    expect(say('library.card.levels')).toEqual(['0 طابق', 'طابق واحد', 'طابقان', '3 طوابق', '11 طابقًا', '100 طابق']);
    // After «عُثر على», so two projects are in the genitive.
    expect(say('library.settings.foundProjects')).toEqual(['0 مشروع', 'مشروع واحد', 'مشروعين', '3 مشاريع', '11 مشروعًا', '100 مشروع']);
    expect(say('rules.count')).toEqual(['0 تحذير', 'تحذير واحد', 'تحذيران', '3 تحذيرات', '11 تحذيرًا', '100 تحذير']);
    // English keeps its two forms.
    expect(counts.map((count) => translate('en', 'plan.count.wall', { count }))).toEqual(['0 walls', '1 wall', '2 walls', '3 walls', '11 walls', '100 walls']);
  });

  it('isolates measurements, versions, paths and shortcuts inside Arabic sentences', () => {
    // Without U+2066 … U+2069 a number and its unit after an Arabic letter read `mm 3000` (UBA rule W2), and a
    // version or a shortcut at the start of a sentence takes the wrong end of the line.
    const LTR = /^(height|length|width|depth|elevation|size|version|path|folder|file|slope|shortcut|w|d|h|shaftW|shaftD|carW|carD|angle|azimuth|percent|mb|drawnWidth|drawnHeight|color|range|lumens|limit)$/;
    // A placeholder filled with a fragment that is already isolated (the ramp's ` · 8.3 %`).
    const COMPOSED = new Set<string>(['tools.ramp.next']);
    for (const key of keys) {
      if (COMPOSED.has(key)) continue;
      for (const text of forms(ar[key])) {
        for (const m of text.matchAll(/\{(\w+)\}/g)) {
          if (!LTR.test(m[1]) || text === m[0]) continue;
          const before = text.slice(0, m.index);
          expect(before.lastIndexOf('\u2066') > before.lastIndexOf('\u2069') || before.lastIndexOf('\u2068') > before.lastIndexOf('\u2069'), `${key}: {${m[1]}} is not isolated in "${text}"`).toBe(true);
        }
      }
    }
  });

  it('names every DXF unit, the English as core names it for agents', () => {
    for (const [code, name] of Object.entries(DXF_UNIT_NAMES)) {
      if (code === '0') continue;
      const key = `exchange.import.unit.${code}`;
      expect(isMessageKey(key), key).toBe(true);
      expect(translate('en', key as MessageKey)).toBe(name);
      expect(translate('ar', key as MessageKey)).toMatch(/[؀-ۿ]/);
    }
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
    // English dates and times take the operating system's format, as they did before Arabic.
    expect(intlLocale('en')).toBeUndefined();
    const at = new Date(2026, 10, 17, 14, 5, 3);
    expect(at.toLocaleTimeString(intlLocale('en'))).toBe(at.toLocaleTimeString());
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

  it('take × and ÷ and Arabic-Indic and Persian digits as neutral', () => {
    expect(textDirection('4 × 5 غرفة')).toBe('rtl');
    expect(textDirection('10 ÷ 2 غرف')).toBe('rtl');
    expect(textDirection('× Room')).toBe('ltr');
    expect(textDirection('٣٦٠٠ mm')).toBe('ltr');
    expect(textDirection('۳٫۵ m')).toBe('ltr');
    expect(textDirection('٪٥٠ Room')).toBe('ltr');
    expect(textDirection('٣٦٠٠')).toBe('ltr');
    expect(textDirection('٣٦٠٠', 'rtl')).toBe('rtl');
    expect(textDirection('٣ غرف')).toBe('rtl');
    // Still Arabic script for the PDF writer, which must shape and embed it.
    expect(hasRtl('٣٦٠٠')).toBe(true);
  });

  it('turn Arabic and Persian digits and separators into what the parsers read', () => {
    expect(toLatinDigits('٣٦٠٠')).toBe('3600');
    expect(toLatinDigits('۳٫۵')).toBe('3.5');
    expect(toLatinDigits('١٬٢٥٠٫٥ mm')).toBe('1250.5 mm');
    expect(toLatinDigits('١٠٠،٢٠٠')).toBe('100,200');
    expect(toLatinDigits('3600 mm')).toBe('3600 mm');
  });

  it('read a number typed in either digits', () => {
    expect(parseNumber('٣٢٠')).toBe(320);
    expect(parseNumber(' 25.4 ')).toBe(25.4);
    expect(parseNumber('٢٥٫٤')).toBe(25.4);
    expect(parseNumber('-١٠')).toBe(-10);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('  ')).toBeNaN();
    expect(parseNumber('12px')).toBeNaN();
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

describe('a project name from a sentence', () => {
  const untitled = 'Untitled project';

  it('takes the first clause of an English sentence, as it always did', () => {
    expect(nameFromSentence('A small cabin by the lake, one bedroom and a stove', untitled)).toBe('A small cabin by the lake');
    expect(nameFromSentence('a 5 by 7 m studio with a bathroom in the corner', untitled)).toBe('A 5 by 7 m studio with a bathroom in the corner');
    expect(nameFromSentence('   ', untitled)).toBe(untitled);
    expect(nameFromSentence('. starts with a stop', untitled)).toBe(untitled);
  });

  it('keeps a decimal number whole', () => {
    expect(nameFromSentence('a 3.5 m bathroom. Tiles', untitled)).toBe('A 3.5 m bathroom');
  });

  it('ends an Arabic sentence at its own comma, question mark or full stop', () => {
    expect(nameFromSentence('بيت صغير على البحر، بغرفتي نوم', untitled)).toBe('بيت صغير على البحر');
    expect(nameFromSentence('هل يمكنك رسم شقة؟ مع مطبخ', untitled)).toBe('هل يمكنك رسم شقة');
    expect(nameFromSentence('استوديو بأبعاد 5 في 7 أمتار. مع حمّام', untitled)).toBe('استوديو بأبعاد 5 في 7 أمتار');
    expect(nameFromSentence('مكتب منزلي؛ ونافذة كبيرة', untitled)).toBe('مكتب منزلي');
  });

  it('cuts a long Arabic clause at a word, counting code points', () => {
    const sentence = 'شقة واسعة بثلاث غرف نوم ومطبخ مفتوح على غرفة المعيشة وشرفة تطل على الحديقة الخلفية';
    const name = nameFromSentence(sentence, untitled);
    expect([...name].length).toBeLessThanOrEqual(SENTENCE_NAME_MAX);
    expect(sentence.startsWith(name)).toBe(true);
    // A whole word: the next character of the sentence is a space.
    expect(sentence[name.length]).toBe(' ');
    expect(name).toBe('شقة واسعة بثلاث غرف نوم ومطبخ مفتوح على غرفة');
  });

  it('never cuts a letter from its diacritics, nor keeps direction marks', () => {
    const word = 'مُ'.repeat(30);
    const name = nameFromSentence(word, untitled);
    expect([...name].length).toBeLessThanOrEqual(SENTENCE_NAME_MAX);
    expect(/^\p{M}/u.test(name)).toBe(false);
    expect(/\p{L}$/u.test(name)).toBe(false);
    expect(name.endsWith('مُ')).toBe(true);
    expect(nameFromSentence('\u2067غرفة\u2069 الضيوف', untitled)).toBe('غرفة الضيوف');
  });

  it('capitalises a first letter outside the basic plane whole', () => {
    expect(nameFromSentence('𝑎 tiny hut', untitled).startsWith('𝑎')).toBe(true);
    expect(nameFromSentence('élan house', untitled)).toBe('Élan house');
  });
});

describe('chat blocks', () => {
  it('give every line of a reply its own block, a blank line too, and drop the blank lines at the end', () => {
    const reply = 'أضفت غرفة المعيشة بعرض 3600 mm.\n\nThe Sofa 3 seats fits.\n- الباب\n- النافذة\n\n\n';
    expect(chatBlocks(reply).map(({ text, blank }) => ({ text, blank }))).toEqual([
      { text: 'أضفت غرفة المعيشة بعرض 3600 mm.', blank: false },
      { text: '', blank: true },
      { text: 'The Sofa 3 seats fits.', blank: false },
      { text: '- الباب', blank: false },
      { text: '- النافذة', blank: false },
    ]);
    // Two blank lines are two lines, as a pre-wrap block showed them; a blank line before the text stays.
    expect(chatBlocks('\nOne\n\n\nTwo').map((b) => (b.blank ? '' : b.text))).toEqual(['', 'One', '', '', 'Two']);
    // A line of spaces is a blank line.
    expect(chatBlocks('One\n   \nTwo').map((b) => b.blank)).toEqual([false, true, false]);
    // Joined with newlines, the blocks are the text as written (without its trailing blank lines).
    expect(chatBlocks('One\n\nTwo\n').map((b) => b.text).join('\n')).toBe('One\n\nTwo');
  });

  it('keep a line as written and take no text as no block', () => {
    expect(chatBlocks('  indented  ')).toEqual([{ text: '  indented  ', parts: [{ text: '  indented  ', ltr: false }], blank: false }]);
    expect(chatBlocks('')).toEqual([]);
    expect(chatBlocks('\n\n')).toEqual([]);
    expect(chatBlocks('a\r\nb').map((b) => b.text)).toEqual(['a', 'b']);
  });

  it('make measurements, sizes and ranges left-to-right islands, and leave bare numbers alone', () => {
    const islands = (line: string) => ltrIslands(line).filter((p) => p.ltr).map((p) => p.text);
    expect(islands('أضفت جدارًا بطول 3600 mm وعمق 3 000 mm.')).toEqual(['3600 mm', '3 000 mm']);
    expect(islands('غرفة 4 × 5 m، والقائمة بين 600–650 mm، والزاوية 45° والمساحة 12.5 m²')).toEqual(['4 × 5 m', '600–650 mm', '45°', '12.5 m²']);
    expect(islands('في الطابق 2 ثلاث غرف و 3,5 نوافذ')).toEqual([]);
    expect(islands('The Sofa 3 seats is 2 meters long and 5mm thick')).toEqual(['5mm']);
    expect(islands('٣٦٠٠ mm')).toEqual(['٣٦٠٠ mm']);
    // Three-digit numbers with plain spaces between them stay separate numbers, unless a unit follows the whole run.
    expect(islands('الغرف 101 102 103 في الطابق الأول')).toEqual([]);
    expect(islands('اتصل على 050 123 456')).toEqual([]);
    expect(islands('بطول 12 000 mm')).toEqual(['12 000 mm']);
    // A no-break or thin space groups thousands without a unit.
    expect(islands('المساحة 3 000 والعدد 1 250')).toEqual(['3 000', '1 250']);
    // Joined, the parts are the line: copying the text is unchanged.
    const line = 'بعرض 3000 mm وعمق 3000 mm.';
    expect(ltrIslands(line).map((p) => p.text).join('')).toBe(line);
    expect(ltrIslands('')).toEqual([]);
  });
});
