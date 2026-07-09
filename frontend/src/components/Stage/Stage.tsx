// Stage cell: tab strip (Plot · Map · Worksheet) over the active view. The
// Plot tab renders `WindowCanvas` (MULTI_PLOT_PLAN item 3) — the MDI plot-
// window host; it collapses to today's single-window full-bleed `PlotStage`
// with no chrome whenever there's exactly one maximized window (the item-3/4
// migration guarantee).

import MapStage from "./MapStage";
import Worksheet from "./Worksheet";
import { useApp } from "../../store/useApp";
import WindowCanvas from "../windows/WindowCanvas";

const TABS = [
  { id: "plot", label: "Plot" },
  { id: "map", label: "Map" },
  { id: "worksheet", label: "Worksheet" },
] as const;

export default function Stage() {
  const stageTab = useApp((s) => s.stageTab);
  const setStageTab = useApp((s) => s.setStageTab);

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
