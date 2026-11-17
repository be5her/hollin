/** The punctuation keys a shortcut names, by their physical key (`event.code`), as a US layout writes them. */
const PUNCTUATION: Readonly<Record<string, string>> = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', BracketLeft: '[', BracketRight: ']' };

/**
 * The key a shortcut means, whatever the keyboard layout writes. Shortcuts are the Latin letters on the keys
 * (W for a wall, Ctrl+K for the palette, Ctrl+, for Settings). On an Arabic layout the same physical key gives
 * an Arabic letter or sign in `event.key` (W gives ص, K gives ن, the comma key gives و), so when `key` is not a
 * Latin letter the physical key (`event.code`: `KeyW`, `Comma`) names it instead, a letter upper case with Shift
 * as a Latin layout would. Latin letters from any layout (AZERTY's A, QWERTZ's Z) and the punctuation a Latin
 * layout writes are taken as they are; digits, named keys and an Arabic-Indic digit are left alone (a digit is
 * typed, not a shortcut). The plan's editor, the shell's shortcuts and the palette all read keys through it.
 */
export function latinKey(e: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code' | 'shiftKey'>>): string {
  const { key, code } = e;
  if (/^[A-Za-z]$/.test(key) || !code) return key;
  // A single character (or a combining mark) that is not a Latin letter, a digit, a space or the punctuation a
  // Latin layout writes (AZERTY's comma is on QWERTY's M, and it is a comma): another script's sign on the key.
  if ([...key].length !== 1 || /^[\p{Nd}\s]$/u.test(key) || /^[\x21-\x7e]$/.test(key)) return key;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  return PUNCTUATION[code] ?? key;
}
