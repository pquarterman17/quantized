// The generation rules half of lib/autosaveGenerations.ts (bundle diet slice
// 32): how many to keep, rotation, age and size caps, and which one to restore.
// Only the lazy autosave engine (lib/autosaveCore.ts) calls them, so they ship
// with it; lib/autosaveGenerations.ts re-exports them with `export *`.

import type { Generation } from "./autosaveGenerations";

/** How many generations to retain. Three covers the realistic recovery story
 *  (the bad save, the one before it, and one more) without turning autosave
 *  into an unbounded archive — #32 explicitly wants recovery storage bounded. */
export const MAX_GENERATIONS = 3;

/** How long a generation stays worth offering for recovery. 30 days covers
 *  "I opened this after a long trip" without autosave quietly becoming a
 *  permanent archive of every project ever opened (P1.2 box "bounded autosave
 *  generations by count/age/total size" — count is `MAX_GENERATIONS` above,
 *  size is `capBySize` below; this is the third bound). Generous next to the
 *  count cap: in practice `MAX_GENERATIONS` prunes first on an active
 *  project, and this mostly matters for a project nobody has reopened in a
 *  long while. */
export const MAX_GENERATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Add `next` as the newest generation, dropping the oldest beyond the cap.
 *
 *  Newest-first ordering is the invariant every other function here relies on.
 *  `existing` is SORTED first: a backend hands generations back in its own
 *  order (IndexedDB's `getAll` is oldest-first by key), and slicing that
 *  unsorted kept the OLDEST recovery points and dropped the newer ones.
 *  `next` itself is ALWAYS kept, ahead of the rest whatever its `at`: after
 *  the clock steps backwards, sorting it in with the others sliced off the
 *  save being written while health still said "saved" (review N4).
 *  Returns a new array — callers persist the result. */
export function rotate(
  existing: readonly Generation[],
  next: Generation,
  max = MAX_GENERATIONS,
): Generation[] {
  return [next, ...newestFirst(existing)].slice(0, Math.max(1, max));
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

/** Drop generations older than `maxAgeMs` relative to `now`, ALWAYS keeping at
 *  least the newest one — same "never evict the most recent good generation"
 *  guarantee `capBySize` makes below, on the age axis instead of the byte
 *  axis. `now` is caller-supplied (never `Date.now()` read in here) for the
 *  same reproducibility reason `Generation.at` itself is caller-supplied. */
export function capByAge(
  generations: readonly Generation[],
  now: number,
  maxAgeMs: number = MAX_GENERATION_AGE_MS,
): Generation[] {
  const ordered = newestFirst(generations);
  return ordered.filter((gen, i) => i === 0 || now - gen.at <= maxAgeMs);
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
