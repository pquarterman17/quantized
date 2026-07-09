// Stage cell: tab strip (Plot · Map · Worksheet) over the active view. The
// Plot tab renders `WindowCanvas` (MULTI_PLOT_PLAN item 3) — the MDI plot-
// window host; it collapses to today's single-window full-bleed `PlotStage`
// with no chrome whenever there's exactly one maximized window (the item-3/4
// migration guarantee). `useWindowCommands` (item 5) is mounted here rather
// than in `WindowCanvas` (which only exists while the Plot tab is showing) or
// `App.tsx` (its curated-actions list is line-pinned) — Stage stays mounted
// for the app's whole lifetime regardless of which tab is active, so the
// Window menu/⌘K entries and their keyboard shortcuts always work.

import MapStage from "./MapStage";
import Worksheet from "./Worksheet";
import { useApp } from "../../store/useApp";
import { useWindowCommands } from "../windows/useWindowCommands";
import WindowCanvas from "../windows/WindowCanvas";

const TABS = [
  { id: "plot", label: "Plot" },
  { id: "map", label: "Map" },
  { id: "worksheet", label: "Worksheet" },
] as const;

export default function Stage() {
  const stageTab = useApp((s) => s.stageTab);
  const setStageTab = useApp((s) => s.setStageTab);
  useWindowCommands();

  return (
    <section className="qzk-stage-cell">
      <div className="qzk-tabs">
        {TABS.map((t) => (
          <span
            key={t.id}
            className={`qzk-tab${stageTab === t.id ? " active" : ""}`}
            onClick={() => setStageTab(t.id)}
          >
            {t.label}
          </span>
        ))}
      </div>
      {stageTab === "plot" ? <WindowCanvas /> : stageTab === "map" ? <MapStage /> : <Worksheet />}
    </section>
  );
}
