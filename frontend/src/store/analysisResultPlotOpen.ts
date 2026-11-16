// Open a saved analysis result's plot, and decide -- ONCE, for every consumer
// -- whether its fit is drawn there (I4, lib/overlayPlacement.ts). Split out of
// store/analysisResultActions.ts, whose Open / Send-to-report actions wrap it.
//
// Two separate decisions:
//   * PLOT-OPEN is legacy-tolerant: the plot opens on the RESOLVED binding
//     (store/analysisResultPlotResolve: a one-channel sheet's missing yKey is
//     channel 0, a stale xKey is time, an unrecorded xKey leaves the plot's X).
//   * FIT-DRAW is exact: the model is evaluated and drawn only when the resolved
//     X IS the X the fit recorded and the resolved Y the Y it recorded (when
//     recorded) and a curve on that X (`fitDrawBinding`). Anything else is
//     REFUSED with re-fit guidance -- a legacy fit with no recorded X included.
//
// Every consumer goes through `openResultPlot` and honours a refusal by its
// purpose: "open" shows the plot without the fit and says why; "report"
// refuses to send at all (and changes nothing), because a report must never
// silently ship a fitted figure without its fit -- and when the fit IS drawn,
// the send also checks the built figure carries it (`specCarriesFit`).

import type { FigureSpec } from "../lib/api/figures";
import { FIT_SERIES_LABEL, specCanCarryOverlays } from "../lib/overlaySpecShape";
import { fitDrawBinding, fitDrawRefusal } from "../lib/fitDrawBinding";
import { captureFit, type FigureOverlays } from "../lib/figureOverlays";
import { evaluateSavedFit } from "../lib/savedFitCurve";
import type { Dataset, FitOverlay, OverlayBinding } from "../lib/types";
import { resolveAnalysisResultPlot, type PreparedAnalysisResultPlot } from "./analysisResultPlotResolve";
import { useApp } from "./useApp";

/** The saved fit of result `id` on `prepared`'s plot (I4): "none" (not a fit
 *  result), "fail" (the fit is missing / broken / changed mid-load), "refused"
 *  (not the X/Y it was fitted on: re-fit), or the curve to draw. ONE gate for
 *  Open plot, Send to report and Build source figure (the saved figure keeps it). */
export type ResultFitCurve =
  | { kind: "none" }
  | { kind: "fail" | "refused"; why: string }
  | { kind: "drawn"; binding: OverlayBinding; y: (number | null)[] };

export async function resultFitCurve(id: string, prepared: PreparedAnalysisResultPlot): Promise<ResultFitCurve> {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const fitDatasetId = result?.settingsRef?.field === "fitSpec" ? result.settingsRef.datasetId : null;
  if (!fitDatasetId) return { kind: "none" };
  const fitDataset = fitDatasetId === prepared.dataset.id ? prepared.dataset : null;
  const fitSpec = fitDataset?.fitSpec;
  if (!fitDataset || !fitSpec) return { kind: "fail", why: "the saved fit is missing" };
  const params = fitSpec.params;
  if (!params?.length) return { kind: "fail", why: "the saved fit has no parameter values" };
  const binding = fitDrawBinding(fitDataset, prepared, fitSpec);
  if (!binding) return { kind: "refused", why: fitDrawRefusal(fitSpec) };
  const evaluated = await evaluateSavedFit(fitDataset, fitSpec, params, binding.yKey);
  if (typeof evaluated === "string") return { kind: "fail", why: evaluated };
  const now = useApp.getState();
  const current = now.analysisResults.find((item) => item.id === id);
  const currentDataset = now.datasets.find((item) => item.id === fitDataset.id);
  if (current?.settingsRef?.field !== "fitSpec" || current.settingsRef.datasetId !== fitDataset.id ||
      currentDataset?.fitSpec !== fitSpec || currentDataset.data !== fitDataset.data ||
      // A re-designation / role edit in flight changes where the fit may be drawn.
      currentDataset.columnDesignations !== fitDataset.columnDesignations ||
      currentDataset.channelRoles !== fitDataset.channelRoles) {
    return { kind: "fail", why: "the fit changed while its curve was loading" };
  }
  return { kind: "drawn", binding, y: evaluated };
}

/** Build source figure: the result's fit (through the SAME gate) as the new
 *  figure's own overlays, handed to the Quick Figure Builder -- never written
 *  to the canvas' shared fit slot, so cancelling changes nothing. A refusal
 *  builds the figure without it and says why. Undefined for a non-fit result. */
export async function resultFitFigureOverlays(id: string, prepared: PreparedAnalysisResultPlot): Promise<FigureOverlays | undefined> {
  const curve = await resultFitCurve(id, prepared);
  if (curve.kind === "drawn") {
    return captureFit({ datasetId: prepared.dataset.id, binding: curve.binding, y: curve.y }, prepared.dataset);
  }
  if (curve.kind !== "none") useApp.getState().setStatus(`the figure is built without the fit: ${curve.why}`);
  return undefined;
}

/** THE gate every consumer of a prepared result plot goes through (module header). */
export async function openResultPlot(
  id: string,
  bindingIndex: number,
  purpose: "open" | "report",
): Promise<(PreparedAnalysisResultPlot & { fit: FitOverlay | null }) | null> {
  const prepared = await resolveAnalysisResultPlot(id, bindingIndex);
  if (!prepared) return null;
  const curve = await resultFitCurve(id, prepared);
  const fail = (why: string) => { useApp.getState().setStatus(`can't ${purpose === "report" ? "send" : "open"} fitted plot: ${why}`); return null; };
  if (curve.kind === "fail") return fail(curve.why);
  const refused = curve.kind === "refused" ? curve.why : null;
  if (refused && purpose === "report") return fail(refused); // refused by the gate: nothing changed
  const apply = useApp.getState();
  apply.setActive(prepared.dataset.id);
  if (prepared.xChannel !== undefined) apply.setXKey(prepared.xChannel);
  apply.setYKeys(prepared.channels);
  const drawn = curve.kind === "drawn" ? { datasetId: prepared.dataset.id, binding: curve.binding, y: curve.y } : null;
  useApp.setState((s) => ({
    stageTab: "plot",
    fitOverlay: drawn,
    // The fitted curve is what was asked for: a stale hide of it would drop its fit (I1).
    ...(drawn && s.hiddenChannels.includes(drawn.binding.yKey)
      ? { hiddenChannels: s.hiddenChannels.filter((c) => c !== drawn.binding.yKey) } : {}),
  }));
  // Last, so nothing the open itself reports overwrites it.
  if (refused) useApp.getState().setStatus(`opened the plot without the fit: ${refused}`);
  return { ...prepared, fit: drawn }; // the overlay object drawn (null: none)
}

/** Does a built figure carry the fit? Only a request shape overlays can ride
 *  (`specCanCarryOverlays`, the predicate withAnalysisOverlays itself asks --
 *  so an encoding's appended category labels never count) whose columns past
 *  the dataset's own include the fit series. A stat figure (null) has none. */
export function specCarriesFit(spec: FigureSpec | null, ds: Pick<Dataset, "data">): boolean {
  return !!spec && specCanCarryOverlays(spec) &&
    spec.dataset.labels.slice(ds.data.labels.length).includes(FIT_SERIES_LABEL);
}
