// The plot toolbar's "whole plot" actions — reset view, smart auto-scale,
// save-as-PNG, copy-data (TSV), and snapshot-to-clipboard — plus the two
// PlotViewport drag-gesture callbacks (onRegionSelect/onRangeSelect, added
// 2026-07-18 to free PlotStage headroom). Split out of PlotStage.tsx
// (component-ceiling ratchet, PROJECT_ORGANIZATION_PLAN #7): these are all
// self-contained callbacks over the live uPlot instance + the currently
// displayed payload, not state PlotStage itself needs to react to, so they
// extract cleanly with no behavior change.

import type { RefObject } from "react";
import type uPlot from "uplot";

import { suggestLogScale } from "../../lib/autoscale";
import { copyImage, copyText, payloadToTSV } from "../../lib/clipboard";
import { xExtent } from "../../lib/plotDecimate";
import { clampPlottedRange, rowsInXRange, type PlotPayload, type PlotSeriesSpec } from "../../lib/plotdata";
import { clipboardSvgSupported } from "../../lib/clipboard";
import { withYRange } from "../../lib/regionSelect";
// Bundle: `copyFigureCommand` (and the whole `figureSpec` transport builder
// behind it) is click-only — loaded via dynamic import in `copyFigure`/
// `copyFigureSvg` below, keeping it off the eager pre-paint path. The command
// itself already awaits a server render before writing to the clipboard, so
// the extra module-load await changes nothing about gesture context.
import { exportPlotPng, plotPngBlob } from "../../lib/plotExport";
import type { Dataset } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

// resetView/smartScale/savePng/copyData/copyFigure/snapshot — the fields the
// "actions" bag threaded through to PlotStageMenus/PlotStageOverlays as a
// single prop. Kept to exactly these 6 keys (not the drag-gesture callbacks
// below) since both callers build the bag as an object LITERAL, and
// PlotStageActions is their prop's structural type. copyFigure joined for
// MAIN #35 (publication copy); snapshot stays as the screen grab.
export interface PlotStageActions {
  resetView: () => void;
  smartScale: () => void;
  savePng: () => void;
  copyData: () => void;
  copyFigure: () => void;
  copyFigureSvg?: () => void;
  snapshot: () => void;
}

/** [min, max] across every plotted y series on the region box's own axis —
 *  `cols[0]` (x) is always skipped, and `cols[s]` aligns with `series[s-1]`,
 *  one x column ahead. Mirrors `uplotOpts`'s `regionYScale` EXACTLY (same
 *  rule, same series) so the read-back and the clamp never disagree: any
 *  secondary-axis (`axis:1`) series — a dy/dx differentiate overlay, or a
 *  dual-Y channel the user toggled to Y2 — is skipped whenever at least one
 *  PRIMARY series is plotted (its differently-calibrated range must never
 *  leak into the primary clamp); only when EVERY plotted series is on the
 *  secondary axis does the clamp fall back to ITS extent instead of skipping
 *  the clamp altogether (round-2 finding 1 — a lone Y2-toggled series is
 *  still a real, deliberately-fit series, not one with no extent at all).
 *  Via plotDecimate's already-eager `xExtent` reused per series (same
 *  "finite [min,max] of one array" shape). */
function plottedYExtent(cols: (number | null)[][], series: PlotSeriesSpec[]): [number, number] | null {
  const hasPrimary = series.some((s) => (s.axis ?? 0) !== 1);
  let lo = Infinity, hi = -Infinity;
  for (let s = 1; s < cols.length; s++) {
    const isSecondary = (series[s - 1]?.axis ?? 0) === 1;
    if (hasPrimary ? isSecondary : !isSecondary) continue;
    const e = xExtent(cols[s]);
    if (e) { lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Build the toolbar/context-menu action callbacks for the active plot, plus
 *  the two PlotViewport drag-gesture callbacks (onRegionSelect/onRangeSelect)
 *  — a separate return shape, not folded into PlotStageActions, since
 *  PlotStage passes those two straight to PlotViewport as their own props,
 *  never through the "actions" bag. */
export function usePlotStageActions(
  plotRef: RefObject<uPlot | null>,
  displayPayload: PlotPayload | null,
  active: Dataset | null | undefined,
): PlotStageActions & {
  onRegionSelect: (x0: number, x1: number, y0?: number, y1?: number) => void;
  onRangeSelect: (x0: number, x1: number) => void;
} {
  function resetView() {
    if (plotRef.current && displayPayload) {
      const u = plotRef.current;
      const before = {
        xLim: [u.scales.x.min ?? 0, u.scales.x.max ?? 1] as [number, number],
        yLim: [u.scales.y.min ?? 0, u.scales.y.max ?? 1] as [number, number],
      };
      plotRef.current.setData(displayPayload.data, true); // resetScales = re-fit
      useApp.getState().recordView(before, { xLim: null, yLim: null });
    }
  }

  // Smart auto-scale: pick log vs linear per axis from the plotted data's dynamic
  // range, then clear manual limits so the view re-fits. (#17)
  function smartScale() {
    if (!displayPayload) return;
    const cols = displayPayload.data as (number | null)[][];
    const xVals = cols[0] ?? [];
    const yVals: (number | null)[] = [];
    for (let s = 1; s < cols.length; s++) yVals.push(...cols[s]);
    const st = useApp.getState();
    st.setXScale(suggestLogScale(xVals) ? "log" : "linear");
    st.setYScale(suggestLogScale(yVals) ? "log" : "linear");
    st.setXLim(null);
    st.setYLim(null);
    st.setStatus("smart auto-scaled");
  }

  function savePng() {
    if (!plotRef.current) return;
    const stem = active?.name.replace(/\.[^.]+$/, "") ?? "plot";
    exportPlotPng(plotRef.current, `${stem}.png`);
  }

  // Copy exactly what's plotted (x + series, honoring x-channel / waterfall /
  // overlays) as TSV — paste straight into Origin / Excel / a notebook.
  function copyData() {
    if (!displayPayload) return;
    const nRows = displayPayload.data[0]?.length ?? 0;
    const nCols = displayPayload.series.length + 1; // + the x column
    void copyText(payloadToTSV(displayPayload)).then((ok) =>
      useApp.getState().setStatus(ok ? `copied ${nRows}×${nCols} to clipboard` : "clipboard unavailable"),
    );
  }

  // MAIN #35: the publication copy — renders through the SAME server-side
  // matplotlib path as "Export figure…" (one shared `buildFigureSpec`) so a
  // pasted figure matches an exported one on fonts, line widths, tick formats,
  // limits, legend placement and multi-panel layout. This is the default
  // "Copy figure"; `snapshot` below stays as the quick screen grab.
  function copyFigure() {
    void import("../../lib/copyFigureCommand").then((m) => m.runCopyFigureCommand(useApp.getState));
  }

  // MAIN #35: undefined where the browser won't take SVG, so the menu can
  // simply omit the entry rather than offer one that always fails.
  const copyFigureSvg = clipboardSvgSupported()
    ? () => void import("../../lib/copyFigureCommand").then((m) => m.runCopyFigureSvgCommand(useApp.getState))
    : undefined;

  // Snapshot: copy exactly what's on screen to the clipboard as a PNG — a quick
  // raster grab for pasting into notes/chat (distinct from the TSV copy and the
  // server-rendered vector Figure export). Falls back to a toast where the async
  // clipboard image API is unavailable (Firefox / insecure context).
  function snapshot() {
    const u = plotRef.current;
    if (!u) return;
    void plotPngBlob(u).then(async (blob) => {
      if (!blob) {
        toast("snapshot failed", "danger");
        return;
      }
      const ok = await copyImage(blob);
      toast(ok ? "plot copied to clipboard" : "clipboard image unavailable", ok ? "ok" : "danger");
    });
  }

  // Baseline-workshop region pick (drag on the "region" tool): clamp x to the
  // plotted x-extent exactly as before. A genuine 2-D box drag (MATLAB
  // `onBGMouseUp` parity, GAP #96/#20) also carries y0/y1 — buildOpts only
  // supplies them once the drag's vertical span clears its own pixel
  // threshold, so an ordinary x-only drag arrives here with y0/y1 undefined
  // and `withYRange` leaves the pick x-only, byte-identical to before this
  // existed. Stash via setRegionPicked, then exit to "zoom".
  function onRegionSelect(x0: number, x1: number, y0?: number, y1?: number) {
    if (!displayPayload) return;
    const x = clampPlottedRange(displayPayload.data[0] as (number | null)[], x0, x1);
    if (!x) return;
    const yExtent = plottedYExtent(displayPayload.data as (number | null)[][], displayPayload.series);
    const picked = withYRange(x, y0, y1, yExtent ? { min: yExtent[0], max: yExtent[1] } : undefined);
    useApp.getState().setRegionPicked(picked);
    useApp.getState().setPlotTool("zoom");
  }

  // Plot-brush: a dragged x-band → row indices (original order) → worksheet selection.
  function onRangeSelect(x0: number, x1: number) {
    if (!displayPayload) return;
    useApp.getState().setRowSelection(rowsInXRange(displayPayload.data[0] as (number | null)[], x0, x1));
  }

  return {
    resetView,
    smartScale,
    savePng,
    copyData,
    copyFigure,
    copyFigureSvg,
    snapshot,
    onRegionSelect,
    onRangeSelect,
  };
}
