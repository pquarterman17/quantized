import type { AnalysisResultTable } from "../lib/analysisResult";
import { snapshotResultState } from "../lib/analysisResultFreshness";
import { createFigureDocument } from "../lib/figureDocument";
import { dedupeWindowTitle } from "../lib/plotview";
import type { StatisticalResultFigureDraft } from "../lib/statisticalResultFigures";
import { nextFigureId } from "./figureLifecycle";
import { useApp } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";

/** Materialize one saved statistical table view as a normal editable frozen
 * figure. The table-array identity is an optimistic-concurrency token: notes
 * may change during lazy loading, but changed scientific output refuses. */
export function createAnalysisStatisticalFigure(
  resultId: string,
  draft: StatisticalResultFigureDraft,
  expectedTables?: AnalysisResultTable[],
): string | null {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === resultId);
  if (!result || (expectedTables !== undefined && result.tables !== expectedTables)) {
    state.setStatus("can't create statistical figure: the saved result changed while loading; reopen the result and try again");
    return null;
  }
  const freshness = snapshotResultState(result, state.datasets);
  if (result.stale || freshness === "out-of-date") {
    state.setStatus(`can't create a figure from ${result.name}: run the analysis again from its source first`);
    return null;
  }
  if (freshness === "pending") {
    state.setStatus(`can't create a figure from ${result.name}: load the full source worksheet first`);
    return null;
  }
  if (draft.data.metadata?.analysisResultId !== result.id) {
    state.setStatus("can't create statistical figure: the saved figure data is unavailable");
    return null;
  }
  const id = nextFigureId();
  const name = dedupeWindowTitle(draft.name, state.editableFigures.map((figure) => figure.name));
  // Construct before mutating the store: an unexpected invalid snapshot must
  // not strand a blank window. createWindow then owns the gesture's single
  // history snapshot and every later mutation joins that same undo unit.
  const snapshot = { ...draft.data, metadata: {
    ...draft.data.metadata,
    snapshotResultState: freshness,
    sourceDatasetId: result.sources[0]?.datasetId ?? null,
    sourceFingerprint: result.sourceFingerprint ?? null,
  } };
  const document = createFigureDocument({
    id,
    name,
    datasetId: null,
    view: draft.view,
    mark: draft.mark,
    errors: draft.errors,
    data: { mode: "frozen", snapshot },
  });
  const windowId = state.createWindow(null, draft.view, name);
  useApp.setState((current) => ({
    editableFigures: [...current.editableFigures, document],
    plotWindows: current.plotWindows.map((window) =>
      window.id === windowId ? withPlotWindowDocument(window, document) : window),
    status: `created editable figure "${name}" from ${result.name}`,
  }));
  useApp.getState().focusWindow(windowId);
  return windowId;
}
