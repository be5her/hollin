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

  it('reads a shifted letter key as its capital where the Arabic (101) layout writes ASCII punctuation', () => {
    // Shift+L writes /, Shift+Z ~, Shift+D ], Shift+F [, Shift+C }, Shift+V { there.
    expect(latinKey({ key: '/', code: 'KeyL', shiftKey: true })).toBe('L');
    expect(latinKey({ key: '~', code: 'KeyZ', shiftKey: true })).toBe('Z');
    expect(latinKey({ key: ']', code: 'KeyD', shiftKey: true })).toBe('D');
    expect(latinKey({ key: '[', code: 'KeyF', shiftKey: true })).toBe('F');
    expect(latinKey({ key: '}', code: 'KeyC', shiftKey: true })).toBe('C');
    expect(latinKey({ key: '{', code: 'KeyV', shiftKey: true })).toBe('V');
    // Ctrl+Shift+Z redoes.
    expect(latinKey({ key: '~', code: 'KeyZ', shiftKey: true, ctrlKey: true })).toBe('Z');
    // Without Shift, a Latin layout's punctuation on a letter key stays (AZERTY's comma on M).
    expect(latinKey({ key: ',', code: 'KeyM' })).toBe(',');
    // Shifted punctuation on a punctuation key stays.
    expect(latinKey({ key: '?', code: 'Slash', shiftKey: true })).toBe('?');
  });

  it('keeps a Latin letter with a diacritic as typed', () => {
    // Polish: ń, ł, ż (AltGr+N, AltGr+L, AltGr+Z); Hungarian ő; Croatian đ.
    expect(latinKey({ key: 'ń', code: 'KeyN' })).toBe('ń');
    expect(latinKey({ key: 'ł', code: 'KeyL' })).toBe('ł');
    expect(latinKey({ key: 'Ż', code: 'KeyZ', shiftKey: true })).toBe('Ż');
    expect(latinKey({ key: 'ő', code: 'BracketLeft' })).toBe('ő');
    expect(latinKey({ key: 'đ', code: 'KeyD' })).toBe('đ');
  });

  it('remaps nothing while Ctrl and Alt are both held (AltGr on Windows)', () => {
    expect(latinKey({ key: 'ń', code: 'KeyN', ctrlKey: true, altKey: true })).toBe('ń');
    expect(latinKey({ key: '€', code: 'KeyE', ctrlKey: true, altKey: true })).toBe('€');
    expect(latinKey({ key: 'ص', code: 'KeyW', ctrlKey: true, altKey: true })).toBe('ص');
    expect(latinKey({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true, shiftKey: true })).toBe('@');
    // Ctrl alone or Alt alone still reads the physical key.
    expect(latinKey({ key: 'ن', code: 'KeyK', ctrlKey: true })).toBe('k');
    expect(latinKey({ key: 'ص', code: 'KeyW', altKey: true })).toBe('w');
  });

  it('leaves Arabic-Indic digits to be typed', () => {
    expect(latinKey({ key: '٣', code: 'Digit3' })).toBe('٣');
    expect(latinKey({ key: '٣', code: 'KeyE' })).toBe('٣');
  });
});
