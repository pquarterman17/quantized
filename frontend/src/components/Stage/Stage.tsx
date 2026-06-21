// Stage cell: tab strip (Plot · Worksheet) over the active view. The Worksheet
// is a read-only preview for this slice; the full interactive grid is Tier 2.

import PlotStage from "./PlotStage";
import Worksheet from "./Worksheet";
import { useApp } from "../../store/useApp";

export default function Stage() {
  const stageTab = useApp((s) => s.stageTab);
  const setStageTab = useApp((s) => s.setStageTab);

  return (
    <section className="qzk-stage-cell">
      <div className="qzk-tabs">
        <span
          className={`qzk-tab${stageTab === "plot" ? " active" : ""}`}
          onClick={() => setStageTab("plot")}
        >
          Plot
        </span>
        <span
          className={`qzk-tab${stageTab === "worksheet" ? " active" : ""}`}
          onClick={() => setStageTab("worksheet")}
        >
          Worksheet
        </span>
      </div>
      {stageTab === "plot" ? <PlotStage /> : <Worksheet />}
    </section>
  );
}
