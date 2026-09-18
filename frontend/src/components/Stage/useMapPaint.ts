// The 2-D map's paint effect, extracted from `MapStage.tsx` (P2.8 review
// round 3) — the same sibling-hook decomposition `useMapPointer`/`useMapCuts`/
// `useMapRoi` already use, and for the same reason: MapStage sits one line
// under the 400-line component ceiling, so the work finding 2 adds here has to
// be funded by an extraction rather than by growing that file.
//
// It owns exactly two things, both of which the canvas already drove:
//   1. the host box size in CSS px, kept in sync by the SAME ResizeObserver
//      that repaints (the ROI/slice overlays convert data<->px through the
//      same `plotRect` the canvas paints with, and refs are not a reliable
//      read during render);
//   2. the repaint itself — and, new in this round, REPORTING what the paint
//      actually used for its colour range.
//
// (2) is finding 2: `effectiveColorLimits` can replace the user's stored pair
// (in log mode a non-positive `lo` is raised to the grid's smallest positive
// cell, and a pair that is unusable after that raise falls back to the auto
// extent), and until now nothing told the user — the Inspector's Colour limits
// row went on showing a pair the renderer was ignoring. `draw` returns the
// pair it painted; this hook always keeps it in LOCAL state and returns it
// (`painted`, below) so the mounting `MapStage` instance can hand its OWN
// toolbar exactly what IT painted, never another instance's.
//
// It is ALSO mirrored into the store's transient per-dataset field
// (`reportMapPaintedLimits`), but only when `reportToStore` is true — review
// round 7, finding 1: that store slot is keyed by DATASET, while the pair
// `draw` returns is a property of this ONE mounted instance (its own z-
// channel pick). Two `MapStage`s open on the same dataset with different z
// channels used to fight over that one slot, each overwriting the other's
// "effective" hint with whatever it painted last. `MapStage.tsx` now passes
// `reportToStore: true` ONLY for the Stage-tab instance (`dataset` prop
// omitted — it follows the Library-active dataset), never for a `kind:"map"`
// document window; the Inspector's colour-limit row describes the Stage tab
// by rule (`components/Inspector/MapColorLimits.tsx`'s header), so it is the
// one instance whose paint the store's per-dataset slot can correctly speak
// for. `components/Inspector/MapColorLimits.tsx` reads it back; the store
// write is no-op-guarded there, so a repaint that changes nothing costs no
// re-render.
//
// The store slot is also CLEARED on unmount of the reporting instance
// (review round 7, finding 4): left in place, a closed-then-reopened Stage
// tab (or a project reload that lands on a dataset id a previous session
// used) would show a stale "effective" hint — a pair from a canvas that no
// longer exists — for as long as the fresh mount's first repaint takes.

import { useEffect, useRef, useState } from "react";

import type { ColormapName } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdataFetch";
import type { RsmPeak } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { draw, type ContourOptions } from "./mapRender";

export interface MapPaintArgs {
  hostRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  payload: MapPayload | null;
  /** The dataset this map shows — the key the painted limits are reported
   *  under, so two open maps on different datasets cannot report over each
   *  other. */
  dsId: string | null;
  cmap: ColormapName;
  logZ: boolean;
  colorLimits: [number, number] | null;
  /** The app-wide peak table; drawn only when it belongs to THIS map's
   *  dataset (unchanged rule, moved verbatim). */
  rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null;
  antialias: boolean;
  contour: ContourOptions;
  /** In the deps only: the frame/axis ink recolors from fresh tokens. */
  theme: string;
  accent: string;
  /** Mirror this instance's own painted pair into the store's per-dataset
   *  `mapPaintedLimits` slot (review round 7, finding 1 — see this file's
   *  header). `MapStage.tsx` passes `true` for the Stage-tab instance only. */
  reportToStore: boolean;
}

/** Paints the map and returns the host box size in CSS px, plus the [lo, hi]
 *  THIS instance's own last paint used — `undefined` before its first paint,
 *  `null` when nothing was paintable. */
export function useMapPaint({
  hostRef,
  canvasRef,
  payload,
  dsId,
  cmap,
  logZ,
  colorLimits,
  rsmPeaks,
  antialias,
  contour,
  theme,
  accent,
  reportToStore,
}: MapPaintArgs): { w: number; h: number; painted: readonly [number, number] | null | undefined } {
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [painted, setPainted] = useState<[number, number] | null | undefined>(undefined);
  // Reset THIS instance's own painted pair the moment its dataset changes —
  // a render-time adjustment (React's sanctioned "reset state on a prop
  // change" pattern), not an effect, so a dataset switch never shows one
  // stale frame of the PREVIOUS dataset's pair before the fresh paint lands.
  const paintedForRef = useRef(dsId);
  if (paintedForRef.current !== dsId) {
    paintedForRef.current = dsId;
    setPainted(undefined);
  }
  const reportMapPaintedLimits = useApp((s) => s.reportMapPaintedLimits);
  const clearMapPaintedLimits = useApp((s) => s.clearMapPaintedLimits);
  const { on: contourOn, levelCount: contourLevelCount, scale: contourScale } = contour;

  // (Re)paint the canvas when the grid / colormap / theme / size change.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    // Show peak markers only when they belong to this map's dataset.
    const markers = rsmPeaks && rsmPeaks.datasetId === dsId ? rsmPeaks.peaks : null;
    const opts = { on: contourOn, levelCount: contourLevelCount, scale: contourScale };
    const paint = () => {
      const paintedNow = draw(canvas, host, payload, cmap, logZ, markers, antialias, opts, colorLimits);
      // P2.8 round 4, finding 1: `draw` returns null both when there is
      // nothing to paint YET (no payload — a map still loading, or a
      // <3-channel dataset that never gets one) and when the limits genuinely
      // painted nothing. Only the second is news for the "effective" row;
      // reporting the first makes a loading map flash "nothing to paint at
      // these limits", blaming the user's typed range for a regrid that just
      // hasn't finished.
      if (payload) {
        setPainted(paintedNow);
        if (reportToStore) reportMapPaintedLimits(dsId, paintedNow);
      }
      const w = host.clientWidth;
      const h = host.clientHeight;
      setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
  }, [
    hostRef,
    canvasRef,
    payload,
    dsId,
    cmap,
    logZ,
    theme,
    accent,
    rsmPeaks,
    antialias,
    contourOn,
    contourLevelCount,
    contourScale,
    colorLimits,
    reportToStore,
    reportMapPaintedLimits,
  ]);

  // Drop this dataset's store entry on unmount of a REPORTING instance
  // (review round 7, finding 4) — never on a mere dataset-id change, which
  // the render-time reset above already handles for this instance's own
  // local `painted`, and never for a non-reporting (document-window)
  // instance, which never owned the entry in the first place. `dsId` is read
  // through a ref so the cleanup clears the id THIS effect actually reported
  // under, not whatever `dsId` happens to be by the time it fires.
  const dsIdRef = useRef(dsId);
  dsIdRef.current = dsId;
  useEffect(() => {
    if (!reportToStore) return;
    return () => clearMapPaintedLimits(dsIdRef.current);
  }, [reportToStore, clearMapPaintedLimits]);

  return { ...hostSize, painted };
}
