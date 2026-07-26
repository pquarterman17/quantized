// Classifies a committed view-limit change against the LIVE uPlot scale, so
// PlotViewport's lim-tracking effect (P0.4 follow-up #8: "committed zoom
// rebuilds the whole plot", docs/performance_envelope.md) can skip an
// expensive full uPlot rebuild whenever the committed value already matches
// what a live gesture already painted.
//
// Background: a zoom/pan gesture already paints live via `u.setScale`
// (wheelZoomPlugin/panPlugin, lib/uplotTools.ts), then `viewHistoryPlugin`
// debounces and commits the SAME bounds to the store (`recordView`). Before
// this fix, `PlotViewport`'s create/destroy effect listed `xLim`/`yLim`/
// `y2Lim` as deps, so that commit tore down and rebuilt the entire uPlot
// instance to reapply a range it had already painted — measured at zoom p95
// 238 ms vs the <100 ms target even with decimation active.
//
// Three outcomes:
//  - "noop"    — `next` is concrete and already (within a relative epsilon)
//                what the live scale shows. This is the hot path: the
//                gesture already called `u.setScale` directly, then
//                committed the SAME bounds to the store — nothing left to do.
//  - "apply"   — `next` is concrete but differs from the live scale (a typed
//                Inspector value, workspace restore, applied Origin figure,
//                or a back/forward-view jump landing on a bound the live
//                scale isn't already at). `u.setScale(key, next)` on the
//                LIVE instance reproduces exactly what a gesture does — and,
//                via uPlot's own `hooks.setScale` chain, still drives
//                `lib/windowsync`'s cross-window x sync and
//                `lib/plotDecimate`'s debounced re-bucket, same as a gesture.
//  - "rebuild" — `next` is null (autoscale) while `prev` was concrete, or a
//                non-finite `next` slips through. A null limit changes
//                `buildOpts`'s `scales.{x,y,y2}.range` from a frozen
//                `[min,max]` tuple to an autoscale function (or nothing at
//                all) — a config SHAPE `u.setScale` cannot express, since it
//                only nudges the CURRENT min/max, not the range function a
//                future resize/data-change/log-splits recompute would fall
//                back to. A full rebuild is the only way to restore that.
//
// A null->concrete transition is NOT special-cased into "apply": it is
// classified via the SAME live-scale comparison as any other concrete
// `next`. The common null->concrete case is a JUST-COMMITTED gesture from a
// previously-autoscaled view, where the live scale already equals `next`
// exactly — that's still "noop". A value typed into the Inspector while
// autoscaled, or a workspace restore, differs from live and falls through to
// "apply" instead.

/** A committed axis view limit — `null` means autoscale. */
export type Lim = [number, number] | null;

export type LimChangeKind = "noop" | "apply" | "rebuild";

const REL_EPS = 1e-9;

/** Relative-epsilon equality with a floor of 1 in the scale (so a pair of
 *  zero/near-zero values doesn't divide by ~0 and falsely disagree). */
function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true; // exact match — also correctly handles 0 === 0
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= REL_EPS * scale;
}

/** Classify one axis' limit change. `prev`/`next` are the previous/incoming
 *  committed store values (`null` = autoscale); `liveMin`/`liveMax` are the
 *  LIVE uPlot scale's current bounds (`u.scales.<key>.min/max`), or
 *  `null`/`undefined` when no live instance/scale exists yet. */
export function classifyLimChange(
  prev: Lim,
  next: Lim,
  liveMin: number | null | undefined,
  liveMax: number | null | undefined,
): LimChangeKind {
  if (next == null) return prev == null ? "noop" : "rebuild";
  const [nextMin, nextMax] = next;
  // Never hand a non-finite bound to u.setScale — fall back to the safe,
  // pre-existing full-rebuild path (buildOpts' own guards apply there).
  if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax)) return "rebuild";
  if (
    liveMin != null &&
    liveMax != null &&
    Number.isFinite(liveMin) &&
    Number.isFinite(liveMax) &&
    nearlyEqual(nextMin, liveMin) &&
    nearlyEqual(nextMax, liveMax)
  ) {
    return "noop";
  }
  return "apply";
}
