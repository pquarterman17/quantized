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
 *  plot's own visible data ranges (not necessarily the peaks' bounding
 *  box), so placement stays sane even when the peaks being labeled cluster
 *  in one corner of a much wider plot.
 *
 *  BOX GEOMETRY (N2 review finding, round 4): approximates
 *  `lib/uplotOverlays.ts`'s ACTUAL draw geometry
 *  (`annotationLayout`/`clampAnnotationLabelX`) rather than an arbitrary
 *  centered box — the renderer left-aligns text AT the anchor (extending
 *  RIGHT by its full measured width, never split half-and-half around the
 *  anchor) and draws it UPWARD from the anchor (`ty = py - 2`, glyphs above
 *  their baseline), never centered vertically either. An earlier symmetric
 *  half-width-sum test under-counted a wide label followed by a narrow one:
 *  only the LEADING label's own width determines how far right it reaches,
 *  never an average of both, so a gap between `(wa+wb)/2` and `wa` used to
 *  read as clear while visually overlapping. Each box here is therefore
 *  `[x, x+w) × [y, y+boxH)` — real 1-D interval overlap on each axis, not a
 *  symmetric extent-sum comparison. (The renderer's small constant pixel
 *  offsets — `+6` horizontal, `-2` vertical — have no data-space
 *  equivalent without knowing the live pixels-per-data-unit scale, which
 *  this pure function deliberately does not take; they're negligible next
 *  to real label text at any non-trivial zoom, and `CHAR_FRACTION` is
 *  already a tuned approximation, not a measurement.)
 *
 *  THE HONEST GUARANTEE (M1 review finding): a fixed plot area cannot hold
 *  unlimited non-overlapping labels. Up to `MAX_STACK_TIERS + 1` labels
 *  (currently 10) sharing one dense cluster, WITH ROOM ON AT LEAST ONE SIDE
 *  of their apex, are guaranteed distinct and non-overlapping — see the
 *  UP-OR-DOWN behavior below for what "room" means. Beyond that, capacity
 *  is genuinely exhausted — the tier search stops rather than searching
 *  forever, so EXTRA labels deterministically pile onto the last tier tried
 *  (and may overlap each other there) instead of either overlapping
 *  unpredictably or running off the plot. This is the "least-bad"
 *  placement: predictable, reproducible, and always within `yRange`.
 *
 *  UP-OR-DOWN (N1 review finding, round 4, CORRECTED RULING replacing round
 *  3's M2 fix): the round-3 fix clamped an over-tall stack's y onto
 *  `yRange`'s own top with `if (y > yRange[1]) y = yRange[1]` — but that
 *  clamp ran AFTER tier resolution and fed the CLAMPED value back into
 *  future collision checks, so two DIFFERENT apex heights whose
 *  up-candidates both exceeded the range both collapsed onto the exact
 *  same clamped y, becoming visually indistinguishable — verified by
 *  execution, and NOT a hypothetical: since `yRange` is typically the data's
 *  own range, the TALLEST peak's apex always equals `yRange[1]`, so this
 *  fired on every real dataset (an XRD Kα1/Kα2 doublet on the strongest
 *  reflection drew both labels on top of each other — the canonical use
 *  case of this whole feature). Fixed: UP (`apex + offset`) is still tried
 *  FIRST at every tier — a label that fits above keeps today's placement.
 *  Only when the up-candidate would exceed `yRange` (or collides) does the
 *  search flip to DOWN (`apex - offset`) at that SAME tier, running it
 *  through the identical collision check against `yRange`'s bottom instead
 *  — never a post-hoc clamp. If NEITHER direction at ANY tier both fits
 *  and clears every placed box (capacity and range genuinely exhausted at
 *  once — rare), the last up-candidate tried is clamped into `yRange` as
 *  an absolute last resort, same "least-bad, deterministic" spirit as the
 *  capacity-exhaustion case above.
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
  const boxH = TIER_STEP_FRAC * yUnit; // N2: rendered text height, extends UPWARD from its own anchor

  // Tier assignment runs on an x-sorted working copy (ties broken by
  // original index for a stable sort) so it always sweeps left-to-right
  // regardless of the caller's input order; `i` maps back to the ORIGINAL
  // index so the returned array lines up with `points`/`labels`. Each
  // candidate's own box width comes from ITS OWN label length (not an
  // average across the batch — a long label next to short ones needs a
  // wider clearance than a short one does), and is a FULL width (N2 — see
  // the doc above), not a half-width to be summed with the other box's.
  const order = points.slice(0, n).map((pt, i) => ({
    i,
    x: pt.x,
    y: pt.y,
    w: xUnit * CHAR_FRACTION * Math.max(1, labels[i].length),
  }));
  order.sort((a, b) => a.x - b.x || a.i - b.i);

  // Round-3 M1 hardening, still needed: two tiers exactly one step apart
  // don't always subtract to EXACTLY one tier step —
  // `(BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yUnit` for consecutive
  // integer tiers can differ by 549.999999999995 instead of 550 from
  // ordinary float rounding, and a naive strict `<` treated that as a real
  // collision, silently wasting a tier. Additive epsilons (scaled to each
  // axis's own unit, not a relative multiplier — safe regardless of sign)
  // shrink both interval edges before comparing, absorbing that rounding
  // regardless of which way it falls, on EITHER axis.
  const xEps = xUnit * 1e-9;
  const yEps = yUnit * 1e-9;
  // N2: true left-aligned/up-from-anchor 1-D interval overlap on each axis
  // — NOT a symmetric half-extent-sum comparison (see the doc above for
  // why that under-counts a wide-then-narrow pair).
  const boxesOverlap = (
    ax: number, ay: number, aw: number,
    bx: number, by: number, bw: number,
  ): boolean =>
    ax + xEps < bx + bw - xEps && bx + xEps < ax + aw - xEps &&
    ay + yEps < by + boxH - yEps && by + yEps < ay + boxH - yEps;

  const inRange = (y: number): boolean => y >= yRange[0] && y <= yRange[1];

  const placedBoxes: { x: number; y: number; w: number }[] = [];
  const out: LabelPlacement[] = new Array(n);
  for (const pt of order) {
    let chosen: number | null = null;
    let lastTried = pt.y + BASE_OFFSET_FRAC * yUnit; // fallback if every tier/direction below is exhausted
    for (let tier = 0; tier <= MAX_STACK_TIERS && chosen === null; tier++) {
      const offset = (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yUnit;
      const upY = pt.y + offset;
      // N1: UP is the preferred direction. While it stays IN RANGE, a
      // collision only advances to the NEXT TIER'S up candidate (never
      // flips direction merely because a tier is occupied — that's the
      // ordinary capacity search, unchanged from before) — a label that
      // fits above keeps today's upward placement.
      if (inRange(upY)) {
        lastTried = upY;
        if (!placedBoxes.some((b) => boxesOverlap(pt.x, upY, pt.w, b.x, b.y, b.w))) {
          chosen = upY;
          break;
        }
        continue; // in range but occupied — try the NEXT TIER'S up, not down
      }
      // N1 CORRECTED RULING: up would exceed `yRange` — NOW flip to DOWN
      // (this same tier) and run it through the identical collision check,
      // rather than clamping the up-candidate onto the boundary (which
      // silently destroyed the collision guarantee above — see the doc).
      const downY = pt.y - offset;
      lastTried = downY;
      if (inRange(downY) && !placedBoxes.some((b) => boxesOverlap(pt.x, downY, pt.w, b.x, b.y, b.w))) {
        chosen = downY;
        break;
      }
    }
    // Last-resort fallback: capacity AND range both genuinely exhausted in
    // both directions at once (rare) — clamp the last candidate tried into
    // `yRange` so this never produces NaN or a wildly off-range value, same
    // "least-bad, deterministic" spirit as the capacity-exhaustion pile-up
    // above.
    const y = chosen ?? Math.min(yRange[1], Math.max(yRange[0], lastTried));
    placedBoxes.push({ x: pt.x, y, w: pt.w });
    out[pt.i] = { x: pt.x, y };
  }
  return out;
}
