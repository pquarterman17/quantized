// Polar plot mode: render the active series with x interpreted as an angle (deg)
// and y as the radius. For angular-dependence data (signal vs sample rotation).
// Canvas2D, self-contained (mirrors MapStage's render approach); a "✺" toggle in
// the plot toolbar enters/leaves it. All plotted channels share one radial scale.
//
// This file is the thin FOCUSED-window wrapper (MULTI_PLOT_PLAN item 15): it
// reads the live singleton store fields and feeds them to `PolarStageCore`
// (the props-driven Canvas2D renderer) — a background window feeds the same
// core from its own `PlotView` snapshot instead (`windows/
// BackgroundAltModes.tsx`), so the two paths can never drift.

import { useSyncExternalStore } from "react";

import { getPolarMapMode, setPolarMapMode, subscribePolarMapMode } from "../../lib/polarMapMode";
import { useActiveDataset, useApp } from "../../store/useApp";
import PolarMapStage from "../workshops/polarmap/PolarMapStage";
import PlotRowRangeChip from "./PlotRowRangeChip";
import PolarStageCore from "./PolarStageCore";

export default function PolarStage() {
  const active = useActiveDataset();
  const yKeys = useApp((s) => s.yKeys);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const showGrid = useApp((s) => s.showGrid);
  const rowRange = useApp((s) => s.rowRange);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setPolarMode = useApp((s) => s.setPolarMode);
  const mapMode = useSyncExternalStore(subscribePolarMapMode, getPolarMapMode);

  return (
    <div className="qzk-stage">
      {mapMode ? (
        <PolarMapStage />
      ) : (
        <PolarStageCore
          dataset={active}
          yKeys={yKeys}
          seriesStyles={seriesStyles}
          showGrid={showGrid}
          rowRange={rowRange}
          theme={theme}
          accent={accent}
        />
      )}
      <div className="qzk-glass qzk-float-tools">
        <button aria-label="Polar map" className={`qzk-tool-btn${mapMode ? " active" : ""}`} title="Polar map / pole figure (heatmap of tilt x azimuth)" onClick={() => setPolarMapMode(!mapMode)}>
          ◍
        </button>
        <button aria-label="Cartesian plot" className="qzk-tool-btn active" title="Back to a cartesian plot" onClick={() => { setPolarMapMode(false); setPolarMode(false); }}>
          ✺
        </button>
      </div>
      <PlotRowRangeChip drawsEvery={mapMode} />
      {!active && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          Select a dataset to plot
        </div>
      )}
    </div>
  );
}
