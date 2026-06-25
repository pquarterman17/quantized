// Stage cell: tab strip (Plot · Worksheet) over the active view. The Worksheet
// is a read-only preview for this slice; the full interactive grid is Tier 2.

import MapStage from "./MapStage";
import PlotStage from "./PlotStage";
import Worksheet from "./Worksheet";
import { useApp } from "../../store/useApp";

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
      {stageTab === "plot" ? <PlotStage /> : stageTab === "map" ? <MapStage /> : <Worksheet />}
    </section>
  );
}
