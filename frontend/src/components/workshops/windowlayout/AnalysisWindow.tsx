// The Analysis window (WORKSPACE_LAYOUT_PLAN P4, D1/D7/D8 and the 2026-11-22
// "Analysis guide" decision): one window that guides the analysis of the
// dataset it follows, the focused plot's, unless pinned (like Data). Top to
// bottom: the technique (recorded, chosen or suggested, with an override saved
// on the dataset), the five steps with their status and the next one
// highlighted (click reopens a step), then every analysis tool, the ones that
// do not fit greyed out with a one-line reason. The tool list is the Analysis
// Center's own (lib/analysisCenter `analysisTools`, the shared requirement
// reasons, the same launch path), not a second registry.

import { useEffect, useMemo, useRef } from "react";

import { guideSteps } from "../../../lib/windowLayout/analysisGuide";
import { pinOf, resolveFollow, type FollowSource } from "../../../lib/windowLayout/pins";
import type { Dataset } from "../../../lib/types";
import { pinAnalysis, unpinAnalysis } from "../../../store/layoutToolActions";
import { useApp } from "../../../store/useApp";
import AnalysisSteps from "./AnalysisSteps";
import AnalysisTechnique from "./AnalysisTechnique";
import AnalysisToolList from "./AnalysisToolList";
import { useInspected } from "./inspectedDatasets";
import { announce } from "./layoutAnnounce";

/** What the Analysis window shows, from the live store. */
export function useAnalysisSource(): FollowSource {
  const pinned = useApp((s) => pinOf(s.windowLayout, "analysis"));
  const datasets = useApp((s) => s.datasets);
  // Only a plot window takes focus; its dataset is the facade's activeId (as for Data).
  const plotDatasetId = useApp((s) => (s.plotWindows.some((w) => w.id === s.focusedWindowId && w.kind === "plot") ? s.activeId : null));
  return resolveFollow(pinned, datasets, plotDatasetId);
}

const MODE: Record<FollowSource["mode"], string> = { plot: "following the plot", pinned: "pinned" };

/** The title-bar half: dataset, mode and the pin toggle. */
export function AnalysisTitle() {
  const src = useAnalysisSource();
  const name = useApp((s) => (src.kind === "dataset" ? s.datasets.find((d) => d.id === src.datasetId)?.name : undefined));
  const pinned = src.mode === "pinned";
  const label = src.kind === "dataset" ? (name ?? "dataset") : src.kind === "missing" ? "removed dataset" : "no dataset";
  const mode = MODE[src.mode];
  // Say what the guide now shows when it changes (focus move, pin); the first render stays silent.
  const key = `${src.kind}:${src.mode}:${src.kind === "dataset" ? src.datasetId : ""}`;
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current !== key) announce(`Analysis shows ${label}, ${mode}`);
    prev.current = key;
  }, [key, label, mode]);
  return (
    <>
      <span className="qzk-wl-data-src" data-testid="analysis-source">
        <span className="qzk-wl-data-name">{label}</span>
        <span className="qzk-wl-data-mode"> · {mode}</span>
      </span>
      <button
        type="button"
        className="qzk-wl-close qzk-wl-pin"
        aria-label={`Pin the Analysis window (${mode})`}
        aria-pressed={pinned}
        disabled={!pinned && src.kind !== "dataset"}
        title={pinned ? "Pinned to this dataset; press to follow the plot again." : "Now following the plot; press to keep this dataset whatever plot is focused."}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => (pinned ? unpinAnalysis() : src.kind === "dataset" && pinAnalysis(src.datasetId))}
      >
        ⚲
      </button>
    </>
  );
}

function Guide({ dataset }: { dataset: Dataset }) {
  const datasets = useApp((s) => s.datasets);
  const results = useApp((s) => s.analysisResults);
  const staleDatasets = useApp((s) => s.staleDatasets);
  const staleFits = useApp((s) => s.staleFits);
  const figures = useApp((s) => s.editableFigures.filter((f) => f.bindings.datasetId === dataset.id).length);
  const reports = useApp((s) => s.reports.filter((r) => r.datasetId === dataset.id).length);
  const inspected = useInspected(dataset.id);
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
      <AnalysisTechnique dataset={dataset} />
      <AnalysisSteps datasetId={dataset.id} steps={steps} onTools={() => toolsRef.current?.focus()} />
      <AnalysisToolList dataset={dataset} datasets={datasets} headingRef={toolsRef} />
    </div>
  );
}

/** The window's body. */
export default function AnalysisWindowBody() {
  const src = useAnalysisSource();
  const dataset = useApp((s) => (src.kind === "dataset" ? s.datasets.find((d) => d.id === src.datasetId) : undefined));
  if (src.kind === "missing") {
    return (
      <div className="qzk-wl-empty" role="status">
        <div>
          <p>{src.reason}</p>
          <button type="button" className="qzk-wl-tbtn" title="Follow the focused plot again." onClick={unpinAnalysis}>
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
        <AnalysisToolList dataset={undefined} datasets={[]} />
      </div>
    );
  }
  return <Guide dataset={dataset} />;
}
