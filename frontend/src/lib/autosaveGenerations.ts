// Autosave generation bookkeeping (MAIN_PLAN #32) — the PURE half.
//
// Autosave used to be one localStorage slot: a single generation, overwritten
// in place, on a store whose own header warned that a large library "can exceed
// the ~5 MB quota". That is one bad write away from losing the work, and it
// gives a user nothing to fall back TO. This module owns the rules for keeping
// several rotating generations and picking which one to restore.
//
// It is deliberately storage-agnostic and side-effect free: every decision that
// can be wrong is testable without IndexedDB, which jsdom does not implement.
// The adapter that actually touches a browser store lives in
// ./autosaveBackend.ts and is kept as thin as possible for that reason.

/** One saved snapshot: the serialized `.dwk` text plus when it was written. */
export interface Generation {
  /** Epoch ms. Supplied by the caller — this module never reads the clock, so
   *  its behaviour is reproducible in tests. */
  at: number;
  /** `serializeWorkspace` output. */
  text: string;
}

/** How many generations to retain. Three covers the realistic recovery story
 *  (the bad save, the one before it, and one more) without turning autosave
 *  into an unbounded archive — #32 explicitly wants recovery storage bounded. */
export const MAX_GENERATIONS = 3;

/** Add `next` as the newest generation, dropping the oldest beyond the cap.
 *
 *  Newest-first ordering is the invariant every other function here relies on.
 *  Returns a new array — callers persist the result. */
export function rotate(
  existing: readonly Generation[],
  next: Generation,
  max = MAX_GENERATIONS,
): Generation[] {
  return [next, ...existing].slice(0, Math.max(1, max));
}

/** Pick the generation to restore, newest first, skipping any that fail
 *  `isValid`.
 *
 *  This is the entire point of keeping more than one: a corrupt or truncated
 *  newest generation must not block startup OR silently restore nothing when an
 *  older, perfectly good snapshot is sitting right behind it. Returns null only
 *  when every generation is unusable. */
export function pickRestorable(
  generations: readonly Generation[],
  isValid: (text: string) => boolean,
): Generation | null {
  for (const gen of newestFirst(generations)) {
    if (isValid(gen.text)) return gen;
  }
  return null;
}

/** Defensive ordering: a store could hand back generations in any order (a
 *  future backend, a hand-edited slot), and every rule here is defined in terms
 *  of "newest". Sorting on read costs nothing at these sizes. */
export function newestFirst(generations: readonly Generation[]): Generation[] {
  return [...generations].sort((a, b) => b.at - a.at);
}

/** Total serialized bytes held across all generations — what a size cap and the
 *  health readout are computed from. Uses UTF-16 code units (`length`), which
 *  is what a browser quota actually counts for stored strings. */
export function totalSize(generations: readonly Generation[]): number {
  return generations.reduce((sum, g) => sum + g.text.length, 0);
}

/** Drop the oldest generations until the set fits `maxBytes`, ALWAYS keeping at
 *  least the newest one.
 *
 *  Keeping the newest even when it alone exceeds the budget is deliberate: a
 *  user with one very large project is better served by a snapshot that might
 *  fail to write than by silently having no autosave at all. The write path
 *  reports that failure rather than this function hiding it. */
export function capBySize(generations: readonly Generation[], maxBytes: number): Generation[] {
  const ordered = newestFirst(generations);
  const kept: Generation[] = [];
  let used = 0;
  for (const gen of ordered) {
    if (kept.length > 0 && used + gen.text.length > maxBytes) break;
    kept.push(gen);
    used += gen.text.length;
  }
  return kept;
}

/** Autosave health, surfaced in the UI so a failing save is visible rather than
 *  a status line that scrolls away (#32: the old code DID warn, but only once
 *  and only transiently). */
export interface AutosaveHealth {
  /** Epoch ms of the last successful write; null = nothing saved yet. */
  savedAt: number | null;
  /** Why the last attempt failed; null = healthy. Persisting until the next
   *  SUCCESS is the point — this is the "actionable error" the plan asks for. */
  error: string | null;
  /** Generations currently retained. */
  count: number;
}

export const HEALTHY: AutosaveHealth = { savedAt: null, error: null, count: 0 };
