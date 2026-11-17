/**
 * The letter a shortcut means, whatever the keyboard layout writes. The plan's shortcuts are the Latin
 * letters on the keys (W for a wall, Ctrl+C to copy). On an Arabic layout the same physical key gives an
 * Arabic letter in `event.key` (W gives ص), so when `key` is not a Latin letter the physical key
 * (`event.code`, `KeyW`) names it instead, upper case with Shift as a Latin layout would. Latin letters
 * from any layout (AZERTY's A, QWERTZ's Z) are taken as they are, and digits and other keys are left
 * alone: an Arabic-Indic digit is typed, not a shortcut.
 */
export function latinKey(e: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code' | 'shiftKey'>>): string {
  const { key, code } = e;
  if (/^[A-Za-z]$/.test(key) || !code) return key;
  const physical = /^Key([A-Z])$/.exec(code);
  // A single character (or a combining mark) that is not a Latin letter or a digit: a letter of another script on a letter key.
  if (!physical || [...key].length !== 1 || /^[\p{Nd}\s]$/u.test(key)) return key;
  return e.shiftKey ? physical[1] : physical[1].toLowerCase();
}
