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
import { fitBands } from "../lib/api/fitStats";
import { FIT_SERIES_LABEL, specCanCarryOverlays } from "../lib/figureSpecOverlays";
import { fitDrawBinding } from "../lib/fitDrawBinding";
import { fullPlottedX } from "../lib/fitselectionActions";
import type { Dataset, FitSpec } from "../lib/types";
import { resolveAnalysisResultPlot, type PreparedAnalysisResultPlot } from "./analysisResultPlotResolve";
import { useApp } from "./useApp";

/** The status suffix for a refused fit. */
export const REFIT_GUIDANCE = "does not match the plot's X/Y channels; use Edit / Re-fit first";

/** `spec`'s model evaluated at every finite row of X `xKey`, or an error message. */
async function evaluateFit(ds: Dataset, spec: FitSpec, params: number[], xKey: number | null): Promise<(number | null)[] | string> {
  const xs = fullPlottedX(ds.data, xKey);
  const finite = xs.flatMap((value, index) => Number.isFinite(value) ? [{ value, index }] : []);
  if (!finite.length) return "the saved X channel has no finite values";
  try {
    const evaluated = await fitBands({
      model: spec.model,
      params,
      covar: null,
      x: finite.map((entry) => entry.value),
      // Only yFit is read (covar null -> no bands), so the counts are nominal.
      n_points: spec.nPoints ?? finite.length,
      n_free: spec.nFree ?? params.length,
    });
    if (!Array.isArray(evaluated.yFit) || evaluated.yFit.length !== finite.length ||
        !evaluated.yFit.every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))) {
      return "model evaluation returned the wrong number of fitted values";
    }
    const y: (number | null)[] = Array.from({ length: xs.length }, () => null);
    finite.forEach((entry, index) => { y[entry.index] = evaluated.yFit[index] ?? null; });
    return y;
  } catch (error) {
    return error instanceof Error ? error.message : "model evaluation failed";
  }
}

/** THE gate every consumer of a prepared result plot goes through (module header). */
export async function openResultPlot(
  id: string,
  bindingIndex: number,
  purpose: "open" | "report",
): Promise<(PreparedAnalysisResultPlot & { fitDrawn: boolean }) | null> {
  const prepared = await resolveAnalysisResultPlot(id, bindingIndex);
  if (!prepared) return null;
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const fitDatasetId = result?.settingsRef?.field === "fitSpec" ? result.settingsRef.datasetId : null;
  const fitDataset = fitDatasetId === prepared.dataset.id ? prepared.dataset : null;
  const fitSpec = fitDataset?.fitSpec;
  const fail = (why: string) => { useApp.getState().setStatus(`can't ${purpose === "report" ? "send" : "open"} fitted plot: ${why}`); return null; };
  if (fitDatasetId && (!fitDataset || !fitSpec)) return fail("the saved fit is missing");
  const params = fitSpec?.params;
  if (fitSpec && !params?.length) return fail("the saved fit has no parameter values");
  const binding = fitDataset && fitSpec ? fitDrawBinding(fitDataset, prepared, fitSpec) : null;
  const refused = !!fitSpec && !binding;
  if (refused && purpose === "report") return fail(`the saved fit ${REFIT_GUIDANCE}`); // nothing changed
  let fitY: (number | null)[] | null = null;
  if (fitDataset && fitSpec && params && binding) {
    const evaluated = await evaluateFit(fitDataset, fitSpec, params, binding.xKey);
    if (typeof evaluated === "string") return fail(evaluated);
    const now = useApp.getState();
    const current = now.analysisResults.find((item) => item.id === id);
    const currentDataset = now.datasets.find((item) => item.id === fitDataset.id);
    if (current?.settingsRef?.field !== "fitSpec" || current.settingsRef.datasetId !== fitDataset.id ||
        currentDataset?.fitSpec !== fitSpec || currentDataset.data !== fitDataset.data ||
        // A re-designation / role edit in flight changes where the fit may be drawn.
        currentDataset.columnDesignations !== fitDataset.columnDesignations ||
        currentDataset.channelRoles !== fitDataset.channelRoles) {
      return fail("the fit changed while its curve was loading");
    }
    fitY = evaluated;
  }
  const apply = useApp.getState();
  apply.setActive(prepared.dataset.id);
  if (prepared.xChannel !== undefined) apply.setXKey(prepared.xChannel);
  apply.setYKeys(prepared.channels);
  const drawn = fitY && binding ? { datasetId: prepared.dataset.id, binding, y: fitY } : null;
  useApp.setState((s) => ({
    stageTab: "plot",
    fitOverlay: drawn,
    // The fitted curve is what was asked for: a stale hide of it would drop its fit (I1).
    ...(drawn && s.hiddenChannels.includes(drawn.binding.yKey)
      ? { hiddenChannels: s.hiddenChannels.filter((c) => c !== drawn.binding.yKey) } : {}),
  }));
  // Last, so nothing the open itself reports overwrites it.
  if (refused) useApp.getState().setStatus(`opened the plot without the fit: it ${REFIT_GUIDANCE}`);
  return { ...prepared, fitDrawn: drawn !== null };
}

/** Does a built figure carry the fit? Only a request shape overlays can ride
 *  (`specCanCarryOverlays`, the predicate withAnalysisOverlays itself asks --
 *  so an encoding's appended category labels never count) whose columns past
 *  the dataset's own include the fit series. A stat figure (null) has none. */
export function specCarriesFit(spec: FigureSpec | null, ds: Pick<Dataset, "data">): boolean {
  return !!spec && specCanCarryOverlays(spec) &&
    spec.dataset.labels.slice(ds.data.labels.length).includes(FIT_SERIES_LABEL);
}
