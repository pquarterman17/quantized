// Shared commit/undo logic behind the map's colour-limit fields
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 residual (a) — review round 3, finding 8:
// a `kind:"map"` document window on a NON-active dataset had no colour-limit
// control at all. The Inspector's `MapColorLimits.tsx` describes the ACTIVE
// dataset by rule; the map toolbar already covers colormap/scale per window
// — every one of those writes already takes THAT window's own dataset id,
// never the active one — but limits were the one toolbar control this round
// had not taken.
//
// Extracted out of `components/Inspector/MapColorLimits.tsx` so it and the
// new per-window toolbar control (`components/Stage/MapToolbarColorLimits.tsx`)
// share ONE commit/undo/effective-pair implementation instead of two copies
// drifting apart. Presentation (labels, layout, aria-labels, number
// formatting) stays with each caller — this hook owns only:
//   - the typed-field state, mirrored from the store's committed pair
//     whenever it changes elsewhere (a dataset switch, undo, another window
//     editing the SAME dataset);
//   - the blur/Enter commit contract, verbatim from the Inspector row: both
//     fields blank commits `null` (auto); a non-finite or inverted pair, or
//     one that says nothing new, is a no-op (no store write, no undo step —
//     `store/mapView.ts`'s `setMapColorLimits` already short-circuits on an
//     unchanged pair, so this hook does not need its own guard — see
//     `commit()` below). A HALF-blank pair is not symmetric, and this is a
//     pre-existing, deliberately PINNED contract, not a bug: `Number("")` is
//     `0`, so a blank min with a typed max commits `[0, max]` (one undo
//     entry); a typed min with a blank max is `min < max` failing and stays a
//     no-op. Pinned by `components/Inspector/MapColorLimits.test.tsx`'s "a
//     half-filled pair commits with the blank side read as 0" — carried over
//     verbatim from the sibling `AxisLimits.tsx` this control was copied
//     from, so changing it here would fork the two controls' one idiom;
//   - Escape-to-revert: discard the typed-but-uncommitted edit and restore
//     the fields to the last COMMITTED pair, without touching the store;
//   - the "effective" pair the renderer actually painted with, when it
//     differs from what was typed (review round 3, finding 2 — a log-mode
//     floor raise, or a fallback to the auto extent). By default this reads
//     the per-dataset store slot `mapPaintedLimits[datasetId]` (what the
//     Inspector's ACTIVE-dataset row wants); a caller with its own per-
//     INSTANCE painted pair (a `MapStage` mount — see its header) passes
//     `paintedOverride` to use that instead (review round 7, finding 1: the
//     store slot is per DATASET, but two open map windows on the SAME
//     dataset each pick their own z channel and paint independently, so the
//     store's "last writer wins" pair is wrong for every window but one).

import { useEffect, useState } from "react";

import { mapViewFor, sameColorLimits } from "./mapView";
import { useApp } from "../store/useApp";

export interface MapColorLimitsField {
  lo: string;
  hi: string;
  setLo: (v: string) => void;
  setHi: (v: string) => void;
  /** Blur/Enter: commit the typed pair (or auto, when both are blank). */
  commit: () => void;
  /** Escape: discard the uncommitted edit, restore the last committed pair. */
  revert: () => void;
  /** The [lo, hi] the map is ACTUALLY painting right now, only when it
   *  differs from the stored pair; `undefined` when there is nothing to say
   *  (nothing painted yet, or painting exactly what was typed). `null` means
   *  "nothing paintable at these limits". */
  effective: readonly [number, number] | null | undefined;
}

/** An explicit painted-pair override, WINNING over the store's per-dataset
 *  `mapPaintedLimits` slot (review round 7, finding 1). Wrapped in an object
 *  (rather than passed bare) so "no override" (omit the argument — the
 *  Inspector's call) and "override present but nothing painted YET" (a
 *  `MapStage` mount whose own paint effect has not fired once — pass
 *  `{ value: undefined }`) stay distinguishable; a bare second argument
 *  cannot tell those apart, since both read as `undefined`. */
export interface PaintedOverride {
  value: readonly [number, number] | null | undefined;
}

export function useMapColorLimitsField(
  datasetId: string | null,
  paintedOverride?: PaintedOverride,
): MapColorLimitsField {
  // Selects the VALUE `mapViewFor` returns, not the whole `mapViews` record
  // (P2.8 review round 3, finding 10 — `edit()` in store/mapView.ts always
  // allocates a fresh `mapViews` object on ANY dataset's write, so a selector
  // that returns `s.mapViews` itself re-renders on every OTHER open map's
  // edit too. `mapViewFor` returns the same reference for this dataset's own
  // entry — or the frozen `DEFAULT_MAP_VIEW` — across an unrelated write, so
  // zustand's default `Object.is` equality skips the re-render exactly the
  // way `MapStage.tsx`'s own `mapView` selector already relies on). Two open
  // map windows, each with this control, must not re-render each other's.
  const colorLimits = useApp((s) => mapViewFor(s.mapViews, datasetId).colorLimits);
  const setMapColorLimits = useApp((s) => s.setMapColorLimits);
  const hasOverride = paintedOverride !== undefined;
  // When an override is in play, this selector always returns `undefined` —
  // never reads the store's `mapPaintedLimits` — so a write into that slot by
  // ANOTHER instance (or by this dataset's own Stage-tab reporter) cannot
  // re-render an instance that no longer reads it.
  const storePainted = useApp((s) => (!hasOverride && datasetId ? s.mapPaintedLimits[datasetId] : undefined));
  const painted = hasOverride ? paintedOverride.value : storePainted;
  const effective =
    colorLimits !== null &&
    painted !== undefined &&
    !sameColorLimits(painted === null ? null : [painted[0], painted[1]], colorLimits)
      ? painted
      : undefined;

  const [lo, setLo] = useState("");
  const [hi, setHi] = useState("");

  const format = (limits: readonly [number, number] | null): [string, string] => [
    limits ? String(limits[0]) : "",
    limits ? String(limits[1]) : "",
  ];

  // Mirror store -> fields whenever the committed pair changes elsewhere (a
  // dataset switch, undo restoring an earlier pair, another open window
  // editing this SAME dataset's limits).
  useEffect(() => {
    const [l, h] = format(colorLimits);
    setLo(l);
    setHi(h);
  }, [colorLimits]);

  const commit = (): void => {
    if (lo === "" && hi === "") {
      if (colorLimits !== null) setMapColorLimits(datasetId, null); // both blank -> auto
      return;
    }
    const min = Number(lo);
    const max = Number(hi);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) return;
    // No separate "unchanged pair" guard here (review round 7, finding 5): a
    // re-commit of the SAME pair already reaches `store/mapView.ts`'s
    // `setMapColorLimits`, which short-circuits on `sameColorLimits` — no
    // write, no undo entry, no re-render. A second guard here was dead code,
    // not defence in depth: deleting it changed nothing observable.
    setMapColorLimits(datasetId, [min, max]);
  };

  const revert = (): void => {
    const [l, h] = format(colorLimits);
    setLo(l);
    setHi(h);
  };

  return { lo, hi, setLo, setHi, commit, revert, effective };
}
