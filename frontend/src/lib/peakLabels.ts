// Pure "Label peaks" support (UX-R6 beta half —
// plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md's UX-R6 status note): token
// template rendering + collision-aware initial placement for turning
// fitted/detected peaks into ordinary Annotation objects. Deliberately has
// NO React, NO uPlot, and NO store import (MY RULING 6) so both functions
// are unit-testable in total isolation — the only caller is
// components/workshops/peaks/usePeaks.ts, which supplies the peaks, reads
// the plot's own data ranges, and folds the resulting `addAnnotation` calls
// into one `withHistoryBatch` entry. This module never mutates anything it
// is handed and never touches the store.

/** The peak fields the token template reads. A local structural shape
 *  (not `Peak`/`FittedPeak` from lib/types.ts) so this module stays free of
 *  every other layer's types — either peak shape satisfies it as-is. */
export interface LabelSourcePeak {
  center: number;
  height: number;
  fwhm: number;
  area: number | null;
}

const TOKEN_RE = /\{(\w+)\}/g;

/** Default template (MY RULING 5): center at the current precision. */
export const DEFAULT_LABEL_TEMPLATE = "{center}";

/** Render one peak's label text from a token template. RULING 5: tokens are
 *  limited to fields that ACTUALLY EXIST on `Peak`/`FittedPeak` today —
 *  `{center}`, `{height}`, `{fwhm}`, `{area}`, `{index}` (1-based) — plus
 *  literal text. quantized has NO phase/`(hkl)` indexing data source yet, so
 *  this deliberately does NOT invent, infer, or fabricate one; a future
 *  `{phase}`/`{hkl}` token slots into the same `switch` the day real
 *  indexing data exists (tracked in the UX-R6 status note). An UNKNOWN token
 *  — including `{phase}`/`{hkl}` today — renders LITERALLY (the `{...}` text
 *  passes through unchanged) rather than throwing, so a stale or
 *  forward-looking template degrades visibly instead of breaking the whole
 *  label.
 *
 *  `precision` is clamped to `[0, 100]` HERE (M5 review finding), not just
 *  at the call site — `Number.prototype.toFixed` throws `RangeError` above
 *  100, and this is an EXPORTED pure helper: any future caller gets the
 *  same defense in depth `usePeaks.ts`'s own (tighter, UX-motivated) `[0,
 *  10]` clamp layers on top of, not a guard this function merely assumes
 *  someone else already applied. */
export function renderLabelTemplate(
  template: string,
  peak: LabelSourcePeak,
  index: number,
  precision: number,
): string {
  const p = Math.min(100, Math.max(0, Math.trunc(Number.isFinite(precision) ? precision : 0)));
  const fmt = (v: number | null): string =>
    v == null || !Number.isFinite(v) ? "" : v.toFixed(p);
  return template.replace(TOKEN_RE, (whole: string, token: string) => {
    switch (token) {
      case "center":
        return fmt(peak.center);
      case "height":
        return fmt(peak.height);
      case "fwhm":
        return fmt(peak.fwhm);
      case "area":
        return fmt(peak.area);
      case "index":
        return String(index + 1);
      default:
        return whole; // unknown token (e.g. a not-yet-real {phase}/{hkl}) -> literal
    }
  });
}

export interface LabelPoint {
  x: number;
  y: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
}

// Tuning constants for the placement heuristic below — all expressed as
// FRACTIONS of the supplied range, so the layout scales with whatever plot
// the caller is placing labels on rather than being pinned to absolute data
// units. Exported (not just internal) so tests can independently compute a
// label's box (and the derived tier capacity below) and assert the
// NO-OVERLAP / stays-in-range invariants directly, rather than trusting
// internal tier bookkeeping (L6/M1/M2 review findings).
export const BASE_OFFSET_FRAC = 0.05; // label sits this far above the apex (fraction of y-range)
export const TIER_STEP_FRAC = 0.055; // one tier's vertical box height (fraction of y-range)
export const CHAR_FRACTION = 0.014; // x-range fraction "consumed" by one label character
// M2 review finding: a stack of labels must never climb higher than this
// fraction of the y-range above its apex, or it runs off the top of the
// plotted view — an annotation the user can then only find again through
// the Object Manager. `MAX_STACK_TIERS` (derived from it, not hardcoded) is
// ALSO the no-overlap capacity M1 asks this doc to state honestly: with the
// current tuning constants that floors to 9, i.e. up to 10 labels
// (tiers 0..9) sharing one dense cluster are guaranteed distinct/
// non-overlapping; a cluster past that pile onto tier 9 and MAY overlap
// each other — see `placeLabels`'s own doc.
export const MAX_STACK_FRAC = 0.6;
export const MAX_STACK_TIERS = Math.max(0, Math.floor((MAX_STACK_FRAC - BASE_OFFSET_FRAC) / TIER_STEP_FRAC));

/** A finite, positive width for a `[lo, hi]` range — falls back to `1` for a
 *  degenerate range (zero/negative width, or non-finite bounds) so every
 *  downstream fraction-of-range computation stays finite. */
function finiteWidth(range: readonly [number, number]): number {
  const w = range[1] - range[0];
  return Number.isFinite(w) && w > 0 ? w : 1;
}

/** Collision-aware initial placement for a batch of peak labels (MY RULING
 *  6). Pure and deterministic: identical inputs always produce identical
 *  outputs, no randomness, no DOM/canvas text measurement.
 *
 *  `points` are the peaks' (x, y) apexes; `labels` are their
 *  ALREADY-RENDERED text (see `renderLabelTemplate`) — only each label's
 *  LENGTH feeds placement, never its content. `xRange`/`yRange` are the
 *  plot's own data ranges (not necessarily the peaks' bounding box), so
 *  placement stays sane even when the peaks being labeled cluster in one
 *  corner of a much wider plot.
 *
 *  L6 review finding: an earlier version compared candidate tiers by X ONLY
 *  and then offset each label relative to its OWN apex y — two neighbours
 *  whose apex heights happened to differ by about one tier step could land
 *  at the SAME absolute y despite getting different tier numbers. Placement
 *  is now genuinely 2-D: each already-placed label owns an axis-aligned box
 *  (half-width from ITS OWN rendered length, half-height one tier step), and
 *  a candidate tier is accepted only once its box clears EVERY box placed
 *  so far — bumping the tier until it does.
 *
 *  THE HONEST GUARANTEE (M1 review finding, replacing an earlier version of
 *  this doc that implied unconditional no-overlap, which the code could
 *  not actually hold): a fixed plot area cannot hold unlimited
 *  non-overlapping labels. Up to `MAX_STACK_TIERS + 1` labels (currently
 *  10) sharing one dense cluster are guaranteed distinct and
 *  non-overlapping. Beyond that, capacity is genuinely exhausted — the
 *  tier search stops at `MAX_STACK_TIERS` rather than searching forever,
 *  so EXTRA labels deterministically pile onto that last tier (and may
 *  overlap each other there) instead of either overlapping unpredictably
 *  or running off the plot. This is the "least-bad" placement: predictable,
 *  reproducible, and — see M2 next — never off-plot.
 *
 *  M2 review finding: stacked offsets are bounded to `MAX_STACK_FRAC` of
 *  the y-range above each apex (which is what makes `MAX_STACK_TIERS`
 *  above the no-overlap capacity in the first place) — a label can no
 *  longer climb arbitrarily high and run off the top of the plotted view.
 *  A final clamp to `yRange`'s own upper bound is an additional backstop
 *  for the case an apex itself is already at/above the top of the caller's
 *  own `yRange` (a range that doesn't actually bound its own peaks) — belt
 *  and braces, never relied on for the common case above.
 *
 *  Returns one `{x, y}` per label, in the SAME ORDER as `points`/`labels`
 *  (result[i] corresponds to points[i]/labels[i]) — collision resolution
 *  sorts an internal working copy by x (RULING 6: "ordering is stable (sort
 *  by x)"); the input/output arrays the caller sees are never reordered.
 *
 *  Degenerate inputs never produce NaN/Infinity: a zero-width range, every
 *  peak sharing one x, or a single peak all fall back to finite constants
 *  (see `finiteWidth`) instead of dividing by zero.
 */
export function placeLabels(
  points: readonly LabelPoint[],
  labels: readonly string[],
  xRange: readonly [number, number],
  yRange: readonly [number, number],
): LabelPlacement[] {
  const n = Math.min(points.length, labels.length);
  if (n === 0) return [];

  const xUnit = finiteWidth(xRange);
  const yUnit = finiteWidth(yRange);
  const yHalf = (TIER_STEP_FRAC * yUnit) / 2;

  // Tier assignment runs on an x-sorted working copy (ties broken by
  // original index for a stable sort) so it always sweeps left-to-right
  // regardless of the caller's input order; `i` maps back to the ORIGINAL
  // index so the returned array lines up with `points`/`labels`. Each
  // candidate's own box half-width comes from ITS OWN label length (not an
  // average across the batch — L6: a long label next to short ones needs a
  // wider clearance than a short one does).
  const order = points.slice(0, n).map((pt, i) => ({
    i,
    x: pt.x,
    y: pt.y,
    halfW: (xUnit * CHAR_FRACTION * Math.max(1, labels[i].length)) / 2,
  }));
  order.sort((a, b) => a.x - b.x || a.i - b.i);

  // M1 hardening (found while writing this round's OWN capacity test): two
  // tiers exactly one step apart don't always subtract to EXACTLY one tier
  // step — `(BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yUnit` for
  // consecutive integer tiers can differ by 549.999999999995 instead of
  // 550 from ordinary float rounding, and a naive strict `<` treated that
  // as a real collision, silently wasting a tier. A relative epsilon
  // shrinks the collision threshold by a fraction far smaller than any
  // visual difference but comfortably larger than accumulated float error,
  // so an intended EXACT-boundary (touching) pair reads as "not colliding"
  // regardless of which way the rounding fell.
  const BOUNDARY_EPS = 1e-9;
  const placedBoxes: { x: number; y: number; halfW: number }[] = [];
  const out: LabelPlacement[] = new Array(n);
  for (const pt of order) {
    let y = pt.y + BASE_OFFSET_FRAC * yUnit;
    for (let tier = 0; tier <= MAX_STACK_TIERS; tier++) {
      y = pt.y + (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yUnit;
      // M1: strict `<` (with `BOUNDARY_EPS` above) — two boxes exactly ONE
      // tier step apart (touching, not overlapping) no longer collide. The
      // earlier `<=` here made every label consume TWO tiers of vertical
      // room instead of one, roughly halving how many labels a cluster
      // could hold before capacity (`MAX_STACK_TIERS`) was exhausted.
      const collides = placedBoxes.some(
        (b) =>
          Math.abs(pt.x - b.x) < (pt.halfW + b.halfW) * (1 - BOUNDARY_EPS) &&
          Math.abs(y - b.y) < (yHalf + yHalf) * (1 - BOUNDARY_EPS),
      );
      if (!collides) break;
      // M1: capacity genuinely exhausted at `tier === MAX_STACK_TIERS` —
      // stop searching (the loop condition ends it) rather than pushing
      // the box further up regardless of collisions; `y` stays at this
      // last-tried tier, deterministically piling onto whatever already
      // occupies it.
    }
    // M2 backstop: even the capped stack must never exceed the caller's
    // OWN y-range — covers an apex that is itself already at/above
    // `yRange`'s top (see the doc above).
    if (y > yRange[1]) y = yRange[1];
    placedBoxes.push({ x: pt.x, y, halfW: pt.halfW });
    out[pt.i] = { x: pt.x, y };
  }
  return out;
}
