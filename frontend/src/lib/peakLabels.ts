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
// units.
const BASE_OFFSET_FRAC = 0.05; // label sits this far above the apex (fraction of y-range)
const TIER_STEP_FRAC = 0.055; // additional stagger per collision tier
const CHAR_FRACTION = 0.014; // x-range fraction "consumed" by one label character
const MAX_TIER_OFFSET = 8; // aesthetic cap on how far tiers stack; never needed for correctness

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
  const avgLen = Math.max(
    1,
    labels.slice(0, n).reduce((sum, l) => sum + l.length, 0) / n,
  );
  const threshold = Math.max(xUnit * CHAR_FRACTION * avgLen, xUnit * 1e-6);

  // Tier assignment runs on an x-sorted working copy (ties broken by
  // original index for a stable sort) so it always sweeps left-to-right
  // regardless of the caller's input order; `tierOf[i]` maps back to the
  // ORIGINAL index so the returned array lines up with `points`/`labels`.
  const order = points.slice(0, n).map((pt, i) => ({ i, x: pt.x }));
  order.sort((a, b) => a.x - b.x || a.i - b.i);

  const tierOf = new Array<number>(n);
  const lastXAtTier: number[] = [];
  for (const pt of order) {
    let tier = 0;
    for (; tier < lastXAtTier.length; tier++) {
      if (pt.x - lastXAtTier[tier] >= threshold) break;
    }
    if (tier === lastXAtTier.length) lastXAtTier.push(pt.x);
    else lastXAtTier[tier] = pt.x;
    tierOf[pt.i] = tier;
  }

  const out: LabelPlacement[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const pt = points[i];
    const offsetFrac = BASE_OFFSET_FRAC + Math.min(tierOf[i], MAX_TIER_OFFSET) * TIER_STEP_FRAC;
    out[i] = { x: pt.x, y: pt.y + offsetFrac * yUnit };
  }
  return out;
}
