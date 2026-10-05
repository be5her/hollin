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
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN = new Set<string>(ERROR_CODES);

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** The one error type commands throw. It crosses IPC and MCP as `{ code, message, details? }`. */
export class StudioError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.details = details;
  }

  toJSON(): ErrorPayload {
    return this.details === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, details: this.details };
  }
}

/** Any thrown value as a payload. Errors rebuilt from a payload (the renderer's) keep their code; anything else is INTERNAL. */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof StudioError) return err.toJSON();
  if (err && typeof err === 'object' && typeof (err as ErrorPayload).message === 'string' && KNOWN.has((err as ErrorPayload).code)) {
    const { code, message, details } = err as ErrorPayload;
    return details === undefined ? { code, message } : { code, message, details };
  }
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}
