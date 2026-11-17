import { ENGLISH_PHRASE, commandTitle, currentLanguage, phraseText, translate, type Language, type Phrase } from './i18n';

export const ERROR_CODES = [
  'UNKNOWN_COMMAND',
  /** A project-scope command ran with no open project. */
  'NO_PROJECT',
  'INVALID_INPUT',
  'NOT_FOUND',
  /** A mutating command was refused for an MCP caller because the user has not allowed mutations. */
  'MUTATION_BLOCKED',
  /** The user declined the confirmation the in-app assistant asked for. */
  'MUTATION_DECLINED',
  /** The target changed since the caller last saw it, or the request clashes with the current state. */
  'CONFLICT',
  /** A file was written by a newer version of the app and cannot be opened safely. */
  'UNSUPPORTED_VERSION',
  /** The host cannot do this right now, e.g. a snapshot with no window to draw it. */
  'UNAVAILABLE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN = new Set<string>(ERROR_CODES);

export interface ErrorPayload {
  code: ErrorCode;
  /** The English message: what agents read (MCP, the assistant's model), and what the English interface shows. */
  message: string;
  details?: unknown;
  /**
   * The message as a phrase (a catalog key with its parameters), for the interface to show in its
   * language. Carried across IPC to the renderer; never sent to agents (`agentPayload`).
   */
  i18n?: Phrase;
}

/**
 * The one error type commands throw. It crosses IPC as `{ code, message, details?, i18n? }` and MCP as
 * `{ code, message, details? }`. An error a person can meet through the interface is thrown with a
 * `Phrase` (`new StudioError('NOT_FOUND', { key: 'errors.…', params })`): its English `message` is made
 * from the English catalog, so it reads exactly as it did, and the phrase rides along as `i18n`.
 */
export class StudioError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly i18n?: Phrase;

  constructor(code: ErrorCode, message: string | Phrase, details?: unknown, i18n?: Phrase) {
    super(typeof message === 'string' ? message : phraseText(message, ENGLISH_PHRASE));
    this.name = 'StudioError';
    this.code = code;
    this.details = details;
    const phrase = typeof message === 'string' ? i18n : message;
    if (phrase) this.i18n = phrase;
  }

  /** An error rebuilt from a payload (the renderer's, from IPC), keeping its English message as it came. */
  static fromPayload(payload: ErrorPayload): StudioError {
    return new StudioError(payload.code, payload.message, payload.details, payload.i18n);
  }

  toJSON(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.i18n ? { i18n: this.i18n } : {}),
    };
  }
}

/** Any thrown value as a payload. Errors rebuilt from a payload (the renderer's) keep their code; anything else is INTERNAL. */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof StudioError) return err.toJSON();
  if (err && typeof err === 'object' && typeof (err as ErrorPayload).message === 'string' && KNOWN.has((err as ErrorPayload).code)) {
    const { code, message, details, i18n } = err as ErrorPayload;
    return { code, message, ...(details === undefined ? {} : { details }), ...(i18n ? { i18n } : {}) };
  }
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}

/** A payload as agents read it (MCP, the assistant's model): the English message, without the interface's phrase. */
export function agentPayload(payload: ErrorPayload): ErrorPayload {
  const { i18n: _shown, ...rest } = payload;
  return rest;
}

/** Wraps a parameter between Unicode isolates. */
const isolate = (text: string) => `\u2066${text}\u2069`;

/**
 * What a person reads of an error in `language`. English shows the message as it is. Another language
 * shows the error's phrase translated when it carries one, else a translated lead for its code with the
 * English message as `detail` (to be shown left to right). Lengths in an error are written in millimetres.
 */
export function errorText(err: unknown, language: Language = currentLanguage()): { text: string; detail?: string } {
  const payload = toErrorPayload(err);
  if (language === 'en') return { text: payload.message };
  const tr = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(language, key, params);
  if (payload.i18n) return { text: phraseText(payload.i18n, { translate: tr, length: ENGLISH_PHRASE.length, command: (c) => commandTitle(c, language) }) };
  return { text: tr(`errors.code.${payload.code}`), detail: payload.message };
}

/** `errorText` as one line, for a place with room for a single string: the lead, then the English detail isolated left to right. */
export function errorLine(err: unknown, language: Language = currentLanguage()): string {
  const { text, detail } = errorText(err, language);
  return detail ? `${text} ${isolate(detail)}` : text;
}
