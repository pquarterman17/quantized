// What a layout window shows (WORKSPACE_LAYOUT_PLAN P1): a plot-family
// window's body, by the SAME kind dispatch WindowCanvas uses in classic mode
// (the focused plot window is the one interactive `PlotStage`; every other
// visible window is a live background renderer), the Style window (the
// Inspector's cards) or the Data window (the worksheet grid, ./DataWindow). The background renderers are the classic lazy chunks,
// so a window opened here and in classic is one fetch.
//
// Kept beside WindowCanvas rather than shared with it on purpose: classic
// mode stays byte-for-byte as it was until the layout is the default (plan
// Pn), and this subtree is lazy, so the duplication costs the eager bundle
// nothing.

import { lazyRegion } from "../../../lib/lazyRegion";
import type { PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import type { WindowRef } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { useWindowHydration } from "../../../store/windowHydration";
import { plotWindowDatasetId, plotWindowView } from "../../../store/windowDocuments";
import { plotIdOf } from "../../../store/windowLayoutActions";
import PlotStage, { type PlotStageProps } from "../../Stage/PlotStage";
import { MapWindow, WorksheetWindow } from "../../windows/DocumentWindow";
import DataWindowBody from "./DataWindow";

const BackgroundPlotWindow = lazyRegion(() => import("../../windows/BackgroundPlotWindow"), "Window");
const PanelPlotWindow = lazyRegion(() => import("../../windows/PanelPlotWindow"), "Window");
const SnapshotPlotWindow = lazyRegion(() => import("../../windows/SnapshotPlotWindow"), "Window");
const FrozenStatisticalFigureStage = lazyRegion(() => import("../../windows/FrozenStatisticalFigureStage"), "Plot");
// The Inspector chunk classic mode already loads; its width grip is hidden here (windowlayout.css).
const StyleBody = lazyRegion(() => import("../../Inspector/Inspector"), "Style");
const renderFrozenStage = (props: PlotStageProps) => <PlotStage {...props} />;

/** A plot-family window's dataset, or null when unbound or removed. */
export function datasetOf(win: PlotWindow, datasets: readonly Dataset[]): Dataset | null {
  const id = plotWindowDatasetId(win);
  return id ? (datasets.find((d) => d.id === id) ?? null) : null;
}

/** The title a window shows in its title bar and its accessible names. */
export function windowTitle(ref: WindowRef, plotWindows: readonly PlotWindow[], datasets: readonly Dataset[]): string {
  if (ref === "style") return "Style";
  if (ref === "data") return "Data";
  if (ref === "analysis") return "Analysis";
  const id = plotIdOf(ref);
  const win = id === null ? undefined : plotWindows.find((w) => w.id === id);
  if (win) return win.title || datasetOf(win, datasets)?.name || "Untitled graph";
  return ref.startsWith("tool:") ? ref.slice(5) : ref;
}

export function PlotWindowBody({ win }: { win: PlotWindow }) {
  const focused = useApp((s) => s.focusedWindowId === win.id);
  const datasets = useApp((s) => s.datasets);
  const staged = useWindowHydration((s) => s.pending.has(win.id)) && !focused;
  const dataset = datasetOf(win, datasets);
  if (staged) {
    return (
      <div className="qzk-plotwin-placeholder" aria-hidden="true">
        {win.title || "…"}
      </div>
    );
  }
  if (win.kind === "snapshot" && win.snapshot) return <SnapshotPlotWindow frozen={win.snapshot} view={win.view} bg={win.bg} />;
  if (win.kind === "worksheet") return <WorksheetWindow dataset={dataset} windowId={win.id} />;
  if (win.kind === "map") return <MapWindow dataset={dataset} />;
  if (win.kind === "panel") return <PanelPlotWindow win={win} datasets={datasets} />;
  if (focused) {
    return win.document?.data.mode === "frozen" ? (
      <FrozenStatisticalFigureStage figureDocument={win.document} render={renderFrozenStage} />
    ) : (
      <PlotStage />
    );
  }
  return (
    <BackgroundPlotWindow
      dataset={dataset}
      view={plotWindowView(win)}
      bg={win.bg}
      linkGroup={win.linkGroup}
      linkYGroup={win.linkYGroup}
      document={win.document}
      windowId={win.id}
    />
  );
}

/** The body of any layout window the host renders today. */
export default function LayoutWindowContent({ refId }: { refId: WindowRef }) {
  const id = plotIdOf(refId);
  const win = useApp((s) => (id === null ? undefined : s.plotWindows.find((w) => w.id === id)));
  if (refId === "style") return <StyleBody />;
  if (refId === "data") return <DataWindowBody />;
  if (win) return <PlotWindowBody win={win} />;
  return null;
}
