/**
 * What Otto changed on the plan in the last minute (`design/identity/03-otto.md` §c): the host keeps the
 * edits, the renderer draws a halo, end nodes and one tag for them. Pure timing and wording here, so
 * the tests need no canvas.
 */

/** One edit by Otto (a batch is one edit), with the entities and connectors it added or changed. */
export interface PlanHighlight {
  /** The undo entry it came from: undo removes it, redo brings it back with its age. */
  txId: string;
  ids: readonly string[];
  /** The batch's label, or the command's title for a single call. */
  label: string;
  /** When the edit landed, in ms since the epoch. */
  at: number;
  /** When your next edit began removing it (a 200 ms ease-out), if it has. */
  clearedAt?: number;
}

/** The halo holds this long at full strength... */
export const HIGHLIGHT_HOLD_MS = 45_000;
/** ...then fades out over this, and is gone a minute after the edit. */
export const HIGHLIGHT_FADE_MS = 15_000;
export const HIGHLIGHT_LIFE_MS = HIGHLIGHT_HOLD_MS + HIGHLIGHT_FADE_MS;
/** How long your next edit takes to remove the marks. */
export const HIGHLIGHT_CLEAR_MS = 200;

/**
 * How strongly an edit's marks are drawn now, 0 to 1: full for 45 s, then a linear fade to 0 at 60 s;
 * a removal by your next edit eases out over 200 ms. Under reduced motion both are cuts: full until
 * the minute is up (or the edit), then nothing.
 */
export function highlightOpacity(h: Pick<PlanHighlight, 'at' | 'clearedAt'>, now: number, reducedMotion = false): number {
  const age = now - h.at;
  if (age >= HIGHLIGHT_LIFE_MS) return 0;
  let base = age <= HIGHLIGHT_HOLD_MS || reducedMotion ? 1 : 1 - (age - HIGHLIGHT_HOLD_MS) / HIGHLIGHT_FADE_MS;
  if (h.clearedAt !== undefined) {
    if (reducedMotion) return 0;
    const t = Math.min(1, Math.max(0, (now - h.clearedAt) / HIGHLIGHT_CLEAR_MS));
    // Ease-out: fast at first, gentle at the end.
    base *= 1 - (1 - (1 - t) * (1 - t));
  }
  return Math.max(0, Math.min(1, base));
}

/** Whether a highlight's opacity is changing now (a fade or a removal), so the host keeps drawing frames. */
export function highlightAnimating(h: Pick<PlanHighlight, 'at' | 'clearedAt'>, now: number, reducedMotion = false): boolean {
  if (reducedMotion) return false;
  if (h.clearedAt !== undefined) return now - h.clearedAt < HIGHLIGHT_CLEAR_MS;
  const age = now - h.at;
  return age > HIGHLIGHT_HOLD_MS && age < HIGHLIGHT_LIFE_MS;
}

/** "now" under 10 s, then "20 s ago", then "1 min ago". */
export function highlightAge(ageMs: number): string {
  if (ageMs < 10_000) return 'now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 10_000) * 10} s ago`;
  return `${Math.floor(ageMs / 60_000)} min ago`;
}

/** The tag's words: `Otto · <label, cut at 36 characters> · <age>`. */
export function highlightTag(label: string, ageMs: number): string {
  const clean = label.trim() || 'an edit';
  const cut = clean.length > 36 ? `${clean.slice(0, 35).trimEnd()}…` : clean;
  return `Otto · ${cut} · ${highlightAge(ageMs)}`;
}
