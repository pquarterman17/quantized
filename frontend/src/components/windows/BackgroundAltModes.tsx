// The background (unfocused) window's ALTERNATE render modes (MULTI_PLOT_PLAN
// item 15): polar / statistics / per-channel stack, fed from the window's OWN
// `PlotView` snapshot instead of the live singleton store fields — the same
// contract `BackgroundPlotWindow`'s XY path has had since item 4, extended to
// the mode flags the view already carried. Each component here is a thin
// store-connected wrapper (theme/accent + the lazy-book fetch action) around
// a props-driven core (`PolarStageCore` / `StatStageCanvas`+`useStatStage` /
// `useMultiPanelStage`), mirroring how the focused `PolarStage`/`StatStage`/
// `MultiPanelStage` wrap the very same cores.
//
// Non-interactive by construction (Key Decision 2): no mode toolbars, no
// pickers, no tool plugins — `PlotWindowFrame`'s capture-phase pointerdown
// focuses the window before any interaction could land here.
//
// Row state matches each mode's FOCUSED path exactly (so N windows on one
// dataset stay mutually consistent): stat reads through
// `lib/rowstate.analysisData` (inside `useStatStage`); polar and the plain
// stack read the dataset raw, exactly as their focused counterparts do.
//
// Stat picker state (box/violin/…, group/value columns) is LOCAL to
// `useStatStage`, not part of `PlotView` — a background stat window therefore
// shows the dataset's DEFAULT statistical view, the same reset the focused
// stage undergoes when it unmounts and remounts today.

import { useId } from "react";

import { resolveTemplate } from "../../lib/plotTemplates";
import type { PlotBg, PlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import PolarStageCore from "../Stage/PolarStageCore";
import StatStageCanvas from "../Stage/StatStageCanvas";
import { useMultiPanelStage } from "../Stage/useMultiPanelStage";
import { useStatStage } from "../Stage/useStatStage";

export interface BackgroundModeProps {
  dataset: Dataset;
  view: PlotView;
}

/** Polar mode from the window's own view (focused twin: `PolarStage`). */
export function BackgroundPolarWindow({ dataset, view }: BackgroundModeProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  return (
    <PolarStageCore
      dataset={dataset}
      yKeys={view.yKeys}
      seriesStyles={view.seriesStyles}
      showGrid={view.showGrid}
      theme={theme}
      accent={accent}
    />
  );
}

// A stable no-op: a background window never carries a Graph Builder seed
// (seeding targets the FOCUSED stage), and a stable reference keeps
// useStatStage's seed effect from re-running per render.
const noSeedConsumed = () => {};

/** Statistics mode from the window's own view (focused twin: `StatStage`,
 *  minus its mode/column toolbar — see the module doc). */
export function BackgroundStatWindow({ dataset, view }: BackgroundModeProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const st = useStatStage({
    active: dataset,
    yKeys: view.yKeys,
    xKey: view.xKey,
    seriesOrder: view.seriesOrder,
    seed: null,
    onSeedConsumed: noSeedConsumed,
  });
  return (
    <>
      <StatStageCanvas data={st.draw} theme={theme} accent={accent} />
      {st.error && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}
        >
          {st.error}
        </div>
      )}
      {st.note && <div className="qzk-glass qzk-readout">{st.note}</div>}
    </>
  );
}

// Background windows never render the transient spatial/facet/break
// arrangements (focused-only singleton state) — stable empties so the hook's
// effects don't see fresh references every render.
const NO_DATASETS: Dataset[] = [];

export interface BackgroundStackWindowProps extends BackgroundModeProps {
  bg?: PlotBg;
}

/** Plain per-channel stack mode from the window's own view (focused twin:
 *  `MultiPanelStage`, which can additionally show the spatial/facet/break
 *  arrangements — those stay focused-only, see the module doc). */
export function BackgroundStackWindow({ dataset, view, bg }: BackgroundStackWindowProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const ensureBookData = useApp((s) => s.ensureBookData);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const template = resolveTemplate(view.plotTemplate);
  // Per-window sync key: this window's panels crosshair/x-zoom together, but
  // never with the focused stage's panels or another window's (cross-window
  // linking stays item 13's opt-in XY feature — deliberately NOT wired here).
  const instanceId = useId();
  const { hostRef, hostStyle } = useMultiPanelStage({
    active: dataset,
    datasets: NO_DATASETS,
    spatialPanels: null,
    facetPanels: null,
    breakPanels: null,
    yScale: view.yScale,
    xScale: view.xScale,
    xLim: view.xLim,
    yLim: view.yLim,
    xFmt: view.xFmt,
    yFmt: view.yFmt,
    showGrid: view.showGrid,
    showAxisBox: view.showAxisBox,
    fontSize: template.fontSize,
    baseLineWidth: view.plotTemplate === "screen" ? defaultLineWidth : template.lineWidth,
    defaultTrace,
    refLines: view.refLines,
    seriesStyles: view.seriesStyles,
    xKey: view.xKey,
    yKeys: view.yKeys,
    y2Keys: view.y2Keys,
    errKeys: view.errKeys,
    hiddenChannels: view.hiddenChannels,
    seriesOrder: view.seriesOrder,
    // No on-plot tools until the window is focused (Key Decision 2) — "zoom"
    // is the inert default the XY background path also uses.
    tool: "zoom",
    theme,
    accent,
    syncKey: `qz-win-stack-${instanceId}`,
    bg,
    ensureBookData,
  });
  return <div ref={hostRef} style={hostStyle} />;
}
