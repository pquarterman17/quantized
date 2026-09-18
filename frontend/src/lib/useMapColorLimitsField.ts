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
//     see `store/mapView.ts`'s `setMapColorLimits` guard);
//   - Escape-to-revert: discard the typed-but-uncommitted edit and restore
//     the fields to the last COMMITTED pair, without touching the store;
//   - the "effective" pair the renderer actually painted with, when it
//     differs from what was typed (review round 3, finding 2 — a log-mode
//     floor raise, or a fallback to the auto extent).

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

export function useMapColorLimitsField(datasetId: string | null): MapColorLimitsField {
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
  const painted = useApp((s) => (datasetId ? s.mapPaintedLimits[datasetId] : undefined));
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
    if (colorLimits && colorLimits[0] === min && colorLimits[1] === max) return; // no change, no undo entry
    setMapColorLimits(datasetId, [min, max]);
  };

  const revert = (): void => {
    const [l, h] = format(colorLimits);
    setLo(l);
    setHi(h);
  };

  return { lo, hi, setLo, setHi, commit, revert, effective };
}
