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
// pair it painted; this hook hands it to the store
// (`reportMapPaintedLimits`, a transient per-dataset field), and
// `components/Inspector/MapColorLimits.tsx` reads it back. The store write is
// no-op-guarded there, so a repaint that changes nothing costs no re-render.

import { useEffect, useState } from "react";

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
}

/** Paints the map and returns the host box size in CSS px. */
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
}: MapPaintArgs): { w: number; h: number } {
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const reportMapPaintedLimits = useApp((s) => s.reportMapPaintedLimits);
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
      const painted = draw(canvas, host, payload, cmap, logZ, markers, antialias, opts, colorLimits);
      // P2.8 round 4, finding 1: `draw` returns null both when there is
      // nothing to paint YET (no payload — a map still loading, or a
      // <3-channel dataset that never gets one) and when the limits genuinely
      // painted nothing. Only the second is news for the Inspector's
      // "effective" row; reporting the first makes a loading map flash
      // "nothing to paint at these limits", blaming the user's typed range
      // for a regrid that just hasn't finished.
      if (payload) reportMapPaintedLimits(dsId, painted);
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
    reportMapPaintedLimits,
  ]);

  return hostSize;
}
