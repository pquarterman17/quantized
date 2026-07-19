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
import { clampPlottedRange, rowsInXRange, type PlotPayload } from "../../lib/plotdata";
import { exportPlotPng, plotPngBlob } from "../../lib/plotExport";
import type { Dataset } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

// resetView/smartScale/savePng/copyData/snapshot — the fields the "actions"
// bag threaded through to PlotStageMenus/PlotStageOverlays as a single prop.
// Kept to exactly these 5 keys (not the drag-gesture callbacks below) since
// both callers build the bag as an object LITERAL, and PlotStageActions is
// their prop's structural type.
export interface PlotStageActions {
  resetView: () => void;
  smartScale: () => void;
  savePng: () => void;
  copyData: () => void;
  snapshot: () => void;
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
  onRegionSelect: (x0: number, x1: number) => void;
  onRangeSelect: (x0: number, x1: number) => void;
} {
  function resetView() {
    if (plotRef.current && displayPayload) {
      plotRef.current.setData(displayPayload.data, true); // resetScales = re-fit
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
    copyText(payloadToTSV(displayPayload)).then((ok) =>
      useApp.getState().setStatus(ok ? `copied ${nRows}×${nCols} to clipboard` : "clipboard unavailable"),
    );
  }

  // Snapshot: copy exactly what's on screen to the clipboard as a PNG — a quick
  // raster grab for pasting into notes/chat (distinct from the TSV copy and the
  // server-rendered vector Figure export). Falls back to a toast where the async
  // clipboard image API is unavailable (Firefox / insecure context).
  function snapshot() {
    const u = plotRef.current;
    if (!u) return;
    plotPngBlob(u).then(async (blob) => {
      if (!blob) {
        toast("snapshot failed", "danger");
        return;
      }
      const ok = await copyImage(blob);
      toast(ok ? "plot copied to clipboard" : "clipboard image unavailable", ok ? "ok" : "danger");
    });
  }

  // Baseline-workshop region pick (drag on the "region" tool): clamp to the
  // plotted x-extent, stash it via setRegionPicked, then exit to "zoom".
  function onRegionSelect(x0: number, x1: number) {
    if (!displayPayload) return;
    const range = clampPlottedRange(displayPayload.data[0] as (number | null)[], x0, x1);
    if (range) useApp.getState().setRegionPicked(range);
    useApp.getState().setPlotTool("zoom");
  }

  // Plot-brush: a dragged x-band → row indices (original order) → worksheet selection.
  function onRangeSelect(x0: number, x1: number) {
    if (!displayPayload) return;
    useApp.getState().setRowSelection(rowsInXRange(displayPayload.data[0] as (number | null)[], x0, x1));
  }

  return { resetView, smartScale, savePng, copyData, snapshot, onRegionSelect, onRangeSelect };
}
