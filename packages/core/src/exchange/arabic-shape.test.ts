import { describe, expect, it } from 'vitest';
import { arabicVisual, baseDirection, bidiClass, joiningType, presentationBase, shapeArabic, stripBidiControls, visualOrder } from './arabic-shape';

/** Code points as hex, for readable failures. */
const hex = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ');
const cps = (...codes: number[]) => String.fromCodePoint(...codes);
/** A text's presentation forms mapped back to their letters, in the order given. */
const letters = (s: string) => [...s].map((c) => presentationBase(c.codePointAt(0)!)).join('');

describe('shapeArabic', () => {
  it('gives each letter the form its neighbours call for', () => {
    // غرفة المعيشة: ghain initial, reh final, feh initial, teh marbuta final; alef isolated, lam initial, meem, ain, yeh and sheen medial, teh marbuta final.
    expect(hex(shapeArabic('غرفة المعيشة'))).toBe(hex(cps(0xfecf, 0xfeae, 0xfed3, 0xfe94, 0x20, 0xfe8d, 0xfedf, 0xfee4, 0xfecc, 0xfef4, 0xfeb8, 0xfe94)));
    // مطبخ: initial, medial, medial, final.
    expect(hex(shapeArabic('مطبخ'))).toBe(hex(cps(0xfee3, 0xfec4, 0xfe92, 0xfea6)));
    // A letter alone, and letters that join on their right only.
    expect(hex(shapeArabic('ب'))).toBe(hex(cps(0xfe8f)));
    expect(hex(shapeArabic('دار'))).toBe(hex(cps(0xfea9, 0xfe8d, 0xfead)));
    expect(joiningType(0x0628)).toBe('D');
    expect(joiningType(0x0627)).toBe('R');
    expect(joiningType(0x064f)).toBe('T');
    expect(joiningType(0x0640)).toBe('C');
  });

  it('makes lam and alef one ligature, isolated or final', () => {
    expect(hex(shapeArabic('لا'))).toBe(hex(cps(0xfefb)));
    // الأهلي: alef, lam-alef with hamza (isolated: alef does not join forward), heh initial, lam medial, yeh final.
    expect(hex(shapeArabic('الأهلي'))).toBe(hex(cps(0xfe8d, 0xfef7, 0xfeeb, 0xfee0, 0xfef2)));
    // After a letter that joins forward: the final ligature.
    expect(hex(shapeArabic('سلام'))).toBe(hex(cps(0xfeb3, 0xfefc, 0xfee1)));
    expect(presentationBase(0xfefb)).toBe('لا');
    expect(presentationBase(0xfef7)).toBe('لأ');
  });

  it('keeps marks on their letter without breaking the join', () => {
    // غُرفة: the damma stays after the ghain, which still joins the reh.
    expect(hex(shapeArabic('غُرفة'))).toBe(hex(cps(0xfecf, 0x064f, 0xfeae, 0xfed3, 0xfe94)));
    // لَا: the fatha on the lam follows the ligature.
    expect(hex(shapeArabic('لَا'))).toBe(hex(cps(0xfefb, 0x064e)));
    // Tatweel joins on both sides; ZWNJ breaks a join.
    expect(hex(shapeArabic('بـب'))).toBe(hex(cps(0xfe91, 0x0640, 0xfe90)));
    expect(hex(shapeArabic('ب‌ب'))).toBe(hex(cps(0xfe8f, 0x200c, 0xfe8f)));
  });

  it('leaves Latin, digits and letters without forms as they are, and maps back to the letters', () => {
    expect(shapeArabic('Room 12')).toBe('Room 12');
    expect(letters(shapeArabic('غرفة المعيشة'))).toBe('غرفة المعيشة');
    expect(letters(shapeArabic('الأهلي'))).toBe('الأهلي');
    // Persian letters through Presentation Forms-A.
    expect(hex(shapeArabic('پل'))).toBe(hex(cps(0xfb58, 0xfede)));
  });

  it('joins letters without presentation forms by their Unicode joining type', () => {
    // Keheh with two dots (U+063B) and ng (U+06AD) are dual-joining: the beh before takes its initial form, the one after its final.
    expect(hex(shapeArabic(cps(0x0628, 0x063b, 0x0628)))).toBe(hex(cps(0xfe91, 0x063b, 0xfe90)));
    expect(hex(shapeArabic(cps(0x0628, 0x06ad, 0x0628)))).toBe(hex(cps(0xfe91, 0x06ad, 0xfe90)));
    // Kashmiri yeh (U+0620) and dotless beh (U+066E) too.
    expect(hex(shapeArabic(cps(0x0628, 0x0620, 0x0628)))).toBe(hex(cps(0xfe91, 0x0620, 0xfe90)));
    expect(hex(shapeArabic(cps(0x0628, 0x066e)))).toBe(hex(cps(0xfe91, 0x066e)));
    // Oe (U+06C6) joins on its right only: the beh after it starts again.
    expect(hex(shapeArabic(cps(0x0628, 0x06c6, 0x0628)))).toBe(hex(cps(0xfe91, 0x06c6, 0xfe8f)));
    expect([0x063b, 0x063f, 0x066f, 0x06ad, 0x06fa].map(joiningType)).toEqual(['D', 'D', 'D', 'D', 'D']);
    expect([0x06c6, 0x06c8, 0x06ee, 0x0673].map(joiningType)).toEqual(['R', 'R', 'R', 'R']);
    // The number signs and the end of ayah are format characters that do not join; a mark is transparent.
    expect([0x0600, 0x06dd, 0x0674, 0x06d4].map(joiningType)).toEqual(['U', 'U', 'U', 'U']);
    expect([0x064e, 0x0670, 0x061c].map(joiningType)).toEqual(['T', 'T', 'T']);
  });

  it('shapes and orders a very long text without overflowing the stack', () => {
    const long = 'غرفة المعيشة '.repeat(20000);
    expect(() => arabicVisual(long)).not.toThrow();
    expect([...shapeArabic(long)].length).toBe([...long].length);
    expect([...visualOrder(long)].length).toBe([...long].length);
  });
});

describe('visualOrder', () => {
  it('reverses a right-to-left line', () => {
    const shaped = shapeArabic('غرفة المعيشة');
    expect(hex(arabicVisual('غرفة المعيشة'))).toBe(hex([...shaped].reverse().join('')));
    expect(letters([...arabicVisual('الأهلي')].reverse().join(''))).toBe('الأهلي');
  });

  it('keeps digits and Latin words left to right inside it', () => {
    // مطبخ 2: the number at the visual left, before the reversed word.
    expect(hex(arabicVisual('مطبخ 2'))).toBe(hex('2 ' + [...shapeArabic('مطبخ')].reverse().join('')));
    expect(hex(arabicVisual('مطبخ 12'))).toBe(hex('12 ' + [...shapeArabic('مطبخ')].reverse().join('')));
    // A Latin word inside Arabic stays readable.
    const mixed = arabicVisual('غرفة Kitchen كبيرة');
    expect(mixed).toContain('Kitchen');
    expect(mixed.indexOf('Kitchen')).toBeGreaterThan(0);
  });

  it('reads a measurement 3600 mm, never mm 3600', () => {
    const v = arabicVisual('الطابق الأرضي · 3600 mm');
    expect(v.startsWith('3600 mm · ')).toBe(true);
    expect(hex(v.slice('3600 mm · '.length))).toBe(hex([...shapeArabic('الطابق الأرضي')].reverse().join('')));
    expect(arabicVisual('مساحة 12.5 m²').startsWith('12.5 m² ')).toBe(true);
  });

  it('puts a left-to-right line with an Arabic word in order', () => {
    expect(hex(arabicVisual('Bedroom غرفة'))).toBe(hex('Bedroom ' + [...shapeArabic('غرفة')].reverse().join('')));
    expect(baseDirection('Bedroom غرفة')).toBe('ltr');
    expect(baseDirection('غرفة Bedroom')).toBe('rtl');
  });

  it('mirrors brackets in a right-to-left run', () => {
    expect(hex(arabicVisual('(مخزن)'))).toBe(hex('(' + [...shapeArabic('مخزن')].reverse().join('') + ')'));
    expect(hex(arabicVisual('مخزن [2]'))).toBe(hex('[2] ' + [...shapeArabic('مخزن')].reverse().join('')));
  });

  it('keeps a mark after its letter, which the face draws it over', () => {
    // غُرفة reversed letter by letter, the damma still following the ghain.
    expect(hex(arabicVisual('غُرفة'))).toBe(hex(cps(0xfe94, 0xfed3, 0xfeae, 0xfecf, 0x064f)));
  });

  it('honours isolates and never prints a bidi control', () => {
    // The not-enclosed sentence of the Arabic interface: a Latin name isolated, the sentence right to left.
    const v = visualOrder(shapeArabic('⁨Kitchen⁩ · غير مغلقة'));
    expect(baseDirection('⁨Kitchen⁩ · غير مغلقة')).toBe('rtl');
    expect(v.endsWith(' · Kitchen')).toBe(true);
    expect(/[‎‏‪-‮⁦-⁩]/.test(v)).toBe(false);
    // A name ending in a number keeps it with the name.
    const room = visualOrder(shapeArabic('⁨Room 2⁩ · غير مغلقة'));
    expect(room.endsWith(' · Room 2')).toBe(true);
    expect(visualOrder('a‎b‪c')).toBe('abc');
    expect(stripBidiControls('⁦x⁩‏')).toBe('x');
  });

  it('classifies characters as the bidi algorithm does', () => {
    expect(bidiClass('A'.codePointAt(0)!)).toBe('L');
    expect(bidiClass(0x0628)).toBe('AL');
    expect(bidiClass(0xfefb)).toBe('AL');
    expect(bidiClass(0x05d0)).toBe('R');
    expect(bidiClass('7'.codePointAt(0)!)).toBe('EN');
    expect(bidiClass(0x0663)).toBe('AN');
    expect(bidiClass(0x064e)).toBe('NSM');
    expect(bidiClass(' '.codePointAt(0)!)).toBe('WS');
    expect(bidiClass('('.codePointAt(0)!)).toBe('ON');
    expect(bidiClass(0x2066)).toBe('BN');
  });

  it('leaves a left-to-right text without right-to-left letters as it is', () => {
    expect(visualOrder('Ground floor · 3600 mm')).toBe('Ground floor · 3600 mm');
    expect(visualOrder('(a) [b]')).toBe('(a) [b]');
  });
});
