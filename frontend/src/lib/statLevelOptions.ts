// P2.6 per-plot options for how a categorical (box/violin/strip) plot shows its
// level slots — a `PlotView` field (`statLevels`), so it rides the window's
// view through focus switches and round-trips through `.dwk` like every other
// view setting. The slot rule itself lives in `lib/levelSlots.ts`.
//
//  - `hideEmpty` — drop empty level slots (a declared level with no usable
//    rows, a nested combination that never occurs). Default false: an empty
//    level is shown as a labelled `n=0` slot, because silently omitting it is
//    indistinguishable from forgetting it.
//  - `showN` — the per-group `n=K` annotation. Default true (the stage drew it
//    unconditionally before P2.6). `n=0` and the low-n caveat mark are shown
//    either way.

export interface StatLevelOptions {
  hideEmpty: boolean;
  showN: boolean;
}

/** A fresh default, never a shared object (views are copied field by field). */
export const defaultStatLevels = (): StatLevelOptions => ({ hideEmpty: false, showN: true });

/** Per-key fallback for a persisted value: anything that is not the
 *  non-default boolean reads as the default, so a hand-edited or pre-P2.6
 *  `.dwk` (no `statLevels` at all) loads as today's behaviour. */
export function sanitizeStatLevels(v: unknown): StatLevelOptions {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return { hideEmpty: o.hideEmpty === true, showN: o.showN !== false };
}
