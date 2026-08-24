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
 *  label. */
export function renderLabelTemplate(
  template: string,
  peak: LabelSourcePeak,
  index: number,
  precision: number,
): string {
  const p = Math.max(0, Math.trunc(Number.isFinite(precision) ? precision : 0));
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
// label's box and assert the NO-OVERLAP invariant directly, rather than
// trusting internal tier bookkeeping (L6 review finding).
export const BASE_OFFSET_FRAC = 0.05; // label sits this far above the apex (fraction of y-range)
export const TIER_STEP_FRAC = 0.055; // one tier's vertical box height (fraction of y-range)
export const CHAR_FRACTION = 0.014; // x-range fraction "consumed" by one label character
const MAX_TIER_OFFSET = 24; // hard cap on collision-avoidance attempts; prevents an unbounded loop on pathological input, never needed for well-formed input

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
 *  a candidate tier is accepted only once its box clears EVERY box placed so
 *  far — bumping the tier (capped at `MAX_TIER_OFFSET`) until it does.
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

  const placedBoxes: { x: number; y: number; halfW: number }[] = [];
  const out: LabelPlacement[] = new Array(n);
  for (const pt of order) {
    let y = pt.y + BASE_OFFSET_FRAC * yUnit;
    for (let tier = 0; tier <= MAX_TIER_OFFSET; tier++) {
      y = pt.y + (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yUnit;
      // `<=` (not `<`): two boxes exactly touching still count as a
      // collision, so tiers never end up flush against one another.
      const collides = placedBoxes.some(
        (b) => Math.abs(pt.x - b.x) <= pt.halfW + b.halfW && Math.abs(y - b.y) <= yHalf + yHalf,
      );
      if (!collides) break;
    }
    placedBoxes.push({ x: pt.x, y, halfW: pt.halfW });
    out[pt.i] = { x: pt.x, y };
  }
  return out;
}
