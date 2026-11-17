/**
 * The forms of a counted message, chosen by `Intl.PluralRules` from `params.count`. English uses
 * `one` and `other`; Arabic all six (0, 1, 2, 3 to 10, 11 to 99, the rest).
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A catalog entry: a text with `{name}` placeholders, or its plural forms. */
export type Message = string | PluralForms;

export type MessageParams = Record<string, string | number>;
