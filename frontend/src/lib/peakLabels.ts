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
 *  ONE SPACE, ROOT-CAUSE FIX (P1+P2, round 6): the O3/N1 implementations
 *  computed OFFSETS in transformed space but immediately converted each
 *  candidate back to data space before the collision box height, the range
 *  bounds, and the acceptance tests — all still linear — ever saw it. Two
 *  confirmed consequences of that split: (a) on a `"reciprocal"` scale an
 *  offset could push a candidate ACROSS the `1/v` pole; the sign-flipped
 *  result was still finite, so the (data-space) guard passed and a label
 *  landed BELOW the peak it names; (b) on a `"log"` scale, a fixed
 *  LINEAR-data-unit box height is wildly mismatched to log-spaced tier
 *  offsets near the low end of the range, exhausting all `MAX_STACK_TIERS`
 *  and collapsing a dense low-y cluster that linear mode would have
 *  separated cleanly. THE FIX: transform ONCE at entry, invert ONCE at
 *  exit. Apexes, offsets, tier steps, the collision box height, the range
 *  bounds, and every acceptance test all live in ONE transformed space for
 *  the ENTIRE search — never mixed with linear-space geometry mid-search.
 *  For `"linear"` that transformed space just IS data space (`fwd`/`bwd`
 *  are the identity), so this is not a special case bolted on top; it is
 *  the same code path degenerating to the old linear math. Pole/bounds
 *  safety then falls out naturally: the in-range acceptance test on a
 *  candidate is evaluated ENTIRELY in transformed space, so a candidate
 *  that would cross a pole (for reciprocal, `t <= 0`) is simply never
 *  accepted — never a post-hoc clamp (contract point 4 below still holds).
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
 *  BOX GEOMETRY (N2, round 4; now computed in the SAME transformed space as
 *  everything else — P1+P2, round 6): each box is `[x, x+w) × [t, t+boxH)`
 *  — left-aligned extending right (x stays plain linear/data-space; there
 *  is no x-axis scale in this feature), up-from-anchor extending toward
 *  larger transformed-t — matching `lib/uplotOverlays.ts`'s actual draw
 *  geometry (`annotationLayout`/`clampAnnotationLabelX`) in spirit, not a
 *  symmetric centered/half-extent-sum box (which under-counts a wide label
 *  followed by a narrow one). The renderer's small constant pixel offsets
 *  (`+6`/`-2`) have no data-space equivalent without the live
 *  pixels-per-data-unit scale this pure function deliberately doesn't take.
 *
 *  Returns one `{x, y}` per label, in the SAME ORDER as `points`/`labels`
 *  (result[i] corresponds to points[i]/labels[i]) — collision resolution
 *  sorts an internal working copy by x (RULING 6: "ordering is stable (sort
 *  by x)"); the input/output arrays the caller sees are never reordered.
 *
 *  Degenerate inputs never produce NaN/Infinity: a zero-width or
 *  descending range, every peak sharing one x, a single peak, a range that
 *  doesn't transform for the given `yScale` (falls back to the identity —
 *  i.e. linear — for the WHOLE call, never partially), or an individual
 *  apex outside the scale's own domain (e.g. non-positive on log — clamped
 *  to the range's own transformed floor, still fully in transformed space,
 *  never a linear-space fallback mixed into the same search) all resolve
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

  // P1+P2: ONE working transform for the ENTIRE call — `fwdT`/`bwdT` are
  // the real `fwd`/`bwd` only when `yRange` transforms cleanly for
  // `yScale` (both bounds finite and distinct once transformed);
  // otherwise identity, so the WHOLE search runs in plain data space for
  // every point — never a per-point mix of the two. `yDir`: `fwd` is not
  // always increasing with `v` (log10 is; reciprocal's `1/v` is
  // DECREASING — larger data-y means SMALLER transformed-t), so "toward
  // larger DATA y" needs a sign that depends on the transform's own slope.
  const { fwd, bwd, tMustBePositive } = yTransform(yScale);
  const yLoRaw = fwd(yRange[0]);
  const yHiRaw = fwd(yRange[1]);
  const yTransformable = Number.isFinite(yLoRaw) && Number.isFinite(yHiRaw) && yLoRaw !== yHiRaw;
  const fwdT = yTransformable ? fwd : (v: number): number => v;
  const bwdT = yTransformable ? bwd : (t: number): number => t;
  const yMinT = yTransformable ? Math.min(yLoRaw, yHiRaw) : Math.min(yRange[0], yRange[1]);
  const yMaxT = yTransformable ? Math.max(yLoRaw, yHiRaw) : Math.max(yRange[0], yRange[1]);
  const yWidthT = finiteWidth([yMinT, yMaxT]);
  const yDir = yTransformable && yHiRaw < yLoRaw ? -1 : 1;
  const boxHT = TIER_STEP_FRAC * yWidthT; // N2 rendered-text "height," now in the SAME units as everything else
  // A candidate `t` must stay in the transform's own DOMAIN, not merely
  // `bwdT`-finite — see `yTransform`'s `tMustBePositive` doc for why a bare
  // finite-check let a pole-crossing candidate through for `reciprocal`.
  const inDomain = (t: number): boolean => !tMustBePositive || t > 0;

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
  const yEpsT = yWidthT * 1e-9;
  // N2: true left-aligned/up-from-anchor 1-D interval overlap on each axis
  // — NOT a symmetric half-extent-sum comparison. Both boxes' `t` are
  // already in the SAME transformed space (P1+P2) — never compared across
  // different spaces.
  const boxesOverlapT = (
    ax: number, atT: number, aw: number,
    bx: number, btT: number, bw: number,
  ): boolean =>
    ax + xEps < bx + bw - xEps && bx + xEps < ax + aw - xEps &&
    atT + yEpsT < btT + boxHT - yEpsT && btT + yEpsT < atT + boxHT - yEpsT;

  // Contract points 2/3 talk about `yRange` itself (the visible DATA
  // range) — this check is deliberately DATA-space, independent of scale.
  const inRange = (y: number): boolean => y >= yRange[0] && y <= yRange[1];
  // P1+P2: the in-range ACCEPTANCE TEST for a candidate tier, evaluated
  // ENTIRELY in transformed space — this is where pole/bounds safety
  // "falls out naturally": a candidate whose transformed value would cross
  // a pole (`inDomain`) or leave `[yMinT, yMaxT]` is rejected HERE, before
  // `bwdT` is ever called on it, never accepted-then-clamped.
  const inRangeT = (t: number): boolean => inDomain(t) && t >= yMinT && t <= yMaxT;

  const placedBoxesT: { x: number; t: number; w: number }[] = [];
  const out: LabelPlacement[] = new Array(n);
  for (const pt of order) {
    const apexInRange = inRange(pt.y);
    let apexT = fwdT(pt.y);
    // An INDIVIDUAL apex outside this scale's own domain (e.g. a
    // non-positive value on an otherwise-valid log range) still gets
    // placed ENTIRELY in transformed space — never a per-point fallback to
    // linear geometry mixed into the same collision search as its
    // neighbours (that mixing is the P1+P2 root cause). Clamped to the
    // domain floor `yMinT`: the nearest representable position, not a
    // fabricated one.
    if (!Number.isFinite(apexT)) apexT = yMinT;

    const hasCollisionT = (x: number, t: number, w: number): boolean =>
      placedBoxesT.some((b) => boxesOverlapT(x, t, w, b.x, b.t, b.w));

    let chosenT: number | null = null;

    if (apexInRange) {
      // CONTRACT 2: the label is guaranteed inside `yRange` too. Up
      // (toward larger DATA y — `yDir` accounts for a decreasing
      // transform) preferred; flip to down only when up would leave the
      // TRANSFORMED range (never merely because a tier is occupied — the
      // ordinary capacity search). NO post-hoc clamp (contract 4): the
      // exhaustion fallback is the apex's OWN transformed position.
      for (let tier = 0; tier <= MAX_STACK_TIERS && chosenT === null; tier++) {
        const offT = yDir * (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yWidthT;
        const upT = apexT + offT;
        if (inRangeT(upT)) {
          if (!hasCollisionT(pt.x, upT, pt.w)) chosenT = upT;
          continue; // in range but occupied — next tier's UP, not down
        }
        const downT = apexT - offT;
        if (inRangeT(downT) && !hasCollisionT(pt.x, downT, pt.w)) chosenT = downT;
      }
      const finalT = chosenT ?? apexT; // exhausted -> the apex itself (trivially in range)
      out[pt.i] = { x: pt.x, y: bwdT(finalT) };
      placedBoxesT.push({ x: pt.x, t: finalT, w: pt.w });
    } else {
      // CONTRACT 3: apex outside `yRange` — placed relative to that apex
      // regardless, MAY be off-screen, and is NEVER pinned to the window
      // edge (no `[yMinT, yMaxT]` requirement here at all — only collision
      // avoidance, per contract 5's "same region" scoping). Still guards
      // against a candidate crossing to the WRONG side of a pole
      // (`inDomain`) — a bare `bwdT`-finite check is not enough (round 6's
      // own repro: an apex at data-y 500 landed its label at -21.05,
      // finite but on the wrong side of `1/v`'s pole entirely).
      for (let tier = 0; tier <= MAX_STACK_TIERS && chosenT === null; tier++) {
        const offT = yDir * (BASE_OFFSET_FRAC + tier * TIER_STEP_FRAC) * yWidthT;
        const upT = apexT + offT;
        if (inDomain(upT) && Number.isFinite(bwdT(upT)) && !hasCollisionT(pt.x, upT, pt.w)) {
          chosenT = upT;
          continue;
        }
        const downT = apexT - offT;
        if (inDomain(downT) && Number.isFinite(bwdT(downT)) && !hasCollisionT(pt.x, downT, pt.w)) chosenT = downT;
      }
      const finalT = chosenT ?? apexT; // exhausted -> the apex's own position, never a boundary clamp
      out[pt.i] = { x: pt.x, y: bwdT(finalT) };
      placedBoxesT.push({ x: pt.x, t: finalT, w: pt.w });
    }
  }
  return out;
}
