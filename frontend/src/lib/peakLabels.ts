// Pure "Label peaks" support (UX-R6 beta half —
// plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md's UX-R6 status note): token
// template rendering + collision-aware initial placement for turning
// fitted/detected peaks into ordinary Annotation objects. Deliberately has
// NO React, NO uPlot, and NO store import (MY RULING 6) — `AxisScale` below
// is a TYPE-only import (erased at build time, no runtime dependency) — so
// both functions are unit-testable in total isolation. The only caller is
// components/workshops/peaks/usePeaks.ts, which supplies the peaks, reads
// the plot's own data ranges (+ `st.yScale`), and folds the resulting
// `addAnnotation` calls into one `withHistoryBatch` entry. This module
// never mutates anything it is handed and never touches the store.

import type { AxisScale } from "./types";

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

/** A finite, positive width for a `[lo, hi]` (already-ascending — see
 *  `ascending` below) range — falls back to `1` for a degenerate range
 *  (zero width, or non-finite bounds) so every downstream fraction-of-range
 *  computation stays finite. */
function finiteWidth(range: readonly [number, number]): number {
  const w = range[1] - range[0];
  return Number.isFinite(w) && w > 0 ? w : 1;
}

/** O2 review finding, round 5: normalize a `[a, b]` range to ascending
 *  order at the function boundary. `finiteWidth`/`inRange`/the whole
 *  placement search assume `range[0] <= range[1]`; a DESCENDING range is
 *  reachable in practice (`useApp.ts` sets `yLim: [fig.y_from, fig.y_to]`
 *  from an Origin figure apply verbatim, with no min/max normalization, so
 *  a reversed Origin Y axis produces a descending `yLim`) and used to
 *  collapse every label onto the same wrong y. A reversed AXIS is a
 *  DISPLAY concern (which end points "up") — this placement math should
 *  never have to reason about it. */
function ascending(range: readonly [number, number]): [number, number] {
  return range[0] <= range[1] ? [range[0], range[1]] : [range[1], range[0]];
}

/** O3 review finding, round 5: the forward/backward transform for one
 *  y-axis scale kind, so offsets can be computed as a sensible VISUAL
 *  distance on that scale rather than always-linear data units. `fwd`
 *  degrades to `NaN` for a value outside the scale's domain (non-positive,
 *  for log/reciprocal — the SAME domain restriction `lib/uplotOpts.ts`'s
 *  `reciprocalTransform` already documents) so a caller can detect it and
 *  fall back to plain linear math for that one point, rather than
 *  propagating `NaN`/`-Infinity` into the result. "reciprocal" is handled
 *  explicitly here (not silently treated as linear): it shares log's
 *  positive-only domain and the SAME "transform, offset, invert" shape, via
 *  `1/v` (self-inverse, matching `reciprocalTransform`'s own math) rather
 *  than `log10`. */
function yTransform(kind: AxisScale): { fwd: (v: number) => number; bwd: (t: number) => number } {
  switch (kind) {
    case "log":
      return { fwd: (v) => (v > 0 ? Math.log10(v) : NaN), bwd: (t) => Math.pow(10, t) };
    case "reciprocal":
      return { fwd: (v) => (v > 0 ? 1 / v : NaN), bwd: (t) => (Number.isFinite(t) && t !== 0 ? 1 / t : NaN) };
    default:
      return { fwd: (v) => v, bwd: (t) => t };
  }
}

/** Collision-aware initial placement for a batch of peak labels (MY RULING
 *  6). Pure and deterministic: identical inputs always produce identical
 *  outputs, no randomness, no DOM/canvas text measurement.
 *
 *  `points` are the peaks' (x, y) apexes; `labels` are their
 *  ALREADY-RENDERED text (see `renderLabelTemplate`) — only each label's
 *  LENGTH feeds placement, never its content. `xRange`/`yRange` are the
 *  plot's own visible data ranges (not necessarily the peaks' bounding
 *  box, and normalized to ascending regardless of input order — O2, round
 *  5), so placement stays sane even when the peaks being labeled cluster
 *  in one corner of a much wider plot. `yScale` (O3, round 5) is the y-axis
 *  kind (`st.yScale` in the store) offsets are computed in — default
 *  `"linear"`.
 *
 *  THE CONTRACT (round 5 — the authoritative statement of what this
 *  function promises; earlier doc revisions implied guarantees the code
 *  could not actually hold and were corrected by three straight rounds of
 *  one placement fix breaking another):
 *
 *  A label belongs to its peak — placement anchors to the PEAK'S OWN APEX,
 *  never to the window edge.
 *   1. Offsets are a FRACTION OF THE VISIBLE RANGE (so a zoomed-in view
 *      gets visually sensible spacing) but are always applied RELATIVE TO
 *      EACH PEAK'S OWN APEX.
 *   2. An apex INSIDE `yRange`: its label is GUARANTEED inside `yRange`
 *      too — try above the apex; if above would leave the range, flip
 *      below (round 4's mechanism, kept). If every tier in both directions
 *      is exhausted (capacity and range both genuinely full at once — rare)
 *      the fallback is the APEX'S OWN position, trivially inside the range
 *      by hypothesis — never a clamp to the edge.
 *   3. An apex OUTSIDE `yRange`: its label is placed relative to THAT APEX
 *      anyway and may be off-screen. It is NEVER pinned/clamped to the
 *      window edge — a label is a durable annotation carrying an absolute
 *      data position; clamping it to a transient zoom edge would write a
 *      WRONG permanent coordinate that survives zooming back out.
 *      Off-screen-but-correct beats on-screen-but-wrong.
 *   4. NO clamp is ever applied AFTER collision resolution — any bound
 *      that must hold participates IN the search itself (as an acceptance
 *      test on each candidate), never post-processes the chosen result.
 *      (A post-hoc clamp is exactly what caused round 4's own regression:
 *      it fed a boundary-clamped value back into later collision checks,
 *      collapsing two different apexes onto one identical y.)
 *   5. Collision-freedom is guaranteed only among labels placed in the SAME
 *      REGION (in-range vs. off-range, and — informally — the visible
 *      cluster a peak's apex sits in): up to `MAX_STACK_TIERS + 1` labels
 *      (currently 10) sharing one dense, same-side cluster are guaranteed
 *      distinct/non-overlapping; beyond that, capacity is genuinely
 *      exhausted and extra labels pile deterministically onto the last
 *      tier tried (may overlap each other there) rather than searching
 *      forever.
 *
 *  BOX GEOMETRY (N2, round 4): each box is `[x, x+w) × [y, y+boxH)` —
 *  left-aligned extending right, up-from-anchor extending up — matching
 *  `lib/uplotOverlays.ts`'s actual draw geometry
 *  (`annotationLayout`/`clampAnnotationLabelX`), not a symmetric
 *  centered/half-extent-sum box (which under-counts a wide label followed
 *  by a narrow one). `boxH` stays computed in LINEAR data units even on a
 *  log/reciprocal `yScale` (a deliberate simplification, not a silent gap:
 *  collision geometry, unlike the OFFSET itself, has no test requiring
 *  log-space accuracy, and mixing per-point transformed/untransformed
 *  comparison spaces would add real complexity for no asked-for behavior).
 *  The renderer's small constant pixel offsets (`+6`/`-2`) have no
 *  data-space equivalent without the live pixels-per-data-unit scale this
 *  pure function deliberately doesn't take.
 *
 *  Returns one `{x, y}` per label, in the SAME ORDER as `points`/`labels`
 *  (result[i] corresponds to points[i]/labels[i]) — collision resolution
 *  sorts an internal working copy by x (RULING 6: "ordering is stable (sort
 *  by x)"); the input/output arrays the caller sees are never reordered.
 *
 *  Degenerate inputs never produce NaN/Infinity: a zero-width or
 *  descending range, every peak sharing one x, a single peak, or a
 *  non-positive apex on a log/reciprocal scale (falls back to plain linear
 *  offset math for that one point) all fall back to finite behavior.
 */
export function placeLabels(
  points: readonly LabelPoint[],
  labels: readonly string[],
  xRangeIn: readonly [number, number],
  yRangeIn: readonly [number, number],
  yScale: AxisScale = "linear",
): LabelPlacement[] {
  const n = Math.min(points.length, labels.length);
  if (n === 0) return [];

  const xRange = ascending(xRangeIn);
  const yRange = ascending(yRangeIn);

  const xUnit = finiteWidth(xRange);
  const yUnit = finiteWidth(yRange); // LINEAR width — box geometry + the linear-fallback offset both use this
  const boxH = TIER_STEP_FRAC * yUnit; // N2: rendered text height, extends UPWARD from its own anchor

  // O3: the y-range's own width in TRANSFORMED space, when the whole range
  // transforms cleanly (both bounds positive for log/reciprocal). `null`
  // means "use plain linear offsets for every point" — either `yScale` is
  // `"linear"` (fwd/bwd are the identity, so this reduces to the exact
  // linear math below) or the range itself doesn't transform. `yDir`
  // matters because `fwd` is NOT always increasing with `v`: log10 is, but
  // reciprocal (`1/v`) is DECREASING — larger data-y means SMALLER
  // transformed-t — so "add a positive offset in transformed space" would
  // silently move a candidate DOWN in data space for a reciprocal scale
  // unless the offset's sign is flipped to match which direction "up"
  // (larger data-y) actually points in transformed space.
  const { fwd, bwd } = yTransform(yScale);
  const yLoT = fwd(yRange[0]);
  const yHiT = fwd(yRange[1]);
  const yTransformable = Number.isFinite(yLoT) && Number.isFinite(yHiT) && yHiT !== yLoT;
  const yUnitT = yTransformable ? Math.abs(yHiT - yLoT) : null;
  const yDir = yTransformable && yHiT < yLoT ? -1 : 1;

  // Tier assignment runs on an x-sorted working copy (ties broken by
  // original index for a stable sort) so it always sweeps left-to-right
  // regardless of the caller's input order; `i` maps back to the ORIGINAL
  // index so the returned array lines up with `points`/`labels`. Each
  // candidate's own box width comes from ITS OWN label length (not an
  // average across the batch), and is a FULL width (N2), not a half-width
  // to be summed with the other box's.
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
  // — NOT a symmetric half-extent-sum comparison.
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
    const apexT = fwd(pt.y);
    const useLogOffset = yUnitT != null && Number.isFinite(apexT);

    // One tier's {up, down} candidate y, in TRANSFORMED space when this
    // point's apex transforms cleanly (O3), else plain linear (O1's
    // contract point 1: always relative to THIS peak's own apex).
    const candidateAt = (tier: number): { up: number; down: number } => {
      if (useLogOffset) {
        const offT = yDir * (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * (yUnitT as number);
        const up = bwd(apexT + offT); // toward larger DATA y, whichever transformed direction that is
        const down = bwd(apexT - offT);
        if (Number.isFinite(up) && Number.isFinite(down)) return { up, down };
        // bwd degenerated (e.g. reciprocal's t===0) — fall through to linear.
      }
      const off = (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yUnit;
      return { up: pt.y + off, down: pt.y - off };
    };

    const hasCollision = (x: number, y: number, w: number): boolean =>
      placedBoxes.some((b) => boxesOverlap(x, y, w, b.x, b.y, b.w));

    let chosen: number | null = null;
    let lastTried = candidateAt(0).up;

    if (inRange(pt.y)) {
      // CONTRACT 2: apex inside `yRange` — the label is guaranteed inside
      // it too. Up preferred; flip to down only when up would leave the
      // range (never merely because a tier is occupied — that's the
      // ordinary capacity search). NO post-hoc clamp (contract 4): the
      // exhaustion fallback below is the apex's OWN position.
      for (let tier = 0; tier <= MAX_STACK_TIERS && chosen === null; tier++) {
        const { up, down } = candidateAt(tier);
        if (inRange(up)) {
          lastTried = up;
          if (!hasCollision(pt.x, up, pt.w)) chosen = up;
          continue; // in range but occupied — next tier's UP, not down
        }
        if (inRange(down)) {
          lastTried = down;
          if (!hasCollision(pt.x, down, pt.w)) chosen = down;
        }
      }
      out[pt.i] = { x: pt.x, y: chosen ?? pt.y }; // exhausted -> the apex itself (trivially in range)
    } else {
      // CONTRACT 3: apex outside `yRange` — placed relative to that apex
      // regardless, MAY be off-screen, and is NEVER pinned to the window
      // edge (no `inRange` requirement here at all — only collision
      // avoidance, per contract 5's "same region" scoping).
      for (let tier = 0; tier <= MAX_STACK_TIERS && chosen === null; tier++) {
        const { up, down } = candidateAt(tier);
        lastTried = up;
        if (!hasCollision(pt.x, up, pt.w)) chosen = up;
        else {
          lastTried = down;
          if (!hasCollision(pt.x, down, pt.w)) chosen = down;
        }
      }
      out[pt.i] = { x: pt.x, y: chosen ?? lastTried }; // exhausted -> last candidate tried, never clamped
    }
    placedBoxes.push({ x: pt.x, y: out[pt.i].y, w: pt.w });
  }
  return out;
}
