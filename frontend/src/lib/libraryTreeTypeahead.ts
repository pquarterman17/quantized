// WAI-ARIA tree type-ahead for the Library tree (U5 follow-up). Pure: a list
// of visible row names, the focused index, the running buffer and a clock
// reading in, the row to focus out. LibraryTree.tsx owns the buffer (a ref)
// and the DOM focus move, as it does for lib/libraryTreeNav.ts's arrows.

/** Keystrokes further apart than this start a new search (APG's ~500 ms). */
export const TYPEAHEAD_RESET_MS = 500;

export interface TypeaheadState {
  /** The characters typed so far in this burst, lower-cased. */
  readonly buffer: string;
  /** Clock reading of the last keystroke (ms). */
  readonly at: number;
}

export const TYPEAHEAD_IDLE: TypeaheadState = { buffer: "", at: Number.NEGATIVE_INFINITY };

/** The type-ahead character a keystroke carries, lower-cased, or null.
 *  Named keys ("Enter", "F2"), Space (the row's select key) and any
 *  Ctrl/Cmd/Alt chord are never type-ahead; nor is "?", which stays the
 *  app-wide keyboard-shortcuts sheet. */
export function typeaheadChar(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if ([...e.key].length !== 1 || e.key === " " || e.key === "?") return null;
  return e.key.toLowerCase();
}

/** First index at or after `start` (wrapping) whose name starts with `prefix`. */
function findFrom(names: readonly string[], start: number, prefix: string): number | null {
  const n = names.length;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (names[i].toLowerCase().startsWith(prefix)) return i;
  }
  return null;
}

/**
 * One type-ahead keystroke `typed` (from `typeaheadChar`; case-insensitive)
 * at clock `now`, with focus on row `index` (-1 when none):
 *   - a burst's first character searches from the NEXT row, wrapping;
 *   - later characters within TYPEAHEAD_RESET_MS extend the prefix and search
 *     from the CURRENT row, so a still-matching row keeps focus;
 *   - one character repeated ("bbb") cycles through rows starting with it.
 * `focusIndex` is null when nothing matches; the state still records the
 * keystroke, so a mistyped burst simply runs out with the timer.
 */
export function typeahead(
  names: readonly string[],
  index: number,
  state: TypeaheadState,
  typed: string,
  now: number,
): { focusIndex: number | null; state: TypeaheadState } {
  const char = typed.toLowerCase();
  const buffer = (now - state.at > TYPEAHEAD_RESET_MS ? "" : state.buffer) + char;
  const next = { buffer, at: now };
  if (names.length === 0) return { focusIndex: null, state: next };
  const repeated = [...buffer].every((c) => c === char);
  const focusIndex = repeated
    ? findFrom(names, index + 1, char)
    : findFrom(names, Math.max(index, 0), buffer);
  return { focusIndex, state: next };
}
