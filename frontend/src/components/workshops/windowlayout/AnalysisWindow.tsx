// The Analysis window (WORKSPACE_LAYOUT_PLAN P4, D1/D7/D8 and the 2026-11-22
// "Analysis guide" decision): one window that guides the analysis of the
// dataset it follows, the focused plot's, unless pinned (like Data). Top to
// bottom: the technique (recorded, chosen or suggested, with an override saved
// on the dataset), the five steps with their status and the next one
// highlighted (click reopens a step), then every analysis tool, the ones that
// do not fit greyed out with a one-line reason. The tool list is the Analysis
// Center's own (lib/analysisCenter `analysisTools`, the shared requirement
// reasons, the same launch path), not a second registry. The title-bar half is
// ./AnalysisTitle. Lazy, its own chunk: what it needs from the layout comes in
// `host` (./analysisHost).

import { useMemo, useRef } from "react";

import { guideSteps } from "../../../lib/windowLayout/analysisGuide";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import AnalysisSteps from "./AnalysisSteps";
import AnalysisTechnique from "./AnalysisTechnique";
import AnalysisToolList from "./AnalysisToolList";
import type { AnalysisHost } from "./analysisHost";

function Guide({ dataset, host }: { dataset: Dataset; host: AnalysisHost }) {
  const datasets = useApp((s) => s.datasets);
  const results = useApp((s) => s.analysisResults);
  const staleDatasets = useApp((s) => s.staleDatasets);
  const staleFits = useApp((s) => s.staleFits);
  const figures = useApp((s) => s.editableFigures.filter((f) => f.bindings.datasetId === dataset.id).length);
  const reports = useApp((s) => s.reports.filter((r) => r.datasetId === dataset.id).length);
  const inspected = host.inspected;
  const toolsRef = useRef<HTMLHeadingElement>(null);
  const steps = useMemo(
    () =>
      guideSteps({
        dataset,
        datasets,
        inspected,
        staleDatasets,
        staleFits,
        results: results.filter((r) => r.sources.some((s) => s.datasetId === dataset.id)),
        figures,
        reports,
      }),
    [dataset, datasets, inspected, staleDatasets, staleFits, results, figures, reports],
  );
  return (
    <div className="qzk-wl-analysis">
      <AnalysisTechnique dataset={dataset} host={host} />
      <AnalysisSteps datasetId={dataset.id} steps={steps} host={host} onTools={() => toolsRef.current?.focus()} />
      <AnalysisToolList dataset={dataset} datasets={datasets} host={host} headingRef={toolsRef} />
    </div>
  );
}

/** The window's body. */
export default function AnalysisWindowBody({ host }: { host: AnalysisHost }) {
  const src = host.source;
  const dataset = useApp((s) => (src.kind === "dataset" ? s.datasets.find((d) => d.id === src.datasetId) : undefined));
  if (src.kind === "missing") {
    return (
      <div className="qzk-wl-empty" role="status">
        <div>
          <p>{src.reason}</p>
          <button type="button" className="qzk-wl-tbtn" title="Follow the focused plot again." onClick={host.unpin}>
            Unpin
          </button>
        </div>
      </div>
    );
  }
  if (src.kind === "none" || !dataset) {
    return (
      <div className="qzk-wl-analysis">
        <p className="qzk-wl-empty" role="status">
          {src.kind === "none" ? src.reason : ""}
        </p>
        <AnalysisToolList dataset={undefined} datasets={[]} host={host} />
      </div>
    );
  }
  return <Guide dataset={dataset} host={host} />;
}
