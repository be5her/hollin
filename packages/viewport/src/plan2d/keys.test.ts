import { describe, expect, it } from 'vitest';
import { latinKey } from './keys';

describe('latinKey', () => {
  it('keeps Latin letters, digits and named keys as the layout writes them', () => {
    expect(latinKey({ key: 'w', code: 'KeyW' })).toBe('w');
    expect(latinKey({ key: 'W', code: 'KeyW', shiftKey: true })).toBe('W');
    // AZERTY: the A is where QWERTY has Q, and it is an A.
    expect(latinKey({ key: 'a', code: 'KeyQ' })).toBe('a');
    expect(latinKey({ key: 'Enter', code: 'Enter' })).toBe('Enter');
    expect(latinKey({ key: '3', code: 'Digit3' })).toBe('3');
    expect(latinKey({ key: 'w' })).toBe('w');
  });

  it('reads the physical key when an Arabic layout writes an Arabic letter', () => {
    // On the Arabic (101) layout W writes ص, D writes ي, C writes ؤ.
    expect(latinKey({ key: 'ص', code: 'KeyW' })).toBe('w');
    expect(latinKey({ key: 'ي', code: 'KeyD' })).toBe('d');
    expect(latinKey({ key: 'ؤ', code: 'KeyC' })).toBe('c');
    // Shift+S is the stair, whatever Shift+S writes there.
    expect(latinKey({ key: 'َ', code: 'KeyS', shiftKey: true })).toBe('S');
  });

  it('leaves Arabic-Indic digits to be typed', () => {
    expect(latinKey({ key: '٣', code: 'Digit3' })).toBe('٣');
    expect(latinKey({ key: '٣', code: 'KeyE' })).toBe('٣');
  });
});
