/** The punctuation keys a shortcut names, by their physical key (`event.code`), as a US layout writes them. */
const PUNCTUATION: Readonly<Record<string, string>> = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', BracketLeft: '[', BracketRight: ']' };

/**
 * The key a shortcut means, whatever the keyboard layout writes. Shortcuts are the Latin letters on the keys
 * (W for a wall, Ctrl+K for the palette, Ctrl+, for Settings). On an Arabic layout the same physical key gives
 * an Arabic letter or sign in `event.key` (W gives ص, K gives ن, the comma key gives و), so when `key` is not a
 * Latin letter the physical key (`event.code`: `KeyW`, `Comma`) names it instead, a letter upper case with Shift
 * as a Latin layout would. Shift on a letter key that writes ASCII punctuation (the Arabic 101 layout's Shift+L
 * writes `/`, Shift+Z `~`) is that letter upper case too: a Latin layout never puts punctuation on Shift+letter
 * except where the letter itself is elsewhere (AZERTY's Shift+M writes `?`, and M is no shortcut there).
 * Latin letters from any layout (AZERTY's A, QWERTZ's Z, Polish ń) and the punctuation a Latin layout writes are
 * taken as they are; digits, named keys and an Arabic-Indic digit are left alone (a digit is typed, not a
 * shortcut). Nothing is remapped while Ctrl and Alt are both held: on Windows that is AltGr, which types a
 * character (ł, €, @), not a shortcut. The plan's editor, the shell's shortcuts and the palette all read keys
 * through it.
 */
export function latinKey(
  e: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey'>>,
): string {
  const { key, code } = e;
  if (/^[A-Za-z]$/.test(key) || !code || (e.ctrlKey && e.altKey)) return key;
  if ([...key].length !== 1 || /^[\p{Nd}\s]$/u.test(key) || /^\p{Script=Latin}$/u.test(key)) return key;
  const letter = /^Key([A-Z])$/.exec(code);
  // ASCII punctuation is taken as written (AZERTY's comma is on QWERTY's M, and it is a comma), except on a
  // shifted letter key, where it is what the Arabic layout puts there instead of the capital.
  if (/^[\x21-\x7e]$/.test(key)) return letter && e.shiftKey ? letter[1] : key;
  // A single character (or a combining mark) of another script on the key.
  if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  return PUNCTUATION[code] ?? key;
}
