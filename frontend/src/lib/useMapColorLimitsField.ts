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
//   - the blur/Enter commit contract, shared with the sibling
//     `AxisLimits.tsx` through `lib/axisLim.parseLimFields`: both fields
//     blank commits `null` (auto); ONE blank field is auto for that side
//     only — a half-open pair such as `[null, max]` ("clip the top, leave
//     the bottom auto"), which the renderer fills from the data's own extent
//     (P2.8 residual (b); it used to read as `Number("") === 0` and commit
//     `[0, max]` while the field still showed "auto"). A non-numeric entry,
//     a fully typed inverted pair, or one that says nothing new, is a no-op
//     (no store write, no undo step — `store/mapView.ts`'s
//     `setMapColorLimits` already short-circuits on an unchanged pair, so
//     this hook does not need its own guard — see `commit()` below);
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

import type { HalfLim } from "./axisLim";
import { limFieldText, parseLimFields } from "./axisLimFields";
import { mapViewFor } from "./mapView";
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
  // Said only when a TYPED side was not honoured: a half-open pair's auto
  // side is filled from the data by design, which is not worth a note.
  const effective =
    colorLimits !== null && painted !== undefined && !honours(painted, colorLimits) ? painted : undefined;

  const [lo, setLo] = useState("");
  const [hi, setHi] = useState("");

  const format = (limits: HalfLim | null): [string, string] => [limFieldText(limits, 0), limFieldText(limits, 1)];

  // Mirror store -> fields whenever the committed pair changes elsewhere (a
  // dataset switch, undo restoring an earlier pair, another open window
  // editing this SAME dataset's limits).
  useEffect(() => {
    const [l, h] = format(colorLimits);
    setLo(l);
    setHi(h);
  }, [colorLimits]);

  const commit = (): void => {
    // Both blank -> auto; one blank -> auto for that side; invalid -> no-op.
    const next = parseLimFields(lo, hi);
    if (next === undefined) return;
    // No separate "unchanged pair" guard here (review round 7, finding 5): a
    // re-commit of the SAME pair already reaches `store/mapView.ts`'s
    // `setMapColorLimits`, which short-circuits on `sameColorLimits` — no
    // write, no undo entry, no re-render. A second guard here was dead code,
    // not defence in depth: deleting it changed nothing observable.
    setMapColorLimits(datasetId, next);
  };

  const revert = (): void => {
    const [l, h] = format(colorLimits);
    setLo(l);
    setHi(h);
  };

  return { lo, hi, setLo, setHi, commit, revert, effective };
}

/** Did the renderer paint every TYPED side of `typed` as typed? (`painted`
 *  null — nothing paintable — never honours a typed pair.) */
function honours(painted: readonly [number, number] | null, typed: HalfLim): boolean {
  if (!painted) return false;
  return (typed[0] === null || typed[0] === painted[0]) && (typed[1] === null || typed[1] === painted[1]);
}
