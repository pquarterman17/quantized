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
/** `tMustBePositive` (round 6, P1+P2 hardening): `reciprocal`'s domain is
 *  `t > 0` STRICTLY (`fwd(v) = 1/v` for `v > 0` never produces a
 *  non-positive `t`) — a candidate `t` that crosses to the OTHER side of
 *  the `1/v` pole (positive apex, negative candidate, or vice versa) is
 *  still `Number.isFinite` (only `t === 0` itself is not), so a bare
 *  finite-check let a wrong-signed, wrong-magnitude candidate through: the
 *  confirmed repro was an apex at `y:500` landing its label at `y:-21.05`.
 *  `log`'s range is EVERY real `t` (`10**t` is finite and positive for any
 *  finite `t` — no pole at all), so this stays `false` there. */
function yTransform(
  kind: AxisScale,
): { fwd: (v: number) => number; bwd: (t: number) => number; tMustBePositive: boolean } {
  switch (kind) {
    case "log":
      return { fwd: (v) => (v > 0 ? Math.log10(v) : NaN), bwd: (t) => Math.pow(10, t), tMustBePositive: false };
    case "reciprocal":
      return {
        fwd: (v) => (v > 0 ? 1 / v : NaN),
        bwd: (t) => (Number.isFinite(t) && t !== 0 ? 1 / t : NaN),
        tMustBePositive: true,
      };
    default:
      return { fwd: (v) => v, bwd: (t) => t, tMustBePositive: false };
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
 *  ONE SPACE, ROOT-CAUSE FIX (P1+P2, round 6; corrected to NORMALIZED
 *  POSITION space by Q1, round 7): the O3/N1 implementations computed
 *  OFFSETS in transformed space but immediately converted each candidate
 *  back to data space before the collision box height, the range bounds,
 *  and the acceptance tests — all still linear — ever saw it. Round 6 fixed
 *  that split by moving everything into raw TRANSFORMED (`t = fwd(v)`)
 *  space, but that reintroduced a different bug: round 6 added a `yDir`
 *  sign-flip on the premise that `1/v` is a DECREASING transform, so
 *  "toward larger data-y" must mean "toward smaller t." That premise is
 *  true of the raw transform but wrong for what a label's y actually needs
 *  to track — SCREEN/NORMALIZED position, which is what uPlot itself
 *  renders (`lib/uplotOpts.ts`'s reciprocal-scale comment: `pct = (fwd(val)
 *  - fwd(scaleMin)) / (fwd(scaleMax) - fwd(scaleMin))` is affine in `fwd`
 *  and its numerator/denominator flip sign TOGETHER for a decreasing
 *  transform, so `pct` "stays correctly monotonic... same left-to-right
 *  [i.e. low-to-high] ordering as linear/log" even though `1/v` itself
 *  decreases). Round 6's `yDir` flip inverted an already-correct direction:
 *  a reciprocal apex at `y:500` on `yRange:[1,100]` landed its label at
 *  `y:19.41` — positive and finite, so round 6's OWN pole guard passed
 *  clean, but still BELOW the apex it names, the wrong direction entirely
 *  (confirmed: apex 50 -> 14.39, apex 20 -> 10.05, both below).
 *
 *  THE FIX (Q1, round 7): do ALL geometry in NORMALIZED POSITION `p`, not
 *  raw transformed `t`. `p = (fwd(v) - fwd(lo)) / (fwd(hi) - fwd(lo))` for
 *  `[lo, hi] = yRange` — the SAME affine-in-`fwd` quantity uPlot computes to
 *  place a pixel. `p` is 0 at `yRange[0]`, 1 at `yRange[1]`, and — critically
 *  — MONOTONICALLY INCREASING IN DATA VALUE FOR EVERY SCALE KIND, reciprocal
 *  included, for exactly the cancellation reason above. "Above" is therefore
 *  unambiguously "larger `p`" everywhere, with NO per-scale sign logic that
 *  could get it backwards — `yDir` is deleted, not patched. A fraction-of-
 *  range offset (`BASE_OFFSET_FRAC`/`TIER_STEP_FRAC`) is now used DIRECTLY
 *  as a `p`-space delta (no `*yWidthT` rescale needed — the `p`-space width
 *  of the whole range is exactly `1` by construction). Pole safety still
 *  applies and is still an acceptance test, never a post-hoc clamp: a
 *  candidate `p` extrapolated far enough beyond `[0, 1]` can still
 *  denormalize to a transformed value on the wrong side of `1/v`'s pole
 *  (`denormT(p) <= 0`) even though `p` itself is an ordinary finite number —
 *  `inDomainP` checks the DENORMALIZED value before `bwd` is ever called on
 *  it (contract point 4 below still holds).
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
 *      distinct/non-overlapping — INCLUDING on a log/reciprocal scale,
 *      since the P1+P2 fix means tier capacity is no longer distorted by
 *      comparing log-spaced offsets against a linear-spaced box height.
 *      Beyond capacity, extra labels pile deterministically onto the last
 *      tier tried (may overlap each other there) rather than searching
 *      forever.
 *
 *  BOX GEOMETRY (N2, round 4; now computed in the SAME normalized-position
 *  space as everything else — P1+P2/Q1, rounds 6-7): each box is
 *  `[x, x+w) × [p, p+boxH)` — left-aligned extending right (x stays plain
 *  linear/data-space; there is no x-axis scale in this feature), up-from-
 *  anchor extending toward larger `p` (unambiguously "up" for every scale
 *  kind — see the FIX note above) — matching `lib/uplotOverlays.ts`'s
 *  actual draw geometry (`annotationLayout`/`clampAnnotationLabelX`) in
 *  spirit, not a symmetric centered/half-extent-sum box (which under-counts
 *  a wide label followed by a narrow one). The renderer's small constant
 *  pixel offsets (`+6`/`-2`) have no data-space equivalent without the live
 *  pixels-per-data-unit scale this pure function deliberately doesn't take.
 *
 *  Returns one `{x, y}` per label, in the SAME ORDER as `points`/`labels`
 *  (result[i] corresponds to points[i]/labels[i]) — collision resolution
 *  sorts an internal working copy by x (RULING 6: "ordering is stable (sort
 *  by x)"); the input/output arrays the caller sees are never reordered.
 *
 *  Degenerate inputs never produce NaN/Infinity: a zero-width or
 *  descending range, every peak sharing one x, a single peak, a range that
 *  doesn't transform for the given `yScale` (falls back to a plain linear
 *  0..1 normalization over `yRange` for the WHOLE call, never partially),
 *  or an individual apex outside the scale's own domain (e.g. non-positive
 *  on log — clamped to `p = 0`, the range's own floor, still fully in
 *  normalized-position space, never a linear-space fallback mixed into the
 *  same search) all resolve
 *  to finite behavior.
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

  // Q1 (round 7): ONE working NORMALIZED-POSITION space for the ENTIRE
  // call. `pFwd`/`denormT`/`pBwd` degrade to a plain linear 0..1
  // normalization over `yRange` when the scale doesn't transform cleanly
  // for `yScale` (both bounds finite and distinct once transformed via raw
  // `fwd`) — the WHOLE search then runs in that fallback space, never a
  // per-point mix. `p = 0` is always `yRange[0]`, `p = 1` is always
  // `yRange[1]`, for EVERY scale kind — no `yDir` sign logic needed or
  // possible, since `p` is monotonically increasing in data value by
  // construction (see the doc above).
  const { fwd, bwd, tMustBePositive } = yTransform(yScale);
  const loT = fwd(yRange[0]);
  const hiT = fwd(yRange[1]);
  const spanT = hiT - loT;
  const yTransformable = Number.isFinite(loT) && Number.isFinite(hiT) && spanT !== 0;
  // `p` is a NORMALIZED position only in the transformable branch (`p = 0`
  // at `yRange[0]`, `p = 1` at `yRange[1]`, by construction). In the
  // fallback branch `p` is literally the DATA value itself (identity) —
  // NOT re-normalized to `[0, 1]` — because a genuinely ZERO-WIDTH `yRange`
  // (e.g. `[7, 7]`) must reject EVERY offset, landing only the apex's own
  // position; normalizing a zero-width range to a fake `[0, 1]` would
  // manufacture headroom that doesn't exist in the real data range (a
  // regression caught by this file's own M2/O1 zero-width-range tests).
  // `offsetScale` is where the "fraction of range" tuning constants
  // (`BASE_OFFSET_FRAC`/`TIER_STEP_FRAC`) get their units: exactly `1` when
  // transformable (the whole point of normalizing — a fraction IS already
  // a `p`-space delta), or the range's own (fallback-safe) DATA width
  // otherwise — matching round 6's `yWidthT`, which served this identical
  // purpose in the untransformable branch.
  const yWidth = finiteWidth(yRange);
  const pFwd = yTransformable
    ? (v: number): number => (fwd(v) - loT) / spanT
    : (v: number): number => v;
  // The DENORMALIZED transformed value a candidate `p` maps to —
  // `loT + p * spanT` when transformable, otherwise `p` itself (identity,
  // since `p` already IS the data value in the fallback branch). This is
  // what a domain check and `bwd` must see, not the normalized `p` alone.
  const denormT = (p: number): number => (yTransformable ? loT + p * spanT : p);
  const pBwd = (p: number): number => (yTransformable ? bwd(denormT(p)) : p);
  // A candidate `p` must denormalize into the transform's own DOMAIN, not
  // merely `pBwd`-finite — see `yTransform`'s `tMustBePositive` doc for why
  // a bare finite-check let a pole-crossing candidate through for
  // `reciprocal`. Vacuously true in the untransformable fallback (plain
  // linear has no domain restriction).
  const inDomainP = (p: number): boolean => !yTransformable || !tMustBePositive || denormT(p) > 0;
  // Acceptance-test bounds: `[0, 1]` when transformable (the definition of
  // `p`); the RAW `yRange` itself otherwise — a degenerate `[7, 7]` stays
  // `[7, 7]`, a single POINT, not an artificially widened `[0, 1]`.
  const pRangeLo = yTransformable ? 0 : yRange[0];
  const pRangeHi = yTransformable ? 1 : yRange[1];
  const offsetScale = yTransformable ? 1 : yWidth;
  const boxHP = TIER_STEP_FRAC * offsetScale;

  // Tier assignment runs on an x-sorted working copy (ties broken by
  // original index for a stable sort) so it always sweeps left-to-right
  // regardless of the caller's input order; `i` maps back to the ORIGINAL
  // index so the returned array lines up with `points`/`labels`. Each
  // candidate's own box width comes from ITS OWN label length (not an
  // average across the batch), and is a FULL width (N2), not a half-width
  // to be summed with the other box's. X stays plain linear/data-space —
  // there is no x-axis scale kind in this feature.
  const order = points.slice(0, n).map((pt, i) => ({
    i,
    x: pt.x,
    y: pt.y,
    w: xUnit * CHAR_FRACTION * Math.max(1, labels[i].length),
  }));
  order.sort((a, b) => a.x - b.x || a.i - b.i);

  // Round-3 M1 hardening, still needed: two tiers exactly one step apart
  // don't always subtract to EXACTLY one tier step in floating point, and a
  // naive strict `<` treated that as a real collision, silently wasting a
  // tier. Additive epsilons (scaled to each axis's own unit) shrink both
  // interval edges before comparing, absorbing that rounding regardless of
  // which way it falls, on EITHER axis.
  const xEps = xUnit * 1e-9;
  const yEpsP = offsetScale * 1e-9; // matches boxHP's own scale (1, or the fallback data width)
  // N2: true left-aligned/up-from-anchor 1-D interval overlap on each axis
  // — NOT a symmetric half-extent-sum comparison. Both boxes' `p` are
  // already in the SAME normalized-position space (P1+P2/Q1) — never
  // compared across different spaces.
  const boxesOverlapP = (
    ax: number, apP: number, aw: number,
    bx: number, bpP: number, bw: number,
  ): boolean =>
    ax + xEps < bx + bw - xEps && bx + xEps < ax + aw - xEps &&
    apP + yEpsP < bpP + boxHP - yEpsP && bpP + yEpsP < apP + boxHP - yEpsP;

  // Contract points 2/3 talk about `yRange` itself (the visible DATA
  // range) — this check is deliberately DATA-space, independent of scale.
  const inRange = (y: number): boolean => y >= yRange[0] && y <= yRange[1];
  // P1+P2/Q1: the in-range ACCEPTANCE TEST for a candidate tier, evaluated
  // ENTIRELY in normalized-position space — this is where pole/bounds
  // safety "falls out naturally": a candidate whose denormalized value
  // would cross a pole (`inDomainP`) or leave `[pRangeLo, pRangeHi]` is
  // rejected HERE, before `pBwd` is ever called on it, never
  // accepted-then-clamped. `[pRangeLo, pRangeHi]` is `[0, 1]` when
  // transformable, or the RAW `yRange` in the fallback branch (see
  // `pRangeLo`/`pRangeHi`'s own doc above for why this must NOT be `[0,1]`
  // for a degenerate zero-width range).
  const inRangeP = (p: number): boolean => inDomainP(p) && p >= pRangeLo && p <= pRangeHi;

  const placedBoxesP: { x: number; p: number; w: number }[] = [];
  const out: LabelPlacement[] = new Array(n);
  for (const pt of order) {
    const apexInRange = inRange(pt.y);
    let apexP = pFwd(pt.y);
    // An INDIVIDUAL apex outside this scale's own domain (e.g. a
    // non-positive value on an otherwise-valid log range) still gets
    // placed ENTIRELY in normalized-position space — never a per-point
    // fallback to linear geometry mixed into the same collision search as
    // its neighbours (that mixing is the P1+P2 root cause). Clamped to
    // `p = 0`, the range's own floor: the nearest representable position,
    // not a fabricated one.
    if (!Number.isFinite(apexP)) apexP = 0;

    const hasCollisionP = (x: number, p: number, w: number): boolean =>
      placedBoxesP.some((b) => boxesOverlapP(x, p, w, b.x, b.p, b.w));

    let chosenP: number | null = null;

    if (apexInRange) {
      // CONTRACT 2: the label is guaranteed inside `yRange` too. Up
      // (toward larger `p` — unambiguously "up" for every scale kind, no
      // sign logic needed) preferred; flip to down only when up would
      // leave `[0, 1]` (never merely because a tier is occupied — the
      // ordinary capacity search). NO post-hoc clamp (contract 4): the
      // exhaustion fallback is the apex's OWN normalized position.
      for (let tier = 0; tier <= MAX_STACK_TIERS && chosenP === null; tier++) {
        const offP = (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * offsetScale;
        const upP = apexP + offP;
        if (inRangeP(upP)) {
          if (!hasCollisionP(pt.x, upP, pt.w)) chosenP = upP;
          continue; // in range but occupied — next tier's UP, not down
        }
        const downP = apexP - offP;
        if (inRangeP(downP) && !hasCollisionP(pt.x, downP, pt.w)) chosenP = downP;
      }
      const finalP = chosenP ?? apexP; // exhausted -> the apex itself (trivially in range)
      out[pt.i] = { x: pt.x, y: pBwd(finalP) };
      placedBoxesP.push({ x: pt.x, p: finalP, w: pt.w });
    } else {
      // CONTRACT 3: apex outside `yRange` — placed relative to that apex
      // regardless, MAY be off-screen, and is NEVER pinned to the window
      // edge (no `[0, 1]` requirement here at all — only collision
      // avoidance, per contract 5's "same region" scoping). Still guards
      // against a candidate crossing to the WRONG side of a pole
      // (`inDomainP`) — a bare `pBwd`-finite check is not enough (round 6's
      // own repro: an apex at data-y 500 landed its label at -21.05,
      // finite but on the wrong side of `1/v`'s pole entirely).
      for (let tier = 0; tier <= MAX_STACK_TIERS && chosenP === null; tier++) {
        const offP = (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * offsetScale;
        const upP = apexP + offP;
        if (inDomainP(upP) && Number.isFinite(pBwd(upP)) && !hasCollisionP(pt.x, upP, pt.w)) {
          chosenP = upP;
          continue;
        }
        const downP = apexP - offP;
        if (inDomainP(downP) && Number.isFinite(pBwd(downP)) && !hasCollisionP(pt.x, downP, pt.w)) chosenP = downP;
      }
      const finalP = chosenP ?? apexP; // exhausted -> the apex's own position, never a boundary clamp
      out[pt.i] = { x: pt.x, y: pBwd(finalP) };
      placedBoxesP.push({ x: pt.x, p: finalP, w: pt.w });
    }
  }
  return out;
}
