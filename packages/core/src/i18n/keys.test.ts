import { describe, expect, it } from 'vitest';
import { latinKey } from './keys';

describe('latinKey', () => {
  it('keeps Latin letters, digits and named keys as the layout writes them', () => {
    expect(latinKey({ key: 'w', code: 'KeyW' })).toBe('w');
    expect(latinKey({ key: 'W', code: 'KeyW', shiftKey: true })).toBe('W');
    // AZERTY: the A is where QWERTY has Q, and it is an A.
    expect(latinKey({ key: 'a', code: 'KeyQ' })).toBe('a');
    expect(latinKey({ key: 'Enter', code: 'Enter' })).toBe('Enter');
    expect(latinKey({ key: 'Tab', code: 'Tab' })).toBe('Tab');
    expect(latinKey({ key: '3', code: 'Digit3' })).toBe('3');
    expect(latinKey({ key: 'w' })).toBe('w');
    expect(latinKey({ key: ',', code: 'Comma' })).toBe(',');
    // A Latin layout's punctuation on another key (AZERTY's comma is on M) is taken as written.
    expect(latinKey({ key: ',', code: 'KeyM' })).toBe(',');
    expect(latinKey({ key: ';', code: 'Comma' })).toBe(';');
  });

  it('reads the physical key when an Arabic layout writes an Arabic letter', () => {
    // On the Arabic (101) layout W writes ص, D writes ي, C writes ؤ, K writes ن, Z writes ئ.
    expect(latinKey({ key: 'ص', code: 'KeyW' })).toBe('w');
    expect(latinKey({ key: 'ي', code: 'KeyD' })).toBe('d');
    expect(latinKey({ key: 'ؤ', code: 'KeyC' })).toBe('c');
    expect(latinKey({ key: 'ن', code: 'KeyK' })).toBe('k');
    expect(latinKey({ key: 'ئ', code: 'KeyZ' })).toBe('z');
    // Shift+S is the stair, whatever Shift+S writes there.
    expect(latinKey({ key: 'َ', code: 'KeyS', shiftKey: true })).toBe('S');
  });

  it('reads the comma key of an Arabic layout as the comma (Ctrl+, opens Settings)', () => {
    expect(latinKey({ key: 'و', code: 'Comma' })).toBe(',');
    expect(latinKey({ key: 'ز', code: 'Period' })).toBe('.');
  });

  it('leaves Arabic-Indic digits to be typed', () => {
    expect(latinKey({ key: '٣', code: 'Digit3' })).toBe('٣');
    expect(latinKey({ key: '٣', code: 'KeyE' })).toBe('٣');
  });
});
